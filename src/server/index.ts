/**
 * `@revenexx/talkback-js/server` — everything that runs on a BFF, never in a browser.
 *
 * The split matters: this entry holds the M2M client credentials and the facade base
 * URL. Nothing here should ever be reachable from a bundle sent to a client, which is
 * why it is a separate export rather than part of the root entry.
 */
export { createTokenSource } from './m2m.js';
export type { M2MOptions, TokenSource } from './m2m.js';

export { createFacadeClient } from './facade.js';
export type {
  FacadeClient,
  FacadeOptions,
  MintTokenRequest,
  MintTokenResponse,
  MintSubscriptionTokenRequest,
  MintSubscriptionTokenResponse,
  SubscriptionOverride,
  PublishRequest,
  PresenceResponse,
  PresenceStatsResponse,
  HistoryQuery,
  HistoryResponse,
  Publication,
  ClientInfo,
} from './facade.js';

export {
  TalkbackError,
  TalkbackUnauthenticatedError,
  TalkbackForbiddenError,
  TalkbackUnknownTenantError,
  TalkbackRequestError,
  TalkbackRateLimitedError,
  TalkbackUnavailableError,
  parseRetryAfter,
} from './errors.js';

export {
  createTokenRoute,
  createSubscriptionTokenRoute,
  TokenRouteError,
  DEFAULT_MAX_SUBS_PER_TOKEN,
} from './route.js';
export type {
  TalkbackUser,
  TokenRouteOptions,
  SubscriptionRouteOptions,
  AuthorizeChannelsContext,
  TokenRequestBody,
} from './route.js';

export { nitroTokenHandler, nitroSubscriptionTokenHandler } from './nitro.js';
export type { H3Helpers } from './nitro.js';
