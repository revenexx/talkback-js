import fixture from './channel-vectors.json';
import type { ChannelErrorCode } from '../channels/errors.js';
import type { Namespace } from '../channels/namespaces.js';

/**
 * The grammar vectors, shared with Go.
 *
 * `channel-vectors.json` is GENERATED from the vector table in
 * `internal/channels/channels_test.go` by `make vectors`, and
 * `internal/channels/ts_clamp_test.go` fails `go test ./...` when the checked-in file
 * has gone stale. That is the whole mechanism behind "a new positive case cannot fall
 * behind on one side": a new Go vector fails the Go build until the fixture is
 * regenerated, and the regenerated fixture fails the TypeScript suites until this side
 * handles it.
 *
 * Exported from `@revenexx/talkback-js/testing` rather than from `/channels` on
 * purpose — esbuild inlines the JSON into whichever bundle imports it, and 52 grammar
 * vectors have no business in a browser bundle.
 */
export interface ChannelVector {
  readonly name: string;
  readonly channel: string;
  /** The caller's resolved tenant; for a valid vector, the tenant the channel is in. */
  readonly tenant: string;
  /** `null` for an invalid vector — comparing it is then a type error, not a silent ''. */
  readonly namespace: Namespace | null;
  readonly valid: boolean;
  /** `null` when valid. Otherwise the exact `ChannelError.code` expected. */
  readonly error: ChannelErrorCode | null;
}

interface VectorFile {
  readonly version: number;
  readonly count: number;
  readonly maxChannelLength: number;
  readonly vectors: readonly ChannelVector[];
}

/**
 * The version this reader understands. A bump on the Go side that this file ignored
 * would leave every negative assertion comparing `undefined` with `undefined` — the
 * same vacuum-green failure the `covered` guards below exist to prevent, so it throws
 * rather than adapts.
 */
const SUPPORTED_VERSION = 1;

function load(): VectorFile {
  const raw = fixture as unknown as VectorFile;

  if (raw.version !== SUPPORTED_VERSION) {
    throw new Error(`channel-vectors.json is version ${raw.version}, this reader understands ${SUPPORTED_VERSION}`);
  }
  if (!Array.isArray(raw.vectors) || raw.vectors.length !== raw.count) {
    throw new Error(`channel-vectors.json declares ${raw.count} vectors but carries ${raw.vectors?.length}`);
  }
  return raw;
}

const file = load();

export const channelVectors: readonly ChannelVector[] = file.vectors;
export const maxChannelLength: number = file.maxChannelLength;
