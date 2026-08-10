---
'@revenexx/talkback-js': patch
---

Relicensed under **MIT**, and moved to its own repository.

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
