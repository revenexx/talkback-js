# Talkback JS

`@revenexx/talkback-js` is the **client half** of the Talkback contract. Talkback is the
platform's realtime push plane — Centrifugo behind a token-minting facade — and this
package is what an application uses to talk to it: the channel grammar, a typed facade
client, the BFF routes that mint tokens, an Echo-shaped browser client, and Vue
composables.

It exists because a client has to *build* a channel name from what it already has, and a
divergence there is **silent**: the client subscribes to a channel nobody publishes to,
and nothing anywhere reports an error. So the grammar is authored once on the Go side and
vendored here, rather than reimplemented per consumer.

## Who this is for

| You are | Start at |
| --- | --- |
| Adding realtime to an application | [Getting Started](getting-started.md) |
| Working out which channel to subscribe to | [Channels](channels.md) |
| Looking for a function, option or error type | [API Reference](api.md) |
| Replacing Centrifugo in a test | [Testing](testing.md) |

## Where it sits

The package never holds a signing key. Only the Talkback facade mints, and it is the one
component that enforces tenant binding — see **ADR-0093** for the decision and
`component:default/talkback` for the service half. This package consumes the facade's
`/v1` API (`api:default/talkback-facade`) and nothing else.

```
Browser ──1── your BFF ──2── Talkback facade ──3── Centrifugo
   │           (holds the session)   (mints, holds the key)
   └───────────── 4: WebSocket with the token ──────────────┘
```

In **direct mode** steps 1 and 2 collapse: a browser behind the platform login mints its
own token at the facade with the user's Zitadel access token, and there is no BFF route.

## What it handles for you

Three things an application otherwise rediscovers the hard way:

- **Deduplication.** The same event arrives on both the action channel and the resource
  channel. That is contractual, not a bug; the client collapses it on `envelope.id`.
- **Lost history.** After a reconnect whose gap outran the recovery buffer, `onResync`
  fires so you can refetch over HTTP. Realtime is never the source of truth.
- **Reference counting.** Two components watching the same resource cost one
  subscription, and the subscription is torn down when the last handle leaves.

## Quick links

- [npm: `@revenexx/talkback-js`](https://www.npmjs.com/package/@revenexx/talkback-js)
- [GitHub: `revenexx/talkback-js`](https://github.com/revenexx/talkback-js)
- [Talkback service (`revenexx/talkback`)](https://github.com/revenexx/talkback)
- Production push plane: <https://talkback.revenexx.com>
