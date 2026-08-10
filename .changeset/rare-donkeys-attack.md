---
'@revenexx/talkback-js': minor
---

First cut: the channel grammar, clamped byte for byte against `internal/channels`.

`@revenexx/talkback-js/channels` exports the three character classes, the three
regexes, `parseWithin` / `parseAllWithin` / `presenceFor` and the seven builders. There
is deliberately no `parse()` without a tenant argument and no `fromTopic()` that
guesses between the action and the resource form — both omissions are asserted by a Go
test, not left to review.

`@revenexx/talkback-js/testing` exports the 52 grammar vectors, generated from the
same table the Go suite runs, so a case added on one side cannot fall behind on the
other.
