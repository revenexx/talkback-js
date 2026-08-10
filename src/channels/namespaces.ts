import { REGEX_RESOURCE, REGEX_SITE, REGEX_TENANT_ID } from './grammar.js';

/**
 * The five namespaces, and the registry is exhaustive: a name that is not one of
 * these does not exist. That is also how a `$`-prefixed channel is rejected —
 * Centrifugo would strip a private prefix and resolve into a real namespace, so
 * `centrifugo/config.yaml` sets `private_prefix` to a sentinel and there is no
 * `$user` here.
 *
 * Clamped against `namespaceRegex` in Go by `internal/channels/ts_clamp_test.go`.
 */
export const NAMESPACES = ['user', 'tenant', 'stream', 'site', 'presence'] as const;

export type Namespace = (typeof NAMESPACES)[number];

/**
 * Which namespaces carry presence, and which carry history. Clamped against
 * `namespaceHasPresence` / `namespaceHasHistory`.
 *
 * They are here rather than derived at the call site because the facade rejects
 * presence or history on a namespace that has neither with a 400 BEFORE it reaches
 * Centrifugo — asking anyway costs a round trip to be told something this file
 * already knows.
 */
export const NAMESPACES_WITH_PRESENCE = ['presence'] as const;
export const NAMESPACES_WITH_HISTORY = ['user', 'tenant'] as const;

/**
 * Centrifugo's `channel.max_length`. Every regex above already bounds its own total
 * well under this, so the check is redundant today — it stays because Centrifugo does
 * NOT enforce `max_length` on the `subs` path, which makes it the only thing between
 * a token claim and an unbounded channel name if a regex is ever relaxed.
 */
export const MAX_CHANNEL_LENGTH = 255;

/**
 * Five namespaces, three regexes. Both collapses are decisions, not accidents:
 *
 * - `stream` ≡ `user`: both are `<tenant>.<opaque id>`. They differ in POLICY, not in
 *   SHAPE, and two subtly different regexes for one shape is a drift surface for
 *   nothing.
 * - `presence` ≡ `tenant`: a resource has ONE spelling, and "who else is looking at
 *   this" is the resource channel with the namespace swapped. `presenceFor` is that
 *   swap, so the two cannot drift by hand.
 */
const REGEX_FOR_NAMESPACE: Record<Namespace, RegExp> = {
  user: REGEX_TENANT_ID,
  stream: REGEX_TENANT_ID,
  tenant: REGEX_RESOURCE,
  presence: REGEX_RESOURCE,
  site: REGEX_SITE,
};

export function isNamespace(value: string): value is Namespace {
  return (NAMESPACES as readonly string[]).includes(value);
}

export function regexForNamespace(ns: Namespace): RegExp {
  return REGEX_FOR_NAMESPACE[ns];
}

export function hasPresence(ns: Namespace): boolean {
  return (NAMESPACES_WITH_PRESENCE as readonly string[]).includes(ns);
}

export function hasHistory(ns: Namespace): boolean {
  return (NAMESPACES_WITH_HISTORY as readonly string[]).includes(ns);
}
