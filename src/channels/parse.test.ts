import { describe, expect, it } from 'vitest';
import { channelVectors } from '../testing/vectors.js';
import { isChannelError } from './errors.js';
import { parseAllWithin, parseWithin, presenceFor } from './parse.js';

/**
 * Every one of these suites is driven by the SAME vector table Go uses — the fixture
 * is generated from `internal/channels/channels_test.go` and pinned by
 * `TestVectorFixtureIsCurrent`. A case added on the Go side arrives here on the next
 * `make vectors`, and until this side handles it these tests fail.
 *
 * The cross-tenant and presence suites are GENERATED from that same list rather than
 * written out, which is the property that matters: a new positive case cannot fall
 * behind its cross-tenant counterpart, because the counterpart does not exist
 * separately. Both carry the `covered` guard their Go counterparts carry — a filter
 * that matched nothing would otherwise be a green test that asserted nothing.
 */

describe('parseWithin, against the shared vector table', () => {
  it('has vectors at all', () => {
    expect(channelVectors.length).toBeGreaterThan(0);
  });

  for (const v of channelVectors) {
    it(`${v.valid ? 'accepts' : 'rejects'}: ${v.name}`, () => {
      if (v.valid) {
        const c = parseWithin(v.tenant, v.channel);
        expect(c.name).toBe(v.channel);
        expect(c.namespace).toBe(v.namespace);
        expect(c.tenant).toBe(v.tenant);
        return;
      }

      let thrown: unknown;
      try {
        parseWithin(v.tenant, v.channel);
      } catch (err) {
        thrown = err;
      }

      // The code is asserted, not merely "it threw". Go distinguishes four sentinels
      // and the facade maps them to different HTTP statuses — a malformed name is a
      // 400 and a cross-tenant one is a 403, so collapsing them here would let the
      // client disagree with the server about what went wrong.
      expect(isChannelError(thrown)).toBe(true);
      if (isChannelError(thrown)) {
        expect(thrown.code).toBe(v.error);
      }
    });
  }
});

describe('parseWithin rejects another tenant', () => {
  // Generated from the positive vectors, exactly like TestParseWithinRejectsOtherTenant.
  const positives = channelVectors.filter(v => v.valid);

  it('covers at least one vector', () => {
    expect(positives.length).toBeGreaterThan(0);
  });

  for (const v of positives) {
    it(`${v.name} is not readable by another tenant`, () => {
      let thrown: unknown;
      try {
        parseWithin('other-tenant', v.channel);
      } catch (err) {
        thrown = err;
      }
      expect(isChannelError(thrown)).toBe(true);
      if (isChannelError(thrown)) {
        expect(thrown.code).toBe('tenant_mismatch');
      }
    });
  }
});

describe('presenceFor round-trips a tenant channel', () => {
  const tenants = channelVectors.filter(v => v.valid && v.namespace === 'tenant');

  it('covers at least one vector', () => {
    expect(tenants.length).toBeGreaterThan(0);
  });

  for (const v of tenants) {
    it(`${v.name} maps onto its presence counterpart`, () => {
      const presence = presenceFor(parseWithin(v.tenant, v.channel));
      expect(presence.name).toBe(`presence:${v.channel.slice('tenant:'.length)}`);
      expect(presence.namespace).toBe('presence');
      expect(presence.tenant).toBe(v.tenant);
    });
  }

  it('is not idempotent — a presence channel in is an error', () => {
    const presence = presenceFor(parseWithin('acme-eu', 'tenant:acme-eu.revenexx.integrations.run'));
    expect(() => presenceFor(presence)).toThrowError(/only defined for the tenant namespace/);
  });
});

describe('parseAllWithin is all-or-nothing', () => {
  it('grants none of them when one is foreign', () => {
    expect(() => parseAllWithin('acme-eu', ['user:acme-eu.u1', 'user:other-tenant.u2'])).toThrowError();
  });

  it('returns every channel when all belong to the tenant', () => {
    const got = parseAllWithin('acme-eu', ['user:acme-eu.u1', 'tenant:acme-eu.revenexx.integrations.run']);
    expect(got.map(c => c.name)).toEqual(['user:acme-eu.u1', 'tenant:acme-eu.revenexx.integrations.run']);
  });
});
