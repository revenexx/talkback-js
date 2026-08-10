# Changesets

This folder is for [changesets](https://github.com/changesets/changesets): every
pull request that changes `clients/js` carries one, and the release workflow turns
them into a version bump plus a changelog entry.

It lives under `clients/js/` rather than at the repository root **on purpose**. The
root of this repository is a Go service, and a Go-only pull request has no business
tripping over a changeset gate — the `js` job filters on `clients/js/**` for the
same reason.

```sh
cd clients/js
npx changeset            # describe the change, pick major/minor/patch
npx changeset --empty    # for a PR that intentionally needs no release
```
