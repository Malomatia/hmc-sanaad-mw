import { RequestNotifier } from './request-notifier.service';
import { NotificationsService } from './notifications.service';
import { RequestLookupPort } from '../domain/ports/request-lookup.port';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { OracleRequestLookupRepository } from '../infrastructure/adapters/oracle-request-lookup.repository';

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
          body: 'Leave Request has been approved.',
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
        : notifier.onRequestInfo('123', target, actor, 'Please attach documents.');

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
