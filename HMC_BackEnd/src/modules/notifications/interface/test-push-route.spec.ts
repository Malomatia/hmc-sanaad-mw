import { NotificationsController } from './notifications.controller';
import { NotificationsService } from '../application/notifications.service';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';

/**
 * Whether a deployment can actually deliver a notification had no answer from
 * outside. An unconfigured credential binds a no-op sender, registration still
 * answers 200, and the only tells were the boot log or waiting for a token FCM
 * had already rejected to disappear from the table. Three attempts to settle
 * it ended in inference.
 *
 * This route settles it, and must keep two properties: it reports the verdict
 * rather than swallowing it, and it can only ever reach the caller's own
 * devices.
 */
describe('POST /notifications/device-token/test', () => {
  const USER = { username: 'AIBRAHIM39' } as AuthenticatedUser;

  function make(result: Record<string, unknown>) {
    const service = { sendTest: jest.fn().mockResolvedValue(result) };
    return {
      controller: new NotificationsController(service as unknown as NotificationsService),
      service,
    };
  }

  it('reports a working credential as configured', async () => {
    const { controller } = make({ devices: 2, sent: 2, failed: 0, invalidTokens: [] });

    await expect(controller.test(USER)).resolves.toMatchObject({
      devices: 2,
      sent: 2,
      pushConfigured: true,
    });
  });

  it('reports a no-op sender as NOT configured, despite the devices existing', async () => {
    // What an unset FIREBASE_SERVICE_ACCOUNT looks like: devices are there,
    // nothing was attempted.
    const { controller } = make({ devices: 3, sent: 0, failed: 0, invalidTokens: [] });

    await expect(controller.test(USER)).resolves.toMatchObject({
      devices: 3,
      pushConfigured: false,
    });
  });

  it('does not claim to be configured when the user has no devices', async () => {
    const { controller } = make({ devices: 0, sent: 0, failed: 0, invalidTokens: [] });

    await expect(controller.test(USER)).resolves.toMatchObject({
      devices: 0,
      pushConfigured: false,
    });
  });

  it('counts a failed send as evidence the credential works', async () => {
    // A dead token is a real round trip to FCM: the credential was accepted.
    const { controller } = make({
      devices: 2,
      sent: 1,
      failed: 1,
      invalidTokens: ['dead-token'],
    });

    await expect(controller.test(USER)).resolves.toMatchObject({
      failed: 1,
      pushConfigured: true,
    });
  });

  it('sends only to the caller, taken from the token', async () => {
    const { controller, service } = make({ devices: 1, sent: 1, failed: 0, invalidTokens: [] });

    await controller.test(USER);

    expect(service.sendTest).toHaveBeenCalledWith('AIBRAHIM39', expect.any(Object));
  });
});
