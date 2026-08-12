# `@revenexx/talkback-js`

Realtime for revenexx applications: a typed client for Talkback's push plane, the
channel grammar it speaks, and the BFF pieces that mint its tokens.

The browser half borrows Laravel Echo's *shape* — a chain of
`listen` / `stopListening` / `leave` — and fills it with Talkback's vocabulary. It
handles the three things an application otherwise has to rediscover: deduplicating
events that arrive on two channels, telling you when a reconnect lost history, and
reference-counting subscriptions so two components watching the same resource cost one
subscription.

```sh
npm install @revenexx/talkback-js centrifuge
```

- **Node** ≥ 20.3
- **`centrifuge`** ≥ 5.2 is a required peer dependency
- **`vue`** ≥ 3.4 and **`vitest`** ≥ 2.0 are optional peers, reachable only from the
  `/vue` and `/testing` entries — nothing pulls them in unless you import those

## Entry points

| Import | Runs in | What it is |
|---|---|---|
| `@revenexx/talkback-js` | browser | `createTalkback` — the client, plus the envelope helpers |
| `@revenexx/talkback-js/channels` | anywhere | the channel grammar: builders, `parseWithin`, `ChannelError` |
| `@revenexx/talkback-js/server` | **server only** | the facade client, M2M tokens, and the BFF route factories |
| `@revenexx/talkback-js/vue` | browser | `provideTalkback`, `useTalkback` and five channel composables |
| `@revenexx/talkback-js/testing` | tests | a Centrifugo stand-in and envelope factories |

`/server` holds M2M client credentials and the facade base URL. It is a separate entry
precisely so nothing in it can be reached from a browser bundle — the root entry does
not re-export it.

## Quickstart

There are **two shapes**, and neither ever puts a signing key in the browser.

**Via a BFF** — a route on your server mints tokens against the facade, and the client
calls that route over the normal session. Use it when the visitor has no platform login
(a storefront), when the token's contents have to be decided server-side, or when you
mint on behalf of somebody else. That is what this quickstart builds.

