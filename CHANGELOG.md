# @revenexx/talkback-js

## 0.3.0

### Minor Changes

- cda26ca: Widen `accessToken` to accept an async, nullable provider:
  `() => string | null | Promise<string | null>`.

  It shipped as a synchronous `Provider<string>`, and that made it unusable by the one host
  that wants it. A real token source is neither synchronous nor always present: the cockpit's
  is `getToken: () => Promise<string | null>` — a promise because an OIDC library refreshes
  over the network, nullable because there is no token until sign-in completes.

  Resolving to `null` or `''` now sends the request **without** a bearer rather than
  throwing. "Not signed in yet" is a normal startup state and belongs to the server's 401,
  which is what a provider watching for sign-in reacts to; throwing would turn it into a
  broken client. Direct mode stays decided by the option being _set_ rather than by what it
  resolves to, so the tenant header and `credentials: 'omit'` apply either way — otherwise a
  missing token would quietly change the request's shape as well as its authorisation.

  This also makes the option the seam for a host whose **own** token route is
  bearer-authenticated rather than cookie-authenticated. Such a host wraps `fetch` by hand
  today to attach the header; pointing the endpoints at its own route and passing
  `accessToken` now does the same thing, and `credentials: 'omit'` costs it nothing because
  it has no session cookie to send.

  Backward compatible: a synchronous provider still satisfies the widened type.

## 0.2.0

### Minor Changes

- be24b3f: Add `accessToken`, so a browser can mint its own token at the facade with no BFF route.

  The facade now admits an **end user** at its mint endpoints — a `user` or `admin` role in
  the Zitadel user project, rather than the `talkback:write` a BFF's service identity holds.
  Such a caller may mint only for itself, which is what makes it safe from a browser. The
  package could not express that: `tokenEndpoint` was just a URL and there was no way to send
  an `Authorization` header at all, so the direct path existed on the server and was
  unreachable from here.

  Setting `accessToken` switches the mint request rather than only adding a header, because
  three things change together and getting one of them wrong fails in a way that is hard to
  read:

  - the token goes out as `Authorization: Bearer`;
  - the tenant goes out as `X-Revenexx-Tenant`, which the BFF route used to do — the facade
    answers **400** when a token authorises several tenants and none is named;
  - `credentials` becomes `omit`. The facade answers `Access-Control-Allow-Origin: *` and
    deliberately never sends `Access-Control-Allow-Credentials`, because storefronts run on
    per-tenant custom domains that cannot be enumerated. A browser refuses that combination
    with credentials mode on, so the previous `include` would have blocked the response even
    though the facade answered 200.

  It is a provider like `tenant` and `userId`, not a value: a connection token is minted
  again on every reconnect and every `expire_at`, so a token read once at construction goes
  stale in exactly the long-lived dashboard this package is for.

  **The BFF path is unchanged** — same cookie session, no bearer, `credentials: 'include'` —
  and remains the only way to mint on behalf of somebody else, to decide a token's contents
  server-side, or to serve a visitor with no platform login. Both paths are covered by tests
  asserting the request each one actually sends.

### Patch Changes

- 389dc35: Document what `authorizeChannels` has to do, and precisely what the built-in check does
  not cover.

  The Quickstart already warned that `requested` is a hint rather than a grant, but it never
  said where the package's own protection stops. `createTokenRoute` runs
  `parseAllWithin(requested, user.tenant)` before minting, so a channel in another **tenant**
  is rejected for you — and that is the whole extent of it. `user:<tenant>.<someoneElse>`
  parses correctly against the right tenant, so within one tenant nothing but
  `authorizeChannels` separates a signed-in user from another user's channel.

  Adds that boundary, a filtering sketch built from the `/channels` builders, a note that
  `playground/` is deliberately not a reference for `resolveUser` or `authorizeChannels`, and
  a line on what `resolveUser` does in a BFF with no server-side session.

  Documentation only; the README ships in the tarball.

