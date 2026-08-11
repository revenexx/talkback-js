# @revenexx/talkback-js

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
