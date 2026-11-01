# Testing

`@revenexx/talkback-js/testing` replaces Centrifugo so you can test the realtime path
without one.

That matters more than it sounds. Without a way to test it, the polling loop this package
exists to delete stays in place as a "safety net" — and the application carries both
forever.

## The fake client

```ts
import { createFakeClient, envelope } from '@revenexx/talkback-js/testing';
import { createTalkback } from '@revenexx/talkback-js';

const fake = createFakeClient();
const tb = createTalkback({
  host: 'http://localhost',
  tenant: () => 'acme-eu',
  userId: () => 'u1',
  tokenEndpoint: '/t',
  subscriptionTokenEndpoint: '/s',
  client: () => fake,                    // the seam
});

const seen: unknown[] = [];
tb.topic('revenexx.integrations.run.finished').listen('finished', e => seen.push(e));

fake.emit('tenant:acme-eu.revenexx.integrations.run.finished',
  envelope({ topic: 'revenexx.integrations.run.finished', topicId: '42' }));

expect(seen).toHaveLength(1);
expect(fake.subscribeCounts.get('tenant:acme-eu.revenexx.integrations.run.finished')).toBe(1);
```

## What the fake exposes

| | |
| --- | --- |
| `emit(channel, payload)` | deliver a publication |
| `subscribed(channel, ctx)` | the subscribe lifecycle — pass `{ wasRecovering: true, recovered: false }` to reproduce the gap that triggers `onResync` |
| `failed(channel, message)` | the error path |
| `subscribeCounts` | assert reference counting: two handles on one channel is one subscription |
| `tokenRequests` | assert what was minted, and how often |
| `subscribed_` | the raw subscribe record |

`envelope({ … })` builds a valid platform envelope with sensible defaults, so a test does
not hand-roll `id`, `tenant_id` and `time` each time.

## Why it fakes the seam, not the wire

`client` replaces the Centrifuge client itself. Faking *frames* instead would mean
maintaining a second implementation of Centrifugo whose divergences no test can see —
the tests would pass against a protocol that is not the one in production.

The cost of the seam is that it does not exercise the transport. That is what
`playground/` is for: a small Nuxt app running the package against a local stack, because
a real Nitro handler and a real subscription over a real transport are the two things
unit tests cannot reach.

## Validating channel names yourself

`channelVectors` ships the shared grammar vector suite, and `maxChannelLength` the
length bound. Both are generated on the Go side — see
[Channels](channels.md#where-the-grammar-comes-from).

```ts
import { channelVectors } from '@revenexx/talkback-js/testing';

for (const v of channelVectors) {
  // v.name, v.valid, …
}
```

## Running this repository's own tests

```sh
npm ci
npm run check   # biome + tsc --noEmit + vitest run
```

`npm run test:integration` uses a separate vitest config and expects a local stack.
