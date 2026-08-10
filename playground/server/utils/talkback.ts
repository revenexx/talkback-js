import { createFacadeClient, createTokenSource } from '@revenexx/talkback-js/server';
import type { FacadeClient } from '@revenexx/talkback-js/server';

/**
 * One facade client for the whole server, because the token source caches — a client per
 * request would re-authenticate against Zitadel on every mint.
 */
let client: FacadeClient | null = null;

export function facade(): FacadeClient {
  if (client) {
    return client;
  }
  const config = useRuntimeConfig();

  client = createFacadeClient({
    baseUrl: config.talkbackUrl as string,
    tenant: config.talkbackTenant as string,
    tokens: createTokenSource({
      issuer: config.zitadelIssuer as string,
      clientId: config.talkbackClientId as string,
      clientSecret: config.talkbackClientSecret as string,
    }),
  });
  return client;
}

/**
 * Stands in for the session.
 *
 * A REAL APPLICATION MUST NOT DO THIS. `resolveUser` reads the session and never the
 * request body — ADR-0057 one level out from the facade — and in a Nuxt BFF that means
 * `getUserSession(event)`, which throws 401 without one. The playground has no identity
 * provider in front of it, so it returns a fixed user and says so loudly rather than
 * demonstrating a pattern somebody might copy.
 */
export function playgroundUser() {
  const config = useRuntimeConfig();
  return { tenant: config.public.tenant as string, userId: config.public.userId as string };
}
