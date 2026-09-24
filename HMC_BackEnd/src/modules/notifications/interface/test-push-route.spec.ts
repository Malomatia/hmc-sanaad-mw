import { PATH_METADATA } from '@nestjs/common/constants';
import { NotificationsController } from './notifications.controller';

describe('pentest notification routes', () => {
  it('does not expose the developer push-test action', () => {
    expect(Object.getOwnPropertyNames(NotificationsController.prototype)).not.toContain('test');
    for (const name of Object.getOwnPropertyNames(NotificationsController.prototype)) {
      const handler = (NotificationsController.prototype as unknown as Record<string, object>)[
        name
      ];
      expect(Reflect.getMetadata(PATH_METADATA, handler)).not.toBe('device-token/test');
    }
  });

  it('retains mobile device registration and unregistration', () => {
    expect(Reflect.getMetadata(PATH_METADATA, NotificationsController.prototype.register)).toBe(
      'device-token',
    );
    expect(Reflect.getMetadata(PATH_METADATA, NotificationsController.prototype.unregister)).toBe(
      'device-token/unregister',
    );
  });
});
