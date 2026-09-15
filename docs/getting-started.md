# Getting Started

Target: events arriving in your application in under fifteen minutes.

## Prerequisites

- **Node** ≥ 20.3
- **`centrifuge`** ≥ 5.2 — a required peer dependency, installed alongside
- **`vue`** ≥ 3.4 and **`vitest`** ≥ 2.0 — optional peers, pulled in only if you import
  the `/vue` or `/testing` entries
- For the BFF route: Zitadel M2M client credentials with the `talkback:write` scope, and
  the facade base URL

```sh
npm install @revenexx/talkback-js centrifuge
```

## Choose a shape

Neither shape ever puts a signing key in the browser.

| Shape | Use it when |
| --- | --- |
| **Via a BFF** | the visitor has no platform login (a storefront), the token's contents must be decided server-side, or you mint on somebody else's behalf |
| **Direct** | the application sits behind the platform login and the browser can mint for itself |

The walkthrough below builds the BFF shape; [direct mode](#direct-mode) is a two-line
change at the end.

## 1. Mint tokens on your server

Create **one** facade client for the whole server — the token source caches, and a client
per request re-authenticates on every mint.

```ts
// server/utils/talkback.ts
import { createFacadeClient, createTokenSource } from '@revenexx/talkback-js/server';

export const facade = createFacadeClient({
  baseUrl: process.env.TALKBACK_URL!,   // no trailing /v1
  tenant: process.env.TALKBACK_TENANT!, // slug or UUID; the facade canonicalises it
  tokens: createTokenSource({
    issuer: process.env.ZITADEL_ISSUER!,
    clientId: process.env.TALKBACK_CLIENT_ID!,
    clientSecret: process.env.TALKBACK_CLIENT_SECRET!,
  }),
});
```

Then the route. On Nuxt/Nitro:

```ts
// server/routes/bff/talkback-token.post.ts
import { nitroTokenHandler } from '@revenexx/talkback-js/server';
import { facade } from '../../utils/talkback';

export default defineEventHandler(
  nitroTokenHandler({
    facade,
    h3: { readBody, createError },
    async resolveUser(event) {
      const session = await getUserSession(event);   // throws 401 without one
      return { tenant: await tenantForOrg(session), userId: session.userInfo.sub };
    },
    authorizeChannels: ({ user, requested }) => channelsFor(user, requested),
  }),
);
```

Not on Nitro? `createTokenRoute` and `createSubscriptionTokenRoute` are the
framework-agnostic factories underneath: they take a request and a parsed body and return
the response body.

!!! danger "The session is the only source of identity"
    Never read the tenant or the user id from the request body. A value the caller
    supplies cannot authorise the caller.

### What `authorizeChannels` must do

The route runs every requested channel through `parseAllWithin(requested, user.tenant)`
before minting, so a channel belonging to **another tenant** is rejected without your
code doing anything. **That is where the built-in protection stops.**
`user:<tenant>.<someoneElse>` parses perfectly well against the right tenant — so inside
one tenant, nothing but your callback stands between a signed-in user and another user's
channel.

Which is why it **filters** rather than validates:

```ts
function channelsFor(user: TalkbackUser, requested: readonly string[]): string[] {
  const allowed = new Set([userChannel(user.tenant, user.userId).name]);
  for (const topic of topicsVisibleTo(user)) {          // your authorisation, not ours
    allowed.add(tenantActionChannel(user.tenant, topic).name);
  }
  return requested.filter(c => allowed.has(c));         // filter, never pass through
}
```

`requested` comes from the request body. Treat it as a hint about what the UI needs —
never as a grant.

For channels the client only discovers at run time (opening a detail panel, expanding a
row), add a second route with `nitroSubscriptionTokenHandler` and its `authorizeChannel`
callback: one channel per request.

## 2. Connect in the browser

```ts
import { createTalkback } from '@revenexx/talkback-js';

const tb = createTalkback({
  host: 'https://talkback.revenexx.com', // the SAME host the BFF calls
  tenant: () => tenantSlug.value,        // PROVIDERS, not values — both change at run time
  userId: () => user.value.id,
  tokenEndpoint: '/bff/talkback-token',
  subscriptionTokenEndpoint: '/bff/talkback-subscription-token',
});
tb.connect();
```

**One host, two paths.** `host` here and `baseUrl` on the server are the same origin:
Centrifugo's client transport sits at the root (`/connection/websocket` and its
fallbacks), the facade API under `/v1`. There is no separate realtime hostname, and
`host` takes no trailing `/v1`.

