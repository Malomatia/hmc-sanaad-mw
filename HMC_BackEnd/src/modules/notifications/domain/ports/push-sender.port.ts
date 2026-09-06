/** What the device shows and what the app routes on. */
export interface PushMessage {
  title: string;
  body: string;
  /**
   * Data payload — string values only, FCM rejects anything else. Carries the
   * notification id and request type so tapping the notification can open the
   * right screen.
   */
  data?: Record<string, string>;
}

/** Outcome of one send, per token, so dead registrations can be pruned. */
export interface PushResult {
  sent: number;
  failed: number;
  /**
   * Tokens FCM says will never work again (`UNREGISTERED`,
   * `INVALID_ARGUMENT`) — distinct from a transient failure, which must NOT
   * cost the user their registration.
   */
  invalidTokens: string[];
}

/**
 * Delivery of a push message.
 *
 * A port so that FCM is one implementation rather than an assumption: the
 * no-op binds when no credential is configured, and the guide's alternative
 * (Azure Service Bus) could be another without touching a caller.
 */
export interface PushSenderPort {
  send(tokens: readonly string[], message: PushMessage): Promise<PushResult>;
  /** Whether a real transport is behind this port. */
  readonly enabled: boolean;
}

export const PUSH_SENDER_PORT = Symbol('PUSH_SENDER_PORT');
