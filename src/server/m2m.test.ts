import { describe, expect, it } from 'vitest';
import { createTokenSource } from './m2m.js';

function source(opts: { expiresIn?: number } = {}) {
  let calls = 0;
  let now = 1_000_000;

  const tokens = createTokenSource({
    issuer: 'https://auth.example',
    clientId: 'talkback-bff',
    clientSecret: 'dev-not-a-real-secret',
    now: () => now,
    fetch: (async () => {
      calls += 1;
      return new Response(JSON.stringify({ access_token: `token-${calls}`, expires_in: opts.expiresIn ?? 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch,
  });

  return {
    tokens,
    calls: () => calls,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('the m2m token is cached', () => {
  it('five calls cost one request', async () => {
    const s = source();
    const got = await Promise.all([s.tokens.token(), s.tokens.token(), s.tokens.token(), s.tokens.token(), s.tokens.token()]);

    expect(new Set(got).size).toBe(1);
    expect(s.calls()).toBe(1);
  });

  /**
   * Concurrent misses collapse onto one request. Without this a BFF handling a reconnect
   * storm opens one token request per in-flight mint — the stampede internal/tenants
   * solves with singleflight, one level further out.
   */
  it('a cold start under concurrency is still one request', async () => {
    const s = source();
    await Promise.all(Array.from({ length: 20 }, () => s.tokens.token()));
    expect(s.calls()).toBe(1);
  });

  /**
   * Refreshed BEFORE expiry, not after a 401. Without the margin every expiry costs one
   * request that fails on the way to being retried, and that failure lands in the
   * facade's audit trail as a 401 — the same place a genuinely broken credential shows
   * up, so the signal stops being useful.
   */
  it('refreshes inside the last minute rather than at expiry', async () => {
    const s = source({ expiresIn: 120 });
    await s.tokens.token();
    expect(s.calls()).toBe(1);

    s.advance(59_000); // 61s of life left — still outside the margin
    await s.tokens.token();
    expect(s.calls()).toBe(1);

    s.advance(2_000); // 59s left — inside the margin
    await s.tokens.token();
    expect(s.calls()).toBe(2);
  });

  it('invalidate forces the next call to fetch', async () => {
    const s = source();
    await s.tokens.token();
    s.tokens.invalidate();
    await s.tokens.token();
    expect(s.calls()).toBe(2);
  });
});

describe('a failure is loud', () => {
  it('names the status rather than returning an empty token', async () => {
    const tokens = createTokenSource({
      issuer: 'https://auth.example',
      clientId: 'talkback-bff',
      clientSecret: 'dev-not-a-real-secret',
      fetch: (async () => new Response('nope', { status: 401 })) as unknown as typeof globalThis.fetch,
    });

    await expect(tokens.token()).rejects.toThrowError(/talkback m2m auth failed \(401\)/);
  });
});
