import { onScopeDispose, provide, inject, isRef, unref, watch } from 'vue';
import type { InjectionKey, Ref } from 'vue';
import type { Talkback } from '../core/talkback.js';
import type { Envelope } from '../core/envelope.js';
import type { EnvelopeListener, RawListener, ResyncContext, TalkbackHandle } from '../core/handles.js';
import { presenceFor, streamChannel, tenantActionChannel, tenantChannel, tenantResourceChannel, userChannel } from '../channels/index.js';

/**
 * Vue composables for Talkback.
 *
 * SHAPED BY THE APPLICATION THAT HAS TO ADOPT THEM. `studio-integrations` has no
 * TanStack Query and no Pinia — it has namespaced `useState` stores and hand-rolled
 * composables — so these deliberately return NOTHING query-shaped. The events are
 * refetch signals anyway: the run payload carries no `result`, because the bus has a
 * 1 MB cap, so "the data arrived over the socket" was never on offer.
 *
 * TWO PROPERTIES ARE NON-NEGOTIABLE, and both come straight from the code being
 * replaced:
 *
 * - **Ref-able arguments.** `RunDetailPanel.vue` does
 *   `watch(() => props.run.id, …, { immediate: true })` plus a manual `onUnmounted`
 *   today. A composable that took a plain string would leave that watch in place and
 *   have solved nothing.
 * - **`onScopeDispose` cleanup.** All four call sites clean up by hand right now. A
 *   route change that leaves a subscription open costs a subscription token and keeps
 *   delivering events into a component that is gone.
 */

export type MaybeRefOrGetter<T> = T | Ref<T> | (() => T);

function read<T>(value: MaybeRefOrGetter<T>): T {
  if (typeof value === 'function') {
    return (value as () => T)();
  }
  return isRef(value) ? unref(value) : (value as T);
}

const TALKBACK_KEY: InjectionKey<Talkback> = Symbol('talkback');

/**
 * Provides one client to a component tree. One connection per application, not one per
 * component — a second `createTalkback` would open a second WebSocket and mint its own
 * connection token.
 */
export function provideTalkback(tb: Talkback): Talkback {
  provide(TALKBACK_KEY, tb);
  return tb;
}

export function useTalkback(): Talkback {
  const tb = inject(TALKBACK_KEY, null);
  if (!tb) {
    throw new Error('no Talkback client in scope — call provideTalkback(createTalkback({…})) in a parent, or in a Nuxt plugin');
  }
  return tb;
}

export interface ChannelSubscription {
  /** The currently subscribed channel, or null while an argument is empty. */
  readonly channel: Ref<string | null>;
  /** Releases the subscription early. Called automatically on scope disposal. */
  stop(): void;
}

interface BaseOptions {
  /** One action, or several. Omit to receive every action on the channel. */
  on?: string | readonly string[];
  /** Called for each matching envelope. */
  handler?: EnvelopeListener;
  /** Every publication, envelope or not — this is how a `stream:` handle is read. */
  raw?: RawListener;
  /** The recovery buffer could not close the gap: refetch over HTTP. */
  onResync?: (ctx: ResyncContext) => void;
  /** Skip subscribing entirely, e.g. while a route parameter is still empty. */
  enabled?: MaybeRefOrGetter<boolean>;
  /**
   * The client to use, instead of the injected one.
   *
   * `provide`/`inject` needs a component instance, so it is unavailable in a plain
   * `effectScope` — which is what a test uses, and what some plugin setups end up with.
   * Passing the client explicitly is the supported way out; without it the only way to
   * test a composable would be to mount a component, and a lifecycle test that needs a
   * DOM is a lifecycle test people stop writing.
   */
  talkback?: Talkback;
}

/**
 * The shared machinery: work out the channel NAME from possibly-reactive arguments,
 * subscribe, and re-subscribe when the name changes. The old handle is released BEFORE
 * the new one is taken, so a route change swaps the channel instead of accumulating them.
 *
 * `resolveName` MUST BE PURE, and that is not a style note — it is the bug this shape
 * exists to prevent. Every method on the client registers a reference, so calling one
 * inside the watch source would take a handle on every re-evaluation and release none
 * of them; a test caught exactly that, with `enabled: false` still leaving a subscribed
 * channel behind.
 */
