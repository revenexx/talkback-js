---
'@revenexx/talkback-js': minor
---

The browser client and the fake transport.

`createTalkback` gives every namespace a handle whose tenant is never an argument, and
does three things an application otherwise forgets: it deduplicates on `envelope.id`
(the same event arrives on the action channel *and* the resource channel — that is
contractual), it fires `onResync` when the recovery buffer could not close the gap, and
it reference-counts per channel name so two components watching one run cost one
subscription token.

`@revenexx/talkback-js/testing` ships a fake transport, which is the precondition for
deleting a polling loop rather than keeping it as a safety net.
