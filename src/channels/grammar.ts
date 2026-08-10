/**
 * The channel grammar, clamped byte for byte against `internal/channels/channels.go`
 * by `internal/channels/ts_clamp_test.go`. That test runs in `go test ./...`, so a
 * change on either side fails the required `build · vet · test` check.
 *
 * TWO RULES THIS FILE HAS TO KEEP, and both are enforced by that test:
 *
 * 1. **The regexes are regex literals, never strings.** In a JavaScript string
 *    literal `'\.'` is a NonEscapeCharacter — the backslash is dropped and the value
 *    becomes a bare `.`, which matches any character. The source bytes do not change,
 *    so a byte comparison would stay green while the grammar had quietly opened up.
 *    The character classes below hold no backslash at all, which is the only reason
 *    they are allowed to be strings.
 *
 * 2. **No flags, and no "improvements".** Centrifugo compiles `channel_regex` with
 *    Go's RE2, which has no lookaround and no backreferences. A tidier regex that
 *    only JavaScript accepts is a grammar the server can never enforce. `i` would
 *    admit `…integrations.Run`; `g` makes `.test()` stateful through `lastIndex`;
 *    `m` turns `^`/`$` into line anchors and lets `"acme-eu.7\nevil"` through.
 *
 * @see docs/channels.md
 */

/**
 * ADR-0033 verbatim: a DNS label, 3–63 characters. Allows `-`, forbids `_`.
 */
export const SLUG_PATTERN = '[a-z][a-z0-9-]{1,61}[a-z0-9]';

/**
 * `EventTopic::SEGMENT` in Console, capped at 32 characters. Allows `_`, forbids `-`.
 *
 * The asymmetry against SLUG_PATTERN is the entire tenant-isolation argument: the two
 * classes overlap only in `[a-z0-9]`, and the tenant is positionally first, so no
 * channel name can be re-read as a different tenant.
 */
export const SEG_PATTERN = '[a-z][a-z0-9_]{0,31}';

/**
 * An opaque FOREIGN identifier, 1–64 characters — Zitadel numeric ids, ULIDs,
 * hyphenated UUIDs, `evt_<ulid>`, plain bigints. Deliberately permissive, because one
 * class covering all of them beats a translation table, and a translation table is a
 * thing that gets skipped.
 *
 * `.` is excluded, and that exclusion is load-bearing: it is what fixes the arity of
 * every channel shape, which is how the trailing-id ambiguity is resolved.
 */
export const ID_PATTERN = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}';

/** `user:` and `stream:` — `<tenant>.<opaque id>`, exactly two segments. */
export const REGEX_TENANT_ID = /^[a-z][a-z0-9-]{1,61}[a-z0-9]\.[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * `tenant:` and `presence:` — `<tenant>.<vendor>.<app>.<entity>[.<id>]`, four or five
 * segments.
 *
 * The optional fifth segment is EITHER an action or a resource id, and the overlap is
 * intentional. It could not have been separated by character class anyway: any class
 * narrow enough to exclude a topic-shaped word like `started` eventually rejects a
 * real id, and `SEG_PATTERN` is in fact a strict subset of `ID_PATTERN`. What tells
 * them apart is the SOURCE — the action comes from topic segment 4, the id from the
 * envelope's `topic_id` — which is why `tenantActionChannel` and
 * `tenantResourceChannel` are two functions rather than one with an optional argument.
 */
export const REGEX_RESOURCE = /^[a-z][a-z0-9-]{1,61}[a-z0-9]\.[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,31}(?:\.[A-Za-z0-9][A-Za-z0-9_-]{0,63})?$/;

/**
 * `site:` — `<tenant>.<site>.<resource>[.<id>]`, three or four segments. `<site>` is a
 * second DNS-label slug, because storefronts have hostnames.
 *
 * Bounded arity IS the "strict channel_regex" this namespace was promised: it is the
 * only namespace reachable by traffic that never authenticated, and there is no depth
 * a Buyer can invent.
 */
export const REGEX_SITE = /^[a-z][a-z0-9-]{1,61}[a-z0-9]\.[a-z][a-z0-9-]{1,61}[a-z0-9]\.[a-z][a-z0-9_]{0,31}(?:\.[A-Za-z0-9][A-Za-z0-9_-]{0,63})?$/;
