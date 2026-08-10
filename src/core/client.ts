/**
 * The seam between the core and `centrifuge`.
 *
 * It exists so a consumer can test its realtime paths without Centrifugo, and it is
 * narrow ON PURPOSE: exactly the surface `createTalkback` uses and nothing more. A wider
 * one would let a fake diverge from the real client in ways a test cannot see, which is
 * the failure mode a fake transport is supposed to remove rather than add.
 *
 * `centrifuge`'s own types satisfy this structurally, so the real client needs no
 * adapter — `createTalkback` passes it straight through.
 */

export interface PublicationLike {
  channel: string;
  data: unknown;
}

export interface SubscribedLike {
  channel: string;
  recoverable: boolean;
  positioned: boolean;
  wasRecovering: boolean;
  recovered: boolean;
}

export interface SubscriptionErrorLike {
  type: string;
  error?: { code?: number; message?: string };
}

export interface SubscriptionLike {
  on(event: 'publication', listener: (ctx: { data: unknown }) => void): unknown;
  on(event: 'subscribed', listener: (ctx: SubscribedLike) => void): unknown;
  on(event: 'error', listener: (ctx: SubscriptionErrorLike) => void): unknown;
  subscribe(): void;
  unsubscribe(): void;
}

export interface SubscriptionOptionsLike {
  getToken: () => Promise<string>;
}

export interface ClientLike {
  on(event: 'publication', listener: (ctx: PublicationLike) => void): unknown;
  on(event: 'subscribed', listener: (ctx: SubscribedLike) => void): unknown;
  newSubscription(channel: string, options: SubscriptionOptionsLike): SubscriptionLike;
  removeSubscription(sub: SubscriptionLike): void;
  connect(): void;
  disconnect(): void;
}
