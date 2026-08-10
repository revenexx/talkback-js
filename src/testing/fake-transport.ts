import type { ClientLike, PublicationLike, SubscribedLike, SubscriptionErrorLike, SubscriptionLike, SubscriptionOptionsLike } from '../core/client.js';
import type { Envelope } from '../core/envelope.js';

/**
 * A Centrifugo stand-in for consumer tests.
 *
 * THIS IS THE PRECONDITION FOR DELETING A POLLING LOOP. Without a way to test the
 * realtime path, the poll stays in place as a "safety net" and the application ends up
 * carrying both — which is worse than either, because the poll's load is unchanged and
 * the realtime path is now also unverified.
 *
 * It fakes the SEAM (`ClientLike`), not the wire protocol. Faking frames would mean
 * maintaining a second implementation of Centrifugo's protocol whose divergences no test
 * can see, which is the failure a fake is supposed to remove rather than add.
 */

export interface FakeTalkbackClient extends ClientLike {
  /** Delivers a publication on a channel, exactly as a subscriber would receive it. */
  emit(channel: string, data: unknown): void;

  /**
   * Fires `subscribed`. The defaults describe a clean first subscribe; pass
   * `{ wasRecovering: true, recovered: false }` to reproduce the gap that triggers
   * `onResync`.
   */
  subscribed(channel: string, ctx?: Partial<SubscribedLike>): void;

  /** Fires a subscription error on a channel. */
  failed(channel: string, message: string, code?: number): void;

  /** Channels with a live client-side subscription. Server-side ones never appear. */
  readonly subscribed_: readonly string[];

  /** How many times each channel was subscribed — the reference-counting assertion. */
  readonly subscribeCounts: ReadonlyMap<string, number>;

  /** Subscription tokens the fake asked for, so a test can assert one per channel. */
  readonly tokenRequests: readonly string[];

  readonly connected: boolean;
}

interface FakeSubscription extends SubscriptionLike {
  channel: string;
}

export function createFakeClient(): FakeTalkbackClient {
  const clientPublicationListeners = new Set<(ctx: PublicationLike) => void>();
  const clientSubscribedListeners = new Set<(ctx: SubscribedLike) => void>();

  const subs = new Map<
    string,
    {
      sub: FakeSubscription;
      publication: Set<(ctx: { data: unknown }) => void>;
      subscribed: Set<(ctx: SubscribedLike) => void>;
      error: Set<(ctx: SubscriptionErrorLike) => void>;
      live: boolean;
    }
  >();

  const subscribeCounts = new Map<string, number>();
  const tokenRequests: string[] = [];
  let connected = false;

  function defaults(channel: string, ctx?: Partial<SubscribedLike>): SubscribedLike {
    return {
      channel,
      recoverable: ctx?.recoverable ?? true,
      positioned: ctx?.positioned ?? true,
      wasRecovering: ctx?.wasRecovering ?? false,
      recovered: ctx?.recovered ?? true,
    };
  }

  const client: FakeTalkbackClient = {
    on(event: string, listener: (ctx: never) => void) {
      if (event === 'publication') {
        clientPublicationListeners.add(listener as (ctx: PublicationLike) => void);
      } else if (event === 'subscribed') {
        clientSubscribedListeners.add(listener as (ctx: SubscribedLike) => void);
      }
      return client;
    },

    newSubscription(channel: string, options: SubscriptionOptionsLike): SubscriptionLike {
      const publication = new Set<(ctx: { data: unknown }) => void>();
      const subscribed = new Set<(ctx: SubscribedLike) => void>();
      const error = new Set<(ctx: SubscriptionErrorLike) => void>();

      const sub: FakeSubscription = {
        channel,
        on(event: string, listener: (ctx: never) => void) {
          if (event === 'publication') {
            publication.add(listener as (ctx: { data: unknown }) => void);
          } else if (event === 'subscribed') {
            subscribed.add(listener as (ctx: SubscribedLike) => void);
          } else if (event === 'error') {
            error.add(listener as (ctx: SubscriptionErrorLike) => void);
          }
          return sub;
        },
        subscribe() {
          subscribeCounts.set(channel, (subscribeCounts.get(channel) ?? 0) + 1);
          const entry = subs.get(channel);
          if (entry) {
            entry.live = true;
          }
          // Recorded SYNCHRONOUSLY, before awaiting anything. The property under test is
          // "one token was requested per subscribe", and recording it in a `.then` would
          // make every assertion depend on how many microtask hops the caller's fetch
          // happens to take — a test that passes or fails on an implementation detail of
          // the mock, which is worse than no test.
          tokenRequests.push(channel);
          void options.getToken().catch(() => {
            /* the fake does not model token failure; use failed() for that */
          });
        },
        unsubscribe() {
          const entry = subs.get(channel);
          if (entry) {
            entry.live = false;
          }
        },
      };

      subs.set(channel, { sub, publication, subscribed, error, live: false });
      return sub;
    },

    removeSubscription(sub: SubscriptionLike): void {
      subs.delete((sub as FakeSubscription).channel);
    },

    connect() {
      connected = true;
    },
    disconnect() {
      connected = false;
    },

    emit(channel, data) {
      const entry = subs.get(channel);
      if (entry) {
        for (const listener of entry.publication) {
          listener({ data });
        }
        return;
      }
      // No client-side subscription: this is a channel carried in the connection token's
      // `subs` claim, and the real client reports those on the CLIENT, not on a
      // Subscription. Getting that split wrong is exactly the kind of thing a fake
      // should reproduce rather than smooth over.
      for (const listener of clientPublicationListeners) {
        listener({ channel, data });
      }
    },

    subscribed(channel, ctx) {
      const full = defaults(channel, ctx);
      const entry = subs.get(channel);
      if (entry) {
        for (const listener of entry.subscribed) {
          listener(full);
        }
        return;
      }
      for (const listener of clientSubscribedListeners) {
        listener(full);
      }
    },

    failed(channel, message, code) {
      const entry = subs.get(channel);
      if (!entry) {
        return;
      }
      for (const listener of entry.error) {
        listener({ type: 'subscribe', error: { message, ...(code ? { code } : {}) } });
      }
    },

    get subscribed_() {
      return [...subs.entries()].filter(([, e]) => e.live).map(([name]) => name);
    },
    get subscribeCounts() {
      return subscribeCounts;
    },
    get tokenRequests() {
      return tokenRequests;
    },
    get connected() {
      return connected;
    },
  };

  return client;
}

/**
 * Builds an envelope the way the bridge publishes one, so a consumer test does not have
 * to remember the field names — and in particular does not have to rediscover that the
 * timestamp is `time` rather than `occurred_at`, and that `topic_id` is a STRING.
 */
export function envelope<T extends Record<string, unknown>>(init: {
  topic: string;
  tenant?: string;
  id?: string;
  topicId?: string | null;
  data?: T;
  metadata?: Record<string, unknown>;
  time?: string;
}): Envelope<T> {
  return {
    id: init.id ?? `evt_${Math.random().toString(36).slice(2, 12).toUpperCase()}`,
    tenant_id: init.tenant ?? 'acme-eu',
    topic: init.topic,
    topic_id: init.topicId ?? null,
    // NOTE for anyone writing a fixture from a real event: the run payload carries no
    // `result` (the bus has a 1 MB cap). The event is a REFETCH SIGNAL, not state.
    data: (init.data ?? {}) as T,
    ...(init.metadata ? { metadata: init.metadata } : {}),
    time: init.time ?? new Date().toISOString(),
  };
}
