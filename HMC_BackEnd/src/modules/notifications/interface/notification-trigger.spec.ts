import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { NotificationTriggerInterceptor } from './notification-trigger.interceptor';
import { RequestNotifier } from '../application/request-notifier.service';

/**
 * This interceptor sits on EVERY POST in the API, so its failure mode matters
 * more than its feature: a notification must never delay a response, change
 * one, or fail a request that already succeeded.
 *
 * It also has to read business success rather than HTTP success — the Sanaad
 * convention returns 200 with the real outcome in `successflag`, so a rejected
 * submit must not announce itself as a new request.
 */
describe('NotificationTriggerInterceptor', () => {
  function make() {
    const notifier = {
      onSubmitted: jest.fn().mockResolvedValue(undefined),
      onDecided: jest.fn().mockResolvedValue(undefined),
      onReassigned: jest.fn().mockResolvedValue(undefined),
      onRequestInfo: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RequestNotifier>;
    return { interceptor: new NotificationTriggerInterceptor(notifier), notifier };
  }

  function context(
    method: string,
    url: string,
    body: Record<string, unknown> = {},
    username = 'AIBRAHIM39',
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ method, url, body, user: username ? { username } : undefined }),
      }),
    } as unknown as ExecutionContext;
  }

  const handler = (response: unknown): CallHandler => ({ handle: () => of(response) });

  /** The dispatch is fire-and-forget; let the microtask queue drain. */
  const settle = () => new Promise((r) => setImmediate(r));

  it('notifies on a submit that actually succeeded', async () => {
    const { interceptor, notifier } = make();

    await firstValueFrom(
      interceptor.intercept(context('POST', '/api/v1/leave/apply'), handler({ successflag: 'S' })),
    );
    await settle();

    expect(notifier.onSubmitted).toHaveBeenCalledWith('AIBRAHIM39');
  });

  it('stays silent when the business result was a rejection', async () => {
    const { interceptor, notifier } = make();

    await firstValueFrom(
      interceptor.intercept(
        context('POST', '/api/v1/leave/apply'),
        handler({ successflag: 'N', message: 'A request is pending.' }),
      ),
    );
    await settle();

    expect(notifier.onSubmitted).not.toHaveBeenCalled();
  });

  it('ignores a POST that is really a read', async () => {
    const { interceptor, notifier } = make();

    await firstValueFrom(
      interceptor.intercept(context('POST', '/api/v1/diagnostics/oracle/sql'), handler({ rows: [] })),
    );
    await settle();

    expect(notifier.onSubmitted).not.toHaveBeenCalled();
  });

  it('routes an approval decision to the requestor path, with its notification id', async () => {
    const { interceptor, notifier } = make();

    await firstValueFrom(
      interceptor.intercept(
        context('POST', '/api/v1/approvals/123859449/decision?lang=en', { decision: 'APPROVE' }),
        handler({ successflag: 'S' }),
      ),
    );
    await settle();

    expect(notifier.onDecided).toHaveBeenCalledWith('123859449', 'APPROVE', 'AIBRAHIM39');
    expect(notifier.onSubmitted).not.toHaveBeenCalled();
  });

  it('routes a rejection decision to the requestor path', async () => {
    const { interceptor, notifier } = make();

    await firstValueFrom(
      interceptor.intercept(
        context('POST', '/api/v1/approvals/123859449/decision?lang=en', { decision: 'REJECT' }),
        handler({ successflag: 'S' }),
      ),
    );
    await settle();

    expect(notifier.onDecided).toHaveBeenCalledWith('123859449', 'REJECT', 'AIBRAHIM39');
    expect(notifier.onSubmitted).not.toHaveBeenCalled();
  });

  it('ignores a decision whose outcome it does not recognise', async () => {
    const { interceptor, notifier } = make();

    await firstValueFrom(
      interceptor.intercept(
        context('POST', '/api/v1/approvals/1/decision', { decision: 'SOMETHING' }),
        handler({ successflag: 'S' }),
      ),
    );
    await settle();

    expect(notifier.onDecided).not.toHaveBeenCalled();
  });

  it('routes a reassignment to the new approver path', async () => {
    const { interceptor, notifier } = make();

    await firstValueFrom(
      interceptor.intercept(
        context('POST', '/api/v1/approvals/123/reassign', { assignTo: 'V-NFERNANDO' }),
        handler({ successflag: 'S' }),
      ),
    );
    await settle();

    expect(notifier.onReassigned).toHaveBeenCalledWith('123', 'V-NFERNANDO', 'AIBRAHIM39');
    expect(notifier.onSubmitted).not.toHaveBeenCalled();
  });

  it('routes a request-info action to the target user path', async () => {
    const { interceptor, notifier } = make();

    await firstValueFrom(
      interceptor.intercept(
        context('POST', '/api/v1/approvals/123/request-info', {
          toUsername: 'V-NFERNANDO',
          comment: 'Please attach documents.',
        }),
        handler({ successflag: 'S' }),
      ),
    );
    await settle();

    expect(notifier.onRequestInfo).toHaveBeenCalledWith(
      '123',
      'V-NFERNANDO',
      'AIBRAHIM39',
      'Please attach documents.',
    );
    expect(notifier.onSubmitted).not.toHaveBeenCalled();
  });

  it('does nothing on GET', async () => {
    const { interceptor, notifier } = make();

    await firstValueFrom(
      interceptor.intercept(context('GET', '/api/v1/leave/apply'), handler({ successflag: 'S' })),
    );
    await settle();

    expect(notifier.onSubmitted).not.toHaveBeenCalled();
  });

  it('does nothing for an unauthenticated request', async () => {
    const { interceptor, notifier } = make();

    await firstValueFrom(
      interceptor.intercept(
        context('POST', '/api/v1/leave/apply', {}, ''),
        handler({ successflag: 'S' }),
      ),
    );
    await settle();

    expect(notifier.onSubmitted).not.toHaveBeenCalled();
  });

  describe('never affects the API', () => {
    it('returns the response untouched', async () => {
      const { interceptor } = make();
      const response = { successflag: 'S', message: 'Success' };

      const result = await firstValueFrom(
        interceptor.intercept(context('POST', '/api/v1/leave/apply'), handler(response)),
      );

      expect(result).toBe(response);
    });

    it('does not make the caller wait for the notification', async () => {
      const notifier = {
        onSubmitted: jest.fn(() => new Promise<void>(() => undefined)), // never resolves
        onDecided: jest.fn(),
      } as unknown as RequestNotifier;

      await expect(
        firstValueFrom(
          new NotificationTriggerInterceptor(notifier).intercept(
            context('POST', '/api/v1/leave/apply'),
            handler({ successflag: 'S' }),
          ),
        ),
      ).resolves.toEqual({ successflag: 'S' });
    });

    it('survives a notifier that rejects', async () => {
      const notifier = {
        onSubmitted: jest.fn().mockRejectedValue(new Error('boom')),
        onDecided: jest.fn(),
      } as unknown as RequestNotifier;

      await expect(
        firstValueFrom(
          new NotificationTriggerInterceptor(notifier).intercept(
            context('POST', '/api/v1/leave/apply'),
            handler({ successflag: 'S' }),
          ),
        ),
      ).resolves.toBeDefined();
      await settle();
    });

    it('leaves a failing request failing, and notifies nobody', async () => {
      const { interceptor, notifier } = make();
      const failing: CallHandler = { handle: () => throwError(() => new Error('Oracle down')) };

      await expect(
        firstValueFrom(interceptor.intercept(context('POST', '/api/v1/leave/apply'), failing)),
      ).rejects.toThrow('Oracle down');
      await settle();

      expect(notifier.onSubmitted).not.toHaveBeenCalled();
    });
  });
});