function useChannel(tb: Talkback, resolveName: () => string | null, options: BaseOptions): ChannelSubscription {
  const channel: Ref<string | null> = { value: null } as Ref<string | null>;
  let handle: TalkbackHandle | null = null;

  function attach(): void {
    const name = read(options.enabled ?? true) ? resolveName() : null;
    if (name === null) {
      channel.value = null;
      return;
    }

    const next = tb.channel(name);
    handle = next;
    channel.value = next.channel;

    if (options.raw) {
      next.listenAll(options.raw);
    }
    if (options.handler) {
      const actions = options.on === undefined ? [] : typeof options.on === 'string' ? [options.on] : [...options.on];
      if (actions.length === 0) {
        // No action named: every envelope. listenAny rather than listenAll, because
        // listenAll is a RAW hook that fires before deduplication — routing this through
        // it would deliver the contractual action/resource duplicate, which a test caught.
        next.listenAny(options.handler);
      } else {
        for (const action of actions) {
          next.listen(action, options.handler);
        }
      }
    }
    if (options.onResync) {
      next.onResync(options.onResync);
    }
  }

  function release(): void {
    handle?.leave();
    handle = null;
    channel.value = null;
  }

  attach();

  // Re-attaching on argument change is the whole reason the arguments may be refs.
  watch(
    () => {
      try {
        return read(options.enabled ?? true) ? resolveName() : null;
      } catch {
        // A half-typed route parameter can make the grammar reject the name. That is not
        // an error here — it is a channel that does not exist yet.
        return null;
      }
    },
    (next, previous) => {
      if (next === previous) {
        return;
      }
      release();
      attach();
    },
  );

  onScopeDispose(release);

  return { channel, stop: release };
}

/**
 * The ACTION channel for a topic — a grid watching every instance of a resource kind.
 *
 * ```ts
 * useTalkbackTopic('revenexx.integrations.run', {
 *   on: ['started', 'finished', 'failed'],
 *   handler: () => load(true),
 * })
 * ```
 */
export function useTalkbackTopic(topic: MaybeRefOrGetter<string>, options: BaseOptions = {}): ChannelSubscription {
  const tb = options.talkback ?? useTalkback();
  return useChannel(
    tb,
    () => {
      const value = read(topic);
      return value ? tenantActionChannel(tb.tenant, value).name : null;
    },
    options,
  );
}

/**
 * The RESOURCE channel — one detail view, every action on it.
 *
 * The id is ref-able because that is exactly what `RunDetailPanel.vue` changes today
 * with a hand-written watch: `useTalkbackResource(topic, () => props.run.id, …)`
 * replaces the watch, the `onUnmounted` and the two `setInterval`s.
 */
export function useTalkbackResource(topic: MaybeRefOrGetter<string>, topicId: MaybeRefOrGetter<string | null | undefined>, options: BaseOptions = {}): ChannelSubscription {
  const tb = options.talkback ?? useTalkback();
  return useChannel(
    tb,
    () => {
      const t = read(topic);
      const id = read(topicId);
      return t && id ? tenantResourceChannel(tb.tenant, t, id).name : null;
    },
    options,
  );
}

/** The signed-in user's channel — notifications and toasts. */
export function useTalkbackUser(options: BaseOptions = {}): ChannelSubscription {
  const tb = options.talkback ?? useTalkback();
  return useChannel(tb, () => userChannel(tb.tenant, tb.userId).name, options);
}

/** A `stream:` channel. Note that `onResync` fires on EVERY subscribe here. */
export function useTalkbackStream(streamId: MaybeRefOrGetter<string | null | undefined>, options: BaseOptions = {}): ChannelSubscription {
  const tb = options.talkback ?? useTalkback();
  return useChannel(
    tb,
    () => {
      const id = read(streamId);
      return id ? streamChannel(tb.tenant, id).name : null;
    },
    options,
  );
}

/** Who else is looking at this resource. */
export function useTalkbackPresence(
  vendor: MaybeRefOrGetter<string>,
  app: MaybeRefOrGetter<string>,
  entity: MaybeRefOrGetter<string>,
  id: MaybeRefOrGetter<string | null | undefined> = () => null,
  options: BaseOptions = {},
): ChannelSubscription {
  const tb = options.talkback ?? useTalkback();
  return useChannel(
    tb,
    () => {
      const v = read(vendor);
      const a = read(app);
      const e = read(entity);
      const resourceId = read(id);
      if (!v || !a || !e) {
        return null;
      }
      const base = resourceId ? tenantResourceChannel(tb.tenant, `${v}.${a}.${e}`, resourceId) : tenantChannel(tb.tenant, v, a, e);
      return presenceFor(base).name;
    },
    options,
  );
}
