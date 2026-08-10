import { defineConfig } from 'tsup';

// Five entries, and the split is not cosmetic — it is what makes two of the peer
// dependencies OPTIONAL. `vue` is imported statically by src/vue/, `vitest` by
// src/testing/, and neither is reachable from src/index.ts, so a consumer that
// imports only the browser client never resolves either. That is the same
// arrangement a sibling package uses for its ./testing entry.
//
// It is also why src/testing/channel-vectors.json lives under the testing entry:
// esbuild inlines the JSON into whichever bundle imports it, and 52 grammar
// vectors have no business in the bundle of a browser that imports ./channels.
export default defineConfig({
  // Grown one entry per task rather than declared up front with stubs: an entry
  // listed here with no file behind it fails the build, and a stub that exports
  // nothing is worse — it publishes.
  entry: ['src/index.ts', 'src/channels/index.ts', 'src/server/index.ts', 'src/vue/index.ts', 'src/testing/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
});
