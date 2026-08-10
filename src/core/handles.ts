import type { Envelope } from './envelope.js';

/**
 * Why a resync happened. `onResync` is ADR-0093 §9's "refetch over HTTP" expressed as a
 * callback rather than as a paragraph somebody has to read.
 */
export type ResyncReason =
  /**
   * Recovery was attempted and the gap was larger than the buffer — 100 publications or
   * 10 minutes on `tenant:`. Everything before the gap is simply gone.
   */
  | 'history-overflow'
  /**
   * A `stream:` handle, on EVERY subscribe. That namespace has no history at all
   * (docs/streaming-output.md §1), so a reconnect mid-run always lost whatever arrived
   * while away, and there is no HTTP endpoint to read it back from either.
   */
  | 'no-history';

export interface ResyncContext {
  channel: string;
  reason: ResyncReason;
}

export interface SubscribedContext {
  channel: string;
  recoverable: boolean;
  positioned: boolean;
  wasRecovering: boolean;
  recovered: boolean;
}

export interface TalkbackErrorContext {
  channel: string;
  code?: number;
  message: string;
}

export type EnvelopeListener<T = Record<string, unknown>> = (envelope: Envelope<T>, raw: unknown) => void;

/**
 * A raw listener, for publications that are not envelopes — `stream:` token output and
 * `presence:` chatter published through `POST /v1/publish` carry whatever their producer
 * sent.
 */
export type RawListener = (data: unknown, channel: string) => void;

/**
 * A handle on one channel. Echo's shape — the chain, the lifecycle,
 * listen/stopListening/leave — filled with Talkback's vocabulary. It is deliberately NOT
 * an Echo connector: there is no Pusher semantics here, no `socket_id`, no `auth`
 * endpoint format, and no PHP side.
 *
 * The tenant is never an argument on any of these. It comes from the provider passed to
 * `createTalkback`, so an application cannot subscribe to another tenant's channel by
 * getting an argument order wrong.
 */
export interface TalkbackHandle {
  /** The resolved channel name, for logging and for `presence()` lookups. */
  readonly channel: string;

  /**
   * Listen for one action. FILTERS ON `envelope.topic`, not on the channel name: on a
   * resource channel the action is not in the name at all, so a channel-name filter
   * would match everything while looking like it filtered.
   */
  listen<T = Record<string, unknown>>(action: string, listener: EnvelopeListener<T>): this;

  /**
   * Every ENVELOPE on the channel, whatever its action — deduplicated like `listen`.
   *
   * Distinct from `listenAll` for one reason that is easy to get wrong: `listenAll` is a
   * RAW hook that fires before deduplication, because a `stream:` payload is not an
   * envelope and has no id to deduplicate on. Routing "I want every action" through it
   * would therefore deliver the contractual duplicate — measured, and the reason this
   * method exists.
   */
  listenAny(listener: EnvelopeListener): this;

  /**
   * Every publication on the channel, envelope or not, BEFORE deduplication. This is how
   * a `stream:` handle is read; for envelopes use `listen` or `listenAny`.
   */
  listenAll(listener: RawListener): this;

  /** Drops one listener, or every listener for an action when none is given. */
  stopListening(action: string, listener?: EnvelopeListener): this;

  error(listener: (ctx: TalkbackErrorContext) => void): this;
  subscribed(listener: (ctx: SubscribedContext) => void): this;

  /** Refetch over HTTP: the recovery buffer could not close the gap. */
  onResync(listener: (ctx: ResyncContext) => void): this;

  /**
   * Releases this handle. The underlying subscription is only torn down when the last
   * handle on the channel leaves — two components watching the same run cost one
   * subscription, and therefore one subscription token, not two.
   */
  leave(): void;
}
