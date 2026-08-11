---
'@revenexx/talkback-js': patch
---

Fix `ChannelSubscription.channel`, which was typed as a `Ref` but was not reactive.

`useChannel` created it as `{ value: null } as Ref<string | null>` — a plain object with a
cast. `ref` was never imported from `vue`. The type checked, and every existing test
passed because they read `.value` directly, where a plain property read behaves
identically.

What was broken is the only thing the field is for. A template binding
`sub.channel.value` rendered the first value and never updated, and a `watch` on it never
fired — including in `playground/app/pages/index.vue`, which binds it twice. Consumers
saw a channel name freeze after the first subscription while the underlying subscription
correctly followed its reactive arguments.

It is now `ref<string | null>(null)`. No API or type change: `channel` was always declared
as `Ref<string | null>` and now actually is one, so a consumer already wrapping it in a
`computed` as a workaround keeps working.

Reported by the `studio-shared` integration, which found it while reading the source
rather than by hitting it — the failure is silent.
