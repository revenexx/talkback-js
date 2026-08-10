/**
 * `@revenexx/talkback-js` — the browser client.
 *
 * ```ts
 * const tb = createTalkback({
 *   host: 'https://rt.revenexx.com',
 *   tenant: () => tenantSlug.value,        // providers, not values
 *   userId: () => user.value.id,
 *   tokenEndpoint: '/bff/talkback-token',
 *   subscriptionTokenEndpoint: '/bff/talkback-subscription-token',
 * });
 * tb.connect();
 *
 * // The topic includes the ACTION: one action is one channel, and Centrifugo has no
 * // wildcards, so `revenexx.integrations.run` would build the resource KIND channel —
 * // a valid name the bridge never publishes to.
 * tb.topic('revenexx.integrations.run.finished').listen('finished', e => refetch(e.topic_id));
 * ```
 *
 * Three things this does that an application otherwise forgets, each written up where it
 * is implemented: deduplication on `envelope.id`, `onResync` when the recovery buffer
 * could not close the gap, and reference counting per channel name.
 *
 * The channel grammar is re-exported from `./channels` so the common case needs one
 * import. `./server` is NOT re-exported here — it holds M2M credentials and must never
 * be reachable from a browser bundle.
 */
export { createTalkback, defaultEndpoints } from './core/talkback.js';
export type { Talkback, TalkbackOptions, Provider } from './core/talkback.js';

export { asEnvelope, actionOf, SeenIds } from './core/envelope.js';
export type { Envelope } from './core/envelope.js';

export type {
  TalkbackHandle,
  EnvelopeListener,
  RawListener,
  ResyncContext,
  ResyncReason,
  SubscribedContext,
  TalkbackErrorContext,
} from './core/handles.js';

export * from './channels/index.js';
