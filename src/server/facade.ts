import { errorFromResponse, TalkbackRateLimitedError, TalkbackError } from './errors.js';
import type { TokenSource } from './m2m.js';

/**
 * The facade's six `/v1` routes.
 *
 * FOUR THINGS THAT GET WRITTEN WRONG EXACTLY ONCE, all of them handled here so no
 * consumer has to know:
 *
 * 1. **The tenant header is `X-Revenexx-Tenant`, not `X-Tenant-Id`.** The org is
 *    genuinely inconsistent about this — `studio-integrations` sends `X-Tenant-Id` to
 *    the integrations API, with a comment that names the confusion — and ADR-0056 §5
 *    settles on the former.
 * 2. **`channel` is a query parameter, never a path segment.** A channel name is a
 *    valid URI scheme prefix: `new URL('tenant:acme-eu.x.y.z', base)` parses `tenant:`
 *    as the protocol. `internal/facade/read.go` deviates from its own task description
 *    for this reason and names this client in the comment.
 * 3. **`override` members are `{value: boolean}` wrappers.** Against Centrifugo a bare
 *    boolean is silently IGNORED and the namespace default applies; the facade turns
 *    that into a 400, and the types here make it unwritable.
 * 4. **`limit=-1` is rejected, not clamped**, and history is oldest-first by default.
 */

export interface FacadeOptions {
  /** The facade base URL, e.g. `https://talkback.revenexx.com`. No trailing `/v1`. */
  baseUrl: string;
  tokens: TokenSource;
  /**
   * The tenant slug or UUID. Sent as `X-Revenexx-Tenant` and canonicalised by the
   * facade against Console, so either spelling works and the resolved slug is what
   * every downstream check uses.
   */
  tenant: string;
  fetch?: typeof globalThis.fetch;
  /**
   * How long to wait out a 429 before giving up entirely. The facade's `Retry-After`
   * comes from the token bucket's own reservation, so it is honoured exactly; this only
   * bounds how long that is allowed to take.
   *
   * 0 disables waiting and surfaces the TalkbackRateLimitedError immediately, which is
   * the right choice inside a request handler that has its own deadline.
   */
  maxRetryWaitMs?: number;
  /** A sleep, injected so the 429 path is testable without real time. */
  sleep?: (ms: number) => Promise<void>;
}

export interface MintTokenRequest {
  userId: string;
  /** May be empty: a client whose depth is not known yet asks for subscription tokens. */
  channels?: readonly string[];
  /** Recorded in the server-only `meta` claim, never in the client-visible `info`. */
  roles?: readonly string[];
  requestId?: string;
}

export interface MintTokenResponse {
  token: string;
  /** Unix SECONDS, and the CONNECTION expiry — not the 60-second connect window. */
  expires_at: number;
  /** The granted set, so a caller can check scope without decoding a JWT. */
  channels: string[];
}

/**
 * A per-subscription policy override.
 *
 * The `{value: …}` wrapper is Centrifugo's wire shape and not decoration. Sent as a
 * bare boolean it decodes to nothing, Centrifugo applies the namespace default, and the
 * subscription quietly does not have the property that was asked for. This type makes
 * the bare form a compile error, and the facade makes it a 400.
 */
export interface SubscriptionOverride {
  presence?: { value: boolean };
  join_leave?: { value: boolean };
  force_recovery?: { value: boolean };
  force_positioning?: { value: boolean };
  force_push_join_leave?: { value: boolean };
}

export interface MintSubscriptionTokenRequest {
  userId: string;
  channel: string;
  /**
   * CLIENT-VISIBLE. Other subscribers of the same channel receive it in presence data
   * and join/leave events, so a display name is the legitimate use and a role is not —
   * roles belong in `roles` on the connection token, which lands in `meta`.
   */
  info?: Record<string, unknown>;
  override?: SubscriptionOverride;
  requestId?: string;
}

export interface MintSubscriptionTokenResponse {
  token: string;
  expires_at: number;
  channel: string;
}

export interface PublishRequest {
  channel: string;
  data: Record<string, unknown>;
  /**
   * Passed through to Centrifugo. NOTE: its idempotency cache is independent of history
   * and survives a history removal, so a key must not be reused across a channel's
   * lifetime — a fixed key makes the second run publish nothing at all.
   */
  idempotencyKey?: string;
  requestId?: string;
}

export interface ClientInfo {
  client?: string;
  /** `<tenant>:<user_id>`. */
  user?: string;
  conn_info?: Record<string, unknown>;
  chan_info?: Record<string, unknown>;
}

export interface PresenceResponse {
  channel: string;
  presence: Record<string, ClientInfo>;
}

export interface PresenceStatsResponse {
  channel: string;
  num_clients: number;
  num_users: number;
}

export interface Publication {
  data: Record<string, unknown>;
  offset?: number;
  info?: ClientInfo;
}

export interface HistoryResponse {
  channel: string;
  /** Oldest-first unless `reverse` was set. */
  publications: Publication[];
  offset: number;
  /** Carry this back in `sinceEpoch`. An offset alone is not resumable. */
  epoch: string;
}

export interface HistoryQuery {
  channel: string;
  /** Page size. `-1` is rejected rather than clamped — see `readHistory`. */
  limit?: number;
  /** Must be given together with `sinceEpoch`. */
  sinceOffset?: number;
  sinceEpoch?: string;
  reverse?: boolean;
  requestId?: string;
}

