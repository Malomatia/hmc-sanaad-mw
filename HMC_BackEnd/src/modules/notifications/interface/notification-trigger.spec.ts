import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { NotificationTriggerInterceptor } from './notification-trigger.interceptor';
import { RequestNotifier } from '../application/request-notifier.service';
import { NotificationsService } from '../application/notifications.service';
import { MssqlService } from '@core/database/mssql.service';
import { MssqlDeviceTokenRepository } from '../infrastructure/adapters/mssql-device-token.repository';
import { PushSenderPort } from '../domain/ports/push-sender.port';
import { RequestLookupPort } from '../domain/ports/request-lookup.port';
import { DECORATORS } from '@nestjs/swagger';
import { ProfileController } from '@modules/profile/interface/profile.controller';
import { EmployeeController } from '@modules/employee/interface/employee.controller';
import { LeaveController } from '@modules/leave/interface/leave.controller';
import { IdentityController } from '@modules/identity/interface/identity.controller';
import { DependentsController } from '@modules/dependents/interface/dependents.controller';
import { SchoolFeesController } from '@modules/school-fees/interface/school-fees.controller';

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
    const worklist = jest.fn().mockResolvedValue(undefined);
    const notifier = {
      onWorklistSubmitted: worklist,
      captureRequest: jest.fn().mockResolvedValue({}),
      onSubmitted: jest.fn().mockResolvedValue(undefined),
      onDecided: jest.fn().mockResolvedValue(undefined),
      onReassigned: jest.fn().mockResolvedValue(undefined),
      onRequestInfo: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RequestNotifier>;
    return { interceptor: new NotificationTriggerInterceptor(notifier), notifier, worklist };
  }

  function context(
    method: string,
    url: string,
    body: Record<string, unknown> = {},
    username = 'AIBRAHIM39',
    httpHandler: object = () => undefined,
    employeeName?: string,
  ): ExecutionContext {
    return {
      getHandler: () => httpHandler,
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          url,
          body,
          user: username ? { username, employeeName } : undefined,
        }),
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
      interceptor.intercept(
        context('POST', '/api/v1/diagnostics/oracle/sql'),
        handler({ rows: [] }),
      ),
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

    expect(notifier.onDecided).toHaveBeenCalledWith(
      '123859449',
      'APPROVE',
      'AIBRAHIM39',
      {},
      undefined,
    );
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

    expect(notifier.onDecided).toHaveBeenCalledWith(
      '123859449',
      'REJECT',
      'AIBRAHIM39',
      {},
      undefined,
    );
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

    expect(notifier.onReassigned).toHaveBeenCalledWith(
      '123',
      'V-NFERNANDO',
      'AIBRAHIM39',
      {},
      undefined,
    );
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
      'QUESTION',
      {},
      undefined,
    );
    expect(notifier.onSubmitted).not.toHaveBeenCalled();
  });

  it.each([
    ['decision', { decision: 'APPROVE' }],
    ['decision', { decision: 'REJECT' }],
    ['reassign', { assignTo: 'TARGET' }],
    ['request-info', { toUsername: 'TARGET', comment: 'Details', mode: 'ANSWER' }],
  ])('passes the signed actor name for %s, never a body-supplied name', async (route, body) => {
    const { interceptor, notifier } = make();
    await firstValueFrom(
      interceptor.intercept(
        context(
          'POST',
          `/api/v1/approvals/123/${route}`,
          { ...body, approverName: 'Forged', requesterName: 'Forged' },
          'ACTOR',
          undefined,
          'Signed Actor Name',
        ),
        handler({ successflag: 'S' }),
      ),
    );
    await settle();
    const calls = [
      ...notifier.onDecided.mock.calls,
      ...notifier.onReassigned.mock.calls,
      ...notifier.onRequestInfo.mock.calls,
    ];
    expect(calls).toHaveLength(1);
    expect(calls[0][calls[0].length - 1]).toBe('Signed Actor Name');
    expect(JSON.stringify(calls)).not.toContain('Forged');
  });

  it.each(['QUESTION', 'ANSWER', undefined, null])(
    'forwards request-info mode %s using the controller default',
    async (mode) => {
      const { interceptor, notifier } = make();
      await firstValueFrom(
        interceptor.intercept(
          context(
            'POST',
            '/api/v1/approvals/123/request-info',
            { mode, toUsername: 'TARGET', comment: 'Private details' },
            'ACTOR',
            undefined,
            'Actor Name',
          ),
          handler({ successflag: 'S' }),
        ),
      );
      await settle();
      expect(notifier.onRequestInfo).toHaveBeenCalledWith(
        '123',
        'TARGET',
        'ACTOR',
        mode ?? 'QUESTION',
        {},
        'Actor Name',
      );
      expect(JSON.stringify(notifier.onRequestInfo.mock.calls)).not.toContain('Private details');
    },
  );

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

  describe('selected worklist submissions', () => {
    const operations = [
      ['profile/personal', 'profile_updatePersonal', ProfileController.prototype.updatePersonal],
      [
        'employee/supervisor',
        'employee_supervisorUpdate',
        EmployeeController.prototype.supervisorUpdate,
      ],
      ['leave/apply', 'leave_apply', LeaveController.prototype.apply],
      ['leave/amend', 'leave_amend', LeaveController.prototype.amend],
      ['leave/cancel', 'leave_cancel', LeaveController.prototype.cancel],
      ['leave/return', 'leave_return', LeaveController.prototype.returnFromLeave],
      ['identity/qid/update', 'identity_qidUpdate', IdentityController.prototype.updateQid],
      [
        'identity/idcard/apply',
        'identity_idCardApply',
        IdentityController.prototype.requestCompanyId,
      ],
      ['dependents', 'dependents_add', DependentsController.prototype.add],
      ['dependents/update', 'dependents_update', DependentsController.prototype.update],
      ['dependents/delete', 'dependents_delete', DependentsController.prototype.delete],
      [
        'dependents/passport/apply',
        'dependents_passportApply',
        DependentsController.prototype.passportApply,
      ],
      ['school-fees/apply', 'schoolFees_apply', SchoolFeesController.prototype.apply],
    ] as const;

    it.each(operations)(
      'uses the real %s handler metadata and never the legacy submit path',
      async (path, operationId, httpHandler) => {
        const { interceptor, notifier, worklist } = make();
        expect(Reflect.getMetadata(DECORATORS.API_OPERATION, httpHandler).operationId).toBe(
          operationId,
        );
        let now = 1000000;
        const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
        const response = { successflag: 'S', status: 'success', result: { leaveDays: 3 } };
        try {
          const result = await firstValueFrom(
            interceptor.intercept(
              context(
                'POST',
                `/custom/prefix/${path}?username=SPOOF`,
                { username: 'SPOOF', requesterName: 'Forged name', p_attachment1: 'attachment' },
                'ACTOR',
                httpHandler,
                'Signed Actor Name',
              ),
              {
                handle: () => {
                  now += 500;
                  return of(response);
                },
              },
            ),
          );
          await settle();

          expect(result).toBe(response);
          expect(worklist).toHaveBeenCalledTimes(1);
          expect(worklist).toHaveBeenCalledWith({
            username: 'ACTOR',
            requesterName: 'Signed Actor Name',
            startedAt: 1000000,
            succeededAt: 1000500,
          });
          expect(notifier.onSubmitted).not.toHaveBeenCalled();
          expect(notifier.captureRequest).not.toHaveBeenCalled();
        } finally {
          clock.mockRestore();
        }
      },
    );

    it.each([
      ['GET', { successflag: 'S' }, 'ACTOR'],
      ['POST', { successflag: 'N' }, 'ACTOR'],
      ['POST', {}, 'ACTOR'],
      ['POST', { successflag: true }, 'ACTOR'],
      ['POST', { successflag: 'S' }, ''],
    ])('does not enqueue for %s with %j and caller %s', async (method, response, username) => {
      const { interceptor, notifier, worklist } = make();
      await firstValueFrom(
        interceptor.intercept(
          context(
            method as string,
            '/api/v1/employee/supervisor',
            {},
            username as string,
            EmployeeController.prototype.supervisorUpdate,
          ),
          handler(response),
        ),
      );
      await settle();
      expect(worklist).not.toHaveBeenCalled();
      expect(notifier.onSubmitted).not.toHaveBeenCalled();
    });

    it.each(['letters/apply', 'read?path=/apply', 'dependents/fake/update'])(
      'does not activate the worklist path from URL text %s',
      async (path) => {
        const { interceptor, worklist } = make();
        await firstValueFrom(
          interceptor.intercept(context('POST', `/api/v1/${path}`), handler({ successflag: 'S' })),
        );
        await settle();
        expect(worklist).not.toHaveBeenCalled();
      },
    );

    it('does not wait for a worklist job or change errors from the business handler', async () => {
      const { interceptor, worklist } = make();
      worklist.mockImplementation(() => new Promise(() => undefined));
      const ctx = context(
        'POST',
        '/api/v1/leave/apply',
        {},
        'ACTOR',
        LeaveController.prototype.apply,
      );
      await expect(
        firstValueFrom(interceptor.intercept(ctx, handler({ successflag: 'S' }))),
      ).resolves.toEqual({ successflag: 'S' });
      expect(worklist).toHaveBeenCalledTimes(1);
      worklist.mockClear();
      await expect(
        firstValueFrom(
          interceptor.intercept(ctx, {
            handle: () => throwError(() => new Error('Oracle failed')),
          }),
        ),
      ).rejects.toThrow('Oracle failed');
      expect(worklist).not.toHaveBeenCalled();
    });

    it('catches a rejected worklist job without changing the successful response', async () => {
      const { interceptor, worklist } = make();
      worklist.mockRejectedValue(new Error('Worklist unavailable'));
      const response = { successflag: 'S' };
      await expect(
        firstValueFrom(
          interceptor.intercept(
            context('POST', '/api/v1/dependents', {}, 'ACTOR', DependentsController.prototype.add),
            handler(response),
          ),
        ),
      ).resolves.toBe(response);
      await settle();
      expect(worklist).toHaveBeenCalledTimes(1);
    });
  });

  describe('workflow actions to all recipient devices', () => {
    const actions = [
      { route: 'decision', body: { decision: 'APPROVE' }, recipients: ['OWNER'], event: 'APPROVE' },
      { route: 'decision', body: { decision: 'REJECT' }, recipients: ['OWNER'], event: 'REJECT' },
      {
        route: 'reassign',
        body: { assignTo: 'TARGET' },
        recipients: ['TARGET', 'OWNER'],
        event: 'REASSIGNED',
      },
      {
        route: 'request-info',
        body: { toUsername: 'TARGET', comment: 'Please attach documents.' },
        recipients: ['TARGET', 'OWNER'],
        event: 'INFO_REQUESTED',
      },
      {
        route: 'request-info',
        body: { mode: 'ANSWER', toUsername: 'TARGET', comment: 'Provided information.' },
        recipients: ['TARGET', 'OWNER'],
        event: 'INFO_REQUESTED',
      },
    ];

    function makeWorkflow() {
      const findByNotificationId = jest
        .fn()
        .mockResolvedValue({ requestor: 'OWNER', requestType: 'Leave Request' });
      const lookup = { findByNotificationId } as unknown as RequestLookupPort;
      const query = jest
        .fn()
        .mockImplementation(async (_sql: string, binds: { username: string }) =>
          ['phone', 'tablet'].map((imei) => ({
            LoginID: binds.username,
            IMEINumber: imei,
            DeviceTokenValue: `${binds.username}-${imei}`,
            Platform: 'android',
          })),
        );
      const send = jest.fn().mockResolvedValue({ sent: 2, failed: 0, invalidTokens: [] });
      const notifications = new NotificationsService(
        new MssqlDeviceTokenRepository({ query } as unknown as MssqlService),
        { send, enabled: true } as unknown as PushSenderPort,
      );
      const notifier = new RequestNotifier(notifications, lookup);
      return {
        interceptor: new NotificationTriggerInterceptor(notifier),
        findByNotificationId,
        query,
        send,
      };
    }

    it.each([
      [
        'QUESTION',
        'OWNER',
        'Your Leave Request has been requested for more information by Signed Actor.',
      ],
      [
        'ANSWER',
        'ACTOR',
        'Signed Actor has provided you more information for the Leave Request approval.',
      ],
    ])(
      'sends the %s message to every target device based on the request mode',
      async (mode, actor, body) => {
        const { interceptor, send } = makeWorkflow();
        await firstValueFrom(
          interceptor.intercept(
            context(
              'POST',
              '/api/v1/approvals/123/request-info',
              { mode, toUsername: 'TARGET', comment: 'Private answer content' },
              actor,
              undefined,
              'Signed Actor',
            ),
            handler({ successflag: 'S' }),
          ),
        );
        await settle();
        expect(send).toHaveBeenCalledWith(
          ['TARGET-phone', 'TARGET-tablet'],
          expect.objectContaining({
            body,
            data: { notificationId: '123', requestType: 'Leave Request', event: 'INFO_REQUESTED' },
          }),
        );
        expect(JSON.stringify(send.mock.calls)).not.toContain('Private answer content');
      },
    );

    it.each(actions)(
      'captures the original owner before $event and sends to all devices',
      async ({ route, body, recipients, event }) => {
        const { interceptor, findByNotificationId, query, send } = makeWorkflow();
        let open = true;
        findByNotificationId.mockImplementation(async () =>
          open ? { requestor: 'OWNER', requestType: 'Leave Request' } : undefined,
        );
        const response = { successflag: 'S', status: 'success' };
        const action = jest.fn(() => {
          open = false;
          return of(response);
        });

        await expect(
          firstValueFrom(
            interceptor.intercept(
              context('POST', `/api/v1/approvals/123/${route}`, body, 'ACTOR'),
              { handle: action },
            ),
          ),
        ).resolves.toBe(response);
        await settle();

        expect(findByNotificationId).toHaveBeenCalledTimes(1);
        expect(findByNotificationId).toHaveBeenCalledWith('123');
        expect(findByNotificationId.mock.invocationCallOrder[0]).toBeLessThan(
          action.mock.invocationCallOrder[0],
        );
        expect(query).toHaveBeenCalledTimes(recipients.length);
        expect(send).toHaveBeenCalledTimes(recipients.length);
        for (const username of recipients) {
          expect(query).toHaveBeenCalledWith(
            expect.stringMatching(/FROM HMC_Sanad_DeviceToken_tbl\s+WHERE LoginID = @username/),
            { username },
          );
          expect(send).toHaveBeenCalledWith(
            [`${username}-phone`, `${username}-tablet`],
            expect.objectContaining({
              data: { notificationId: '123', requestType: 'Leave Request', event },
            }),
          );
        }
      },
    );

    it.each(actions)('does not notify after a failed $event action', async ({ route, body }) => {
      const { interceptor, query, send } = makeWorkflow();
      const response = { successflag: 'N', status: 'error' };

      await expect(
        firstValueFrom(
          interceptor.intercept(
            context('POST', `/api/v1/approvals/123/${route}`, body, 'ACTOR'),
            handler(response),
          ),
        ),
      ).resolves.toBe(response);
      await settle();

      expect(query).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });

    it('does not fail the action when the pre-action lookup rejects', async () => {
      const { interceptor, findByNotificationId, query, send } = makeWorkflow();
      findByNotificationId.mockRejectedValue(new Error('Oracle lookup unavailable'));

      await expect(
        firstValueFrom(
          interceptor.intercept(
            context('POST', '/api/v1/approvals/123/reassign', { assignTo: 'TARGET' }, 'ACTOR'),
            handler({ successflag: 'S' }),
          ),
        ),
      ).resolves.toEqual({ successflag: 'S' });
      await settle();

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(expect.any(String), { username: 'TARGET' });
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('does not notify when the action throws after the owner was captured', async () => {
      const { interceptor, findByNotificationId, query, send } = makeWorkflow();

      await expect(
        firstValueFrom(
          interceptor.intercept(
            context('POST', '/api/v1/approvals/123/decision', { decision: 'APPROVE' }, 'ACTOR'),
            { handle: () => throwError(() => new Error('Action failed')) },
          ),
        ),
      ).rejects.toThrow('Action failed');
      await settle();

      expect(findByNotificationId).toHaveBeenCalledTimes(1);
      expect(query).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });

    it('does not replace a missing pre-action owner with a later workflow participant', async () => {
      const { interceptor, findByNotificationId, send } = makeWorkflow();
      findByNotificationId
        .mockResolvedValueOnce(undefined)
        .mockResolvedValue({ requestor: 'LATER_USER' });

      await firstValueFrom(
        interceptor.intercept(
          context('POST', '/api/v1/approvals/123/decision', { decision: 'APPROVE' }, 'ACTOR'),
          handler({ successflag: 'S' }),
        ),
      );
      await settle();

      expect(findByNotificationId).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
    });

    it('keeps captured owners separate across concurrent actions', async () => {
      const { interceptor, findByNotificationId, query } = makeWorkflow();
      findByNotificationId.mockImplementation(async (id: string) => ({ requestor: `OWNER_${id}` }));

      await Promise.all(
        ['123', '456'].map((id) =>
          firstValueFrom(
            interceptor.intercept(
              context('POST', `/api/v1/approvals/${id}/decision`, { decision: 'APPROVE' }, 'ACTOR'),
              handler({ successflag: 'S' }),
            ),
          ),
        ),
      );
      await settle();

      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenCalledWith(expect.any(String), { username: 'OWNER_123' });
      expect(query).toHaveBeenCalledWith(expect.any(String), { username: 'OWNER_456' });
    });

    it('does not make a successful action wait for push delivery', async () => {
      const { interceptor, send } = makeWorkflow();
      send.mockImplementation(() => new Promise(() => undefined));

      await expect(
        firstValueFrom(
          interceptor.intercept(
            context('POST', '/api/v1/approvals/123/decision', { decision: 'APPROVE' }, 'ACTOR'),
            handler({ successflag: 'S' }),
          ),
        ),
      ).resolves.toEqual({ successflag: 'S' });
      await settle();

      expect(send).toHaveBeenCalled();
    });

    it('bounds the pre-action lookup wait and still performs the action', async () => {
      jest.useFakeTimers();
      try {
        const { interceptor, findByNotificationId, send } = makeWorkflow();
        let resolveLookup!: (value: { requestor: string }) => void;
        findByNotificationId.mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveLookup = resolve;
            }),
        );
        const action = jest.fn(() => of({ successflag: 'S' }));
        const result = firstValueFrom(
          interceptor.intercept(
            context('POST', '/api/v1/approvals/123/decision', { decision: 'APPROVE' }, 'ACTOR'),
            { handle: action },
          ),
        );
        const assertion = expect(result).resolves.toEqual({ successflag: 'S' });

        expect(action).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(2000);
        await assertion;
        resolveLookup({ requestor: 'OWNER' });
        await jest.advanceTimersByTimeAsync(0);

        expect(action).toHaveBeenCalledTimes(1);
        expect(send).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
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
