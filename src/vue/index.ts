/**
 * `@revenexx/talkback-js/vue` — composables.
 *
 * `vue` is an OPTIONAL peer dependency, and the isolation comes from this entry alone:
 * nothing reachable from `@revenexx/talkback-js` or `/channels` imports it, so a React
 * application never resolves Vue.
 *
 * There is deliberately no `./react` entry. `integrations-ui` already has the patch
 * point — `qc.setQueryData(['workflow-runs', …])` in `WorkflowRuns.tsx` — so the core
 * plus about twenty lines of `useEffect` is the whole integration there. A React entry
 * would be additive if it ever earns its keep.
 *
 * A NOTE FOR NUXT MODULE AUTHORS: unimport skips `node_modules`, so these do not
 * auto-import on their own. Add the package to `imports.transform.include` and
 * `build.transpile` — `studio-integrations/src/module.ts` does exactly that for its own
 * runtime directory.
 */
export {
  provideTalkback,
  useTalkback,
  useTalkbackTopic,
  useTalkbackResource,
  useTalkbackUser,
  useTalkbackStream,
  useTalkbackPresence,
} from './composables.js';
export type { ChannelSubscription, MaybeRefOrGetter } from './composables.js';
