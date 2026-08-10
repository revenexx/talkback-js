/**
 * `@revenexx/talkback-js/testing` — everything a consumer needs to test its realtime
 * paths without a running Centrifugo.
 *
 * That testability is the precondition for the migration this package exists to make
 * possible: without it the polling loop stays in place as a "safety net" and the
 * application ends up carrying both.
 *
 * `vitest` is an optional peer dependency. It is imported statically by the modules
 * that need it, and the isolation comes from the entry split — nothing reachable from
 * `@revenexx/talkback-js` or `/channels` imports this file.
 */
export { channelVectors, maxChannelLength } from './vectors.js';
export type { ChannelVector } from './vectors.js';

export { createFakeClient, envelope } from './fake-transport.js';
export type { FakeTalkbackClient } from './fake-transport.js';
