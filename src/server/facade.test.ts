import { describe, expect, it } from 'vitest';
import { createFacadeClient } from './facade.js';
import { TalkbackForbiddenError, TalkbackRateLimitedError, TalkbackUnauthenticatedError, TalkbackUnavailableError, TalkbackUnknownTenantError } from './errors.js';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * A fetch that records what it was asked to do and replies with a queue of canned
 * responses. Deliberately not a mocking library: what these tests assert is the exact
 * wire shape, so seeing the request object is the point.
 */
function harness(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: RecordedCall[] = [];
  const slept: number[] = [];
  const queue = [...responses];

  const client = createFacadeClient({
    baseUrl: 'https://talkback.example/',
    tenant: 'acme-eu',
    tokens: { token: async () => 'test-access-token', invalidate: () => {} },
    sleep: async ms => {
      slept.push(ms);
    },
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        headers: init.headers as Record<string, string>,
        body: init.body === undefined ? undefined : JSON.parse(init.body as string),
      });
      const next = queue.shift() ?? { status: 200, body: {} };
      return new Response(JSON.stringify(next.body ?? {}), {
        status: next.status,
        headers: { 'content-type': 'application/json', ...next.headers },
      });
    }) as unknown as typeof globalThis.fetch,
  });

  return { client, calls, slept };
}

describe('every request carries the tenant header the org gets wrong', () => {
  it('sends X-Revenexx-Tenant, not X-Tenant-Id', async () => {
    const { client, calls } = harness([{ status: 200, body: { token: 't', expires_at: 1, channels: [] } }]);
    await client.mintToken({ userId: 'u1' });

    expect(calls[0]?.headers['X-Revenexx-Tenant']).toBe('acme-eu');
    expect(calls[0]?.headers['X-Tenant-Id']).toBeUndefined();
    expect(calls[0]?.headers['Authorization']).toBe('Bearer test-access-token');
  });

  it('passes X-Request-ID and Idempotency-Key through', async () => {
    const { client, calls } = harness([{ status: 200, body: { channel: 'stream:acme-eu.s1' } }]);
    await client.publish({
      channel: 'stream:acme-eu.s1',
      data: { line: 'hello' },
      idempotencyKey: 'run-42-seq-1',
      requestId: 'req-abc',
    });

    expect(calls[0]?.headers['X-Request-ID']).toBe('req-abc');
    expect(calls[0]?.headers['Idempotency-Key']).toBe('run-42-seq-1');
  });
});

describe('the channel is a query parameter, never a path segment', () => {
  /**
   * The failure being prevented: a channel name is a valid URI scheme prefix, so
   * `new URL('tenant:acme-eu.x.y.z', base)` parses `tenant:` as the protocol and the
   * request goes somewhere else entirely. internal/facade/read.go names this client in
   * the comment that explains why the route is shaped this way.
   */
  it('keeps a channel-shaped name out of the path', async () => {
    const { client, calls } = harness([
      { status: 200, body: { channel: 'x', presence: {} } },
      { status: 200, body: { channel: 'x', num_clients: 0, num_users: 0 } },
      { status: 200, body: { channel: 'x', publications: [], offset: 0, epoch: 'e1' } },
    ]);

    await client.presence('presence:acme-eu.revenexx.integrations.run');
    await client.presenceStats('presence:acme-eu.revenexx.integrations.run');
    await client.history({ channel: 'tenant:acme-eu.revenexx.integrations.run' });

    for (const call of calls) {
      const url = new URL(call.url);
      expect(url.protocol).toBe('https:');
      expect(url.pathname).not.toContain('acme-eu');
      expect(url.searchParams.get('channel')).toMatch(/^(presence|tenant):acme-eu\./);
    }
  });
});