- c17057d: Fix `ChannelSubscription.channel`, which was typed as a `Ref` but was not reactive.

  `useChannel` created it as `{ value: null } as Ref<string | null>` — a plain object with a
  cast. `ref` was never imported from `vue`. The type checked, and every existing test
  passed because they read `.value` directly, where a plain property read behaves
  identically.

  What was broken is the only thing the field is for. A template binding
  `sub.channel.value` rendered the first value and never updated, and a `watch` on it never
  fired — including in `playground/app/pages/index.vue`, which binds it twice. Consumers
  saw a channel name freeze after the first subscription while the underlying subscription
  correctly followed its reactive arguments.

  It is now `ref<string | null>(null)`. No API or type change: `channel` was always declared
  as `Ref<string | null>` and now actually is one, so a consumer already wrapping it in a
  `computed` as a workaround keeps working.

  Reported by the `studio-shared` integration, which found it while reading the source
  rather than by hitting it — the failure is silent.

## 0.1.3

### Patch Changes

- 8a46c6c: Fix the documented Centrifugo host, which named a hostname that does not exist.

  Every example gave `host` as `https://rt.revenexx.com`. There is no such host: the Swarm
  stack serves Centrifugo's client transport, the facade API, the JWKS and the metrics paths
  all on **one** origin — `talkback.revenexx.com` — with the transport at the root
  (`/connection/websocket` and its fallbacks) and the facade under `/v1`. Anyone who copied
  the README got a DNS failure.

  The fix also says the thing the old docs left a reader to guess wrong: `host` for the
  browser client and `baseUrl` for `createFacadeClient` are the **same origin**. Two
  different example hostnames invited the reasonable conclusion that they were two services
  in two places.

  Documentation only — no API, behaviour or type change. It is a `patch` rather than an
  empty changeset because the corrected JSDoc ships in `dist/**/*.d.ts`, so the wrong
  hostname was reaching consumers through the type definitions as well as the README.

## 0.1.2

### Patch Changes

- 50afc46: Relicensed under **MIT**, and moved to its own repository.

  Nothing about the API, the exports or the runtime behaviour changed — `0.1.2` is
  `0.1.1` with a different licence and different metadata. Two things are worth knowing:

  - **The licence changed.** Up to `0.1.1` the `LICENSE` in the tarball read "proprietary
    and confidential" and pointed at the revenexx platform licence. From `0.1.2` it is
    the standard MIT licence. `package.json` now declares the SPDX identifier `MIT`
    instead of `SEE LICENSE IN LICENSE`, so tooling can classify it.
  - **The source is public.** The package was developed inside a private monorepo and now
    lives at [`revenexx/talkback-js`](https://github.com/revenexx/talkback-js), with the
    history of its five original commits intact. Releases from `0.1.2` on carry npm
    provenance attestation, which a private source repository could not produce.

  The channel grammar is still authored on the Go side and vendored here — see "Where the
  grammar comes from" in the README. Grammar changes start there, not in this repository.

## 0.1.1

### Patch Changes

- 89d6faf: Rewrite the README as consumer documentation, and correct an example that receives nothing.

  The published README carried design rationale and no usage: no install, no quickstart,
  no API. It now covers the entry points, a three-step quickstart, the channel grammar,
  the envelope and its deduplication and resync behaviour, the typed facade errors and the
  fake transport.

  The example it led with was wrong. `tb.topic('revenexx.integrations.run')` builds the
  resource _kind_ channel, while events are published to the _action_ channel
  `…run.finished` — and Centrifugo has no wildcards, so the two names merely share a
  prefix. The call subscribed successfully, `.listen('finished')` looked like a filter,
  and nothing ever arrived. Corrected in the README and in the three JSDoc comments that
  taught it, which ship in the type declarations: the module example, the
  `useTalkbackTopic` example, and `tenantChannel`.

  No runtime behaviour changed, and the channel grammar is untouched.
