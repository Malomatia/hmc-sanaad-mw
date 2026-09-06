/** Who to notify about a request, resolved to the login the tokens are keyed by. */
export interface RequestParticipants {
  /** Login of the person who submitted it. */
  requestor?: string;
  /** Login of the person it is waiting on. */
  approver?: string;
  /** Display label, e.g. `Return from Leave`. */
  requestType?: string;
  notificationId?: string;
}

/**
 * Reads just enough about a request to address a notification.
 *
 * Declared here rather than reusing the approvals repository so the dependency
 * points inward: this module says what it needs, and an adapter satisfies it.
 * Approvals would otherwise have to know that notifications exist, and a later
 * "notify on approval" inside approvals would close the cycle.
 *
 * Every method returns undefined rather than throwing. Not finding a request
 * means no notification — never a failed API call.
 */
export interface RequestLookupPort {
  /**
   * The caller's most recently submitted request.
   *
   * Used right after a submit succeeds, because the procedures return only
   * `successflag` — they do not say which notification the workflow created.
   * Best-effort by nature: Oracle's workflow writes that row asynchronously,
   * so it may not exist yet, in which case the approver simply is not
   * notified.
   */
  findLatestSubmission(username: string): Promise<RequestParticipants | undefined>;

  /** Participants of a known notification — used when a decision is taken. */
  findByNotificationId(notificationId: string): Promise<RequestParticipants | undefined>;
}

export const REQUEST_LOOKUP_PORT = Symbol('REQUEST_LOOKUP_PORT');
