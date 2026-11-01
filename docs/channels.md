# Channels

A channel name is an exact string. There are no wildcards, and **a wrong name fails
silently** — you subscribe to something nobody publishes to and no error is reported
anywhere. This page is the part to get right first.

## The five namespaces

The registry is exhaustive: a name that is not one of these does not exist.

| Namespace | Shape | History | Presence |
| --- | --- | --- | --- |
| `user:` | `<tenant>.<user_id>` | ✅ | — |
| `tenant:` | `<tenant>.<vendor>.<app>.<entity>[.<action｜topic_id>]` | ✅ | — |
| `presence:` | same tail as `tenant:` | — | ✅ |
| `stream:` | `<tenant>.<stream_id>` | — | — |
| `site:` | `<tenant>.<site>.<resource>[.<id>]` | — | — |

The **tenant slug is always the first segment**, so every channel name states its own
isolation boundary.

## Action and resource are two different names

An event on topic `<vendor>.<app>.<entity>.<action>` is published to the **action**
channel:

```
tenant:<tenant>.<vendor>.<app>.<entity>.<action>
```

and — when the envelope carries a `topic_id` — **also** to the **resource** channel:

```
tenant:<tenant>.<vendor>.<app>.<entity>.<topic_id>
```

Those two names share a prefix and are otherwise unrelated. Neither contains the other,
and there is no wildcard that covers both. So a grid interested in three actions takes
three handles:

```ts
for (const action of ['started', 'finished', 'failed'] as const) {
  tb.topic(`revenexx.integrations.run.${action}`).listenAny(() => reload());
}
```

while one open detail panel takes a single handle, because every action on that resource
arrives on one channel:

```ts
tb.resource('revenexx.integrations.run', runId).listenAny(e => apply(e));
```

This is also why the same event legitimately arrives twice when a grid and a panel are
both open. The client deduplicates on `envelope.id`; see
[Events](api.md#the-envelope).

!!! note "Three-segment topics"
    `tb.topic()` accepts a three-segment topic, which builds the resource *kind* channel
    `tenant:<t>.<vendor>.<app>.<entity>`. It is a valid name the event bus never
    publishes to — useful only for ad-hoc publishes of your own, never for bus events.

## Building names yourself

Import from `@revenexx/talkback-js/channels`, which runs anywhere (browser, Node, tests):

```ts
import {
  userChannel, streamChannel, tenantChannel,
  tenantActionChannel, tenantResourceChannel,
  siteChannel, siteResourceChannel,
} from '@revenexx/talkback-js/channels';

userChannel('acme-eu', 'u1').name;
// 'user:acme-eu.u1'

tenantActionChannel('acme-eu', 'revenexx.integrations.run.started').name;
// 'tenant:acme-eu.revenexx.integrations.run.started'

tenantResourceChannel('acme-eu', 'revenexx.integrations.run.started', '4711').name;
// 'tenant:acme-eu.revenexx.integrations.run.4711'
```

Each builder throws a `ChannelError` rather than returning a malformed name. Catch it
with `isChannelError(err)` and read `err.code` (`CHANNEL_ERROR_CODES` enumerates them).

## Parsing and validating

```ts
import { parseWithin, parseAllWithin, presenceFor } from '@revenexx/talkback-js/channels';

parseWithin('tenant:acme-eu.revenexx.integrations.run.started', 'acme-eu');
// → Channel — throws if the name is malformed OR belongs to another tenant

parseAllWithin(requested, user.tenant);   // what the BFF token route runs for you
presenceFor(channel);                     // the presence: twin of a tenant: channel
```

**`parseWithin` takes the tenant as a required argument, and that is deliberate.** There
is no `parse()` without one, and no `fromTopic()` that guesses between the action and the
resource form. Both omissions are asserted by the Go clamp — see below.

Namespace helpers: `isNamespace`, `regexForNamespace`, `hasPresence`, `hasHistory`,
`NAMESPACES`, `NAMESPACES_WITH_HISTORY`, `NAMESPACES_WITH_PRESENCE`,
`MAX_CHANNEL_LENGTH`.

## Where the grammar comes from

The grammar in `src/channels/` is the client half of a contract whose other half is Go,
in `revenexx/talkback`. The vectors in `src/testing/channel-vectors.json` are generated
there from the vector table in `internal/channels/channels_test.go`; the copy here is
**vendored**.

The clamp runs on the Go side: `internal/channels/ts_clamp_test.go` compares the two
copies and runs the Go constants against the regexes in `src/channels/grammar.ts`, so a
grammar change made only here fails there. **Start grammar changes on the Go side.**

!!! warning "Do not 'improve' the regexes"
    They are literals rather than strings for a reason, and the Go clamp compares them as
    written. Read the header of `src/channels/grammar.ts` before touching anything in
    that directory.
