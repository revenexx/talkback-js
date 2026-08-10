/**
 * The four ways a channel name can be wrong. These strings are not a translation of
 * the Go sentinels — they ARE the shared vocabulary: the generator behind
 * `src/testing/channel-vectors.json` maps `ErrMalformed`, `ErrUnknownNamespace`,
 * `ErrTenantMismatch` and `ErrTooLong` onto exactly these four codes, and fails the
 * build on a sentinel it does not know. A translation table would be a thing that
 * gets skipped.
 */
export const CHANNEL_ERROR_CODES = ['malformed', 'unknown_namespace', 'tenant_mismatch', 'too_long'] as const;

export type ChannelErrorCode = (typeof CHANNEL_ERROR_CODES)[number];

/**
 * Discriminated by a DATA FIELD rather than by `instanceof`.
 *
 * tsup emits ESM and CJS, and a consumer whose dependency graph pulls in both loads
 * this class twice. `instanceof` then fails across that realm boundary for an error
 * that is genuinely ours, which is the kind of bug that gets diagnosed as "the error
 * handling is flaky". A string field does not care how many times the module loaded.
 */
export class ChannelError extends Error {
  readonly code: ChannelErrorCode;

  constructor(code: ChannelErrorCode, message: string) {
    super(message);
    this.name = 'ChannelError';
    this.code = code;
  }
}

export function isChannelError(err: unknown): err is ChannelError {
  return err instanceof Error && typeof (err as ChannelError).code === 'string' && (CHANNEL_ERROR_CODES as readonly string[]).includes((err as ChannelError).code);
}

/**
 * The cross-tenant rejection, and the single most important error here.
 *
 * The Go side names BOTH tenants in the wrapped message on purpose — that message is
 * the content of an audit line — and the facade never puts it in an HTTP body. The
 * same reasoning applies one level further out: this message names the channel the
 * caller asked for, which they already have, and not what the tenant actually is.
 */
export function tenantMismatch(channel: string): ChannelError {
  return new ChannelError('tenant_mismatch', `channel does not belong to the tenant: ${channel}`);
}

export function malformed(channel: string): ChannelError {
  return new ChannelError('malformed', `channel is malformed: ${channel}`);
}

export function unknownNamespace(channel: string): ChannelError {
  return new ChannelError('unknown_namespace', `channel namespace is unknown: ${channel}`);
}

export function tooLong(channel: string, max: number): ChannelError {
  return new ChannelError('too_long', `channel is longer than ${max} characters: ${channel.length}`);
}
