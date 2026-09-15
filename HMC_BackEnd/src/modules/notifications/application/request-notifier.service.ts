import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  REQUEST_LOOKUP_PORT,
  RequestLookupPort,
  RequestParticipants,
} from '../domain/ports/request-lookup.port';
import { PushMessage } from '../domain/ports/push-sender.port';
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
 * **Nothing in this class may fail a request.** Participants are captured before
 * the action; notifications are sent only after it succeeds — a lost
 * notification is a nuisance, a failed submit is a fault.
 */
@Injectable()
export class RequestNotifier {
  private static readonly log = new Logger(RequestNotifier.name);

  constructor(
    private readonly notifications: NotificationsService,
    @Inject(REQUEST_LOOKUP_PORT) private readonly requests: RequestLookupPort,
  ) {}

  async captureRequest(notificationId: string): Promise<RequestParticipants> {
    return {
      ...(await this.safely('captureRequest', () =>
        this.requests.findByNotificationId(notificationId),
      )),
    };
  }

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
  async onDecided(
    notificationId: string,
    outcome: DecisionOutcome,
    actor: string,
    snapshot?: RequestParticipants,
  ): Promise<void> {
    await this.safely('onDecided', async () => {
      const request = snapshot ?? (await this.captureRequest(notificationId));
      const approved = outcome === 'APPROVE';
      const subject = request.requestType ?? 'Your request';
      await this.notifyRecipients(actor, [
        {
          username: request.requestor,
          message: {
            title: approved ? 'Request approved' : 'Request rejected',
            body: approved ? `${subject} has been approved.` : `${subject} has been rejected.`,
            data: this.payload(notificationId, request.requestType, outcome),
          },
        },
      ]);
    });
  }

  /** A request was reassigned — tell the new approver and original requestor. */
  async onReassigned(
    notificationId: string,
    assignTo: string,
    actor: string,
    snapshot?: RequestParticipants,
  ): Promise<void> {
    await this.safely('onReassigned', async () => {
      const request = snapshot ?? (await this.captureRequest(notificationId));
      const data = this.payload(notificationId, request.requestType, 'REASSIGNED');
      await this.notifyRecipients(actor, [
        {
          username: assignTo,
          message: {
            title: 'Request reassigned to you',
            body: `${request.requestType ?? 'A request'} has been reassigned to you.`,
            data,
          },
        },
        {
          username: request.requestor,
          message: {
            title: 'Request reassigned',
            body: `${request.requestType ?? 'Your request'} has been reassigned.`,
            data,
          },
        },
      ]);
    });
  }

  /** More information was requested — tell the target and original requestor. */
  async onRequestInfo(
    notificationId: string,
    toUsername: string | undefined,
    actor: string,
    comment?: string,
    snapshot?: RequestParticipants,
  ): Promise<void> {
    await this.safely('onRequestInfo', async () => {
      const request = snapshot ?? (await this.captureRequest(notificationId));
      const subject = request.requestType ?? 'Your request';
      const body = comment?.trim()
        ? `${subject} needs more information: ${comment.trim()}`
        : `${subject} needs more information.`;
      const message = {
        title: 'More information requested',
        body,
        data: this.payload(notificationId, request.requestType, 'INFO_REQUESTED'),
      };
      await this.notifyRecipients(actor, [
        { username: toUsername, message },
        { username: request.requestor, message },
      ]);
    });
  }

  private async notifyRecipients(
    actor: string,
    recipients: readonly { username?: string; message: PushMessage }[],
  ): Promise<void> {
    const seen = new Set<string>();
    await Promise.all(
      recipients.map(async ({ username, message }) => {
        const login = username?.trim();
        if (!login || this.same(login, actor) || seen.has(login.toUpperCase())) return;
        seen.add(login.toUpperCase());
        await this.notifications.notifyUser(login, message);
      }),
    );
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

  private async safely<T>(operation: string, work: () => Promise<T>): Promise<T | undefined> {
    try {
      return await work();
    } catch (err) {
      RequestNotifier.log.warn(`Notification (${operation}) failed: ${(err as Error).message}`);
    }
  }
}