**Direct** — the browser mints its own token at the facade with the signed-in user's
Zitadel access token, and there is no BFF route at all. Use it in an application behind
the platform login. It is one option: see [direct mode](#direct-mode-no-bff-route).

### 1. Mint tokens on your server

```ts
// server/utils/talkback.ts — one client for the whole server, because the token
// source caches. A client per request re-authenticates on every mint.
import { createFacadeClient, createTokenSource } from '@revenexx/talkback-js/server';

export const facade = createFacadeClient({
  baseUrl: process.env.TALKBACK_URL!,        // no trailing /v1
  tenant: process.env.TALKBACK_TENANT!,      // slug or UUID; the facade canonicalises it
  tokens: createTokenSource({
    issuer: process.env.ZITADEL_ISSUER!,
    clientId: process.env.TALKBACK_CLIENT_ID!,
    clientSecret: process.env.TALKBACK_CLIENT_SECRET!,
  }),
});
```

```ts
// server/routes/bff/talkback-token.post.ts — Nuxt/Nitro
import { nitroTokenHandler } from '@revenexx/talkback-js/server';
import { facade } from '../../utils/talkback';

export default defineEventHandler(
  nitroTokenHandler({
    facade,
    h3: { readBody, createError },

    // THE SESSION IS THE ONLY SOURCE OF IDENTITY. Never read the tenant or the user
    // from the request body — a value the caller supplies cannot authorise the caller.
    async resolveUser(event) {
      const session = await getUserSession(event);        // throws 401 without one
      return { tenant: await tenantForOrg(session), userId: session.userInfo.sub };
    },

    // REQUIRED, and there is deliberately no default: this is the one question the
    // package cannot answer. `requested` comes from the body, so it is a hint about
    // what the UI needs — never a grant. Filter it against what the session permits.
    authorizeChannels: ({ user, requested }) => channelsFor(user, requested),
  }),
);
```

The same file with `nitroSubscriptionTokenHandler` and `authorizeChannel` gives you the
dynamic path — one channel per request, for depth the client discovers at run time
(opening a detail panel, expanding a row). Not on Nitro? `createTokenRoute` and
`createSubscriptionTokenRoute` are the framework-agnostic factories underneath; they take
a request and a parsed body and return the response body.

#### What `channelsFor` has to do, and what it cannot delegate

`resolveUser` and `authorizeChannels` are the two callbacks this package deliberately
refuses to answer, so they are also the two worth getting right before anything else.

**Know exactly what the built-in check covers.** The route runs every requested channel
through `parseAllWithin(requested, user.tenant)` before minting, so a channel belonging to
another **tenant** is rejected without your code doing anything. That is where the
protection stops. `user:<tenant>.<someoneElse>` parses perfectly well against the right
tenant — so inside one tenant, nothing but `authorizeChannels` stands between a signed-in
user and another user's channel.

That is why it filters rather than validates:

```ts
function channelsFor(user: TalkbackUser, requested: readonly string[]): string[] {
  const allowed = new Set([userChannel(user.tenant, user.userId).name]);
  for (const topic of topicsVisibleTo(user)) {              // your authorisation, not ours
    allowed.add(tenantActionChannel(user.tenant, topic).name);
  }
  return requested.filter(c => allowed.has(c));             // filter, never pass through
}
```

Build the allow-set from the **verified** user with the builders from
`@revenexx/talkback-js/channels` rather than by concatenating strings, and `filter` rather
than reject — an unknown channel then drops silently instead of becoming a 400 that tempts
the next person to loosen the check.

**`playground/` is not a reference for either callback.** It returns a fixed user and
authorises everything asked for, and says so loudly in its own source, because it has no
identity provider in front of it. It demonstrates the client, not the authorisation.

If your BFF has no server-side session — a Bearer-token SPA, say — then `resolveUser`
verifies the incoming JWT against your issuer's JWKS and takes the user from the verified
claims. What it must not do is read identity from anything the caller merely asserts.

### 2. Connect in the browser

```ts
import { createTalkback } from '@revenexx/talkback-js';

const tb = createTalkback({
  host: 'https://talkback.revenexx.com', // the SAME host the BFF calls — see below
  tenant: () => tenantSlug.value,       // PROVIDERS, not values — both change at run time
  userId: () => user.value.id,
  tokenEndpoint: '/bff/talkback-token',
  subscriptionTokenEndpoint: '/bff/talkback-subscription-token',
});
tb.connect();
```

**One host, two paths.** `host` here and `baseUrl` in the BFF snippet above are the same
origin — Centrifugo's client transport sits at the root (`/connection/websocket` and its
fallbacks) and the facade API sits under `/v1`. There is no separate realtime hostname to
look up, and `host` takes no trailing `/v1`.

One client per application. A second `createTalkback` opens a second WebSocket and mints
its own connection token.

#### Direct mode: no BFF route

If the signed-in user holds a platform login, the browser can mint its own token. Point
the two endpoints at the facade and pass the user's access token:

```ts
const tb = createTalkback({
  host: 'https://talkback.revenexx.com',
  tenant: () => tenantSlug.value,
  userId: () => user.value.id,
  tokenEndpoint: 'https://talkback.revenexx.com/v1/tokens',
  subscriptionTokenEndpoint: 'https://talkback.revenexx.com/v1/subscription-tokens',
  accessToken: () => auth.accessToken.value, // a PROVIDER — it is refreshed while the tab lives
});
```

That is the whole change. `accessToken` also switches the request itself: the token goes
out as `Authorization: Bearer`, the tenant as `X-Revenexx-Tenant` — which the BFF used to
do — and `credentials` becomes `omit`, because the facade allows every origin and a
browser refuses credentials mode against a wildcard origin.

The provider may be **async and may answer `null`**: `() => Promise<string | null>` is
accepted, which is what an OIDC token source actually looks like. No token yet sends the
request without a bearer rather than throwing, so "not signed in" arrives as the server's
401 instead of a broken client.

> **Also useful without the facade.** If your own token route is bearer-authenticated
> rather than cookie-authenticated — a Nitro with no server-side session — point the two
> endpoints at *your* route and pass `accessToken` anyway. The bearer and the tenant header
> go there, and `credentials: 'omit'` costs you nothing because there is no session cookie.
> That replaces wrapping `fetch` yourself to attach the header.

**What the facade allows an end user, and what it does not.** It mints **only for the
caller itself**: the request carries no `user_id` and the facade fills it from the token's
own `sub`, so naming somebody else is a 403. `roles`, `info` and `override` are refused —
those exist for a server-side caller that builds the body on a user's behalf. Publishing
is not available at all; that stays a service scope.

