import { describe, expect, it } from 'vitest';
import { effectScope, ref } from 'vue';
import { createTalkback } from '../core/talkback.js';
import type { Talkback } from '../core/talkback.js';
import { createFakeClient, envelope } from '../testing/fake-transport.js';
import type { FakeTalkbackClient } from '../testing/fake-transport.js';
import { useTalkbackResource, useTalkbackTopic } from './composables.js';

/**
 * `provide`/`inject` need a component instance, which these tests do not have. The
 * composables are exercised inside an `effectScope` with the client injected through the
 * same mechanism a Nuxt plugin would use — `onScopeDispose` is what a route change
 * actually triggers, and it is what these tests assert.
 */
function harness() {
  let fake!: FakeTalkbackClient;
  const tb: Talkback = createTalkback({
    host: 'https://rt.example',
    tenant: () => 'acme-eu',
    userId: () => 'u1',
    tokenEndpoint: '/bff/talkback-token',
    subscriptionTokenEndpoint: '/bff/talkback-subscription-token',
    fetch: (async () =>
      new Response(JSON.stringify({ token: 'fake' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof globalThis.fetch,
    client: () => {
      fake = createFakeClient();
      return fake;
    },
  });

  return { tb, fake: () => fake };
}

/**
 * Runs `fn` inside an effect scope.
 *
 * The client is passed to each composable rather than provided: `provide`/`inject` needs
 * a component INSTANCE, and a bare effectScope has none — provide() there is a silent
 * no-op. Mounting a component to test a subscription lifecycle would need a DOM, and a
 * lifecycle test that needs a DOM is one people stop writing. `onScopeDispose` is what a
 * route change actually triggers, and it works in a plain scope.
 */
function inScope<T>(fn: () => T): { scope: ReturnType<typeof effectScope>; value: T } {
  const scope = effectScope();
  const value = scope.run(fn) as T;
  return { scope, value };
}

describe('a route change swaps the channel instead of leaking one', () => {
  /**
   * The DoD for T8.5, and the reason `onScopeDispose` is not optional: the four call
   * sites being replaced clean up by hand today, and a leaked subscription costs a
   * subscription token and keeps delivering events into a component that is gone.
   */
  it('leaves no open subscription after the scope is disposed', () => {
    const { tb, fake } = harness();

    const { scope } = inScope(() => useTalkbackTopic('revenexx.integrations.run', { talkback: tb, on: 'finished', handler: () => {} }));
    expect(tb.channels).toEqual(['tenant:acme-eu.revenexx.integrations.run']);

    scope.stop();
    expect(tb.channels).toEqual([]);
    expect(fake().subscribed_).toEqual([]);
  });

  it('follows a ref-able id and releases the previous channel', async () => {
    const { tb } = harness();
    const runId = ref('42');

    const { scope } = inScope(() => useTalkbackResource('revenexx.integrations.run', runId, { talkback: tb, handler: () => {} }));
    expect(tb.channels).toEqual(['tenant:acme-eu.revenexx.integrations.run.42']);

    runId.value = '43';
    await Promise.resolve();

    // Exactly one channel, and it is the new one. This is what replaces the hand-written
    // `watch(() => props.run.id, …)` plus `onUnmounted` in RunDetailPanel.vue.
    expect(tb.channels).toEqual(['tenant:acme-eu.revenexx.integrations.run.43']);

    scope.stop();
    expect(tb.channels).toEqual([]);
  });

  it('subscribes to nothing while the id is still empty', () => {
    const { tb } = harness();
    const runId = ref<string | null>(null);

    const { scope } = inScope(() => useTalkbackResource('revenexx.integrations.run', runId, { talkback: tb, handler: () => {} }));
    expect(tb.channels).toEqual([]);

    scope.stop();
  });
});

describe('the DoD example: run.created → started → finished, with a duplicate and a resync', () => {
  /**
   * Deliberately written the way a consumer would write it — a grid on the action
   * channel and an open detail panel on the resource channel at the same time, which is
   * precisely when the duplicate arrives.
   */
  it('drives a run through a resource composable', async () => {
    const { tb, fake } = harness();
    const seen: string[] = [];
    const resyncs: string[] = [];
    const runId = ref('42');

    const { scope } = inScope(() => {
      // The grid.
      useTalkbackTopic('revenexx.integrations.run', {
        talkback: tb,
        handler: e => seen.push(`grid:${e.topic}`),
      });
      // The open detail panel, on the same run.
      return useTalkbackResource('revenexx.integrations.run', runId, {
        talkback: tb,
        handler: e => seen.push(`panel:${e.topic}`),
        onResync: ctx => resyncs.push(ctx.reason),
      });
    });

    const created = envelope({ topic: 'revenexx.integrations.run.created', topicId: '42' });
    const started = envelope({ topic: 'revenexx.integrations.run.started', topicId: '42' });
    const finished = envelope({ topic: 'revenexx.integrations.run.finished', topicId: '42' });

    for (const e of [created, started, finished]) {
      fake().emit('tenant:acme-eu.revenexx.integrations.run', e);
    }
    // The duplicate: the same finished event on the resource channel. It is contractual
    // (ADR-0094) and must surface exactly once.
    fake().emit('tenant:acme-eu.revenexx.integrations.run.42', finished);

    expect(seen).toEqual(['grid:revenexx.integrations.run.created', 'grid:revenexx.integrations.run.started', 'grid:revenexx.integrations.run.finished']);

    // The resync: a reconnect whose gap was larger than the buffer. This is where a
    // consumer refetches over HTTP.
    fake().subscribed('tenant:acme-eu.revenexx.integrations.run.42', {
      wasRecovering: true,
      recovered: false,
    });
    expect(resyncs).toEqual(['history-overflow']);

    scope.stop();
    expect(tb.channels).toEqual([]);
  });
});

describe('enabled', () => {
  it('does not subscribe while false, and subscribes when it flips', async () => {
    const { tb } = harness();
    const enabled = ref(false);

    const { scope } = inScope(() => useTalkbackTopic('revenexx.integrations.run', { talkback: tb, enabled, handler: () => {} }));
    expect(tb.channels).toEqual([]);

    enabled.value = true;
    await Promise.resolve();
    expect(tb.channels).toEqual(['tenant:acme-eu.revenexx.integrations.run']);

    scope.stop();
  });
});