export interface FacadeClient {
  mintToken(req: MintTokenRequest): Promise<MintTokenResponse>;
  mintSubscriptionToken(req: MintSubscriptionTokenRequest): Promise<MintSubscriptionTokenResponse>;
  publish(req: PublishRequest): Promise<{ channel: string }>;
  presence(channel: string, requestId?: string): Promise<PresenceResponse>;
  presenceStats(channel: string, requestId?: string): Promise<PresenceStatsResponse>;
  history(query: HistoryQuery): Promise<HistoryResponse>;
}

interface CallOptions {
  method: 'GET' | 'POST';
  path: string;
  operation: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  channel?: string;
  requestId?: string | undefined;
}

export function createFacadeClient(options: FacadeOptions): FacadeClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));
  const maxRetryWaitMs = options.maxRetryWaitMs ?? 5_000;
  const base = options.baseUrl.replace(/\/+$/, '');

  async function once<T>(opts: CallOptions): Promise<T> {
    // Built by concatenation rather than `new URL(path, base)`, because the base may
    // carry a path prefix that the relative-reference rules would discard.
    const url = new URL(base + opts.path);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${await options.tokens.token()}`,
      'X-Revenexx-Tenant': options.tenant,
      Accept: 'application/json',
      ...opts.headers,
    };
    if (opts.requestId) {
      headers['X-Request-ID'] = opts.requestId;
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await doFetch(url.toString(), {
      method: opts.method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });

    const payload = await res.json().catch(() => undefined);
    if (!res.ok) {
      throw errorFromResponse(res, payload, {
        operation: opts.operation,
        tenant: options.tenant,
        channel: opts.channel,
      });
    }
    return payload as T;
  }

  /**
   * Waits out a 429 once, then gives up.
   *
   * ONE retry rather than a loop: `Retry-After` is computed from the bucket's own
   * reservation, so if the wait was honoured and the second attempt is still limited,
   * the caller is over budget rather than unlucky — and a loop there is how a client
   * turns its own rate limit into sustained load against the service that imposed it.
   */
  async function call<T>(opts: CallOptions): Promise<T> {
    try {
      return await once<T>(opts);
    } catch (err) {
      if (err instanceof TalkbackRateLimitedError && maxRetryWaitMs > 0 && err.retryAfterMs <= maxRetryWaitMs) {
        await sleep(err.retryAfterMs);
        return once<T>(opts);
      }
      throw err;
    }
  }

  return {
    mintToken(req) {
      return call<MintTokenResponse>({
        method: 'POST',
        path: '/v1/tokens',
        operation: 'mintConnectionToken',
        requestId: req.requestId,
        body: {
          user_id: req.userId,
          ...(req.channels ? { channels: req.channels } : {}),
          ...(req.roles ? { roles: req.roles } : {}),
        },
      });
    },

    mintSubscriptionToken(req) {
      return call<MintSubscriptionTokenResponse>({
        method: 'POST',
        path: '/v1/subscription-tokens',
        operation: 'mintSubscriptionToken',
        channel: req.channel,
        requestId: req.requestId,
        body: {
          user_id: req.userId,
          channel: req.channel,
          ...(req.info ? { info: req.info } : {}),
          ...(req.override ? { override: req.override } : {}),
        },
      });
    },

    publish(req) {
      return call<{ channel: string }>({
        method: 'POST',
        path: '/v1/publish',
        operation: 'publish',
        channel: req.channel,
        requestId: req.requestId,
        headers: req.idempotencyKey ? { 'Idempotency-Key': req.idempotencyKey } : {},
        body: { channel: req.channel, data: req.data },
      });
    },

    presence(channel, requestId) {
      return call<PresenceResponse>({
        method: 'GET',
        path: '/v1/presence',
        operation: 'getPresence',
        channel,
        requestId,
        query: { channel },
      });
    },

    presenceStats(channel, requestId) {
      return call<PresenceStatsResponse>({
        method: 'GET',
        path: '/v1/presence/stats',
        operation: 'getPresenceStats',
        channel,
        requestId,
        query: { channel },
      });
    },

    // `async` so the two local guards below REJECT rather than throw synchronously. A
    // method that sometimes throws before returning a promise and sometimes rejects is a
    // caller-facing trap: `.catch()` alone silently misses half the failures.
    async history(query) {
      // Rejected locally rather than passed on, and NOT clamped to 1. -1 is Centrifugo's
      // "no limit": clamping would silently turn a caller's mistake into a small page,
      // and passing it on would hand over an entire stream. Neither is what the caller
      // meant, so this is the one place a local check beats a round trip.
      if (query.limit !== undefined && query.limit < 1) {
        throw new TalkbackError({
          status: 0,
          operation: 'getHistory',
          message: `limit must be positive; ${query.limit} is not accepted (-1 is Centrifugo's "no limit")`,
        });
      }
      // An offset without its epoch is exactly how a caller "recovers" from a freshly
      // rebuilt stream and silently skips everything before it. The facade rejects it
      // too; catching it here names the pair instead of returning a 400.
      if ((query.sinceOffset === undefined) !== (query.sinceEpoch === undefined)) {
        throw new TalkbackError({
          status: 0,
          operation: 'getHistory',
          message: 'sinceOffset and sinceEpoch must be given together: an offset without its epoch silently skips publications',
        });
      }

      return call<HistoryResponse>({
        method: 'GET',
        path: '/v1/history',
        operation: 'getHistory',
        channel: query.channel,
        requestId: query.requestId,
        query: {
          channel: query.channel,
          limit: query.limit === undefined ? undefined : String(query.limit),
          since_offset: query.sinceOffset === undefined ? undefined : String(query.sinceOffset),
          since_epoch: query.sinceEpoch,
          reverse: query.reverse === undefined ? undefined : String(query.reverse),
        },
      });
    },
  };
}
