/**
 * Typed errors for the facade API.
 *
 * THE ENVELOPE CARRIES NO MACHINE-READABLE CODE. `{ "error": true, "message": "…" }` —
 * `error` is a boolean, always `true`, and `message` is prose meant for a human reading
 * a log. So the discrimination below comes from the HTTP status plus the route, never
 * from parsing the message; a client that matched on message text would break the first
 * time somebody improved the wording.
 *
 * The distinctions that matter, and each one sends a different person to a different
 * place:
 *
 * - **401** — the M2M credential is missing, expired or not a JWT. Your problem.
 * - **403** — three different situations the status cannot separate, which is why
 *   `TalkbackForbiddenError` carries `channel` when one was involved: a channel outside
 *   the tenant, a tenant the caller is not a member of, or a missing scope.
 * - **404** — *Console does not know this tenant*. Explicitly NOT a 403: the credential
 *   is fine, the name is not. Conflating them sends a team hunting through Zitadel for
 *   a typo in a slug.
 * - **429** — a token bucket. `Retry-After` comes from the bucket rather than a
 *   constant, so it is worth honouring rather than backing off blindly.
 * - **502** — Centrifugo is unreachable or answered with something unusable.
 * - **503** — a dependency is down or a component is unconfigured. Retryable.
 */

export interface TalkbackErrorInit {
  status: number;
  message: string;
  /** The operation, e.g. `mintConnectionToken`. Half of what makes a 403 legible. */
  operation: string;
  requestId?: string | undefined;
}

export class TalkbackError extends Error {
  readonly status: number;
  readonly operation: string;
  /** The `X-Request-ID` the facade echoed, for correlating with its audit line. */
  readonly requestId: string | undefined;

  constructor(init: TalkbackErrorInit) {
    super(init.message);
    this.name = 'TalkbackError';
    this.status = init.status;
    this.operation = init.operation;
    this.requestId = init.requestId;
  }
}

/** 401 — our credential, not the end user's session. */
export class TalkbackUnauthenticatedError extends TalkbackError {
  constructor(init: TalkbackErrorInit) {
    super(init);
    this.name = 'TalkbackUnauthenticatedError';
  }
}

/** 403 — scope, tenant membership, or a channel outside the tenant. */
export class TalkbackForbiddenError extends TalkbackError {
  /** Set when the rejection was about a specific channel. */
  readonly channel: string | undefined;

  constructor(init: TalkbackErrorInit & { channel?: string | undefined }) {
    super(init);
    this.name = 'TalkbackForbiddenError';
    this.channel = init.channel;
  }
}

/** 404 — Console does not know this tenant. Not a credential problem. */
export class TalkbackUnknownTenantError extends TalkbackError {
  readonly tenant: string;

  constructor(init: TalkbackErrorInit & { tenant: string }) {
    super(init);
    this.name = 'TalkbackUnknownTenantError';
    this.tenant = init.tenant;
  }
}

/** 400 or 413 — the request itself. Retrying it unchanged cannot help. */
export class TalkbackRequestError extends TalkbackError {
  constructor(init: TalkbackErrorInit) {
    super(init);
    this.name = 'TalkbackRequestError';
  }
}

/**
 * 429. `retryAfterMs` is derived from the header the facade sent, which it computes
 * from the token bucket's own reservation rather than from a constant — so waiting
 * exactly that long is the cheapest correct behaviour, and retrying sooner is how a
 * client turns its own rate limit into a hot loop.
 */
export class TalkbackRateLimitedError extends TalkbackError {
  readonly retryAfterMs: number;

  constructor(init: TalkbackErrorInit & { retryAfterMs: number }) {
    super(init);
    this.name = 'TalkbackRateLimitedError';
    this.retryAfterMs = init.retryAfterMs;
  }
}

/** 502 or 503 — a dependency. Retryable, unlike everything above. */
export class TalkbackUnavailableError extends TalkbackError {
  constructor(init: TalkbackErrorInit) {
    super(init);
    this.name = 'TalkbackUnavailableError';
  }
}

interface RawEnvelope {
  error?: unknown;
  message?: unknown;
}

/** `Retry-After` is seconds in this API; the facade never sends the HTTP-date form. */
export function parseRetryAfter(header: string | null): number {
  const seconds = Number.parseInt(header ?? '', 10);
  if (!Number.isFinite(seconds) || seconds < 0) {
    // A 429 without a usable header still has to wait for something. One second is the
    // smallest value the facade can advertise, so it is the smallest honest guess.
    return 1_000;
  }
  return seconds * 1_000;
}

export function errorFromResponse(res: Response, body: unknown, context: { operation: string; tenant: string; channel?: string | undefined }): TalkbackError {
  const envelope = (body ?? {}) as RawEnvelope;
  const message = typeof envelope.message === 'string' && envelope.message !== '' ? envelope.message : `${context.operation} failed with HTTP ${res.status}`;
  const requestId = res.headers.get('x-request-id') ?? undefined;
  const init = { status: res.status, message, operation: context.operation, requestId };

  switch (res.status) {
    case 400:
    case 413:
      return new TalkbackRequestError(init);
    case 401:
      return new TalkbackUnauthenticatedError(init);
    case 403:
      return new TalkbackForbiddenError({ ...init, channel: context.channel });
    case 404:
      return new TalkbackUnknownTenantError({ ...init, tenant: context.tenant });
    case 429:
      return new TalkbackRateLimitedError({
        ...init,
        retryAfterMs: parseRetryAfter(res.headers.get('retry-after')),
      });
    case 502:
    case 503:
      return new TalkbackUnavailableError(init);
    default:
      return new TalkbackError(init);
  }
}
