import { ID_PATTERN, SEG_PATTERN, SLUG_PATTERN } from './grammar.js';
import { malformed } from './errors.js';
import { parseWithin } from './parse.js';
import type { Channel } from './parse.js';

/**
 * The per-part validators, built from the character classes rather than repeating
 * them. That is what keeps the three exported class constants load-bearing: if one
 * drifted from Go, the clamp catches the bytes AND these checks would start accepting
 * the wrong thing, so the vector suite catches it too.
 */
const SLUG = new RegExp(`^${SLUG_PATTERN}$`);
const SEG = new RegExp(`^${SEG_PATTERN}$`);
const ID = new RegExp(`^${ID_PATTERN}$`);

function checkSlug(what: string, value: string): void {
  if (!SLUG.test(value)) {
    throw malformed(`${what} ${JSON.stringify(value)} is not a slug (3-64 chars, lowercase, '-' allowed, '_' is not)`);
  }
}

function checkSeg(what: string, value: string): void {
  if (!SEG.test(value)) {
    throw malformed(`${what} ${JSON.stringify(value)} is not a topic segment (1-32 chars, lowercase, '_' allowed, '-' is not)`);
  }
}

/**
 * Validates an opaque foreign identifier against the same class the grammar uses for
 * one inside a channel name.
 *
 * Exported because the facade needs it for a value that never appears in a channel: a
 * token's `sub` is `<tenant>:<user_id>`, so a user id ends up in signing material even
 * when no `user:` channel was requested. One definition of "an id" rather than two
 * that can drift.
 */
export function checkId(what: string, value: string): void {
  if (!ID.test(value)) {
    throw malformed(`${what} ${JSON.stringify(value)} is not an id (1-64 chars of [A-Za-z0-9_-], no dot)`);
  }
}

/**
 * Every builder ends here: whatever was assembled is parsed again through exactly the
 * path a caller-supplied name takes. A builder that could produce a channel
 * `parseWithin` rejects would be a grammar bug hiding behind a pleasant API.
 */
function assemble(tenant: string, name: string): Channel {
  return parseWithin(tenant, name);
}

/** `user:<tenant>.<user_id>` — notifications and toasts, one channel per person. */
export function userChannel(tenant: string, userId: string): Channel {
  checkSlug('tenant', tenant);
  checkId('user id', userId);
  return assemble(tenant, `user:${tenant}.${userId}`);
}

/** `stream:<tenant>.<stream_id>` — agent and LLM token streaming, no history. */
export function streamChannel(tenant: string, streamId: string): Channel {
  checkSlug('tenant', tenant);
  checkId('stream id', streamId);
  return assemble(tenant, `stream:${tenant}.${streamId}`);
}

/**
 * `tenant:<tenant>.<vendor>.<app>.<entity>` — a resource KIND, no specific instance.
 *
 * NOT what a grid subscribes to, and the distinction is the one this package exists to
 * make hard to get wrong: the bridge publishes to the ACTION channel (segment 5 present),
 * Centrifugo has no wildcards, and a name that is a prefix of another is simply a
 * different channel. A grid takes one `tenantActionChannel` per action it cares about.
 * This form is for ad-hoc publishes that address a collection.
 */
export function tenantChannel(tenant: string, vendor: string, app: string, entity: string): Channel {
  checkResourceParts(tenant, vendor, app, entity);
  return assemble(tenant, `tenant:${tenant}.${vendor}.${app}.${entity}`);
}

/**
 * `tenant:<tenant>.<vendor>.<app>.<entity>.<action>` from a topic — the ACTION form
 * the bridge publishes for an event with no `topic_id`.
 *
 * Separate from `tenantResourceChannel` rather than one function with an optional
 * argument, and this separation is the point rather than a style choice: with a single
 * function an entity of `"run.started"` would assemble into a five-segment channel
 * that validates, silently turning an action into a resource id. Two functions make
 * the intent unmissable at the call site.
 */
export function tenantActionChannel(tenant: string, topic: string): Channel {
  const { vendor, app, entity, action } = splitTopic(tenant, topic);
  if (action === '') {
    return tenantChannel(tenant, vendor, app, entity);
  }
  return assemble(tenant, `tenant:${tenant}.${vendor}.${app}.${entity}.${action}`);
}

/**
 * `tenant:<tenant>.<vendor>.<app>.<entity>.<topic_id>` — the RESOURCE form, same arity
 * as the action form and a different meaning. What tells them apart is the SOURCE:
 * the action comes from topic segment 4, the id from the envelope's `topic_id`.
 *
 * A client on both this and the action channel receives the same event twice. That is
 * contractual (ADR-0094) rather than a bug, and deduplicating on `envelope.id` is a
 * duty — the core client does it for you.
 */
export function tenantResourceChannel(tenant: string, topic: string, topicId: string): Channel {
  const { vendor, app, entity } = splitTopic(tenant, topic);
  checkId('topic_id', topicId);
  return assemble(tenant, `tenant:${tenant}.${vendor}.${app}.${entity}.${topicId}`);
}

/** `site:<tenant>.<site>.<resource>` — Buyer-facing storefronts. */
export function siteChannel(tenant: string, site: string, resource: string): Channel {
  checkSiteParts(tenant, site, resource);
  return assemble(tenant, `site:${tenant}.${site}.${resource}`);
}

/** `site:<tenant>.<site>.<resource>.<id>`. */
export function siteResourceChannel(tenant: string, site: string, resource: string, id: string): Channel {
  checkSiteParts(tenant, site, resource);
  checkId('id', id);
  return assemble(tenant, `site:${tenant}.${site}.${resource}.${id}`);
}

function checkResourceParts(tenant: string, vendor: string, app: string, entity: string): void {
  checkSlug('tenant', tenant);
  checkSeg('vendor', vendor);
  checkSeg('app', app);
  checkSeg('entity', entity);
}

function checkSiteParts(tenant: string, site: string, resource: string): void {
  checkSlug('tenant', tenant);
  checkSlug('site', site);
  checkSeg('resource', resource);
}

/**
 * EVERY segment is validated, including the ones thrown away. A malformed action means
 * a malformed producer, and silently mapping it onto a valid channel would hide that.
 */
function splitTopic(tenant: string, topic: string): { vendor: string; app: string; entity: string; action: string } {
  checkSlug('tenant', tenant);

  const parts = topic.split('.');
  if (parts.length < 3) {
    throw malformed(`topic ${JSON.stringify(topic)} has ${parts.length} segments, want at least 3 (<vendor>.<app>.<name>)`);
  }
  for (const part of parts) {
    checkSeg('topic segment', part);
  }

  return {
    vendor: parts[0] as string,
    app: parts[1] as string,
    entity: parts[2] as string,
    action: parts.length > 3 ? (parts[3] as string) : '',
  };
}
