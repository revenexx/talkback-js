---
'@revenexx/talkback-js': patch
---

Document what `authorizeChannels` has to do, and precisely what the built-in check does
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
