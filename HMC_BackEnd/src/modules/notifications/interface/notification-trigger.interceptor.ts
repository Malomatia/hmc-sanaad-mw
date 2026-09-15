import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { catchError, defer, Observable, of, switchMap, tap, timeout } from 'rxjs';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { DecisionOutcome, RequestNotifier } from '../application/request-notifier.service';
import { RequestParticipants } from '../domain/ports/request-lookup.port';
import { DECORATORS } from '@nestjs/swagger';

const WORKLIST_SUBMIT_OPERATIONS = new Set([
  'profile_updatePersonal',
  'employee_supervisorUpdate',
  'leave_apply',
  'leave_amend',
  'leave_cancel',
  'leave_return',
  'identity_qidUpdate',
  'identity_idCardApply',
  'dependents_add',
  'dependents_update',
  'dependents_delete',
  'dependents_passportApply',
  'schoolFees_apply',
]);

/** `POST /approvals/123859449/decision` → the notification id. */
const DECISION_ROUTE = /\/approvals\/([^/?]+)\/decision/i;

/** `POST /approvals/123859449/reassign` → the notification id. */
const REASSIGN_ROUTE = /\/approvals\/([^/?]+)\/reassign/i;

/** `POST /approvals/123859449/request-info` → the notification id. */
const REQUEST_INFO_ROUTE = /\/approvals\/([^/?]+)\/request-info/i;

/** Routes that submit something for approval but are not themselves approvals. */
const SUBMIT_ROUTE = /\/(apply|cancel|return|amend|personal|create|update|add|delete)\b/i;

/**
 * Fires a notification after a request succeeds.
 *
 * An interceptor rather than a call inside each feature: submits live in ten
 * modules, and adding a notify line to every one of them would spread the same
 * concern across the codebase and guarantee the eleventh gets forgotten. Here
 * the rule is stated once.
 *
 * Two hard rules, because a notification must never fail the API:
 *
 *  - delivery runs AFTER success and is not awaited; approval participants
 *    are captured beforehand with a bounded lookup, before workflow changes;
 *  - a rejected promise is swallowed. `RequestNotifier` already guards itself;
 *    the catch here is the second line of defence against an unhandled
 *    rejection taking the process down.
 *
 * Only successful business outcomes notify: the Sanaad convention puts the
 * real result in `successflag`, so an HTTP 200 carrying `N` is a rejection and
 * must not announce itself as a new request.
 */
@Injectable()
export class NotificationTriggerInterceptor implements NestInterceptor {
  private static readonly log = new Logger(NotificationTriggerInterceptor.name);
  private static readonly LOOKUP_TIMEOUT_MS = 2000;

  constructor(private readonly notifier: RequestNotifier) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      method: string;
      url?: string;
      body?: Record<string, unknown>;
      user?: AuthenticatedUser;
    }>();

    if (req.method !== 'POST') return next.handle();

    const operation = Reflect.getMetadata(DECORATORS.API_OPERATION, context.getHandler()) as
      { operationId?: string } | undefined;
    if (WORKLIST_SUBMIT_OPERATIONS.has(operation?.operationId ?? '')) {
      const startedAt = Date.now();
      const username = req.user?.username;
      return next.handle().pipe(
        tap((body) => {
          if (!username || !this.succeeded(body)) return;
          void this.notifier
            .onWorklistSubmitted({ username, startedAt, succeededAt: Date.now() })
            .catch(() => undefined);
        }),
      );
    }

    const proceed = (snapshot?: RequestParticipants) =>
      next.handle().pipe(
        tap((body) => {
          if (!this.succeeded(body)) return;
          void this.dispatch(req, snapshot).catch(() => undefined);
        }),
      );
    const url = req.url ?? '';
    const action =
      DECISION_ROUTE.exec(url) ?? REASSIGN_ROUTE.exec(url) ?? REQUEST_INFO_ROUTE.exec(url);
    if (!action || !req.user?.username) return proceed();

    return defer(() => this.notifier.captureRequest(action[1])).pipe(
      timeout(NotificationTriggerInterceptor.LOOKUP_TIMEOUT_MS),
      catchError(() => {
        NotificationTriggerInterceptor.log.warn(
          'Notification context lookup failed or timed out; continuing the action.',
        );
        return of({} as RequestParticipants);
      }),
      switchMap((snapshot) => proceed(snapshot)),
    );
  }

  /** Business success, not HTTP success. */
  private succeeded(body: unknown): boolean {
    const flag = (body as { successflag?: unknown } | undefined)?.successflag;
    // Reads that happen to POST carry no flag; those are not submissions.
    return typeof flag === 'string' && flag.toUpperCase() === 'S';
  }

  private async dispatch(
    req: {
      url?: string;
      body?: Record<string, unknown>;
      user?: AuthenticatedUser;
    },
    snapshot?: RequestParticipants,
  ): Promise<void> {
    const url = req.url ?? '';
    const username = req.user?.username;
    if (!username) return;

    const decision = DECISION_ROUTE.exec(url);
    if (decision) {
      const outcome = String(req.body?.decision ?? req.body?.p_result ?? '').toUpperCase();
      if (outcome === 'APPROVE' || outcome === 'REJECT') {
        await this.notifier.onDecided(decision[1], outcome as DecisionOutcome, username, snapshot);
      }
      return;
    }

    const reassign = REASSIGN_ROUTE.exec(url);
    if (reassign) {
      await this.notifier.onReassigned(
        reassign[1],
        String(req.body?.assignTo ?? ''),
        username,
        snapshot,
      );
      return;
    }

    const requestInfo = REQUEST_INFO_ROUTE.exec(url);
    if (requestInfo) {
      await this.notifier.onRequestInfo(
        requestInfo[1],
        req.body?.toUsername as string | undefined,
        username,
        req.body?.comment as string | undefined,
        snapshot,
      );
      return;
    }

    if (SUBMIT_ROUTE.test(url)) await this.notifier.onSubmitted(username);
  }
}
