import { Centrifuge } from 'centrifuge';
import type { TransportEndpoint } from 'centrifuge';
import type { ClientLike, SubscriptionLike, SubscriptionOptionsLike } from './client.js';
import { presenceFor, parseWithin, siteChannel, siteResourceChannel, streamChannel, tenantActionChannel, tenantChannel, tenantResourceChannel, userChannel } from '../channels/index.js';
import type { Channel } from '../channels/index.js';
import { SeenIds, actionOf, asEnvelope } from './envelope.js';
import type { Envelope } from './envelope.js';
import type { EnvelopeListener, RawListener, ResyncContext, SubscribedContext, TalkbackErrorContext, TalkbackHandle } from './handles.js';

/** A value that may change at run time, hence a getter rather than a value. */
export type Provider<T> = () => T;

export interface TalkbackOptions {
  /**
   * The Centrifugo base URL, e.g. `https://rt.revenexx.com`. It expands to the full
   * fallback chain unless `endpoints` is given.
   */
  host: string;

  /**
   * The active tenant. A PROVIDER, not a value: the tenant changes at run time. In
   * `studio-integrations` it is `usePlatformTenant().slug`, a computed.
   */
  tenant: Provider<string>;

  /** The signed-in user. A provider for the same reason. */
  userId: Provider<string>;

  /** The BFF route built with `createTokenRoute`. */
  tokenEndpoint: string;

  /** The BFF route built with `createSubscriptionTokenRoute`. */
  subscriptionTokenEndpoint: string;

  /**
   * Channels to carry in the connection token's `subs` claim, so they are subscribed on
   * connect with no subscribe round trip. More than `maxSubsPerToken` is an error that
   * points at the dynamic path.
   */
  channels?: readonly string[];

  /** Mirrors `TALKBACK_MAX_SUBS_PER_TOKEN`, whose value the browser cannot see. */
  maxSubsPerToken?: number;

  /**
   * Full control over the transport chain. Only for a deployment where the three
   * transports do not sit on one origin — the default derived from `host` is what
   * `centrifugo/config.yaml` actually serves.
   */
  endpoints?: TransportEndpoint[];

  fetch?: typeof globalThis.fetch;

  /**
   * How many event ids to remember for deduplication. The default holds a long-lived
   * dashboard's working set without growing for the lifetime of the tab.
   */
  dedupeCapacity?: number;

  /** Passed straight to Centrifuge. */
  debug?: boolean;

  /**
   * Replaces the Centrifuge client. The seam exists so a consumer can drive its realtime
   * paths without Centrifugo — `@revenexx/talkback-js/testing` ships a fake that
   * satisfies it, and that testability is what lets a team delete a polling loop instead
   * of keeping it as a safety net. Left unset in production.
   */
  client?: (endpoints: TransportEndpoint[], opts: { getToken: () => Promise<string>; debug: boolean }) => ClientLike;
}

/**
 * The three transports, in the order Centrifuge should try them.
 *
 * NOT OPT-IN, and that is a policy decision rather than a convenience. T0.2 — whether
 * BunkerWeb and Traefik pass a WebSocket upgrade at all — is still open, and ADR-0093 §8
 * names SSE and HTTP streaming as exactly the mitigation for an edge that will not
 * upgrade. Both are already enabled in `centrifugo/config.yaml`, where they are off by
 * default in Centrifugo, with the same reasoning written down.
 */
export function defaultEndpoints(host: string): TransportEndpoint[] {
  const base = host.replace(/\/+$/, '');
  const ws = base.replace(/^http/, 'ws');
  return [
    { transport: 'websocket', endpoint: `${ws}/connection/websocket` },
    { transport: 'http_stream', endpoint: `${base}/connection/http_stream` },
    { transport: 'sse', endpoint: `${base}/connection/sse` },
  ];
}

/**
 * Wraps the real client in the narrow seam.
 *
 * An adapter rather than widening `ClientLike` to fit: `Centrifuge.removeSubscription`
 * takes a full `Subscription`, so a seam that promised to accept any `SubscriptionLike`
 * would be lying — TypeScript catches that, correctly. Widening the seam to match would
 * make it as large as Centrifuge's own surface and defeat the point, so the mismatch is
 * absorbed here, in one place, where the casts are visible.
 */
