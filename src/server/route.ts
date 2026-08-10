import { parseAllWithin } from '../channels/parse.js';
import type { FacadeClient, MintTokenResponse, SubscriptionOverride } from './facade.js';

/**
 * `POST /bff/talkback-token` as a factory.
 *
 * ADR-0093 has listed this route since Phase 0 and it exists NOWHERE — without it the
 * browser half of Talkback is unusable, and each of the four consumers would write it
 * again. It is framework-agnostic here, with a Nitro adapter below, because the org runs
 * Nuxt BFFs and one React SPA.
 *
 * THE ONE QUESTION THIS PACKAGE CANNOT ANSWER is *which channels may this user see*.
 * That is `authorizeChannels`, and it is a REQUIRED callback rather than a default —
 * TypeScript rejects a route without it, so the answer cannot be forgotten into
 * existence. A default here would be a default answer to an authorisation question.
 *
 * THE SESSION IS THE ONLY SOURCE OF IDENTITY. `resolveUser` reads from the request's
 * session, never from its body. That is ADR-0057's rule ("a tenant is never read from a
 * request body") one level further out than the facade applies it, and the reason is the
 * same: a value the caller supplies cannot authorise the caller.
 *
 * A NOTE THAT DECIDES THE SIGNATURE. The org's Nuxt session — see
 * `services/skills/ui/server/routes/bff/session.get.ts` — holds a Zitadel ORG ID, not a
 * Talkback tenant slug. There is no way for this package to derive one, so `resolveUser`
 * returns the tenant and the host application maps org to tenant however it already
 * does. Guessing here would produce four different mappings.
 */

export interface TalkbackUser {
  /** The tenant slug or UUID. From the session; never from the request body. */
  tenant: string;
  /** Becomes half of the token's `sub` (`<tenant>:<userId>`). */
  userId: string;
  /** Recorded in the server-only `meta` claim. Never client-visible. */
  roles?: readonly string[];
}

export interface AuthorizeChannelsContext<Req> {
  request: Req;
  user: TalkbackUser;
  /**
   * The channels the client asked for, if any. ADVISORY ONLY: it comes from the request
   * body, so it is a hint about what the UI currently needs, never a grant. Returning it
   * unfiltered is the bug this parameter's name is trying not to invite — filter it
   * against what the session actually permits.
   */
  requested: readonly string[];
}

export interface TokenRouteOptions<Req> {
  facade: FacadeClient;
  /** Reads the session. Throwing here is how "not signed in" is expressed. */
  resolveUser(request: Req): Promise<TalkbackUser> | TalkbackUser;
  /** REQUIRED. There is deliberately no default — see the module comment. */
  authorizeChannels(ctx: AuthorizeChannelsContext<Req>): Promise<string[]> | string[];
  /**
   * Optional cap on how many channels one token may carry. The facade's own limit is
   * `TALKBACK_MAX_SUBS_PER_TOKEN` (32 by default); asking for more is a 400 that points
   * at the subscription-token path.
   */
  maxChannels?: number;
}

export interface TokenRequestBody {
  channels?: unknown;
  /**
   * Anything else a caller sends is ignored rather than rejected, and `tenant` in
   * particular. The facade goes further — its decoders use DisallowUnknownFields, so a
   * body-supplied `tenant_id` is a 400 by construction — but this route sits in the host
   * application, where an extra field is far more likely to be an unrelated UI value
   * than an attack. Ignoring it is enough, because nothing here ever reads it.
   */
  [key: string]: unknown;
}

/** The facade's default; overridable because the deployment's value is not visible here. */
export const DEFAULT_MAX_SUBS_PER_TOKEN = 32;

export class TokenRouteError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'TokenRouteError';
    this.status = status;
  }
}

/**
 * Builds the handler. Framework-agnostic: it takes a parsed body and the raw request,
 * and returns what the response body should be.
 */
export function createTokenRoute<Req>(options: TokenRouteOptions<Req>) {
  const maxChannels = options.maxChannels ?? DEFAULT_MAX_SUBS_PER_TOKEN;

  return async function handle(request: Req, body: TokenRequestBody): Promise<MintTokenResponse> {
    const user = await options.resolveUser(request);

    const requested = Array.isArray(body.channels) ? body.channels.filter((c): c is string => typeof c === 'string') : [];

    const granted = await options.authorizeChannels({ request, user, requested });

    // Parsed against the tenant from the SESSION, before anything leaves this process.
    // The facade checks this too and is the enforcement point — this check is here so
    // the error names the channel and arrives without a round trip, not because the
    // facade could be skipped.
    parseAllWithin(user.tenant, granted);

    if (granted.length > maxChannels) {
      throw new TokenRouteError(400, `at most ${maxChannels} channels per token; request subscription tokens for the rest`);
    }

    return options.facade.mintToken({
      userId: user.userId,
      channels: granted,
      ...(user.roles ? { roles: user.roles } : {}),
    });
  };
}

/**
 * The subscription-token counterpart, for depth the client discovers at run time —
 * opening a detail panel, expanding a row.
 *
 * Same shape and same rule: one channel per request, authorised against the session.
 */
export interface SubscriptionRouteOptions<Req> {
  facade: FacadeClient;
  resolveUser(request: Req): Promise<TalkbackUser> | TalkbackUser;
  /** REQUIRED. Return false and the route answers 403. */
  authorizeChannel(ctx: {
    request: Req;
    user: TalkbackUser;
    channel: string;
  }): Promise<boolean> | boolean;
}

export function createSubscriptionTokenRoute<Req>(options: SubscriptionRouteOptions<Req>) {
  return async function handle(request: Req, body: { channel?: unknown; info?: Record<string, unknown>; override?: SubscriptionOverride }) {
    const user = await options.resolveUser(request);

    if (typeof body.channel !== 'string' || body.channel === '') {
      throw new TokenRouteError(400, 'channel is required');
    }
    const channel = body.channel;

    if (!(await options.authorizeChannel({ request, user, channel }))) {
      throw new TokenRouteError(403, 'not authorised for this channel');
    }
    parseAllWithin(user.tenant, [channel]);

    return options.facade.mintSubscriptionToken({
      userId: user.userId,
      channel,
      ...(body.info ? { info: body.info } : {}),
      ...(body.override ? { override: body.override } : {}),
    });
  };
}
