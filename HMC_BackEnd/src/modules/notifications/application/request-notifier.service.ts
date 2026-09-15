import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  REQUEST_LOOKUP_PORT,
  RequestLookupPort,
  RequestParticipants,
} from '../domain/ports/request-lookup.port';
import { PushMessage } from '../domain/ports/push-sender.port';
import { NotificationsService } from './notifications.service';

/** What the workflow decided, as the decision endpoint reports it. */
export type DecisionOutcome = 'APPROVE' | 'REJECT';

export interface WorklistSubmission {
  username: string;
  startedAt: number;
  succeededAt: number;
}

interface WorklistJob {
  username: string;
  windowStart: Date;
  windowEnd: Date;
}

interface WorklistClaim {
  expiresAt: number;
  inFlight: boolean;
}

const WORKLIST_POLL_DELAYS_MS = [0, 2000, 5000, 10000, 20000, 30000];
const WORKLIST_WINDOW_MS = 120000;
const WORKLIST_WORKERS = 2;
const WORKLIST_QUEUE_LIMIT = 100;
const WORKLIST_CLAIM_LIMIT = 10000;
const WORKLIST_CLAIM_TTL_MS = 600000;

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
export class RequestNotifier implements OnModuleDestroy {
  private static readonly log = new Logger(RequestNotifier.name);
  private readonly worklistQueue: WorklistJob[] = [];
  private readonly worklistClaims = new Map<string, WorklistClaim>();
  private readonly worklistTimers = new Map<ReturnType<typeof setTimeout>, () => void>();
  private activeWorklistJobs = 0;
  private nextClaimCleanup = 0;
  private claimsFullWarned = false;
  private stopping = false;

  constructor(
    private readonly notifications: NotificationsService,
    @Inject(REQUEST_LOOKUP_PORT) private readonly requests: RequestLookupPort,
  ) {}

  async onWorklistSubmitted(event: WorklistSubmission): Promise<void> {
    if (this.stopping || !this.notifications.enabled) return;
    const username = event.username.trim().toUpperCase();
    if (
      !username ||
      !Number.isFinite(event.startedAt) ||
      !Number.isFinite(event.succeededAt) ||
      event.startedAt > event.succeededAt
    )
      return;
    const job = {
      username,
      windowStart: new Date(event.startedAt),
      windowEnd: new Date(event.succeededAt + WORKLIST_WINDOW_MS),
    };
    if (!this.worklistJobActive(job)) {
      RequestNotifier.log.warn('Expired worklist notification job skipped.');
      return;
    }
    if (this.worklistQueue.length >= WORKLIST_QUEUE_LIMIT) {
      RequestNotifier.log.warn(
        'Worklist notification queue is full; submission notification skipped.',
      );
      return;
    }
    this.worklistQueue.push(job);
    this.drainWorklist();
  }

  onModuleDestroy(): void {
    this.stopping = true;
    this.worklistQueue.length = 0;
    for (const cancel of this.worklistTimers.values()) cancel();
  }

  private drainWorklist(): void {
    while (
      !this.stopping &&
      this.activeWorklistJobs < WORKLIST_WORKERS &&
      this.worklistQueue.length
    ) {
      const job = this.worklistQueue.shift()!;
      if (!this.worklistJobActive(job)) {
        RequestNotifier.log.warn('Expired or disabled worklist notification job skipped.');
        continue;
      }
      this.activeWorklistJobs++;
      void this.pollWorklist(job)
        .catch(() => RequestNotifier.log.warn('Worklist notification job failed.'))
        .finally(() => {
          this.activeWorklistJobs--;
          this.drainWorklist();
        });
    }
  }

  private worklistJobActive(job: WorklistJob): boolean {
    return !this.stopping && this.notifications.enabled && Date.now() < job.windowEnd.getTime();
  }

  private async pollWorklist(job: WorklistJob): Promise<void> {
    for (const delay of WORKLIST_POLL_DELAYS_MS) {
      if (!this.worklistJobActive(job)) return;
      await this.waitForWorklist(Math.min(delay, job.windowEnd.getTime() - Date.now()));
      if (!this.worklistJobActive(job)) return;
      const rows = await this.requests
        .findWorklistNotifications(job.username, job.windowStart, job.windowEnd)
        .catch(() => {
          RequestNotifier.log.warn('Worklist notification lookup failed.');
          return undefined;
        });
      if (!this.worklistJobActive(job)) return;
      for (const row of rows ?? []) {
        if (!this.worklistJobActive(job)) return;
        const recipient = row.recipient.trim();
        if (!row.notificationId || !recipient || this.same(recipient, job.username)) continue;
        const claim = this.claimWorklistNotification(row.notificationId, recipient);
        if (!claim) continue;
        try {
          await this.notifications.notifyUser(recipient, {
            title: 'New request awaiting your approval',
            body: row.subject?.trim() ? row.subject : 'A request needs your action.',
            data: {
              event: 'APPROVAL_REQUIRED',
              notificationId: row.notificationId,
              ...(row.itemKey ? { itemKey: row.itemKey } : {}),
              ...(row.itemType ? { itemType: row.itemType } : {}),
            },
          });
        } catch {
          RequestNotifier.log.warn('Worklist notification dispatch failed.');
        } finally {
          claim.inFlight = false;
          claim.expiresAt = Date.now() + WORKLIST_CLAIM_TTL_MS;
        }
      }
    }
  }

  private waitForWorklist(delay: number): Promise<void> {
    if (this.stopping || delay <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.worklistTimers.delete(timer);
        resolve();
      };
      const timer = setTimeout(done, delay);
      timer.unref();
      this.worklistTimers.set(timer, done);
    });
  }

  private claimWorklistNotification(
    notificationId: string,
    recipient: string,
  ): WorklistClaim | undefined {
    const now = Date.now();
    if (now >= this.nextClaimCleanup) {
      for (const [key, claim] of this.worklistClaims) {
        if (!claim.inFlight && claim.expiresAt <= now) this.worklistClaims.delete(key);
      }
      this.nextClaimCleanup = now + 60000;
    }
    const key = JSON.stringify([notificationId, recipient.toUpperCase()]);
    const existing = this.worklistClaims.get(key);
    if (existing && (existing.inFlight || existing.expiresAt > now)) return undefined;
    this.worklistClaims.delete(key);
    if (this.worklistClaims.size >= WORKLIST_CLAIM_LIMIT) {
      if (!this.claimsFullWarned)
        RequestNotifier.log.warn('Worklist notification registry is full; dispatch skipped.');
      this.claimsFullWarned = true;
      return undefined;
    }
    this.claimsFullWarned = false;
    const claim = { expiresAt: now + WORKLIST_CLAIM_TTL_MS, inFlight: true };
    this.worklistClaims.set(key, claim);
    return claim;
  }

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
