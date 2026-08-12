---
'@revenexx/talkback-js': minor
---

Widen `accessToken` to accept an async, nullable provider:
`() => string | null | Promise<string | null>`.

It shipped as a synchronous `Provider<string>`, and that made it unusable by the one host
that wants it. A real token source is neither synchronous nor always present: the cockpit's
is `getToken: () => Promise<string | null>` — a promise because an OIDC library refreshes
over the network, nullable because there is no token until sign-in completes.

Resolving to `null` or `''` now sends the request **without** a bearer rather than
throwing. "Not signed in yet" is a normal startup state and belongs to the server's 401,
which is what a provider watching for sign-in reacts to; throwing would turn it into a
broken client. Direct mode stays decided by the option being *set* rather than by what it
resolves to, so the tenant header and `credentials: 'omit'` apply either way — otherwise a
missing token would quietly change the request's shape as well as its authorisation.

This also makes the option the seam for a host whose **own** token route is
bearer-authenticated rather than cookie-authenticated. Such a host wraps `fetch` by hand
today to attach the header; pointing the endpoints at its own route and passing
`accessToken` now does the same thing, and `credentials: 'omit'` costs it nothing because
it has no session cookie to send.

Backward compatible: a synchronous provider still satisfies the widened type.