describe('history parameters', () => {
  it('rejects limit=-1 rather than clamping it', async () => {
    const { client, calls } = harness([]);
    await expect(client.history({ channel: 'tenant:acme-eu.revenexx.integrations.run', limit: -1 })).rejects.toThrowError(/no limit/);

    // Nothing left the process: the point of checking locally is that -1 never becomes
    // a request at all.
    expect(calls).toHaveLength(0);
  });

  it('insists on since_offset and since_epoch together', async () => {
    const { client, calls } = harness([]);
    await expect(client.history({ channel: 'tenant:acme-eu.revenexx.integrations.run', sinceOffset: 12 })).rejects.toThrowError(/silently skips publications/);
    expect(calls).toHaveLength(0);
  });

  it('sends the pair as two query parameters when both are given', async () => {
    const { client, calls } = harness([{ status: 200, body: { channel: 'x', publications: [], offset: 12, epoch: 'e1' } }]);
    await client.history({
      channel: 'tenant:acme-eu.revenexx.integrations.run',
      sinceOffset: 12,
      sinceEpoch: 'e1',
      limit: 50,
    });

    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.get('since_offset')).toBe('12');
    expect(url.searchParams.get('since_epoch')).toBe('e1');
    expect(url.searchParams.get('limit')).toBe('50');
  });
});

describe('429 is waited out, not hot-retried', () => {
  it('sleeps for exactly what Retry-After said, then retries once', async () => {
    const { client, calls, slept } = harness([
      { status: 429, body: { error: true, message: 'rate limited' }, headers: { 'retry-after': '3' } },
      { status: 200, body: { token: 't', expires_at: 1, channels: [] } },
    ]);

    const got = await client.mintToken({ userId: 'u1' });

    expect(got.token).toBe('t');
    expect(slept).toEqual([3_000]);
    expect(calls).toHaveLength(2);
  });

  it('surfaces the error instead of looping when the wait exceeds the budget', async () => {
    const { client, slept } = harness([
      {
        status: 429,
        body: { error: true, message: 'rate limited' },
        headers: { 'retry-after': '30' },
      },
    ]);

    const err = await client.mintToken({ userId: 'u1' }).catch(e => e);
    expect(err).toBeInstanceOf(TalkbackRateLimitedError);
    expect((err as TalkbackRateLimitedError).retryAfterMs).toBe(30_000);
    expect(slept).toEqual([]);
  });
});

describe('the status becomes a typed error, because the envelope has no code', () => {
  const cases: Array<[number, unknown]> = [
    [401, TalkbackUnauthenticatedError],
    [403, TalkbackForbiddenError],
    [404, TalkbackUnknownTenantError],
    [502, TalkbackUnavailableError],
    [503, TalkbackUnavailableError],
  ];

  for (const [status, type] of cases) {
    it(`maps ${status}`, async () => {
      const { client } = harness([{ status, body: { error: true, message: 'nope' } }]);
      const err = await client.presence('presence:acme-eu.revenexx.integrations.run').catch(e => e);
      expect(err).toBeInstanceOf(type as never);
    });
  }

  /**
   * The distinction that sends a team to the wrong system. 404 is "Console does not know
   * this tenant" — the credential is fine and the slug is not. Read as an authorisation
   * failure it starts a hunt through Zitadel.
   */
  it('a 404 names the tenant rather than blaming the credential', async () => {
    const { client } = harness([{ status: 404, body: { error: true, message: 'unknown tenant' } }]);
    const err = (await client.mintToken({ userId: 'u1' }).catch(e => e)) as TalkbackUnknownTenantError;

    expect(err).toBeInstanceOf(TalkbackUnknownTenantError);
    expect(err.tenant).toBe('acme-eu');
  });

  it('a 403 on a channel carries the channel', async () => {
    const { client } = harness([{ status: 403, body: { error: true, message: 'forbidden' } }]);
    const err = (await client.mintSubscriptionToken({ userId: 'u1', channel: 'user:other-tenant.u2' }).catch(e => e)) as TalkbackForbiddenError;

    expect(err.channel).toBe('user:other-tenant.u2');
  });
});

describe('the override wrapper', () => {
  it('sends the {value} form Centrifugo actually reads', async () => {
    const { client, calls } = harness([{ status: 200, body: { token: 't', expires_at: 1, channel: 'c' } }]);
    await client.mintSubscriptionToken({
      userId: 'u1',
      channel: 'tenant:acme-eu.revenexx.integrations.run.42',
      override: { presence: { value: true } },
    });

    expect((calls[0]?.body as { override: unknown }).override).toEqual({
      presence: { value: true },
    });
  });
});
