/**
 * The event envelope, ADR-0072 §2, as the bridge publishes it — VERBATIM. The bridge
 * does not re-serialise, so what arrives here is what the producer wrote.
 */
export interface Envelope<T = Record<string, unknown>> {
  /** `evt_<ulid>`. Also the deduplication key — see below. */
  id: string;
  tenant_id: string;
  /** `<vendor>.<app>.<entity>.<action>`. */
  topic: string;
  /**
   * The resource this event is about. A STRING or null, never a number: an 18–19 digit
   * id loses precision as a float64 above 2^53, and a silently altered id produces a
   * channel nobody subscribes to and no error anywhere.
   */
  topic_id?: string | null;
  data: T;
  metadata?: Record<string, unknown>;
  eligible_for_retry?: boolean;
  /** RFC3339. Note the field name: `time`, not `occurred_at`. */
  time?: string;
  [key: string]: unknown;
}

/**
 * The action, i.e. the fourth topic segment. `topic.split('.')[3]`.
 *
 * Worth its own function because of what it is NOT: the channel name. On a resource
 * channel the fifth segment is the resource id and the action is gone from it, so a
 * listener that filtered on the channel would receive every action and think it had
 * filtered. `listen()` filters on this.
 */
export function actionOf(envelope: Envelope): string | undefined {
  const parts = envelope.topic.split('.');
  return parts.length > 3 ? parts[3] : undefined;
}

/**
 * Narrows an arbitrary publication payload to an envelope.
 *
 * Everything the bridge publishes is one; a `stream:` or `presence:` publication from
 * `POST /v1/publish` is whatever its producer sent, which is usually NOT. So the core
 * hands raw data to `listenAll` when this returns null rather than dropping it — a
 * client streaming LLM tokens has no envelopes at all, and dropping its traffic as
 * "malformed" would be the wrong reading of a namespace that is working exactly as
 * designed.
 */
export function asEnvelope(data: unknown): Envelope | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const candidate = data as Partial<Envelope>;
  if (typeof candidate.id !== 'string' || typeof candidate.topic !== 'string') {
    return null;
  }
  if (typeof candidate.tenant_id !== 'string') {
    return null;
  }
  return candidate as Envelope;
}

/**
 * Remembers which event ids have already been delivered, so the same event arriving on
 * both the action and the resource channel surfaces once.
 *
 * THIS IS CONTRACTUAL, NOT A WORKAROUND. A grid subscribes to
 * `tenant:<t>.<vendor>.<app>.<entity>.<action>` and an open detail panel to
 * `…<entity>.<topic_id>`; the bridge publishes to both, one publish each (ADR-0094).
 * ADR-0093 §9's "apply idempotently and reconcile on `id`" is a duty, and doing it here
 * once beats four consumers each discovering it from a duplicated row.
 *
 * Bounded and insertion-ordered rather than a plain Set that grows for the lifetime of
 * a tab. A long-lived dashboard would otherwise hold every id it ever saw.
 */
export class SeenIds {
  private readonly ids = new Set<string>();
  private readonly capacity: number;

  constructor(capacity = 2048) {
    this.capacity = capacity;
  }

  /** True when this id has not been seen before, and records it. */
  admit(id: string): boolean {
    if (this.ids.has(id)) {
      return false;
    }
    this.ids.add(id);
    if (this.ids.size > this.capacity) {
      // Set preserves insertion order, so the first key is the oldest.
      const oldest = this.ids.values().next();
      if (!oldest.done) {
        this.ids.delete(oldest.value);
      }
    }
    return true;
  }

  get size(): number {
    return this.ids.size;
  }
}
