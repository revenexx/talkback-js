import { defineConfig } from 'vitest/config';

// Tests live next to the code they test (`src/**/*.test.ts`) rather than in a
// separate tests/ tree, which is a deliberate divergence from a sibling package:
// the grammar suites are GENERATED from the same fixture the Go clamp pins, so
// keeping them beside src/channels/ is what makes the pairing visible when
// either side is edited.
//
// Integration tests against a running stack (see vitest.integration.config.ts;
// the stack lives in revenexx/talkback, a separate repository) are excluded
// here and have their own config, so `npm test` never depends on Docker.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules/**', 'dist/**'],
    reporters: ['default'],
  },
});