**Requirements.** The user needs a `user` or `admin` role in the Zitadel **user** project.
A `talkback:*` scope does not substitute for it: those live in the M2M project, and a role
is only honoured from the project that granted it. An end user may still subscribe to any
channel of its tenant, exactly as a service caller can — the `user_id` binding prevents
impersonation, not reading.

### 3. Listen

```ts
// A grid watching every run that finished. The topic includes the ACTION: one action
// is one channel, and there are no wildcards.
tb.topic('revenexx.integrations.run.finished')
  .listen('finished', e => refetch(e.topic_id));

// One open detail panel: every action on this one resource, on one channel.
const handle = tb.resource('revenexx.integrations.run', runId)
  .listenAny(e => apply(e))
  .onResync(() => refetchFromHttp());   // the gap was bigger than the buffer

handle.leave();                          // on unmount
```

The tenant is never an argument on any of these. It comes from the provider you passed to
`createTalkback`, so an application cannot subscribe to another tenant's channel by
getting an argument order wrong.

**Centrifugo channels are exact names, and this is the thing to get right first.** An
event on topic `<vendor>.<app>.<entity>.<action>` is published to the *action* channel
`tenant:<t>.<vendor>.<app>.<entity>.<action>`, and — when the envelope carries a
`topic_id` — also to the *resource* channel `tenant:<t>.<vendor>.<app>.<entity>.<id>`.
Those two names share a prefix and are otherwise unrelated; neither contains the other.
So a grid interested in three actions takes three handles:

```ts
for (const action of ['started', 'finished', 'failed'] as const) {
  tb.topic(`revenexx.integrations.run.${action}`).listenAny(() => reload());
}
```

`tb.topic()` accepts a three-segment topic too, which builds the resource *kind* channel
`tenant:<t>.<vendor>.<app>.<entity>`. It is a valid name that the event bus never
publishes to — useful only for ad-hoc publishes of your own, never for bus events.

## Channels

Five namespaces, and the registry is exhaustive — a name that is not one of these does
not exist.

| Namespace | Shape | History | Presence |
|---|---|---|---|
| `user:` | `<tenant>.<user_id>` | ✅ | — |
| `tenant:` | `<tenant>.<vendor>.<app>.<entity>[.<action｜topic_id>]` | ✅ | — |
| `presence:` | same tail as `tenant:` | — | ✅ |
| `stream:` | `<tenant>.<stream_id>` | — | — |
| `site:` | `<tenant>.<site>.<resource>[.<id>]` | — | — |

The parts are not interchangeable, and the asymmetry is the tenant-isolation argument —
the classes overlap only in `[a-z0-9]`, and the tenant is positionally first, so no
channel name can be re-read as a different tenant:

| Part | Rule |
|---|---|
| tenant, site | a DNS label: 3–63 chars, lowercase, `-` allowed, **`_` is not** |
| vendor, app, entity, action | a topic segment: 1–32 chars, lowercase, `_` allowed, **`-` is not** |
| user id, stream id, `topic_id` | an opaque id: 1–64 of `[A-Za-z0-9_-]`, **no dot** |

`createTalkback` gives you a handle per shape — `topic`, `resource`, `user`, `stream`,
`presence`, `site`, and `channel(raw)` as an escape hatch that is still tenant-checked.
To compute a *name* without subscribing, use the pure builders:

```ts
import { tenantResourceChannel, parseWithin, isChannelError } from '@revenexx/talkback-js/channels';

tenantResourceChannel('acme-eu', 'revenexx.integrations.run', '01J2X…').name
// → 'tenant:acme-eu.revenexx.integrations.run.01J2X…'

try {
  parseWithin('acme-eu', untrusted);
} catch (err) {
  if (isChannelError(err)) {
    err.code; // 'malformed' | 'unknown_namespace' | 'tenant_mismatch' | 'too_long'
  }
}
```

Two omissions are deliberate. There is no `parse(name)` without a tenant — "validate the
grammar, then separately remember to check the tenant" is the shape of a cross-tenant
leak. And the action form and the resource form are two functions
(`tenantActionChannel`, `tenantResourceChannel`) rather than one with an optional
argument: they have the same arity and different meanings, and what tells them apart is
the *source* — the action comes from the topic, the id from the envelope's `topic_id`.

