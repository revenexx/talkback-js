---
'@revenexx/talkback-js': minor
---

Add `accessToken`, so a browser can mint its own token at the facade with no BFF route.

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
