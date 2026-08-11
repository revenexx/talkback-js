# Contributing to `@revenexx/talkback-js`

What the package *is* and how to use it lives in [`README.md`](README.md). This file is
only about **how work gets in**: branches, commits, the checks, releases, and the rules
that enforce them.

The conventions here are the same ones `revenexx/talkback` uses — the Go service that
owns the other half of the channel grammar. That is deliberate: the two repositories are
worked on together, and two different branching models would be one more thing to hold
in your head for no benefit.

## Branching model

Branch names follow the revenexx engineering code standards:

```
TYPE-ISSUE_ID-DESCRIPTION      e.g. feat-PE-431-presence-handles
```

Types: `feat`, `doc`, `cicd`, `fix`, `refactor`.

This is **enforced, not suggested**. The `branch naming convention` ruleset rejects the
*creation* of any branch that does not start with one of those five prefixes, so a
`chore/…` or `feature/…` name fails at `git push`, not at review — and a branch that
already has commits on it is the expensive moment to find out.

Two families are exempt because they do not get to pick their own names: Dependabot's
`dependabot/**` refs, and `changeset-release/*`, which is the branch the release
workflow opens. Without that second exemption the release flow could not run at all.

The rule governs branches created **in this repository**, so it binds people with push
access. If you are contributing from a fork, push whatever branch name you like — your
fork is not covered, and the pull request is judged on its contents.

`main` is protected: no direct push, no force push, no deletion, and linear history.
Repository admins hold an `always` bypass, without which a single-maintainer repository
could not merge anything at all — GitHub does not let you approve your own pull request,
and the ruleset requires one approval. Treat using the bypass as a decision, not a
convenience.

## Commits

Conventional Commits: lowercase, imperative subject, no trailing period. An optional
scope is common and useful — it says which entry point moved.

```
feat(vue): reference-count subscriptions across composable instances
cicd: run biome, tsc and vitest on every push
```

Types in use: `feat`, `fix`, `docs`, `build`, `cicd`, `refactor`, `chore`. Note the
mismatch you will otherwise trip over exactly once: the *branch* type is `doc`, while
the *commit* type is `docs`. Both are correct in their place.

Because `main` requires linear history, only **squash** and **rebase** merges are
allowed. Merge commits are rejected.

## Before you push

Every one of these has a CI job behind it, so running them locally only changes *when*
you find out:

| Locally | Fails this check otherwise |
|---|---|
| `npm run check` — Biome, `tsc --noEmit`, then Vitest | `check (biome · tsc · vitest)` |
| `npm run build` — tsup, all five entry points | `check (biome · tsc · vitest)` |
| `npx changeset` — every PR that changes the package carries one | `check (biome · tsc · vitest)` |

`npm run build` is worth running even though `prepublishOnly` also builds: a sibling
package once published a tarball with no `dist` in it because nothing built first.

The integration suites are **not** in that table on purpose. `npm run test:integration`
needs a live stack, which lives in `revenexx/talkback` behind its `make dev` — so
`npm test`, and therefore CI, never depends on Docker.

## Releases

[Changesets](https://github.com/changesets/changesets). Every pull request that changes
the package carries one; `npx changeset --empty` covers a PR that intentionally needs no
release. The `check` job runs `changeset status --since=origin/main`, so a missing
changeset fails there rather than at release time.

One thing about that command will waste your time otherwise: `--since` compares against
git, not your working copy, so **the changeset has to be committed before the gate sees
it**. Run it on an uncommitted changeset and it reports the same "no changesets were
found" error as if you had written none. CI never hits this, because by then everything
is a commit.

On merge to `main`, `publish.yml` either opens or updates a "Version Packages" pull
request, or — when no changesets are left — publishes to npm and pushes the tag. It runs
under a GitHub App token rather than `GITHUB_TOKEN`, and that is load-bearing: pull
requests opened by `GITHUB_TOKEN` do not trigger required checks, which would leave the
Version Packages PR permanently unmergeable.

Publishing uses npm OIDC trusted publishing, so there is no `NPM_TOKEN`. The binding is
keyed to this repository **plus the workflow filename**, which is why `publish.yml` keeps
its name.

## Changing the channel grammar

The grammar in `src/channels/` is one half of a contract whose other half is Go, in
`revenexx/talkback`. That repository authors it: the vectors in
`src/testing/channel-vectors.json` are generated there and vendored here, and a CI job
there clamps the two together byte for byte. See "Where the grammar comes from" in the
README.

**Authoring and landing run in opposite directions, and conflating them deadlocks a pull
request.** The Go side decides what the grammar *is*. But the clamp job checks this
repository out at `main`, so it cannot go green until `main` already carries the matching
change. The order is therefore:

1. Land the TypeScript change here, on `main`.
2. Then the `revenexx/talkback` pull request goes green and merges.
3. Then release from here.

The release comes last on purpose: a published client carrying a grammar no released
server enforces would build channel names the server rejects.

## Changing the rules themselves

`.github/rulesets/*.json` are the source of truth for both active rulesets. Edit the
file, then push it to GitHub — don't click the settings in the web UI, or the repository
and the file silently disagree:

```sh
gh api repos/revenexx/talkback-js/rulesets -q '.[] | "\(.id)  \(.name)"'
gh api --method PUT repos/revenexx/talkback-js/rulesets/<id> --input .github/rulesets/main.json
```

That drift is not hypothetical. `revenexx/talkback` accumulated it twice — once with a
required check naming a job that had been deleted, and once with a branch-name exemption
present in the live ruleset but missing from the file.

The required status check contexts in `main.json` are **job names** from
`.github/workflows/ci.yml`, including the `·` separators (U+00B7). Rename a job and the
required check silently stops matching — a check that never reports leaves the pull
request blocked forever, so rename both in the same commit, and compare the strings
rather than eyeballing them.

`publish.yml`'s job is deliberately absent from the required checks: it only triggers on
push to `main`, so requiring it would deadlock every pull request.
