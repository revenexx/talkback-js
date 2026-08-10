/**
 * `@revenexx/talkback-js/channels` — the channel grammar.
 *
 * Clamped byte for byte against `internal/channels` by
 * `internal/channels/ts_clamp_test.go`, which runs in `go test ./...`. If you are
 * about to change anything here, read the header of `grammar.ts` first: the regexes
 * are literals rather than strings for a reason, and they must not be "improved".
 *
 * Note what is deliberately NOT exported: a `parse()` without a tenant argument, and a
 * `fromTopic()` that guesses between the action and the resource form. Both omissions
 * are asserted by the Go clamp.
 */
export {
  SLUG_PATTERN,
  SEG_PATTERN,
  ID_PATTERN,
  REGEX_TENANT_ID,
  REGEX_RESOURCE,
  REGEX_SITE,
} from './grammar.js';

export {
  NAMESPACES,
  NAMESPACES_WITH_PRESENCE,
  NAMESPACES_WITH_HISTORY,
  MAX_CHANNEL_LENGTH,
  isNamespace,
  regexForNamespace,
  hasPresence,
  hasHistory,
} from './namespaces.js';
export type { Namespace } from './namespaces.js';

export {
  CHANNEL_ERROR_CODES,
  ChannelError,
  isChannelError,
} from './errors.js';
export type { ChannelErrorCode } from './errors.js';

export { parseWithin, parseAllWithin, presenceFor } from './parse.js';
export type { Channel } from './parse.js';

export {
  userChannel,
  streamChannel,
  tenantChannel,
  tenantActionChannel,
  tenantResourceChannel,
  siteChannel,
  siteResourceChannel,
  checkId,
} from './build.js';