Discriminate `ChannelError` on `err.code`, not with `instanceof`. The package ships ESM
and CJS; a dependency graph that pulls in both loads the class twice, and `instanceof`
then fails for an error that is genuinely ours.

## Events

What arrives is the platform event envelope, verbatim:

```ts
interface Envelope<T> {
  id: string;              // evt_<ulid>, and the deduplication key
  tenant_id: string;
  topic: string;           // <vendor>.<app>.<entity>.<action>
  topic_id?: string | null; // a STRING or null, never a number
  data: T;
  metadata?: Record<string, unknown>;
  time?: string;           // RFC3339 — note the name: `time`, not `occurred_at`
}
```

Three behaviours are worth knowing before you build on them:

**`listen(action, …)` filters on `envelope.topic`, not on the channel name.** On a
resource channel the action is not in the name at all, so a channel-name filter would
match everything while looking like it filtered.

**Events are deduplicated on `envelope.id` across the whole client.** A grid on the
action channel and an open panel on the resource channel receive the same event twice —
that is contractual, not a bug — and the client collapses it for you. The window is
bounded (2048 ids by default, `dedupeCapacity`) so a long-lived tab does not grow
forever.

**`onResync` is the "refetch over HTTP" signal.** It fires with `reason:
'history-overflow'` when a reconnect's gap was larger than the recovery buffer, and with
`reason: 'no-history'` on **every** subscribe of a `stream:` channel — that namespace
keeps no history, so a reconnect mid-run always lost whatever arrived while away and no
endpoint can return it.

### Handle API

| Method | |
|---|---|
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

`leave()` releases one handle. The underlying subscription is torn down only when the
last handle on that channel leaves.

## Vue

```ts
// plugins/talkback.client.ts
import { createTalkback } from '@revenexx/talkback-js';
import { provideTalkback } from '@revenexx/talkback-js/vue';

export default defineNuxtPlugin(nuxtApp => {
  const tb = createTalkback({ /* … */ });
  tb.connect();
  nuxtApp.vueApp.runWithContext(() => provideTalkback(tb));
});
```

```vue
<script setup lang="ts">
import { useTalkbackTopic, useTalkbackResource } from '@revenexx/talkback-js/vue';

// A grid. One action is one channel, so one call per action.
for (const action of ['started', 'finished', 'failed'] as const) {
  useTalkbackTopic(`revenexx.integrations.run.${action}`, { handler: () => load(true) });
}

// A detail panel: every action arrives on one channel, so `on` filters here. The id may
// be a ref or a getter, and the composable re-subscribes when it changes — releasing the
// old channel before taking the new one.
useTalkbackResource('revenexx.integrations.run', () => props.run.id, {
  on: ['finished', 'failed'],
  handler: e => apply(e),
  onResync: () => refetch(),
  enabled: () => props.open,        // skip while the panel is closed
});
</script>
```

`useTalkbackTopic`, `useTalkbackResource`, `useTalkbackUser`, `useTalkbackStream` and
`useTalkbackPresence` all take the same options — `on`, `handler`, `raw`, `onResync`,
`enabled`, `talkback` — and all clean up via `onScopeDispose`. A route change cannot
leave a subscription open. They return `{ channel, stop() }`, not anything
query-shaped: the events are refetch signals, and the payload deliberately does not
carry the resource.

Pass `talkback` explicitly when there is no component instance to `inject` from — a test
running in a plain `effectScope`, or some plugin setups.

**Nuxt module authors:** unimport skips `node_modules`, so these do not auto-import on
their own. Add the package to `imports.transform.include` and `build.transpile`.

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
4. `limit` must be positive — `-1` is Centrifugo's "no limit" and is rejected rather
   than clamped — and `sinceOffset` only works paired with `sinceEpoch`, because an
   offset without its epoch silently skips publications.

