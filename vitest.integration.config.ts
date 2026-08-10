import { defineConfig } from 'vitest/config';

// The integration suites, run against a live stack:
//
//   cd ../.. && make dev        # Valkey, Centrifugo, NATS, facade, bridge, devstub
//   cd clients/js && npm run test:integration
//
// Base URLs come from TALKBACK_TEST_* with localhost defaults, the same convention
// the Go integration tests use (T5.2). They are a separate config rather than a
// tag so that `npm test` — and therefore the js CI job — never depends on Docker.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    // A real stack is slower than a fake transport, and a token has a 60-second
    // connect window; a 5-second default would flake on the transport matrix.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Centrifugo connections are process-global enough that parallel files fight
    // over the same channel names.
    fileParallelism: false,
    reporters: ['default'],
  },
});
