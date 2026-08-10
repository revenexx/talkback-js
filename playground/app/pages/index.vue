<script setup lang="ts">
import { ref } from 'vue';
import { useTalkbackResource, useTalkbackStream, useTalkbackTopic } from '@revenexx/talkback-js/vue';

/**
 * Three subscriptions, chosen to show the three things the package does that an
 * application otherwise forgets:
 *
 *   - the grid and the panel are on DIFFERENT channels and receive the same event —
 *     `events` shows it once, because of deduplication on `envelope.id`
 *   - `runId` is a ref, so editing it swaps the channel instead of leaving one open
 *   - `stream:` has no history, so `resyncs` ticks on every (re)subscribe
 */

const runId = ref('42');
const events = ref<string[]>([]);
const lines = ref<string[]>([]);
const resyncs = ref<string[]>([]);

// The grid: every instance of the resource kind.
useTalkbackTopic('revenexx.integrations.run', {
  handler: e => events.value.unshift(`[topic] ${e.topic} ${e.topic_id ?? ''} ${e.id}`),
});

// The detail panel: one run, every action on it.
const panel = useTalkbackResource('revenexx.integrations.run', runId, {
  handler: e => events.value.unshift(`[resource] ${e.topic} ${e.id}`),
  onResync: ctx => resyncs.value.unshift(`${ctx.channel}: ${ctx.reason}`),
});

// A stream: raw payloads, no envelopes — this is what `POST /v1/publish` sends.
const stream = useTalkbackStream('demo', {
  raw: data => lines.value.unshift(JSON.stringify(data)),
  onResync: ctx => resyncs.value.unshift(`${ctx.channel}: ${ctx.reason}`),
});
</script>

<template>
  <section>
    <p>
      <label>run id: <input v-model="runId" /></label>
      — subscribed to <code>{{ panel.channel.value }}</code>
    </p>
    <p>stream: <code>{{ stream.channel.value }}</code></p>

    <h2>Events ({{ events.length }})</h2>
    <p v-if="!events.length"><em>nothing yet — publish a bus event, or see the README</em></p>
    <ul><li v-for="(e, i) in events" :key="i"><code>{{ e }}</code></li></ul>

    <h2>Stream lines ({{ lines.length }})</h2>
    <ul><li v-for="(l, i) in lines" :key="i"><code>{{ l }}</code></li></ul>

    <h2>Resyncs — refetch over HTTP here</h2>
    <ul><li v-for="(r, i) in resyncs" :key="i"><code>{{ r }}</code></li></ul>
  </section>
</template>
