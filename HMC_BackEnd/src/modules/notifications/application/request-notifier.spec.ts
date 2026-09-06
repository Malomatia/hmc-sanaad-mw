import { RequestNotifier } from './request-notifier.service';
import { NotificationsService } from './notifications.service';
import { RequestLookupPort } from '../domain/ports/request-lookup.port';

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
