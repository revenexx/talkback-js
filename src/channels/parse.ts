import { malformed, tenantMismatch, tooLong, unknownNamespace } from './errors.js';
import { MAX_CHANNEL_LENGTH, isNamespace, regexForNamespace } from './namespaces.js';
import type { Namespace } from './namespaces.js';

/**
 * A parsed channel. The fields are readonly and there is no public constructor: the
 * only way to obtain one is through `parseWithin` or a builder in `./build.js`, both
 * of which have already checked the tenant.
 *
 * The Go counterpart goes further and makes the fields unexported, so "publish to an
 * unparsed name" is unrepresentable. TypeScript cannot enforce that at run time, so
 * the guarantee here is a convention plus the fact that every function that accepts a
 * channel takes this type rather than `string`.
 */
export interface Channel {
  readonly namespace: Namespace;
  readonly tenant: string;
  readonly name: string;
}

/**
 * The only parse entry point, and the tenant argument is not optional.
 *
 * There is deliberately no `parse(name)`. "Validate the grammar, then separately
 * remember to check the tenant" is the SHAPE of a cross-tenant leak, so it is not
 * offered — and `internal/channels/ts_clamp_test.go` fails the Go build if an
 * `export function parse(` ever appears in this file.
 *
 * The order of the checks mirrors Go exactly, and it is not arbitrary: length first,
 * because on the `subs` path Centrifugo checks nothing at all and a 303-character
 * channel was accepted by its server API.
 */
export function parseWithin(tenant: string, channel: string): Channel {
  if (channel.length > MAX_CHANNEL_LENGTH) {
    throw tooLong(channel, MAX_CHANNEL_LENGTH);
  }

  const boundary = channel.indexOf(':');
  if (boundary < 0) {
    throw unknownNamespace(channel);
  }
  const ns = channel.slice(0, boundary);
  const rest = channel.slice(boundary + 1);

  if (!isNamespace(ns)) {
    throw unknownNamespace(channel);
  }
  if (!regexForNamespace(ns).test(rest)) {
    throw malformed(channel);
  }

  // Safe without a check: every regex requires a slug followed by '.', so a match
  // guarantees there is a first segment.
  const got = rest.slice(0, rest.indexOf('.'));
  if (got !== tenant) {
    throw tenantMismatch(channel);
  }

  return { namespace: ns, tenant: got, name: channel };
}

/**
 * All-or-nothing: one bad channel grants none of them.
 *
 * A connection token carries a single `subs` claim, so a partial result would leave a
 * client subscribed to less than it believes with no error anywhere. The facade
 * behaves the same way, and a client that filtered locally instead would disagree
 * with the token it is about to be handed.
 */
export function parseAllWithin(tenant: string, channels: readonly string[]): Channel[] {
  return channels.map(raw => parseWithin(tenant, raw));
}

/**
 * Swaps a `tenant:` channel into its `presence:` counterpart, so a resource has
 * exactly one spelling and "who else is looking at this" cannot drift from "what is
 * this".
 *
 * NOT idempotent, on purpose: a `presence:` channel in is an error, not a pass-through.
 * Presence is only defined for the tenant namespace — on a per-user channel it would
 * be a write per connection for something nobody reads, and a storefront Buyer has no
 * collaborators to see.
 */
export function presenceFor(channel: Channel): Channel {
  if (channel.namespace !== 'tenant') {
    throw unknownNamespace(`presence is only defined for the tenant namespace, got ${channel.namespace}`);
  }
  const rest = channel.name.slice(channel.name.indexOf(':') + 1);
  return parseWithin(channel.tenant, `presence:${rest}`);
}