function adaptCentrifuge(c: Centrifuge): ClientLike {
  return {
    on(event: string, listener: (ctx: never) => void) {
      return (c.on as (e: string, l: unknown) => unknown)(event, listener);
    },
    newSubscription(channel, subOptions) {
      return c.newSubscription(channel, subOptions) as unknown as SubscriptionLike;
    },
    removeSubscription(sub) {
      c.removeSubscription(sub as unknown as Parameters<Centrifuge['removeSubscription']>[0]);
    },
    connect: () => c.connect(),
    disconnect: () => c.disconnect(),
  };
}

export interface Talkback {
  /** The action channel for a topic — a grid watching every instance. */
  topic(topic: string): TalkbackHandle;
  /** The resource channel — one detail view, every action on it. */
  resource(topic: string, topicId: string): TalkbackHandle;
  /** `user:<tenant>.<userId>` for the signed-in user. */
  user(): TalkbackHandle;
  stream(streamId: string): TalkbackHandle;
  presence(vendor: string, app: string, entity: string, id?: string): TalkbackHandle;
  site(site: string, resource: string, id?: string): TalkbackHandle;
  /** Escape hatch for a channel this API cannot express yet. Still tenant-checked. */
  channel(raw: string): TalkbackHandle;

  connect(): void;
  disconnect(): void;
  /** Every open channel name, for diagnostics. */
  readonly channels: readonly string[];
  /**
   * The tenant the provider currently reports.
   *
   * Exposed so a caller can compute a channel NAME without taking a handle. Every method
   * above has a side effect — it registers a reference — so using one inside a reactive
   * getter would subscribe on every re-evaluation and release none of them. The Vue
   * composables read this and build the name with the pure builders from `./channels`.
   */
  readonly tenant: string;
  /** The user the provider currently reports. Exposed for the same reason as `tenant`. */
  readonly userId: string;
}

interface ChannelEntry {
  refs: number;
  /** Absent for a channel carried in the connection token's `subs` claim. */
  sub: SubscriptionLike | null;
  envelopeListeners: Map<string, Set<EnvelopeListener>>;
  anyEnvelopeListeners: Set<EnvelopeListener>;
  rawListeners: Set<RawListener>;
  errorListeners: Set<(ctx: TalkbackErrorContext) => void>;
  subscribedListeners: Set<(ctx: SubscribedContext) => void>;
  resyncListeners: Set<(ctx: ResyncContext) => void>;
}

