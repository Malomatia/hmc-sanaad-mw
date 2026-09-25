import { RequestNotifier } from './request-notifier.service';
import { NotificationsService } from './notifications.service';
import { RequestLookupPort } from '../domain/ports/request-lookup.port';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { OracleRequestLookupRepository } from '../infrastructure/adapters/oracle-request-lookup.repository';
import { UsersDbService } from '@core/database/users-db/users-db.service';
import { MssqlDeviceTokenRepository } from '../infrastructure/adapters/mssql-device-token.repository';
import { PushSenderPort } from '../domain/ports/push-sender.port';

/**
 * Every entry point here runs AFTER a business action has already succeeded.
 * A lost notification is a nuisance; an exception escaping into that path
 * would turn a submitted leave request into a 500. So the rule these cases
 * defend is: never throw, and skip quietly whenever the answer is unknown.
 */
describe('RequestNotifier', () => {
  function make(lookup: Partial<RequestLookupPort> = {}) {
    const notifyUser = jest.fn().mockResolvedValue(undefined);
    const notifications = { notifyUser } as unknown as NotificationsService;
    const requests = {
      findLatestSubmission: jest.fn().mockResolvedValue(undefined),
      findByNotificationId: jest.fn().mockResolvedValue(undefined),
      ...lookup,
    } as unknown as RequestLookupPort;
    return { notifier: new RequestNotifier(notifications, requests), notifyUser };
  }

  describe('on submit', () => {
    it('notifies the approver of the request just submitted', async () => {
      const { notifier, notifyUser } = make({
        findLatestSubmission: jest.fn().mockResolvedValue({
          approver: 'RABOOBACKER',
          requestType: 'Return from Leave',
          notificationId: '123859449',
        }),
      });

      await notifier.onSubmitted('AIBRAHIM39');

      expect(notifyUser).toHaveBeenCalledWith('RABOOBACKER', {
        title: 'New request awaiting your approval',
        body: 'A Return from Leave request needs your action.',
        data: {
          notificationId: '123859449',
          requestType: 'Return from Leave',
          event: 'APPROVAL_REQUIRED',
        },
      });
    });

    it('stays silent when the workflow row does not exist yet', async () => {
      // Oracle writes it asynchronously — being early is normal, not an error.
      const { notifier, notifyUser } = make();

      await expect(notifier.onSubmitted('AIBRAHIM39')).resolves.toBeUndefined();
      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('stays silent when the row names no approver', async () => {
      const { notifier, notifyUser } = make({
        findLatestSubmission: jest.fn().mockResolvedValue({ requestType: 'Leave' }),
      });

      await notifier.onSubmitted('AIBRAHIM39');

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('does not notify someone about their own submission', async () => {
      const { notifier, notifyUser } = make({
        findLatestSubmission: jest.fn().mockResolvedValue({ approver: 'aibrahim39' }),
      });

      await notifier.onSubmitted('AIBRAHIM39');

      expect(notifyUser).not.toHaveBeenCalled();
    });
  });

  describe('on decision', () => {
    it('tells the requestor their request was approved', async () => {
      const { notifier, notifyUser } = make({
        findByNotificationId: jest.fn().mockResolvedValue({
          requestor: 'AIBRAHIM39',
          requestType: 'Leave Request',
        }),
      });

      await notifier.onDecided('123859449', 'APPROVE', 'RABOOBACKER');

      expect(notifyUser).toHaveBeenCalledWith(
        'AIBRAHIM39',
        expect.objectContaining({
          title: 'Request approved',
          body: 'Your Leave Request has been approved by RABOOBACKER',
        }),
      );
    });

    it('and when it was rejected', async () => {
      const { notifier, notifyUser } = make({
        findByNotificationId: jest.fn().mockResolvedValue({ requestor: 'AIBRAHIM39' }),
      });

      await notifier.onDecided('123859449', 'REJECT', 'RABOOBACKER');

      expect(notifyUser).toHaveBeenCalledWith(
        'AIBRAHIM39',
        expect.objectContaining({ title: 'Request rejected' }),
      );
    });

    it('does not notify an approver who decided on their own request', async () => {
      const { notifier, notifyUser } = make({
        findByNotificationId: jest.fn().mockResolvedValue({ requestor: 'RABOOBACKER' }),
      });

      await notifier.onDecided('123859449', 'APPROVE', 'RABOOBACKER');

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('stays silent for an unknown notification', async () => {
      const { notifier, notifyUser } = make();

      await expect(notifier.onDecided('999', 'APPROVE', 'X')).resolves.toBeUndefined();
      expect(notifyUser).not.toHaveBeenCalled();
    });
  });

  describe.each(['reassign', 'request-info'] as const)('%s recipients', (action) => {
    const trigger = (notifier: RequestNotifier, target?: string, actor = 'ACTOR') =>
      action === 'reassign'
        ? notifier.onReassigned('123', target ?? '', actor)
        : notifier.onRequestInfo('123', target, actor, 'QUESTION');

    it('notifies the original requestor as well as the named target', async () => {
      const { notifier, notifyUser } = make({
        findByNotificationId: jest.fn().mockResolvedValue({
          requestor: 'OWNER',
          requestType: 'Leave Request',
        }),
      });

      await trigger(notifier, 'TARGET');

      expect(notifyUser).toHaveBeenCalledTimes(2);
      expect(notifyUser).toHaveBeenCalledWith(
        'OWNER',
        expect.objectContaining({
          title: action === 'reassign' ? 'Request reassigned' : 'More information requested',
          data: {
            notificationId: '123',
            requestType: 'Leave Request',
            event: action === 'reassign' ? 'REASSIGNED' : 'INFO_REQUESTED',
          },
        }),
      );
      expect(notifyUser).toHaveBeenCalledWith(
        'TARGET',
        expect.objectContaining({
          title: action === 'reassign' ? 'Request reassigned to you' : 'More information requested',
        }),
      );
    });

    it('notifies a person only once when the owner and target match ignoring case and whitespace', async () => {
      const { notifier, notifyUser } = make({
        findByNotificationId: jest.fn().mockResolvedValue({ requestor: ' OWNER ' }),
      });

      await trigger(notifier, 'owner');

      expect(notifyUser).toHaveBeenCalledTimes(1);
      expect(notifyUser).toHaveBeenCalledWith('owner', expect.any(Object));
    });

    it('still notifies the owner when the actor is the named target', async () => {
      const { notifier, notifyUser } = make({
        findByNotificationId: jest.fn().mockResolvedValue({ requestor: 'OWNER' }),
      });

      await trigger(notifier, ' actor ');

      expect(notifyUser).toHaveBeenCalledTimes(1);
      expect(notifyUser).toHaveBeenCalledWith('OWNER', expect.any(Object));
    });

    it('still notifies the target when the owner took the action', async () => {
      const { notifier, notifyUser } = make({
        findByNotificationId: jest.fn().mockResolvedValue({ requestor: 'OWNER' }),
      });

      await trigger(notifier, 'TARGET', ' owner ');

      expect(notifyUser).toHaveBeenCalledTimes(1);
      expect(notifyUser).toHaveBeenCalledWith('TARGET', expect.any(Object));
    });

    it('notifies nobody when owner and target are both the actor', async () => {
      const { notifier, notifyUser } = make({
        findByNotificationId: jest.fn().mockResolvedValue({ requestor: 'ACTOR' }),
      });

      await trigger(notifier, ' actor ');

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('notifies the owner when no target is supplied', async () => {
      const { notifier, notifyUser } = make({
        findByNotificationId: jest.fn().mockResolvedValue({ requestor: 'OWNER' }),
      });

      await trigger(notifier);

      expect(notifyUser).toHaveBeenCalledTimes(1);
      expect(notifyUser).toHaveBeenCalledWith('OWNER', expect.any(Object));
    });

    it('keeps target delivery when the original requestor cannot be resolved', async () => {
      const { notifier, notifyUser } = make({
        findByNotificationId: jest.fn().mockRejectedValue(new Error('Oracle unavailable')),
      });

      await expect(trigger(notifier, 'TARGET')).resolves.toBeUndefined();

      expect(notifyUser).toHaveBeenCalledWith('TARGET', expect.any(Object));
    });

    it('attempts both recipients even when one delivery rejects', async () => {
      const { notifier, notifyUser } = make({
        findByNotificationId: jest.fn().mockResolvedValue({ requestor: 'OWNER' }),
      });
      notifyUser.mockRejectedValueOnce(new Error('Push unavailable'));

      await expect(trigger(notifier, 'TARGET')).resolves.toBeUndefined();

      expect(notifyUser).toHaveBeenCalledTimes(2);
    });
  });

  describe('personalized message bodies', () => {
    const participants = {
      requestor: 'REQUESTER',
      requestorName: 'Alice Requester',
      approver: 'APPROVER',
      approverName: 'Bob Approver',
      requestType: 'Annual Leave',
    };

    it.each(['APPROVE', 'REJECT'] as const)(
      'uses the request name and approver name for %s',
      async (outcome) => {
        const { notifier, notifyUser } = make({
          findByNotificationId: jest.fn().mockResolvedValue(participants),
        });
        await notifier.onDecided('123', outcome, 'APPROVER');
        expect(notifyUser).toHaveBeenCalledWith(
          'REQUESTER',
          expect.objectContaining({
            body: `Your Annual Leave has been ${outcome === 'APPROVE' ? 'approved' : 'rejected'} by Bob Approver`,
          }),
        );
      },
    );

    it('uses recipient-specific forwarding messages without losing the requestor copy', async () => {
      const { notifier, notifyUser } = make({
        findByNotificationId: jest.fn().mockResolvedValue(participants),
      });
      await notifier.onReassigned('123', 'TARGET', 'APPROVER');
      expect(notifyUser).toHaveBeenCalledTimes(2);
      expect(notifyUser).toHaveBeenCalledWith(
        'TARGET',
        expect.objectContaining({
          body: 'Bob Approver has forwarded you Annual Leave',
        }),
      );
      expect(notifyUser).toHaveBeenCalledWith(
        'REQUESTER',
        expect.objectContaining({
          body: 'Your Annual Leave has been forwarded by Bob Approver',
        }),
      );
    });

    it('uses the request-for-more-info template and does not append the comment', async () => {
      const { notifier, notifyUser } = make({
        findByNotificationId: jest.fn().mockResolvedValue(participants),
      });
      await notifier.onRequestInfo('123', 'REQUESTER', 'APPROVER', 'QUESTION');
      expect(notifyUser).toHaveBeenCalledTimes(1);
      expect(notifyUser).toHaveBeenCalledWith(
        'REQUESTER',
        expect.objectContaining({
          body: 'Your Annual Leave has been requested for more information by Bob Approver.',
          data: { notificationId: '123', requestType: 'Annual Leave', event: 'INFO_REQUESTED' },
        }),
      );
      expect(JSON.stringify(notifyUser.mock.calls)).not.toContain('Private supporting details');
    });

    it.each([undefined, 'APPROVER'])(
      'notifies the approver when the original requester answers, target=%s',
      async (target) => {
        const { notifier, notifyUser } = make({
          findByNotificationId: jest.fn().mockResolvedValue(participants),
        });
        await notifier.onRequestInfo('123', target, ' requester ', 'ANSWER');
        expect(notifyUser).toHaveBeenCalledTimes(1);
        expect(notifyUser).toHaveBeenCalledWith(
          'APPROVER',
          expect.objectContaining({
            body: 'Alice Requester has provided you more information for the Annual Leave approval.',
            data: { notificationId: '123', requestType: 'Annual Leave', event: 'INFO_REQUESTED' },
          }),
        );
      },
    );

    it('keeps an explicit answer recipient instead of overriding it with the captured approver', async () => {
      const { notifier, notifyUser } = make({
        findByNotificationId: jest.fn().mockResolvedValue(participants),
      });
      await notifier.onRequestInfo('123', 'OTHER', 'REQUESTER', 'ANSWER');
      expect(notifyUser).toHaveBeenCalledTimes(1);
      expect(notifyUser).toHaveBeenCalledWith(
        'OTHER',
        expect.objectContaining({
          body: 'Alice Requester has provided you more information for the Annual Leave approval.',
        }),
      );
    });

    it('prefers signed-in actor names over captured names for every approval action', async () => {
      const { notifier, notifyUser } = make();
      await notifier.onDecided('123', 'APPROVE', 'APPROVER', participants, ' Signed Bob ');
      await notifier.onDecided('123', 'REJECT', 'APPROVER', participants, ' Signed Bob ');
      await notifier.onReassigned('123', 'TARGET', 'APPROVER', participants, ' Signed Bob ');
      await notifier.onRequestInfo(
        '123',
        'REQUESTER',
        'APPROVER',
        'QUESTION',
        participants,
        ' Signed Bob ',
      );
      await notifier.onRequestInfo(
        '123',
        'APPROVER',
        'REQUESTER',
        'ANSWER',
        participants,
        ' Signed Alice ',
      );
      for (const body of [
        'Your Annual Leave has been approved by Signed Bob',
        'Your Annual Leave has been rejected by Signed Bob',
        'Your Annual Leave has been forwarded by Signed Bob',
        'Your Annual Leave has been requested for more information by Signed Bob.',
      ])
        expect(notifyUser).toHaveBeenCalledWith('REQUESTER', expect.objectContaining({ body }));
      expect(notifyUser).toHaveBeenCalledWith(
        'TARGET',
        expect.objectContaining({ body: 'Signed Bob has forwarded you Annual Leave' }),
      );
      expect(notifyUser).toHaveBeenCalledWith(
        'APPROVER',
        expect.objectContaining({
          body: 'Signed Alice has provided you more information for the Annual Leave approval.',
        }),
      );
    });

    it.each([
      [
        'ANSWER',
        'DELEGATE',
        'Signed Responder has provided you more information for the Annual Leave approval.',
      ],
      [
        'QUESTION',
        'REQUESTER',
        'Your Annual Leave has been requested for more information by Signed Responder.',
      ],
      [
        undefined,
        'REQUESTER',
        'Your Annual Leave has been requested for more information by Signed Responder.',
      ],
      [
        ' answer ',
        'DELEGATE',
        'Signed Responder has provided you more information for the Annual Leave approval.',
      ],
      [
        ' question ',
        'REQUESTER',
        'Your Annual Leave has been requested for more information by Signed Responder.',
      ],
    ] as const)(
      'selects the message from mode %s rather than actor/requestor equality',
      async (mode, actor, body) => {
        const { notifier, notifyUser } = make();
        await notifier.onRequestInfo(
          '123',
          'TARGET',
          actor,
          mode,
          participants,
          'Signed Responder',
        );
        expect(notifyUser).toHaveBeenCalledWith(
          'TARGET',
          expect.objectContaining({
            body,
            data: { notificationId: '123', requestType: 'Annual Leave', event: 'INFO_REQUESTED' },
          }),
        );
      },
    );

    it('keeps ANSWER wording when the original requestor is unavailable', async () => {
      const { notifier, notifyUser } = make();
      await notifier.onRequestInfo('123', 'TARGET', 'REQUESTER', 'ANSWER', {}, 'Alice Requester');
      expect(notifyUser).toHaveBeenCalledWith(
        'TARGET',
        expect.objectContaining({
          body: 'Alice Requester has provided you more information for the request approval.',
        }),
      );
    });

    it.each(['', 'OTHER'])(
      'does not mislabel unsupported mode %s as a question or answer',
      async (mode) => {
        const { notifier, notifyUser } = make();
        await notifier.onRequestInfo('123', 'TARGET', 'REQUESTER', mode, participants);
        expect(notifyUser).not.toHaveBeenCalled();
      },
    );

    it('uses the acting login rather than an unrelated captured approver name', async () => {
      const { notifier, notifyUser } = make({
        findByNotificationId: jest.fn().mockResolvedValue({ ...participants, requestType: ' ' }),
      });
      await notifier.onDecided('123', 'APPROVE', 'DELEGATE');
      expect(notifyUser).toHaveBeenCalledWith(
        'REQUESTER',
        expect.objectContaining({
          body: 'Your request has been approved by DELEGATE',
        }),
      );
    });
  });

  describe('worklist submission jobs', () => {
    const notifiers: RequestNotifier[] = [];
    const row = {
      notificationId: '123',
      recipient: 'APPROVER',
      subject: '  Leave request  ',
      itemKey: '456',
      itemType: 'HRSSA',
    };

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-09-15T08:00:00Z'));
    });

    afterEach(async () => {
      for (const notifier of notifiers.splice(0)) notifier.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(0);
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    function makeWorklist(enabled = true) {
      const findWorklistNotifications = jest.fn().mockResolvedValue([]);
      const findByNotificationId = jest.fn().mockResolvedValue({
        requestor: 'SUBMITTER',
        requestorName: 'Alice Requester',
        requestType: 'Leave Request',
      });
      const notifyUser = jest.fn().mockResolvedValue(undefined);
      const notifier = new RequestNotifier(
        { notifyUser, enabled } as unknown as NotificationsService,
        { findWorklistNotifications, findByNotificationId } as unknown as RequestLookupPort,
      );
      notifiers.push(notifier);
      const submit = (username = 'SUBMITTER') =>
        notifier.onWorklistSubmitted({
          username,
          startedAt: Date.now() - 100,
          succeededAt: Date.now(),
        });
      return { notifier, submit, findWorklistNotifications, findByNotificationId, notifyUser };
    }

    it('discovers later rows using the Oracle-clock lookup and keeps the job deadline', async () => {
      const { submit, findWorklistNotifications, notifyUser } = makeWorklist();
      findWorklistNotifications
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([row])
        .mockResolvedValue([row, { ...row, notificationId: '124', recipient: 'OTHER' }]);
      await submit(' submitter ');
      await jest.advanceTimersByTimeAsync(0);
      expect(notifyUser).not.toHaveBeenCalled();
      for (const delay of [2000, 5000, 10000, 20000, 30000])
        await jest.advanceTimersByTimeAsync(delay);
      expect(findWorklistNotifications).toHaveBeenCalledTimes(6);
      for (const args of findWorklistNotifications.mock.calls) {
        expect(args).toEqual(['SUBMITTER']);
      }
      expect(notifyUser).toHaveBeenCalledTimes(2);
      expect(notifyUser).toHaveBeenCalledWith('APPROVER', {
        title: 'New request awaiting your approval',
        body: 'Alice Requester sent you Leave Request for Approval',
        data: {
          event: 'APPROVAL_REQUIRED',
          notificationId: '123',
          itemKey: '456',
          itemType: 'HRSSA',
        },
      });
      await jest.advanceTimersByTimeAsync(120000);
      expect(findWorklistNotifications).toHaveBeenCalledTimes(6);
    });

    it('deduplicates overlapping jobs by notification and normalized recipient, not notification alone', async () => {
      const { submit, findWorklistNotifications, notifyUser } = makeWorklist();
      findWorklistNotifications.mockResolvedValue([
        row,
        { ...row, recipient: ' approver ' },
        { ...row, recipient: 'OTHER' },
      ]);
      await Promise.all([submit(), submit()]);
      await jest.advanceTimersByTimeAsync(67000);
      expect(notifyUser).toHaveBeenCalledTimes(2);
      expect(notifyUser).toHaveBeenCalledWith('OTHER', expect.any(Object));
    });

    it('uses safe fallbacks when request details are unavailable and omits absent navigation fields', async () => {
      const { submit, findWorklistNotifications, findByNotificationId, notifyUser } =
        makeWorklist();
      findByNotificationId.mockRejectedValue(new Error('Request details unavailable'));
      findWorklistNotifications.mockResolvedValue([
        { notificationId: '123', recipient: 'APPROVER', subject: '  ' },
      ]);
      await submit();
      await jest.advanceTimersByTimeAsync(0);
      expect(notifyUser).toHaveBeenCalledWith('APPROVER', {
        title: 'New request awaiting your approval',
        body: 'SUBMITTER sent you request for Approval',
        data: { event: 'APPROVAL_REQUIRED', notificationId: '123' },
      });
    });

    it('uses the captured JWT requester name without using a full subject as the request name', async () => {
      const { notifier, findWorklistNotifications, findByNotificationId, notifyUser } =
        makeWorklist();
      findWorklistNotifications.mockResolvedValue([row]);
      findByNotificationId.mockResolvedValue({
        requestType: ' Annual Leave ',
        requestor: 'SUBMITTER',
        requestorName: 'Old Name',
      });
      await notifier.onWorklistSubmitted({
        username: 'SUBMITTER',
        requesterName: ' Signed Alice ',
        startedAt: Date.now() - 100,
        succeededAt: Date.now(),
      });
      await jest.advanceTimersByTimeAsync(67000);
      expect(findByNotificationId).toHaveBeenCalledTimes(1);
      expect(findByNotificationId).toHaveBeenCalledWith('123');
      expect(notifyUser).toHaveBeenCalledWith(
        'APPROVER',
        expect.objectContaining({
          body: 'Signed Alice sent you Annual Leave for Approval',
        }),
      );
    });

    it.each(['shutdown', 'deadline'])(
      'does not send when request-name enrichment finishes after %s',
      async (stop) => {
        const { notifier, submit, findWorklistNotifications, findByNotificationId, notifyUser } =
          makeWorklist();
        findWorklistNotifications.mockResolvedValue([row]);
        let finish!: (request: { requestType: string }) => void;
        findByNotificationId.mockImplementation(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        );
        await submit();
        await jest.advanceTimersByTimeAsync(0);
        if (stop === 'shutdown') notifier.onModuleDestroy();
        else jest.setSystemTime(Date.now() + 120001);
        finish({ requestType: 'Annual Leave' });
        await jest.advanceTimersByTimeAsync(0);
        expect(notifyUser).not.toHaveBeenCalled();
      },
    );

    it('sends the supplied worklist row directly to all AIBRAHIM39 devices without waiting for other Oracle views', async () => {
      const oracleQuery = jest.fn().mockImplementation((sql: string) =>
        sql.includes('WORKLISTS_V')
          ? Promise.resolve([
              {
                NOTIFICATION_ID: 123864402,
                FROM_USER: '038999    - Vandana Pavithran',
                TO_USER: '037400    - Amir Ibrahim',
                SUBJECT: 'Return from Leave for 038999    - Vandana Pavithran    ',
                BEGIN_DATE: '2026-09-16T18:05:46.000Z',
                STATUS: 'OPEN',
                RECIPIENT_ROLE: 'AIBRAHIM39',
                FROM_ROLE: 'VPAVITHRAN',
                TYPE: 'HR',
                MESSAGE_TYPE: 'HRSSA',
                ITEM_KEY: '18876468',
              },
            ])
          : new Promise(() => undefined),
      );
      const query = jest.fn().mockResolvedValue([
        {
          LoginID: 'AIBRAHIM39',
          IMEINumber: 'phone',
          DeviceTokenValue: 'test-android-token',
          Platform: 'android',
        },
        {
          LoginID: 'AIBRAHIM39',
          IMEINumber: 'tablet',
          DeviceTokenValue: 'test-ios-token',
          Platform: 'ios',
        },
      ]);
      const send = jest.fn().mockResolvedValue({ sent: 2, failed: 0, invalidTokens: [] });
      const notifier = new RequestNotifier(
        new NotificationsService(
          new MssqlDeviceTokenRepository({ query } as unknown as UsersDbService),
          { send, enabled: true } as unknown as PushSenderPort,
        ),
        new OracleRequestLookupRepository(
          { query: oracleQuery } as unknown as OracleService,
          {} as OracleSchemaService,
        ),
      );
      notifiers.push(notifier);
      await notifier.onWorklistSubmitted({
        username: 'vpavithran',
        startedAt: Date.now() - 100,
        succeededAt: Date.now(),
      });
      await jest.advanceTimersByTimeAsync(0);

      expect(query).toHaveBeenCalledWith(
        expect.stringMatching(/FROM HMC_Sanad_DeviceToken_tbl\s+WHERE LoginID = @username/),
        { username: 'AIBRAHIM39' },
      );
      expect(send).toHaveBeenCalledWith(['test-android-token', 'test-ios-token'], {
        title: 'New request awaiting your approval',
        body: 'Vandana Pavithran sent you Return from Leave for Approval',
        data: {
          event: 'APPROVAL_REQUIRED',
          notificationId: '123864402',
          itemKey: '18876468',
          itemType: 'HRSSA',
        },
      });
      expect(oracleQuery).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(67000);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('does not let an optional request-name lookup block a valid recipient indefinitely', async () => {
      const { submit, findWorklistNotifications, findByNotificationId, notifyUser } =
        makeWorklist();
      findWorklistNotifications.mockResolvedValue([row]);
      let finish!: (request: { requestType: string }) => void;
      findByNotificationId.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      await submit();
      await jest.advanceTimersByTimeAsync(1000);
      expect(notifyUser).toHaveBeenCalledWith(
        'APPROVER',
        expect.objectContaining({ body: 'SUBMITTER sent you request for Approval' }),
      );
      finish({ requestType: 'Late name' });
      await jest.advanceTimersByTimeAsync(3000);
      expect(notifyUser).toHaveBeenCalledTimes(1);
    });

    it('caps unresolved fallback lookups while still delivering other discovered rows', async () => {
      const { submit, findWorklistNotifications, findByNotificationId, notifyUser } =
        makeWorklist();
      findWorklistNotifications.mockResolvedValue(
        ['1', '2', '3'].map((notificationId) => ({ ...row, notificationId })),
      );
      findByNotificationId.mockImplementation(() => new Promise(() => undefined));
      await submit();
      await jest.advanceTimersByTimeAsync(2000);
      expect(findByNotificationId).toHaveBeenCalledTimes(2);
      expect(notifyUser).toHaveBeenCalledTimes(3);
    });

    it('keeps skipping the submitter own devices', async () => {
      const { submit, findWorklistNotifications, notifyUser } = makeWorklist();
      findWorklistNotifications.mockResolvedValue([{ ...row, recipient: ' submitter ' }]);
      await submit();
      await jest.advanceTimersByTimeAsync(67000);
      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('does no discovery when the sender is disabled', async () => {
      const { submit, findWorklistNotifications } = makeWorklist(false);
      await submit();
      await jest.advanceTimersByTimeAsync(120000);
      expect(findWorklistNotifications).not.toHaveBeenCalled();
    });

    it('retries lookup errors but does not retry failed delivery attempts', async () => {
      const { submit, findWorklistNotifications, notifyUser } = makeWorklist();
      findWorklistNotifications
        .mockRejectedValueOnce(new Error('Oracle unavailable'))
        .mockResolvedValue([row]);
      notifyUser.mockRejectedValue(new Error('FCM unavailable'));
      await expect(submit()).resolves.toBeUndefined();
      await jest.advanceTimersByTimeAsync(67000);
      expect(findWorklistNotifications).toHaveBeenCalledTimes(6);
      expect(notifyUser).toHaveBeenCalledTimes(1);
    });

    it('caps active lookups at two and the waiting queue at one hundred', async () => {
      const { submit, findWorklistNotifications, notifier } = makeWorklist();
      const release: Array<(rows: []) => void> = [];
      findWorklistNotifications.mockImplementation(
        () => new Promise((resolve) => release.push(resolve)),
      );
      for (let i = 0; i < 103; i++) await submit(`USER_${i}`);
      await jest.advanceTimersByTimeAsync(0);
      expect(findWorklistNotifications).toHaveBeenCalledTimes(2);
      expect(notifier['worklistQueue']).toHaveLength(100);
      await jest.advanceTimersByTimeAsync(120001);
      for (const resolve of release) resolve([]);
      await jest.advanceTimersByTimeAsync(0);
      expect(findWorklistNotifications).toHaveBeenCalledTimes(2);
      expect(notifier['worklistQueue']).toHaveLength(0);
    });

    it('releases workers so waiting jobs can run without exceeding concurrency', async () => {
      const { submit, findWorklistNotifications } = makeWorklist();
      await submit('ONE');
      await submit('TWO');
      await submit('THREE');
      await jest.advanceTimersByTimeAsync(0);
      expect(findWorklistNotifications.mock.calls.map(([username]) => username)).toEqual([
        'ONE',
        'TWO',
      ]);
      await jest.advanceTimersByTimeAsync(67000);
      expect(findWorklistNotifications).toHaveBeenCalledWith('THREE');
    });

    it('skips lookup results arriving after the fixed two-minute deadline', async () => {
      const { submit, findWorklistNotifications, notifyUser } = makeWorklist();
      findWorklistNotifications.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([row]), 120001)),
      );
      await submit();
      await jest.advanceTimersByTimeAsync(120001);
      expect(findWorklistNotifications).toHaveBeenCalledTimes(1);
      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('does not enqueue an already-expired event', async () => {
      const { notifier, findWorklistNotifications } = makeWorklist();
      await notifier.onWorklistSubmitted({
        username: 'SUBMITTER',
        startedAt: Date.now() - 130000,
        succeededAt: Date.now() - 120000,
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(findWorklistNotifications).not.toHaveBeenCalled();
    });

    it('clears retry timers and queued work on shutdown', async () => {
      const { submit, notifier, findWorklistNotifications, notifyUser } = makeWorklist();
      await Promise.all([submit(), submit(), submit()]);
      await jest.advanceTimersByTimeAsync(0);
      expect(findWorklistNotifications).toHaveBeenCalledTimes(2);
      notifier.onModuleDestroy();
      await submit();
      await jest.advanceTimersByTimeAsync(120000);
      expect(findWorklistNotifications).toHaveBeenCalledTimes(2);
      expect(notifyUser).not.toHaveBeenCalled();
      expect(notifier['worklistTimers'].size).toBe(0);
      expect(notifier['worklistQueue']).toHaveLength(0);
    });

    it('does not dispatch a pending lookup result after shutdown', async () => {
      const { submit, notifier, findWorklistNotifications, notifyUser } = makeWorklist();
      let release!: (rows: (typeof row)[]) => void;
      findWorklistNotifications.mockImplementation(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      await submit();
      await jest.advanceTimersByTimeAsync(0);
      notifier.onModuleDestroy();
      release([row]);
      await jest.advanceTimersByTimeAsync(0);
      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('expires completed claims after ten minutes and bounds the registry capacity', async () => {
      const { submit, notifier, findWorklistNotifications, notifyUser } = makeWorklist();
      for (let i = 0; i < 10000; i++)
        notifier['worklistClaims'].set(`existing-${i}`, {
          inFlight: false,
          expiresAt: Date.now() + 600000,
        });
      findWorklistNotifications.mockResolvedValue([row]);
      await submit();
      await jest.advanceTimersByTimeAsync(67000);
      expect(notifyUser).not.toHaveBeenCalled();
      expect(notifier['worklistClaims'].size).toBe(10000);
      await jest.advanceTimersByTimeAsync(533001);
      await submit();
      await jest.advanceTimersByTimeAsync(0);
      expect(notifyUser).toHaveBeenCalledTimes(1);
      expect(notifier['worklistClaims'].size).toBe(1);
    });

    it('never evicts an in-flight claim even after its retention period', async () => {
      const { submit, findWorklistNotifications, notifyUser } = makeWorklist();
      findWorklistNotifications.mockResolvedValue([row]);
      let finish!: () => void;
      notifyUser.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      await submit();
      await jest.advanceTimersByTimeAsync(600001);
      await submit();
      await jest.advanceTimersByTimeAsync(0);
      expect(notifyUser).toHaveBeenCalledTimes(1);
      finish();
      await jest.advanceTimersByTimeAsync(0);
    });
  });

  describe('Oracle requestor identity', () => {
    function makeOracle(employeeNumber: string) {
      const query = jest
        .fn()
        .mockImplementation(async (sql: string) =>
          sql.includes('PERSONAL_DETAILS_V') ? [] : [{ REQUESTOR_USER_NAME: employeeNumber }],
        );
      const lookup = new OracleRequestLookupRepository(
        { query } as unknown as OracleService,
        {} as OracleSchemaService,
      );
      const notifyUser = jest.fn().mockResolvedValue(undefined);
      const notifier = new RequestNotifier(
        { notifyUser } as unknown as NotificationsService,
        lookup,
      );
      return { query, notifier, notifyUser };
    }

    it('translates an employee number to the login used for device registrations', async () => {
      const { query, notifier, notifyUser } = makeOracle('900001');
      query.mockImplementation(async (sql: string) =>
        sql.includes('PERSONAL_DETAILS_V')
          ? [{ USER_NAME: 'OWNER' }]
          : [{ REQUESTOR_USER_NAME: '900001' }],
      );

      await notifier.onDecided('123', 'APPROVE', 'ACTOR');

      expect(query).toHaveBeenCalledWith(expect.stringContaining('employee_number = :n'), {
        n: '900001',
      });
      expect(notifyUser).toHaveBeenCalledWith('OWNER', expect.any(Object));
    });

    it('never treats an unresolved employee number as a login', async () => {
      const { notifier, notifyUser } = makeOracle('900002');

      await notifier.onDecided('123', 'APPROVE', 'ACTOR');

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('retries a failed employee-to-login lookup on a later action', async () => {
      const { query, notifier, notifyUser } = makeOracle('900003');
      await notifier.onDecided('123', 'APPROVE', 'ACTOR');
      query.mockImplementation(async (sql: string) =>
        sql.includes('PERSONAL_DETAILS_V')
          ? [{ USER_NAME: 'OWNER' }]
          : [{ REQUESTOR_USER_NAME: '900003' }],
      );

      await notifier.onDecided('456', 'REJECT', 'ACTOR');

      expect(notifyUser).toHaveBeenCalledTimes(1);
      expect(notifyUser).toHaveBeenCalledWith('OWNER', expect.any(Object));
    });
  });

  describe('never fails the caller', () => {
    it('swallows a lookup that throws', async () => {
      const { notifier } = make({
        findLatestSubmission: jest.fn().mockRejectedValue(new Error('Oracle down')),
      });

      await expect(notifier.onSubmitted('AIBRAHIM39')).resolves.toBeUndefined();
    });

    it('swallows a delivery that throws', async () => {
      const notifications = {
        notifyUser: jest.fn().mockRejectedValue(new Error('FCM down')),
      } as unknown as NotificationsService;
      const requests = {
        findByNotificationId: jest.fn().mockResolvedValue({ requestor: 'AIBRAHIM39' }),
      } as unknown as RequestLookupPort;

      await expect(
        new RequestNotifier(notifications, requests).onDecided('1', 'APPROVE', 'X'),
      ).resolves.toBeUndefined();
    });
  });

  it('omits absent data keys rather than sending the string "undefined"', async () => {
    const { notifier, notifyUser } = make({
      findByNotificationId: jest.fn().mockResolvedValue({ requestor: 'AIBRAHIM39' }),
    });

    await notifier.onDecided('123', 'APPROVE', 'X');

    const [, message] = notifyUser.mock.calls[0] as [string, { data: Record<string, string> }];
    expect(message.data).toEqual({ notificationId: '123', event: 'APPROVE' });
  });
});
