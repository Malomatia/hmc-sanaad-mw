/** Where a registration came from — FCM behaves the same for both. */
export type DevicePlatform = 'android' | 'ios';

/**
 * One app installation's FCM token.
 *
 * Keyed by (username, IMEI) rather than by the token itself: FCM reissues a
 * token on reinstall, data clear and periodically on its own, so the token is
 * the volatile part and the device is the stable one. Registering the same
 * device twice replaces its token instead of accumulating dead ones.
 *
 * A user may hold SEVERAL of these. Phone plus tablet is ordinary, and a single
 * stored token would silently drop the notification for whichever device
 * registered first.
 */
export interface DeviceToken {
  username: string;
  /** Device identifier the app already sends on login. */
  imei: string;
  token: string;
  platform?: DevicePlatform;
  /** App build that registered it — useful when a payload shape changes. */
  appVersion?: string;
  updatedAt?: Date;
}
