---
'@revenexx/talkback-js': patch
---

Fix the documented Centrifugo host, which named a hostname that does not exist.

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
