/**
 * Zitadel client-credentials, for a BFF talking to the facade.
 *
 * Modelled on `services/brand/server/utils/stencil.ts`, the only Nitro precedent in the
 * org that combines client-credentials with `X-Revenexx-Tenant`. Two properties are
 * taken from it deliberately: the token is cached in the module, and it is refreshed a
 * minute BEFORE expiry rather than on the first 401.
 *
 * The second is not an optimisation. Without it, every token expiry costs one request
 * that fails on the way to being retried — and that failure lands in the facade's audit
 * trail as a 401, i.e. in the same place a genuinely misconfigured credential shows up.
 * A margin keeps the audit signal clean.
 */

export interface M2MOptions {
  /** Zitadel issuer, e.g. `https://id.revenexx.com`. */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /**
   * OAuth scopes. `talkback:write` is what minting needs; `talkback:read` is enough for
   * presence and history. The role hierarchy is `read ≤ validate ≤ write`, so a writer
   * can read (ADR-0042).
   */
  scope?: string;
  /**
   * Injected for tests, and for a Nitro app that wants its own instrumented fetch.
   */
  fetch?: typeof globalThis.fetch;
  /** Injected so the cache can be tested without waiting or faking timers. */
  now?: () => number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

/** Refresh this far before the token actually expires. */
const REFRESH_MARGIN_MS = 60_000;

export interface TokenSource {
  token(): Promise<string>;
  /** Drops the cached token. For a test, or for a caller that just saw a 401. */
  invalidate(): void;
}

export function createTokenSource(options: M2MOptions): TokenSource {
  const doFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const scope = options.scope ?? 'openid profile talkback:write';

  let cached: { token: string; expiresAt: number } | null = null;
  // Collapses concurrent misses onto one request. A BFF handling a reconnect storm
  // would otherwise open one token request per in-flight mint — the same stampede
  // internal/tenants solves with singleflight, one level out.
  let inFlight: Promise<string> | null = null;

  async function fetchToken(): Promise<string> {
    const started = now();
    const res = await doFetch(`${options.issuer}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: options.clientId,
        client_secret: options.clientSecret,
        scope,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`talkback m2m auth failed (${res.status}): ${detail}`);
    }

    const body = (await res.json()) as TokenResponse;
    if (!body.access_token) {
      throw new Error('talkback m2m auth returned no access_token');
    }

    cached = {
      token: body.access_token,
      expiresAt: started + (body.expires_in ?? 3600) * 1000,
    };
    return body.access_token;
  }

  return {
    async token(): Promise<string> {
      if (cached && cached.expiresAt > now() + REFRESH_MARGIN_MS) {
        return cached.token;
      }
      if (inFlight) {
        return inFlight;
      }
      inFlight = fetchToken().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    invalidate(): void {
      cached = null;
    },
  };
}