export function createTalkback(options: TalkbackOptions): Talkback {
  const doFetch = options.fetch ?? globalThis.fetch;
  const maxSubs = options.maxSubsPerToken ?? 32;
  const initialChannels = options.channels ?? [];

  if (initialChannels.length > maxSubs) {
    throw new Error(`at most ${maxSubs} channels in the connection token; open the rest as handles, which use subscription tokens`);
  }

  const seen = new SeenIds(options.dedupeCapacity);
  const entries = new Map<string, ChannelEntry>();
  // The `subs` set is fixed at mint time, so a handle on one of these attaches to a
  // server-side subscription rather than creating a client one.
  const serverSide = new Set(initialChannels);

  /**
   * THE TOKEN IS NEVER CACHED, and that is the whole comment.
   *
   * A connection token's `exp` is the 60-second connect window. Reused after it, the
   * connect fails with error 109 and disconnect 3502 "stale" — which looks like a
   * transport problem and is not. Centrifuge calls this exactly when it needs a token,
   * so caching would buy one saved request in exchange for that.
   *
   * The refresh path is the SAME endpoint: because `expire_at` is set, a live connection
   * eventually needs a fresh token and `getToken` is simply invoked again. There is
   * deliberately no refresh proxy on the facade.
   */
  async function connectionToken(): Promise<string> {
    const res = await doFetch(options.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ channels: [...initialChannels] }),
    });
    if (!res.ok) {
      throw new Error(`talkback token endpoint answered ${res.status}`);
    }
    const body = (await res.json()) as { token?: string };
    if (!body.token) {
      throw new Error('talkback token endpoint returned no token');
    }
    return body.token;
  }

  async function subscriptionToken(channel: string): Promise<string> {
    const res = await doFetch(options.subscriptionTokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ channel }),
    });
    if (!res.ok) {
      throw new Error(`talkback subscription token endpoint answered ${res.status} for ${channel}`);
    }
    const body = (await res.json()) as { token?: string };
    if (!body.token) {
      throw new Error(`talkback subscription token endpoint returned no token for ${channel}`);
    }
    return body.token;
  }

  const endpoints = options.endpoints ?? defaultEndpoints(options.host);
  const clientOptions = { getToken: connectionToken, debug: options.debug ?? false };
  const centrifuge: ClientLike = options.client ? options.client(endpoints, clientOptions) : adaptCentrifuge(new Centrifuge(endpoints, clientOptions));

  function deliver(channel: string, data: unknown): void {
    const entry = entries.get(channel);
    if (!entry) {
      return;
    }

    for (const listener of entry.rawListeners) {
      listener(data, channel);
    }

    const envelope = asEnvelope(data);
    if (!envelope) {
      // Not an envelope, and not an error: `stream:` output and ad-hoc `presence:`
      // publications carry whatever their producer sent. They reached listenAll above.
      return;
    }

    // Deduplication spans the whole client, not one channel — the point is precisely
    // that the two copies arrive on DIFFERENT channels.
    if (!seen.admit(envelope.id)) {
      return;
    }

    const typed = envelope as Envelope<Record<string, unknown>>;
    for (const listener of entry.anyEnvelopeListeners) {
      listener(typed, data);
    }

    const action = actionOf(envelope);
    if (action === undefined) {
      return;
    }
    const listeners = entry.envelopeListeners.get(action);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(typed, data);
    }
  }

  function emitSubscribed(channel: string, ctx: SubscribedContext, namespace: string): void {
    const entry = entries.get(channel);
    if (!entry) {
      return;
    }
    for (const listener of entry.subscribedListeners) {
      listener(ctx);
    }

    // `stream:` has no history, so a reconnect ALWAYS lost whatever arrived while away
    // and no HTTP endpoint can return it. Every subscribe is a resync there.
    if (namespace === 'stream') {
      emitResync(entry, { channel, reason: 'no-history' });
      return;
    }
    // Recovery was attempted and could not close the gap: the buffer is 100
    // publications or 10 minutes on `tenant:`, and everything older is gone.
    if (ctx.wasRecovering && !ctx.recovered) {
      emitResync(entry, { channel, reason: 'history-overflow' });
    }
  }

  function emitResync(entry: ChannelEntry, ctx: ResyncContext): void {
    for (const listener of entry.resyncListeners) {
      listener(ctx);
    }
  }

  // Server-side subscriptions — the ones the connection token's `subs` claim created —
  // report on the client, not on a Subscription object.
  centrifuge.on('publication', ctx => deliver(ctx.channel, ctx.data));
  centrifuge.on('subscribed', ctx => {
    const namespace = ctx.channel.slice(0, ctx.channel.indexOf(':'));
    emitSubscribed(
      ctx.channel,
      {
        channel: ctx.channel,
        recoverable: ctx.recoverable,
        positioned: ctx.positioned,
        wasRecovering: ctx.wasRecovering,
        recovered: ctx.recovered,
      },
      namespace,
    );
  });

  function entryFor(parsed: Channel): ChannelEntry {
    const name = parsed.name;
    const existing = entries.get(name);
    if (existing) {
      // REFERENCE COUNTING, and it is not an optimisation. Two components on the same
      // run — the grid row and the open detail panel — would otherwise each mint a
      // subscription token and hold their own subscription.
      existing.refs += 1;
      return existing;
    }

    const entry: ChannelEntry = {
      refs: 1,
      sub: null,
      envelopeListeners: new Map(),
      anyEnvelopeListeners: new Set(),
      rawListeners: new Set(),
      errorListeners: new Set(),
      subscribedListeners: new Set(),
      resyncListeners: new Set(),
    };
    entries.set(name, entry);

    if (!serverSide.has(name)) {
      const subOptions: SubscriptionOptionsLike = { getToken: () => subscriptionToken(name) };
      const sub = centrifuge.newSubscription(name, subOptions);
      sub.on('publication', ctx => deliver(name, ctx.data));
      sub.on('subscribed', ctx =>
        emitSubscribed(
          name,
          {
            channel: name,
            recoverable: ctx.recoverable,
            positioned: ctx.positioned,
            wasRecovering: ctx.wasRecovering,
            recovered: ctx.recovered,
          },
          parsed.namespace,
        ),
      );
      sub.on('error', ctx => {
        for (const listener of entry.errorListeners) {
          listener({ channel: name, message: String(ctx.error?.message ?? ctx.type) });
        }
      });
      sub.subscribe();
      entry.sub = sub;
    }

    return entry;
  }

  function handleFor(parsed: Channel): TalkbackHandle {
    const entry = entryFor(parsed);
    const name = parsed.name;
    let released = false;

    const handle: TalkbackHandle = {
      channel: name,

      listen(action, listener) {
        const set = entry.envelopeListeners.get(action) ?? new Set();
        set.add(listener as EnvelopeListener);
        entry.envelopeListeners.set(action, set);
        return handle;
      },

      listenAny(listener) {
        entry.anyEnvelopeListeners.add(listener);
        return handle;
      },

      listenAll(listener) {
        entry.rawListeners.add(listener);
        return handle;
      },

      stopListening(action, listener) {
        if (!listener) {
          entry.envelopeListeners.delete(action);
          return handle;
        }
        entry.envelopeListeners.get(action)?.delete(listener);
        return handle;
      },

      error(listener) {
        entry.errorListeners.add(listener);
        return handle;
      },

      subscribed(listener) {
        entry.subscribedListeners.add(listener);
        return handle;
      },

      onResync(listener) {
        entry.resyncListeners.add(listener);
        return handle;
      },

      leave() {
        // Idempotent: a component that unmounts twice — Vue's StrictMode-like double
        // invocation, or a manual leave() followed by scope disposal — must not take the
        // reference count below zero and tear down a channel another component is using.
        if (released) {
          return;
        }
        released = true;
        entry.refs -= 1;
        if (entry.refs > 0) {
          return;
        }
        entry.sub?.unsubscribe();
        if (entry.sub) {
          centrifuge.removeSubscription(entry.sub);
        }
        entries.delete(name);
      },
    };

    return handle;
  }

  const tenant = () => options.tenant();

  return {
    topic(topic) {
      return handleFor(tenantActionChannel(tenant(), topic));
    },
    resource(topic, topicId) {
      return handleFor(tenantResourceChannel(tenant(), topic, topicId));
    },
    user() {
      return handleFor(userChannel(tenant(), options.userId()));
    },
    stream(streamId) {
      return handleFor(streamChannel(tenant(), streamId));
    },
    presence(vendor, app, entity, id) {
      const base = id === undefined ? tenantChannel(tenant(), vendor, app, entity) : tenantResourceChannel(tenant(), `${vendor}.${app}.${entity}`, id);
      return handleFor(presenceFor(base));
    },
    site(site, resource, id) {
      return handleFor(id === undefined ? siteChannel(tenant(), site, resource) : siteResourceChannel(tenant(), site, resource, id));
    },
    channel(raw) {
      // Still parsed against the tenant. An escape hatch that skipped the check would be
      // the one place in this package where a cross-tenant name could get through.
      return handleFor(parseWithin(tenant(), raw));
    },

    connect() {
      centrifuge.connect();
    },
    disconnect() {
      centrifuge.disconnect();
    },
    get channels() {
      return [...entries.keys()];
    },
    get tenant() {
      return tenant();
    },
    get userId() {
      return options.userId();
    },
  };
}
