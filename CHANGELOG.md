# @revenexx/talkback-js

## 0.1.1

### Patch Changes

- 89d6faf: Rewrite the README as consumer documentation, and correct an example that receives nothing.

  The published README carried design rationale and no usage: no install, no quickstart,
  no API. It now covers the entry points, a three-step quickstart, the channel grammar,
  the envelope and its deduplication and resync behaviour, the typed facade errors and the
  fake transport.

  The example it led with was wrong. `tb.topic('revenexx.integrations.run')` builds the
  resource _kind_ channel, while events are published to the _action_ channel
  `…run.finished` — and Centrifugo has no wildcards, so the two names merely share a
  prefix. The call subscribed successfully, `.listen('finished')` looked like a filter,
  and nothing ever arrived. Corrected in the README and in the three JSDoc comments that
  taught it, which ship in the type declarations: the module example, the
  `useTalkbackTopic` example, and `tenantChannel`.

  No runtime behaviour changed, and the channel grammar is untouched.
