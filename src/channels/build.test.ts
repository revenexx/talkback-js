import { describe, expect, it } from 'vitest';
import { checkId, siteChannel, siteResourceChannel, streamChannel, tenantActionChannel, tenantChannel, tenantResourceChannel, userChannel } from './build.js';
import { isChannelError } from './errors.js';

describe('the builders assemble what the grammar accepts', () => {
  it('builds each shape', () => {
    expect(userChannel('acme-eu', 'u1').name).toBe('user:acme-eu.u1');
    expect(streamChannel('acme-eu', 'build-1786002458').name).toBe('stream:acme-eu.build-1786002458');
    expect(tenantChannel('acme-eu', 'revenexx', 'integrations', 'run').name).toBe('tenant:acme-eu.revenexx.integrations.run');
    expect(siteChannel('acme-eu', 'flagship-store', 'cart').name).toBe('site:acme-eu.flagship-store.cart');
    expect(siteResourceChannel('acme-eu', 'flagship-store', 'order_status', '4711').name).toBe('site:acme-eu.flagship-store.order_status.4711');
  });

  it('takes a topic for the two tenant forms', () => {
    expect(tenantActionChannel('acme-eu', 'revenexx.integrations.run.started').name).toBe('tenant:acme-eu.revenexx.integrations.run.started');
    expect(tenantResourceChannel('acme-eu', 'revenexx.integrations.run.started', '4711').name).toBe('tenant:acme-eu.revenexx.integrations.run.4711');
  });

  it('falls back to the kind channel for a three-segment topic', () => {
    expect(tenantActionChannel('acme-eu', 'revenexx.integrations.run').name).toBe('tenant:acme-eu.revenexx.integrations.run');
  });
});

describe('the builders reject what would assemble into a valid but wrong channel', () => {
  const cases: Array<[string, () => unknown]> = [
    ['tenant slug with an underscore', () => userChannel('acme_eu', 'u1')],
    ['tenant slug too short', () => userChannel('ac', 'u1')],
    ['id with a dot, which would add a segment', () => userChannel('acme-eu', 'a.b')],
    ['id with the Centrifugo user boundary', () => userChannel('acme-eu', 'abc#def')],
    ['vendor with a hyphen', () => tenantChannel('acme-eu', 'my-vendor', 'app', 'run')],
    ['entity with uppercase', () => tenantChannel('acme-eu', 'revenexx', 'app', 'Run')],
    ['site slug with an underscore', () => siteChannel('acme-eu', 'flagship_store', 'cart')],
    ['topic with two segments', () => tenantActionChannel('acme-eu', 'revenexx.integrations')],
    ['topic_id with a dot', () => tenantResourceChannel('acme-eu', 'revenexx.integrations.run', 'a.b')],
  ];

  for (const [name, fn] of cases) {
    it(`rejects ${name}`, () => {
      let thrown: unknown;
      try {
        fn();
      } catch (err) {
        thrown = err;
      }
      expect(isChannelError(thrown)).toBe(true);
    });
  }

  /**
   * The failure this separation exists to prevent. With one function taking an
   * optional id, an entity carrying a dot would assemble into a five-segment channel
   * that VALIDATES — an action silently occupying the id position. Per-part
   * validation is what rejects it, so this is the test that would go green if someone
   * "simplified" the two builders into one.
   */
  it('an entity carrying a dot cannot become a fifth segment', () => {
    expect(() => tenantChannel('acme-eu', 'revenexx', 'integrations', 'run.started')).toThrowError();
  });
});

describe('checkId is the id class, usable outside a channel name', () => {
  it('accepts the id shapes the platform actually produces', () => {
    for (const id of ['221234567890123456', '01JQ8ZK9V4ABCDEFGHJKMNPQRS', 'f47ac10b-58cc-4372-a567-0e02b2c3d479', 'evt_01JQ8ZK9V4', '7']) {
      expect(() => checkId('id', id)).not.toThrow();
    }
  });

  it('rejects a dot, which is what fixes the arity of every shape', () => {
    expect(() => checkId('id', 'a.b')).toThrowError();
  });
});
