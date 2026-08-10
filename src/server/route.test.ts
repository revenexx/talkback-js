import { describe, expect, it } from 'vitest';
import { createTokenRoute, createSubscriptionTokenRoute, TokenRouteError } from './route.js';
import type { FacadeClient, MintTokenRequest } from './facade.js';

interface FakeRequest {
  session: { tenant: string; userId: string };
}

function fakeFacade(): FacadeClient & { minted: MintTokenRequest[] } {
  const minted: MintTokenRequest[] = [];
  return {
    minted,
    async mintToken(req) {
      minted.push(req);
      return { token: 'minted', expires_at: 0, channels: [...(req.channels ?? [])] };
    },
    async mintSubscriptionToken(req) {
      return { token: 'sub', expires_at: 0, channel: req.channel };
    },
    async publish(req) {
      return { channel: req.channel };
    },
    async presence(channel) {
      return { channel, presence: {} };
    },
    async presenceStats(channel) {
      return { channel, num_clients: 0, num_users: 0 };
    },
    async history(query) {
      return { channel: query.channel, publications: [], offset: 0, epoch: 'e1' };
    },
  };
}

const resolveUser = (req: FakeRequest) => ({
  tenant: req.session.tenant,
  userId: req.session.userId,
});

describe('the tenant comes from the session and nowhere else', () => {
  /**
   * ADR-0057 one level out from the facade: a value the caller supplies cannot authorise
   * the caller. The body here carries a plausible-looking `tenant`, and the minted token
   * must be for the session's tenant regardless.
   */
  it('ignores a tenant sent in the body', async () => {
    const facade = fakeFacade();
    const handle = createTokenRoute<FakeRequest>({
      facade,
      resolveUser,
      authorizeChannels: ({ user }) => [`user:${user.tenant}.${user.userId}`],
    });

    const out = await handle(
      { session: { tenant: 'acme-eu', userId: 'u1' } },
      {
        tenant: 'other-tenant',
        tenant_id: 'other-tenant',
        channels: ['user:other-tenant.u2'],
      },
    );

    expect(out.channels).toEqual(['user:acme-eu.u1']);
    expect(facade.minted[0]?.channels).toEqual(['user:acme-eu.u1']);
  });

  /**
   * `requested` is advisory. A callback that returns it unfiltered is the bug the
   * parameter name tries not to invite — and when it does, the grammar check against the
   * SESSION tenant is what stops it before anything is minted.
   */
  it('a callback that trusts the body still cannot cross a tenant', async () => {
    const facade = fakeFacade();
    const handle = createTokenRoute<FakeRequest>({
      facade,
      resolveUser,
      // Deliberately the wrong implementation.
      authorizeChannels: ({ requested }) => [...requested],
    });

    await expect(
      handle(
        { session: { tenant: 'acme-eu', userId: 'u1' } },
        {
          channels: ['user:other-tenant.u2'],
        },
      ),
    ).rejects.toThrowError(/does not belong to the tenant/);

    expect(facade.minted).toHaveLength(0);
  });
});

describe('the channel budget', () => {
  it('points at the subscription-token path rather than truncating', async () => {
    const facade = fakeFacade();
    const handle = createTokenRoute<FakeRequest>({
      facade,
      resolveUser,
      authorizeChannels: ({ user }) => Array.from({ length: 5 }, (_, i) => `user:${user.tenant}.u${i}`),
      maxChannels: 3,
    });

    const err = await handle({ session: { tenant: 'acme-eu', userId: 'u1' } }, {}).catch(e => e);
    expect(err).toBeInstanceOf(TokenRouteError);
    expect((err as TokenRouteError).status).toBe(400);
    expect((err as Error).message).toMatch(/subscription tokens/);
    expect(facade.minted).toHaveLength(0);
  });
});

describe('the subscription-token route', () => {
  it('answers 403 when the callback declines', async () => {
    const handle = createSubscriptionTokenRoute<FakeRequest>({
      facade: fakeFacade(),
      resolveUser,
      authorizeChannel: () => false,
    });

    const err = await handle(
      { session: { tenant: 'acme-eu', userId: 'u1' } },
      {
        channel: 'tenant:acme-eu.revenexx.integrations.run.42',
      },
    ).catch(e => e);

    expect((err as TokenRouteError).status).toBe(403);
  });

  it('mints for an authorised channel', async () => {
    const handle = createSubscriptionTokenRoute<FakeRequest>({
      facade: fakeFacade(),
      resolveUser,
      authorizeChannel: () => true,
    });

    const out = await handle(
      { session: { tenant: 'acme-eu', userId: 'u1' } },
      {
        channel: 'tenant:acme-eu.revenexx.integrations.run.42',
      },
    );
    expect(out.channel).toBe('tenant:acme-eu.revenexx.integrations.run.42');
  });
});

/**
 * The DoD for T8.3 is that a route without `authorizeChannels` is a TYPE error rather
 * than a runtime one. It cannot be asserted at run time by definition — the check below
 * is the compile-time one, kept as code so `tsc --noEmit` carries it, with the negative
 * case written out in a comment because making it compile-fail on purpose would fail the
 * whole suite.
 */
describe('authorizeChannels is required', () => {
  it('compiles with the callback', () => {
    const handle = createTokenRoute<FakeRequest>({
      facade: fakeFacade(),
      resolveUser,
      authorizeChannels: () => [],
    });
    expect(typeof handle).toBe('function');

    // @ts-expect-error — omitting authorizeChannels must not type-check. If this line
    // ever stops erroring, the callback has acquired a default and the one question this
    // package cannot answer has been answered for the caller.
    createTokenRoute<FakeRequest>({ facade: fakeFacade(), resolveUser });
  });
});
