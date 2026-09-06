import { NotificationsController } from './notifications.controller';
import { NotificationsService } from '../application/notifications.service';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';

/**
 * Unregistering was a DELETE, and the WAF in front of the API blocks that
 * method outright — every shape tried against staging (body, no body, IMEI in
 * the path, IMEI in the query) came back as its rejection page, and it answers
 * HTTP 200 while doing so. So logout appeared to succeed, the request never
 * arrived, and the handset kept receiving the previous user's notifications.
 *
 * The reachable route is a POST. These pin the behaviour that matters: the
 * person comes from the token, and both spellings do the same thing.
 */
describe('unregistering a device', () => {
  const USER = { username: 'AIBRAHIM39' } as AuthenticatedUser;

  function make() {
    const service = { unregister: jest.fn().mockResolvedValue(undefined) };
    return {
      controller: new NotificationsController(service as unknown as NotificationsService),
      service,
    };
  }

  it('unregisters the device named in the body, for the user in the token', async () => {
    const { controller, service } = make();

    await controller.unregister({ imei: 'device-1' }, USER);

    expect(service.unregister).toHaveBeenCalledWith('AIBRAHIM39', 'device-1');
  });

  it('reports success to the caller', async () => {
    const { controller } = make();

    await expect(controller.unregister({ imei: 'device-1' }, USER)).resolves.toEqual({
      message: 'Device unregistered.',
    });
  });

  it('takes the person from the token, never from the body', async () => {
    const { controller, service } = make();

    await controller.unregister(
      { imei: 'device-1', username: 'SOMEONE_ELSE' } as never,
      USER,
    );

    expect(service.unregister).toHaveBeenCalledWith('AIBRAHIM39', 'device-1');
  });

  it('behaves identically on the legacy DELETE spelling', async () => {
    const { controller, service } = make();

    await controller.unregisterViaDelete({ imei: 'device-1' }, USER);

    expect(service.unregister).toHaveBeenCalledWith('AIBRAHIM39', 'device-1');
  });
});
