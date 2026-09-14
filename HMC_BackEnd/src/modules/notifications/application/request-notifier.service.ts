import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  REQUEST_LOOKUP_PORT,
  RequestLookupPort,
} from '../domain/ports/request-lookup.port';
import { NotificationsService } from './notifications.service';

/** What the workflow decided, as the decision endpoint reports it. */
export type DecisionOutcome = 'APPROVE' | 'REJECT';

/**
 * Turns a business event into a notification for the right person.
 *
 * Split from `NotificationsService` on purpose: that one knows about devices
 * and delivery, this one knows who cares about a request. Wording lives here
 * too, so changing a message never touches transport code.
 *
 * **Nothing in this class may fail a request.** Every entry point is called
 * after the business action has already succeeded and returns void — a lost
 * notification is a nuisance, a failed submit is a fault.
 */
@Injectable()
export class RequestNotifier {
  private static readonly log = new Logger(RequestNotifier.name);

  constructor(
    private readonly notifications: NotificationsService,
    @Inject(REQUEST_LOOKUP_PORT) private readonly requests: RequestLookupPort,
  ) {}

  /**
   * A request was submitted — tell whoever has to act on it.
   *
   * Best-effort by nature: the submit procedures return only `successflag`, so
   * the new request is found by reading the submitter's newest row, and
   * Oracle's workflow writes that row asynchronously. When it is not there yet
   * nobody is notified; the approver still sees it in their worklist.
   */
  async onSubmitted(username: string): Promise<void> {
    await this.safely('onSubmitted', async () => {
      const request = await this.requests.findLatestSubmission(username);
      if (!request?.approver) return;
      // Do not notify someone about their own action.
      if (this.same(request.approver, username)) return;

      await this.notifications.notifyUser(request.approver, {
        title: 'New request awaiting your approval',
        body: request.requestType
          ? `A ${request.requestType} request needs your action.`
          : 'A request needs your action.',
        data: this.payload(request.notificationId, request.requestType, 'APPROVAL_REQUIRED'),
      });
    });
  }

  /** A decision was taken — tell the person who submitted the request. */
  async onDecided(notificationId: string, outcome: DecisionOutcome, actor: string): Promise<void> {
    await this.safely('onDecided', async () => {
      const request = await this.requests.findByNotificationId(notificationId);
      if (!request?.requestor) return;
      if (this.same(request.requestor, actor)) return;

      const approved = outcome === 'APPROVE';
      const subject = request.requestType ?? 'Your request';
      await this.notifications.notifyUser(request.requestor, {
        title: approved ? 'Request approved' : 'Request rejected',
        body: approved ? `${subject} has been approved.` : `${subject} has been rejected.`,
        data: this.payload(notificationId, request.requestType, outcome),
      });
    });
  }

  /** A request was reassigned — tell the new approver. */
  async onReassigned(notificationId: string, assignTo: string, actor: string): Promise<void> {
    await this.safely('onReassigned', async () => {
      const target = assignTo?.trim();
      if (!target) return;
      if (this.same(target, actor)) return;

      const request = await this.requests.findByNotificationId(notificationId);
      const subject = request?.requestType ?? 'A request';
      await this.notifications.notifyUser(target, {
        title: 'Request reassigned to you',
        body: `${subject} has been reassigned to you.`,
        data: this.payload(notificationId, request?.requestType, 'REASSIGNED'),
      });
    });
  }

  /** More information was requested — tell the person it is directed to. */
  async onRequestInfo(
    notificationId: string,
    toUsername: string | undefined,
    actor: string,
    comment?: string,
  ): Promise<void> {
    await this.safely('onRequestInfo', async () => {
      const request = await this.requests.findByNotificationId(notificationId);
      const target = (toUsername?.trim() || request?.requestor)?.trim();
      if (!target) return;
      if (this.same(target, actor)) return;

      const subject = request?.requestType ?? 'Your request';
      const body = comment?.trim()
        ? `${subject} needs more information: ${comment.trim()}`
        : `${subject} needs more information.`;
      await this.notifications.notifyUser(target, {
        title: 'More information requested',
        body,
        data: this.payload(notificationId, request?.requestType, 'INFO_REQUESTED'),
      });
    });
  }

  /** FCM data values must be strings, and absent keys must not become "undefined". */
  private payload(
    notificationId?: string,
    requestType?: string,
    event?: string,
  ): Record<string, string> {
    return {
      ...(notificationId ? { notificationId } : {}),
      ...(requestType ? { requestType } : {}),
      ...(event ? { event } : {}),
    };
  }

  private same(a?: string, b?: string): boolean {
    return !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase();
  }

  private async safely(operation: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (err) {
      RequestNotifier.log.warn(`Notification (${operation}) failed: ${(err as Error).message}`);
    }
  }
}
