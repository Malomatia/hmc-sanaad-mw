import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { DecisionOutcome, RequestNotifier } from '../application/request-notifier.service';

/** `POST /approvals/123859449/decision` → the notification id. */
const DECISION_ROUTE = /\/approvals\/([^/?]+)\/decision/i;

/** Routes that submit something for approval but are not themselves approvals. */
const SUBMIT_ROUTE = /\/(apply|cancel|return|amend|personal|create|update|add|delete|reassign|request-info)\b/i;

/**
 * Fires a notification after a request succeeds.
 *
 * An interceptor rather than a call inside each feature: submits live in ten
 * modules, and adding a notify line to every one of them would spread the same
 * concern across the codebase and guarantee the eleventh gets forgotten. Here
 * the rule is stated once.
 *
 * Two hard rules, because a notification must never affect the API:
 *
 *  - it runs AFTER the response has been produced, and the work is not
 *    awaited — the caller never waits for FCM or for an Oracle lookup;
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
  constructor(private readonly notifier: RequestNotifier) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      method: string;
      url?: string;
      body?: Record<string, unknown>;
      user?: AuthenticatedUser;
    }>();

    if (req.method !== 'POST') return next.handle();

    return next.handle().pipe(
      tap((body) => {
        if (!this.succeeded(body)) return;
        void this.dispatch(req).catch(() => undefined);
      }),
    );
  }

  /** Business success, not HTTP success. */
  private succeeded(body: unknown): boolean {
    const flag = (body as { successflag?: unknown } | undefined)?.successflag;
    // Reads that happen to POST carry no flag; those are not submissions.
    return typeof flag === 'string' && flag.toUpperCase() === 'S';
  }

  private async dispatch(req: {
    url?: string;
    body?: Record<string, unknown>;
    user?: AuthenticatedUser;
  }): Promise<void> {
    const url = req.url ?? '';
    const username = req.user?.username;
    if (!username) return;

    const decision = DECISION_ROUTE.exec(url);
    if (decision) {
      const outcome = String(req.body?.action ?? req.body?.p_result ?? '').toUpperCase();
      if (outcome === 'APPROVE' || outcome === 'REJECT') {
        await this.notifier.onDecided(decision[1], outcome as DecisionOutcome, username);
      }
      return;
    }

    if (SUBMIT_ROUTE.test(url)) await this.notifier.onSubmitted(username);
  }
}
