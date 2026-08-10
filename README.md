# `@revenexx/talkback-js`

The client half of the Talkback contract. It lives in the Talkback repository
rather than in a consumer, and that is the whole point: `docs/event-channels.md`
says a client has to be able to *build* a channel name from what it already has,
and that **a divergence is silent** — the client subscribes to a channel nobody
publishes to, and nothing anywhere reports an error. A TypeScript reimplementation
of the grammar in another repository cannot be tested against
`internal/channels`. Here it is: `internal/channels/ts_clamp_test.go` reads
`src/channels/grammar.ts` and fails `go test ./...` when the two disagree by a byte.

## Entry points

| Import | What it is |
|---|---|
| `@revenexx/talkback-js` | the Echo-shaped browser client (`createTalkback`) |
| `@revenexx/talkback-js/channels` | the channel grammar: builders and `parseWithin` |
| `@revenexx/talkback-js/server` | the facade client and the BFF token route factory |
| `@revenexx/talkback-js/vue` | `useTalkback`, `useTalkbackTopic`, `useTalkbackResource`, `useTalkbackPresence` |
| `@revenexx/talkback-js/testing` | a fake transport and envelope factories, so consumers can test without Centrifugo |

`centrifuge` is a required peer dependency. `vue` and `vitest` are optional peers —
they are reachable only from the `/vue` and `/testing` entries, so nothing pulls
them in unless you import those.

## What it is not

It is **not** a `laravel-echo` connector. It borrows Echo's *shape* — the chain,
the lifecycle, `listen` / `stopListening` / `leave` — and fills it with Talkback's
vocabulary. It has no Pusher semantics (`socket_id`, the `auth` endpoint format)
and no PHP side. ADR-0093 §7 rejects `denis660/laravel-centrifugo` because it puts
the API key *and* the signing key in every application and mints tokens locally;
that objection is about **local key custody**, never about Echo's ergonomics, and
the facade remains the only minting path here. See `docs/clients.md`.

## Releasing

Trusted publishing over OIDC from `.github/workflows/publish.yml` — the filename is
bound to the publisher configuration on npmjs and is not free to change. There is
deliberately no `publishConfig.provenance`: Sigstore provenance requires a public
source repository and this one is private. The token exchange itself works from a
private repo, so there is no `NPM_TOKEN`.
