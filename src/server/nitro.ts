import { createSubscriptionTokenRoute, createTokenRoute, TokenRouteError } from './route.js';
import type { SubscriptionRouteOptions, TokenRouteOptions } from './route.js';
import { TalkbackError } from './errors.js';

/**
 * Nitro adapters, kept in their own module so `./route.js` stays framework-agnostic and
 * so importing the factory never drags h3's types in.
 *
 * h3 is NOT a dependency, not even an optional peer: these adapters take the handful of
 * helpers as arguments. A Nuxt app already has `defineEventHandler`, `readBody` and
 * `createError` auto-imported, and adding h3 here would pin a version against every
 * Nuxt release the org runs.
 *
 * Usage in `server/routes/bff/talkback-token.post.ts`:
 *
 * ```ts
 * import { getUserSession } from 'nuxt-oidc-auth/runtime/server/utils/session.js'
 *
 * const handle = nitroTokenHandler({
 *   facade,
 *   // The session, never the body — ADR-0057 one level out from the facade.
 *   async resolveUser(event) {
 *     const session = await getUserSession(event)   // throws 401 without one
 *     return { tenant: await tenantForOrg(session), userId: session.userInfo.sub }
 *   },
 *   authorizeChannels: ({ user, requested }) => channelsFor(user, requested),
 * })
 *
 * export default defineEventHandler(event => handle(event, readBody))
 * ```
 */

export interface H3Helpers {
  /** `readBody` from h3. */
  readBody: (event: unknown) => Promise<unknown>;
  /** `createError` from h3. Optional — a plain throw works, it just renders as a 500. */
  createError?: (input: { statusCode: number; statusMessage: string }) => Error;
}

function toHttpError(err: unknown, helpers: H3Helpers): Error {
  const create = helpers.createError;
  if (!create) {
    return err instanceof Error ? err : new Error(String(err));
  }
  if (err instanceof TokenRouteError) {
    return create({ statusCode: err.status, statusMessage: err.message });
  }
  // A facade error is passed through with its own status, and that mapping is the point
  // of the typed errors: a 404 means "Console does not know this tenant", which is a
  // configuration problem in this app, while a 403 on a channel means the
  // authorizeChannels callback and the facade disagree. Collapsing both into 500 would
  // hide the difference exactly where somebody is debugging it.
  if (err instanceof TalkbackError && err.status >= 400) {
    return create({ statusCode: err.status, statusMessage: err.message });
  }
  return err instanceof Error ? err : new Error(String(err));
}

export function nitroTokenHandler<Req>(options: TokenRouteOptions<Req> & { h3: H3Helpers }) {
  const handle = createTokenRoute(options);

  return async (event: Req) => {
    try {
      const body = ((await options.h3.readBody(event)) ?? {}) as Record<string, unknown>;
      return await handle(event, body);
    } catch (err) {
      throw toHttpError(err, options.h3);
    }
  };
}

export function nitroSubscriptionTokenHandler<Req>(options: SubscriptionRouteOptions<Req> & { h3: H3Helpers }) {
  const handle = createSubscriptionTokenRoute(options);

  return async (event: Req) => {
    try {
      const body = ((await options.h3.readBody(event)) ?? {}) as Record<string, unknown>;
      return await handle(event, body);
    } catch (err) {
      throw toHttpError(err, options.h3);
    }
  };
}