A 429 is waited out exactly once, honouring `Retry-After` (which the facade computes
from the bucket's own reservation). Set `maxRetryWaitMs: 0` inside a request handler
that has its own deadline.

Failures are typed, discriminated on HTTP status and operation rather than on message
text:

| Error | Status | Means |
|---|---|---|
| `TalkbackUnauthenticatedError` | 401 | *your* M2M credential — not the end user's session |
| `TalkbackForbiddenError` | 403 | missing scope, tenant membership, or a channel outside the tenant (carries `channel`) |
| `TalkbackUnknownTenantError` | 404 | the tenant is unknown. The credential is fine, the name is not |
| `TalkbackRequestError` | 400, 413 | the request itself; retrying unchanged cannot help |
| `TalkbackRateLimitedError` | 429 | carries `retryAfterMs` |
| `TalkbackUnavailableError` | 502, 503 | a dependency. Retryable, unlike everything above |

Every error carries `operation` and the `requestId` the facade echoed, for correlating
with its audit line. The Nitro adapters pass these statuses through rather than
collapsing them into 500 — a 404 and a 403 send different people to different places.

## Testing

`@revenexx/talkback-js/testing` replaces Centrifugo so you can test the realtime path
without one. That matters more than it sounds: without it the polling loop this package
exists to delete stays in place as a "safety net", and the application carries both.

```ts
import { createFakeClient, envelope } from '@revenexx/talkback-js/testing';
import { createTalkback } from '@revenexx/talkback-js';

const fake = createFakeClient();
const tb = createTalkback({
  host: 'http://localhost',
  tenant: () => 'acme-eu',
  userId: () => 'u1',
  tokenEndpoint: '/t',
  subscriptionTokenEndpoint: '/s',
  client: () => fake,                    // the seam
});

const seen: unknown[] = [];
tb.topic('revenexx.integrations.run.finished').listen('finished', e => seen.push(e));

fake.emit('tenant:acme-eu.revenexx.integrations.run.finished',
  envelope({ topic: 'revenexx.integrations.run.finished', topicId: '42' }));

expect(seen).toHaveLength(1);
expect(fake.subscribeCounts.get('tenant:acme-eu.revenexx.integrations.run.finished')).toBe(1);
```

It fakes the *seam*, not the wire protocol — faking frames would mean maintaining a
second implementation of Centrifugo whose divergences no test can see. Beyond `emit`, it
exposes `subscribed(channel, ctx)` (pass `{ wasRecovering: true, recovered: false }` to
reproduce the gap that triggers `onResync`), `failed(channel, message)`, and the
assertion surfaces `subscribeCounts`, `tokenRequests` and `subscribed_`.

`channelVectors` ships the shared grammar vector suite, if you are validating channel
names yourself.

## Why this package exists

A client has to be able to *build* a channel name from what it already has — and **a
divergence is silent**. The client subscribes to a channel nobody publishes to, and
nothing anywhere reports an error. So the grammar is not reimplemented per consumer,
where each copy could quietly drift from the server's and from every other: it is
authored once, on the Go side, and vendored here — see "Where the grammar comes from"
below for how a mismatch still fails a build.

It is also **not** a `laravel-echo` connector. It borrows Echo's shape and has no Pusher
semantics — no `socket_id`, no `auth` endpoint format — and no PHP side. The reason
Laravel Broadcasting is not the answer here was never Echo's ergonomics; it is key
custody. Whoever holds the signing key can assert any channel, including another
tenant's. The facade is the only component that holds it, and it stays the only minting
path.

## Development

```sh
npm ci
npm run check          # lint + typecheck + unit tests
npm run build          # tsup → dist (ESM + CJS + types)
```

`playground/` is a small Nuxt app that runs the package against a local stack — the two
things that cannot be unit-tested are a real Nitro handler and a real subscription over a
real transport. See [`playground/README.md`](./playground/README.md).

Releases go through Changesets: add one with `npx changeset`, and merging the "Version
Packages" PR publishes to npm over OIDC trusted publishing. The publishing workflow's
*filename* is bound to the trusted-publisher configuration on npmjs and is not free to
change.

## Where the grammar comes from

The channel grammar in `src/channels/` is the client half of a contract whose other
half is Go, in the private repository `revenexx/talkback`. The 52 grammar vectors in
`src/testing/channel-vectors.json` are **generated there** from the vector table in
`internal/channels/channels_test.go`; the copy in this repository is vendored.

The intent is for a CI job in `revenexx/talkback` to check this repository out, compare
both copies byte for byte, and run its Go constants against the regexes in
`src/channels/grammar.ts` — so a change to the grammar made only here fails there, not
here. That job is not wired up yet; until it is, treat the vendored copies as
authoritative only once the Go side has produced them, and start grammar changes on the
Go side regardless.