**One client per application.** A second `createTalkback` opens a second WebSocket and
mints its own connection token.

## 3. Listen

```ts
// A grid watching every run that finished. The topic includes the ACTION:
// one action is one channel, and there are no wildcards.
tb.topic('revenexx.integrations.run.finished')
  .listen('finished', e => refetch(e.topic_id));

// One open detail panel: every action on this one resource, on one channel.
const handle = tb.resource('revenexx.integrations.run', runId)
  .listenAny(e => apply(e))
  .onResync(() => refetchFromHttp());  // the gap was bigger than the buffer

handle.leave();                        // on unmount
```

The tenant is never an argument. It comes from the provider you passed to
`createTalkback`, so an application cannot reach another tenant's channel by getting an
argument order wrong.

A grid interested in three actions takes three handles — see
[Channels](channels.md#action-and-resource-are-two-different-names) for why.

## Verify it works

1. `tb.connect()` and subscribe as above.
2. Trigger the event on the producing service.
3. The handler fires. If it does not, check in this order:
   - the channel name you subscribed to is one the producer actually publishes to
     ([Channels](channels.md)), since a wrong name fails **silently**;
   - the token route returned 200 — a 403 there carries the offending `channel`;
   - `subscribed(fn)` fired on the handle, and `error(fn)` did not.

## Direct mode

If the signed-in user holds a platform login, point the two endpoints at the facade and
pass the user's access token:

```ts
const tb = createTalkback({
  host: 'https://talkback.revenexx.com',
  tenant: () => tenantSlug.value,
  userId: () => user.value.id,
  tokenEndpoint: 'https://talkback.revenexx.com/v1/tokens',
  subscriptionTokenEndpoint: 'https://talkback.revenexx.com/v1/subscription-tokens',
  accessToken: () => auth.accessToken.value,  // a PROVIDER — refreshed while the tab lives
});
```

That is the whole change. `accessToken` also switches the request itself: the token goes
out as `Authorization: Bearer`, the tenant as `X-Revenexx-Tenant`, and `credentials`
becomes `omit` — the facade allows every origin, and a browser refuses credentials mode
against a wildcard origin.

The provider may be async and may answer `null` (`() => Promise<string | null>`), which
is what an OIDC token source actually looks like. No token yet sends the request without
a bearer rather than throwing, so "not signed in" arrives as the server's 401 instead of
a broken client.

**What the facade allows an end user.** It mints **only for the caller itself**: the
request carries no `user_id` and the facade fills it from the token's own `sub`, so
naming somebody else is a 403. `roles`, `info` and `override` are refused — those exist
for a server-side caller building a body on a user's behalf. Publishing is not available
at all; that stays a service scope.

**Requirements.** The user needs a `user` or `admin` role in the Zitadel **user** project.
A `talkback:*` scope does not substitute: those live in the M2M project, and a role is
only honoured from the project that granted it.

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

for (const action of ['started', 'finished', 'failed'] as const) {
  useTalkbackTopic(`revenexx.integrations.run.${action}`, { handler: () => load(true) });
}

useTalkbackResource('revenexx.integrations.run', () => props.run.id, {
  on: ['finished', 'failed'],
  handler: e => apply(e),
  onResync: () => refetch(),
  enabled: () => props.open,   // skip while the panel is closed
});
</script>
```

All five composables clean up via `onScopeDispose`, so a route change cannot leave a
subscription open. See the [API Reference](api.md#vue-composables).

!!! note "Nuxt module authors"
    unimport skips `node_modules`, so these do not auto-import on their own. Add the
    package to `imports.transform.include` and `build.transpile`.

## Working on the package itself

```sh
npm ci
npm run check   # lint + typecheck + unit tests
npm run build   # tsup → dist (ESM + CJS + types)
```

`playground/` is a small Nuxt app that runs the package against a local stack — the two
things that cannot be unit-tested are a real Nitro handler and a real subscription over a
real transport.

Releases go through Changesets: add one with `npx changeset`, and merging the "Version
Packages" PR publishes to npm over OIDC trusted publishing. The publishing workflow's
*filename* is bound to the trusted-publisher configuration on npmjs and is not free to
change.
