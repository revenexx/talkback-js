# API Reference

## Entry points

| Import | Runs in | What it is |
| --- | --- | --- |
| `@revenexx/talkback-js` | browser | `createTalkback` — the client, plus the envelope helpers |
| `@revenexx/talkback-js/channels` | anywhere | the channel grammar: builders, `parseWithin`, `ChannelError` |
| `@revenexx/talkback-js/server` | **server only** | the facade client, M2M tokens, and the BFF route factories |
| `@revenexx/talkback-js/vue` | browser | `provideTalkback`, `useTalkback` and five channel composables |
| `@revenexx/talkback-js/testing` | tests | a Centrifugo stand-in and envelope factories |

`/server` holds M2M client credentials and the facade base URL. It is a separate entry
precisely so nothing in it can be reached from a browser bundle — the root entry does not
re-export it. There is deliberately no `/react` entry.

## The client

`createTalkback(options)` returns a `Talkback`. `tenant`, `userId` and `accessToken` are
**providers** (`() => value`), not values, because all three change while a tab lives.

| Option | Notes |
| --- | --- |
| `host` | the origin serving both the transport and `/v1`; no trailing `/v1` |
| `tenant` | provider for the tenant slug |
| `userId` | provider for the user id |
| `tokenEndpoint` | your BFF route, or the facade's `/v1/tokens` in direct mode |
| `subscriptionTokenEndpoint` | likewise, for dynamic channels |
| `accessToken` | optional provider; switches to `Authorization: Bearer` + `X-Revenexx-Tenant` + `credentials: 'omit'`. May be async and may answer `null` |
| `dedupeCapacity` | id window, default 2048 |
| `client` | the transport seam — replace Centrifuge in tests, see [Testing](testing.md) |

Channel entry points on the client: `tb.topic(topic)`, `tb.resource(topic, id)`, plus the
`user:`, `stream:` and `site:` equivalents. `defaultEndpoints(host)` exposes the transport
chain the client uses.

### Handle API

| Method | |
| --- | --- |
| `listen(action, fn)` | one action, deduplicated |
| `listenAny(fn)` | every **envelope**, whatever the action, deduplicated |
| `listenAll(fn)` | every **publication**, envelope or not, *before* deduplication — this is how a `stream:` channel is read |
| `stopListening(action, fn?)` | drop one listener, or all for an action |
| `subscribed(fn)` / `error(fn)` | lifecycle |
| `onResync(fn)` | refetch over HTTP |
| `leave()` | release; idempotent |

`listenAll` fires before deduplication because a `stream:` payload is not an envelope and
has no id to deduplicate on. Routing "I want every action" through it would therefore
deliver the duplicate — use `listenAny` for that.

`leave()` releases **one handle**. The underlying subscription is torn down only when the
last handle on that channel leaves.

### The envelope

What arrives is the platform event envelope, verbatim:

```ts
interface Envelope<T> {
  id: string;               // evt_<ulid>, and the deduplication key
  tenant_id: string;
  topic: string;            // <vendor>.<app>.<entity>.<action>
  topic_id?: string | null; // a STRING or null, never a number
  data: T;
  metadata?: Record<string, unknown>;
  time?: string;            // RFC3339 — note the name: `time`, not `occurred_at`
}
```

Helpers on the root entry: `asEnvelope`, `actionOf`, `SeenIds`.

Three behaviours worth knowing before you build on them:

- **`listen(action, …)` filters on `envelope.topic`, not on the channel name.** On a
  resource channel the action is not in the name at all, so a channel-name filter would
  match everything while looking like it filtered.
- **Events are deduplicated on `envelope.id` across the whole client.** A grid on the
  action channel and a panel on the resource channel receive the same event twice — that
  is contractual. The window is bounded (`dedupeCapacity`, default 2048) so a long-lived
  tab does not grow forever.
