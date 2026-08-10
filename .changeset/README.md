# Changesets

This folder is for [changesets](https://github.com/changesets/changesets): every
pull request carries one, and the release workflow turns them into a version bump
plus a changelog entry.

```sh
npx changeset            # describe the change, pick major/minor/patch
npx changeset --empty    # for a PR that intentionally needs no release
```

The `ci` job runs `changeset status --since=origin/main` on every pull request, so
a missing changeset fails there rather than at release time. The one exception is
`changeset-release/main` — the branch the release workflow opens, whose entire
purpose is to consume the changesets, so it has none left by definition.
