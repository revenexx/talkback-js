---
'@revenexx/talkback-js': minor
---

Vue composables: `useTalkback`, `useTalkbackTopic`, `useTalkbackResource`,
`useTalkbackUser`, `useTalkbackStream` and `useTalkbackPresence`.

All of them take ref-able arguments and clean up through `onScopeDispose`, which is what
lets a route change swap a channel instead of leaving one open. They return nothing
query-shaped on purpose: the target application has no query client, and the events are
refetch signals rather than state.

Adds `listenAny` to the handle — every envelope, whatever its action, deduplicated. It is
distinct from `listenAll`, which is a raw hook that fires before deduplication because a
`stream:` payload has no id to deduplicate on.