- **`onResync` is the "refetch over HTTP" signal.** It fires with
  `reason: 'history-overflow'` when a reconnect's gap outran the recovery buffer, and
  with `reason: 'no-history'` on **every** subscribe of a `stream:` channel — that
  namespace keeps no history, so a reconnect mid-run always lost whatever arrived while
  away, and no endpoint can return it.

## Vue composables

`provideTalkback(tb)` and `useTalkback()`, plus `useTalkbackTopic`,
`useTalkbackResource`, `useTalkbackUser`, `useTalkbackStream` and `useTalkbackPresence`.

All five take the same options — `on`, `handler`, `raw`, `onResync`, `enabled`,
`talkback` — and all clean up via `onScopeDispose`, so a route change cannot leave a
subscription open. An id may be a ref or a getter, and the composable re-subscribes when
it changes, releasing the old channel before taking the new one.

They return `{ channel, stop() }`, not anything query-shaped: the events are refetch
signals, and the payload deliberately does not carry the resource.

Pass `talkback` explicitly when there is no component instance to `inject` from — a test
running in a plain `effectScope`, or some plugin setups.

## Server API

`createFacadeClient` covers the facade's six routes:

```ts
await facade.mintToken({ userId, channels, roles });
await facade.mintSubscriptionToken({ userId, channel, info, override });
await facade.publish({ channel, data, idempotencyKey });
await facade.presence(channel);
await facade.presenceStats(channel);
await facade.history({ channel, limit, sinceOffset, sinceEpoch, reverse });
```

Four things it gets right so you do not have to:

1. The tenant header is `X-Revenexx-Tenant` — the org is genuinely inconsistent about
   this elsewhere.
2. `channel` is a query parameter, never a path segment. A channel name is a valid URI
   scheme prefix: `new URL('tenant:acme-eu.x.y.z', base)` parses `tenant:` as the
   protocol.
3. `override` members are `{ value: boolean }` wrappers. A bare boolean is silently
   ignored by Centrifugo and the namespace default applies; the types here make it
   unwritable.
4. `limit` must be positive — `-1` is Centrifugo's "no limit" and is rejected rather than
   clamped — and `sinceOffset` only works paired with `sinceEpoch`, because an offset
   without its epoch silently skips publications.

A 429 is waited out exactly once, honouring `Retry-After` (which the facade computes from
the bucket's own reservation). Set `maxRetryWaitMs: 0` inside a request handler that has
its own deadline.

### Route factories

`createTokenRoute` and `createSubscriptionTokenRoute` are framework-agnostic;
`nitroTokenHandler` and `nitroSubscriptionTokenHandler` wrap them for Nuxt/Nitro and take
h3's helpers via `h3: { readBody, createError }`. `DEFAULT_MAX_SUBS_PER_TOKEN` bounds one
token's channel list, and `TokenRouteError` is what the factories throw.

The two callbacks the package deliberately refuses to answer — `resolveUser` and
`authorizeChannels` / `authorizeChannel` — are covered in
[Getting Started](getting-started.md#what-authorizechannels-must-do).

### Errors

Typed and discriminated on HTTP status and operation, not on message text:

| Error | Status | Means |
| --- | --- | --- |
| `TalkbackUnauthenticatedError` | 401 | *your* M2M credential — not the end user's session |
| `TalkbackForbiddenError` | 403 | missing scope, tenant membership, or a channel outside the tenant (carries `channel`) |
| `TalkbackUnknownTenantError` | 404 | the tenant is unknown. The credential is fine, the name is not |
| `TalkbackRequestError` | 400, 413 | the request itself; retrying unchanged cannot help |
| `TalkbackRateLimitedError` | 429 | carries `retryAfterMs` |
| `TalkbackUnavailableError` | 502, 503 | a dependency. Retryable, unlike everything above |

All extend `TalkbackError` and carry `operation` plus the `requestId` the facade echoed,
for correlating with its audit line. `parseRetryAfter` is exported for the header itself.

The Nitro adapters pass these statuses through rather than collapsing them into 500 — a
404 and a 403 send different people to different places.
