import { Inject, Injectable, Logger } from '@nestjs/common';
import { DeviceToken } from '../domain/device-token';
import {
  DEVICE_TOKEN_STORE_PORT,
  DeviceTokenStorePort,
} from '../domain/ports/device-token-store.port';
import {
  PUSH_SENDER_PORT,
  PushMessage,
  PushResult,
  PushSenderPort,
} from '../domain/ports/push-sender.port';

/**
 * Push notifications: registration of a device, and delivery to a person.
 *
 * Callers address a USER, not a token — who holds which devices is this
 * module's business, and a caller that had to fetch tokens itself would end up
 * owning the multi-device and pruning rules too.
 */
@Injectable()
export class NotificationsService {
  private static readonly log = new Logger(NotificationsService.name);

  constructor(
    @Inject(DEVICE_TOKEN_STORE_PORT) private readonly store: DeviceTokenStorePort,
    @Inject(PUSH_SENDER_PORT) private readonly sender: PushSenderPort,
  ) {}

  /** Whether a real transport is configured — surfaced by /health. */
  get enabled(): boolean {
    return this.sender.enabled;
  }

  register(token: DeviceToken): Promise<void> {
    return this.store.save(token);
  }

  unregister(username: string, imei: string): Promise<void> {
    return this.store.remove(username, imei);
  }

  /**
   * Send to a user's own devices and REPORT what happened, for the diagnostic
   * route. Unlike notifyUser this returns the verdict instead of swallowing
   * it, because the whole point is to see it.
   *
   * It exists because everything here degrades silently: with no credential
   * the sender is a no-op and registrations still answer 200, so "can this
   * deployment actually deliver a notification?" had no answer short of the
   * boot log or waiting for a dead token to disappear from the table.
   */
  async sendTest(username: string, message: PushMessage): Promise<PushResult & { devices: number }> {
    const devices = await this.store.findByUsername(username);
    if (!devices.length) return { sent: 0, failed: 0, invalidTokens: [], devices: 0 };

    const result = await this.sender.send(
      devices.map((d) => d.token),
      message,
    );
    return { ...result, devices: devices.length };
  }

  /**
   * Notify every device a user has registered.
   *
   * Never throws. A notification is a side effect of a business action that has
   * already succeeded — losing one is a nuisance, but failing the request that
   * caused it would be a fault. Tokens FCM rejects as permanently dead are
   * dropped here, so the next send does not repeat them.
   */
  async notifyUser(username: string, message: PushMessage): Promise<void> {
    try {
      const devices = await this.store.findByUsername(username);
      if (!devices.length) return;

      const result = await this.sender.send(
        devices.map((d) => d.token),
        message,
      );

      // Map the dead tokens back to the devices they came from: the identity
      // of a registration is the device, and deleting by device uses the index
      // the table already has.
      const dead = new Set(result.invalidTokens);
      const staleDevices = devices
        .filter((d) => dead.has(d.token))
        .map(({ username: owner, imei }) => ({ username: owner, imei }));
      if (staleDevices.length) await this.store.removeDevices(staleDevices);

      if (result.failed) {
        NotificationsService.log.warn(
          `Push to ${username}: ${result.sent} sent, ${result.failed} failed, ` +
            `${result.invalidTokens.length} token(s) pruned.`,
        );
      }
    } catch (err) {
      NotificationsService.log.warn(`Push to ${username} failed: ${(err as Error).message}`);
    }
  }
}
