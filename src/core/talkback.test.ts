import { describe, expect, it, vi } from 'vitest';
import { createFakeClient, envelope } from '../testing/fake-transport.js';
import type { FakeTalkbackClient } from '../testing/fake-transport.js';
import { createTalkback, defaultEndpoints } from './talkback.js';
import type { Envelope } from './envelope.js';

function build(overrides: { tenant?: () => string; channels?: string[] } = {}) {
  let fake!: FakeTalkbackClient;

  const tb = createTalkback({
    host: 'https://rt.example',
    tenant: overrides.tenant ?? (() => 'acme-eu'),
    userId: () => 'u1',
    tokenEndpoint: '/bff/talkback-token',
    subscriptionTokenEndpoint: '/bff/talkback-subscription-token',
    ...(overrides.channels ? { channels: overrides.channels } : {}),
    fetch: (async () =>
      new Response(JSON.stringify({ token: 'fake', expires_at: 0, channels: [] }), {
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

describe('the transport chain is the default, not an opt-in', () => {
  /**
   * T0.2 — whether BunkerWeb and Traefik pass a WebSocket upgrade — is still open, and
   * ADR-0093 §8 names SSE and HTTP streaming as the mitigation for an edge that will
   * not. Both are already enabled server-side. A client that had to opt in would mean
   * four applications each discovering that the hard way.
   */
  it('expands a host into websocket, http_stream and sse', () => {
    expect(defaultEndpoints('https://rt.example/')).toEqual([
      { transport: 'websocket', endpoint: 'wss://rt.example/connection/websocket' },
      { transport: 'http_stream', endpoint: 'https://rt.example/connection/http_stream' },
      { transport: 'sse', endpoint: 'https://rt.example/connection/sse' },
    ]);
  });

  it('keeps ws for a plain-http dev host', () => {
    expect(defaultEndpoints('http://localhost:8000')[0]).toEqual({
      transport: 'websocket',
      endpoint: 'ws://localhost:8000/connection/websocket',
    });
  });
});

describe('the tenant is never an argument', () => {
  it('builds every shape from the provider', () => {
    const { tb } = build();
    expect(tb.topic('revenexx.integrations.run.started').channel).toBe('tenant:acme-eu.revenexx.integrations.run.started');
    expect(tb.resource('revenexx.integrations.run.started', '42').channel).toBe('tenant:acme-eu.revenexx.integrations.run.42');
    expect(tb.user().channel).toBe('user:acme-eu.u1');
    expect(tb.stream('build-1').channel).toBe('stream:acme-eu.build-1');
    expect(tb.presence('revenexx', 'integrations', 'run', '42').channel).toBe('presence:acme-eu.revenexx.integrations.run.42');
  });

  it('follows the provider when the active tenant changes', () => {
    let tenant = 'acme-eu';
    const { tb } = build({ tenant: () => tenant });
    expect(tb.user().channel).toBe('user:acme-eu.u1');

    tenant = 'globex-us';
    expect(tb.user().channel).toBe('user:globex-us.u1');
  });

  it('the raw escape hatch is still tenant-checked', () => {
    const { tb } = build();
    expect(() => tb.channel('user:other-tenant.u2')).toThrowError(/does not belong to the tenant/);
  });
});

describe('deduplication on envelope.id', () => {
  /**
   * The contractual case (ADR-0094): a grid on the action channel and an open detail
   * panel on the resource channel BOTH receive the same event, one publish each. §9's
   * "apply idempotently and reconcile on id" is a duty, and doing it once here beats
   * four consumers each discovering it from a duplicated row.
   */
  it('the same event on both channels surfaces once', () => {
    const { tb, fake } = build();
    const seen: Envelope[] = [];

    tb.topic('revenexx.integrations.run.finished').listen('finished', e => seen.push(e));
    tb.resource('revenexx.integrations.run.finished', '42').listen('finished', e => seen.push(e));

    const e = envelope({ topic: 'revenexx.integrations.run.finished', topicId: '42' });
    fake().emit('tenant:acme-eu.revenexx.integrations.run.finished', e);
    fake().emit('tenant:acme-eu.revenexx.integrations.run.42', e);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.id).toBe(e.id);
  });

  it('two distinct events both arrive', () => {
    const { tb, fake } = build();
    const seen: string[] = [];
    tb.topic('revenexx.integrations.run.finished').listen('finished', e => seen.push(e.id));

    fake().emit('tenant:acme-eu.revenexx.integrations.run.finished', envelope({ topic: 'revenexx.integrations.run.finished', id: 'evt_1' }));
    fake().emit('tenant:acme-eu.revenexx.integrations.run.finished', envelope({ topic: 'revenexx.integrations.run.finished', id: 'evt_2' }));

    expect(seen).toEqual(['evt_1', 'evt_2']);
  });
});

describe('listen filters on the topic, not on the channel name', () => {
  /**
   * On a RESOURCE channel the fifth segment is the id and the action is not in the name
   * at all. A listener filtering on the channel would receive every action while looking
   * like it had filtered — the bug this test exists for.
   */
  it('a resource channel still separates actions', () => {
    const { tb, fake } = build();
    const finished: string[] = [];
    const started: string[] = [];

    const handle = tb.resource('revenexx.integrations.run.started', '42');
    handle.listen('finished', e => finished.push(e.id));
    handle.listen('started', e => started.push(e.id));

    fake().emit('tenant:acme-eu.revenexx.integrations.run.42', envelope({ topic: 'revenexx.integrations.run.started', id: 'evt_a', topicId: '42' }));
    fake().emit('tenant:acme-eu.revenexx.integrations.run.42', envelope({ topic: 'revenexx.integrations.run.finished', id: 'evt_b', topicId: '42' }));

    expect(started).toEqual(['evt_a']);
    expect(finished).toEqual(['evt_b']);
  });

  it('listenAll receives non-envelope payloads, which stream: is full of', () => {
    const { tb, fake } = build();
    const lines: unknown[] = [];
    tb.stream('build-1').listenAll(data => lines.push(data));

    fake().emit('stream:acme-eu.build-1', { seq: 1, line: 'api.md' });
    fake().emit('stream:acme-eu.build-1', { seq: 2, line: 'architecture.md' });

    expect(lines).toEqual([
      { seq: 1, line: 'api.md' },
      { seq: 2, line: 'architecture.md' },
    ]);
  });
});

describe('reference counting per channel name', () => {
  /**
   * Two components on the same run — the grid row and the open detail panel — must cost
   * ONE subscription and therefore one subscription token. Without this every opened
   * detail view is another mint.
   */
  it('two handles on one channel subscribe once', async () => {
    const { tb, fake } = build();
    const a = tb.resource('revenexx.integrations.run.started', '42');
    const b = tb.resource('revenexx.integrations.run.started', '42');

    expect(fake().subscribeCounts.get('tenant:acme-eu.revenexx.integrations.run.42')).toBe(1);

    // The first leave must not tear down the channel the second handle is still using.
    a.leave();
    expect(tb.channels).toContain('tenant:acme-eu.revenexx.integrations.run.42');

    b.leave();
    expect(tb.channels).not.toContain('tenant:acme-eu.revenexx.integrations.run.42');

    expect(fake().tokenRequests).toEqual(['tenant:acme-eu.revenexx.integrations.run.42']);
  });

  it('leave is idempotent', () => {
    const { tb } = build();
    const a = tb.user();
    const b = tb.user();

    a.leave();
    a.leave(); // a double unmount must not release b's reference
    expect(tb.channels).toContain('user:acme-eu.u1');

    b.leave();
    expect(tb.channels).toEqual([]);
  });
});

describe('onResync is the refetch signal', () => {
  it('fires when the gap was larger than the buffer', () => {
    const { tb, fake } = build();
    const reasons: string[] = [];
    tb.topic('revenexx.integrations.run.started').onResync(ctx => reasons.push(ctx.reason));

    fake().subscribed('tenant:acme-eu.revenexx.integrations.run.started', {
      wasRecovering: true,
      recovered: false,
    });
    expect(reasons).toEqual(['history-overflow']);
  });

  it('stays quiet when recovery closed the gap', () => {
    const { tb, fake } = build();
    const reasons: string[] = [];
    tb.topic('revenexx.integrations.run.started').onResync(ctx => reasons.push(ctx.reason));

    fake().subscribed('tenant:acme-eu.revenexx.integrations.run.started', {
      wasRecovering: true,
      recovered: true,
    });
    expect(reasons).toEqual([]);
  });

  /**
   * `stream:` has no history at all, so a reconnect mid-run always lost whatever arrived
   * while away — and unlike `tenant:` there is no HTTP endpoint to read it back from.
   * Every subscribe there is a resync.
   */
  it('fires on every subscribe for a stream handle', () => {
    const { tb, fake } = build();
    const reasons: string[] = [];
    tb.stream('build-1').onResync(ctx => reasons.push(ctx.reason));

    fake().subscribed('stream:acme-eu.build-1');
    fake().subscribed('stream:acme-eu.build-1');
    expect(reasons).toEqual(['no-history', 'no-history']);
  });
});

describe('the connection token', () => {
  it('rejects more start channels than a token may carry', () => {
    expect(() => build({ channels: Array.from({ length: 33 }, (_, i) => `user:acme-eu.u${i}`) })).toThrowError(/subscription tokens/);
  });

  /**
   * A channel in the `subs` claim is a SERVER-SIDE subscription: Centrifuge reports its
   * publications on the client, not on a Subscription object. A handle on one must not
   * create a second, client-side subscription — that would mint a subscription token for
   * a channel the connection token already covers.
   */
  it('a start channel needs no subscription of its own', () => {
    const { tb, fake } = build({ channels: ['user:acme-eu.u1'] });
    const seen: string[] = [];
    tb.user().listen('created', e => seen.push(e.id));

    expect(fake().subscribeCounts.get('user:acme-eu.u1')).toBeUndefined();

    fake().emit('user:acme-eu.u1', envelope({ topic: 'revenexx.console.notification.created', id: 'evt_n1' }));
    expect(seen).toEqual(['evt_n1']);
  });
});

describe('stopListening', () => {
  it('drops one listener and then the whole action', () => {
    const { tb, fake } = build();
    const a: string[] = [];
    const b: string[] = [];
    const listenerA = (e: Envelope) => a.push(e.id);
    const listenerB = (e: Envelope) => b.push(e.id);

    const handle = tb.topic('revenexx.integrations.run.started');
    handle.listen('started', listenerA).listen('started', listenerB);

    handle.stopListening('started', listenerA);
    fake().emit('tenant:acme-eu.revenexx.integrations.run.started', envelope({ topic: 'revenexx.integrations.run.started', id: 'evt_1' }));
    expect(a).toEqual([]);
    expect(b).toEqual(['evt_1']);

    handle.stopListening('started');
    fake().emit('tenant:acme-eu.revenexx.integrations.run.started', envelope({ topic: 'revenexx.integrations.run.started', id: 'evt_2' }));
    expect(b).toEqual(['evt_1']);
  });
});

/**
 * Direct mode: the browser mints its own connection token at the facade instead of
 * asking a BFF for one.
 *
 * It became possible when the facade started admitting an END USER at its mint
 * endpoints — a role in the Zitadel user project, rather than the `talkback:write` a
 * BFF's service identity holds. The end user may mint only for itself, which is what
 * makes it safe and also why the request body stays exactly as it is: no `user_id`, so
 * the facade fills it from the token's own `sub`.
 */
describe('direct mode', () => {
  function build(opts: { accessToken?: () => string } = {}) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let connectionToken!: () => Promise<string>;
    let fake!: FakeTalkbackClient;

    const tb = createTalkback({
      host: 'https://rt.example',
      tenant: () => 'revenexx',
      userId: () => '364499920398320387',
      tokenEndpoint: opts.accessToken ? 'https://rt.example/v1/tokens' : '/bff/talkback-token',
      subscriptionTokenEndpoint: opts.accessToken ? 'https://rt.example/v1/subscription-tokens' : '/bff/talkback-subscription-token',
      ...(opts.accessToken ? { accessToken: opts.accessToken } : {}),
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ token: 'minted', expires_at: 0, channels: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof globalThis.fetch,
      client: (_endpoints, o) => {
        connectionToken = o.getToken;
        fake = createFakeClient();
        return fake;
      },
    });

    /**
     * A CHECKED accessor. tsconfig has noUncheckedIndexedAccess, and `calls[0]!` in
     * every assertion would be a non-null assertion repeated fifteen times — this fails
     * with the index it wanted instead, which is also a better message when a mint stops
     * happening at all.
     */
    const callAt = (i: number) => {
      const c = calls[i];
      if (!c) throw new Error(`expected a fetch call at index ${i}, saw ${calls.length}`);
      return c;
    };
    const callTo = (path: string) => {
      const c = calls.find(x => x.url.includes(path));
      if (!c) throw new Error(`no fetch call to ${path}`);
      return c;
    };

    return { tb, calls, callAt, callTo, connectionToken: () => connectionToken(), fake: () => fake };
  }

  const headersOf = (init: RequestInit) => new Headers(init.headers as HeadersInit);

  it('sends the access token as a bearer', async () => {
    const { callAt, connectionToken } = build({ accessToken: () => 'jwt-abc' });

    await connectionToken();

    expect(callAt(0).url).toBe('https://rt.example/v1/tokens');
    expect(headersOf(callAt(0).init).get('authorization')).toBe('Bearer jwt-abc');
  });

  /**
   * The facade answers `Access-Control-Allow-Origin: *` and deliberately never sends
   * `Access-Control-Allow-Credentials`, because storefronts run on per-tenant custom
   * domains that cannot be enumerated. A browser REFUSES that combination with
   * credentials mode on, so leaving `include` here would block the response even though
   * the facade answered 200 — the least diagnosable failure available.
   */
  it('does not ask the browser to attach credentials', async () => {
    const { callAt, connectionToken } = build({ accessToken: () => 'jwt-abc' });

    await connectionToken();

    expect(callAt(0).init.credentials).toBe('omit');
  });

  /**
   * A BFF token route reads the tenant from the session; the facade reads it from the
   * header, and answers 400 when a token authorises several tenants and none is named.
   */
  it('names the tenant, which the BFF used to do', async () => {
    const { callAt, connectionToken } = build({ accessToken: () => 'jwt-abc' });

    await connectionToken();

    expect(headersOf(callAt(0).init).get('x-revenexx-tenant')).toBe('revenexx');
  });

  it('re-reads the provider on every mint, so a refreshed session is picked up', async () => {
    let token = 'jwt-1';
    const { callAt, connectionToken } = build({ accessToken: () => token });

    await connectionToken();
    token = 'jwt-2';
    await connectionToken();

    expect(headersOf(callAt(0).init).get('authorization')).toBe('Bearer jwt-1');
    expect(headersOf(callAt(1).init).get('authorization')).toBe('Bearer jwt-2');
  });

  it('applies to subscription tokens too', async () => {
    const { tb, calls, callTo } = build({ accessToken: () => 'jwt-abc' });

    tb.stream('build-1').listen('line', () => {});
    await vi.waitFor(() => expect(calls.some(c => c.url.includes('/v1/subscription-tokens'))).toBe(true));

    const sub = callTo('/v1/subscription-tokens');
    expect(headersOf(sub.init).get('authorization')).toBe('Bearer jwt-abc');
    expect(headersOf(sub.init).get('x-revenexx-tenant')).toBe('revenexx');
    expect(sub.init.credentials).toBe('omit');
  });

  /** The BFF path is untouched: a cookie session, and no bearer to send. */
  it('leaves the BFF path on cookies with no bearer', async () => {
    const { callAt, connectionToken } = build();

    await connectionToken();

    expect(callAt(0).url).toBe('/bff/talkback-token');
    expect(callAt(0).init.credentials).toBe('include');
    expect(headersOf(callAt(0).init).get('authorization')).toBeNull();
    expect(headersOf(callAt(0).init).get('x-revenexx-tenant')).toBeNull();
  });
});
