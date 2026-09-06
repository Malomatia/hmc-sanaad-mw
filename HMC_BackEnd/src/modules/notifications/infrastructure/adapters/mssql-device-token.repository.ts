import { Injectable, Logger } from '@nestjs/common';
import { MssqlService } from '@core/database/mssql.service';
import { MssqlQueryError } from '@core/database/mssql.error';
import { DeviceToken, DevicePlatform } from '../../domain/device-token';
import { DeviceTokenStorePort } from '../../domain/ports/device-token-store.port';

/** Kept next to `HMC_Sanad_DeviceRegn_tbl`, keyed the same way. */
const TABLE = 'HMC_Sanad_DeviceToken_tbl';

/** SQL Server "Invalid object name" — i.e. the table has not been created. */
const INVALID_OBJECT_NAME = 208;

/**
 * FCM tokens in the Sanaad SQL Server, alongside the device-binding table this
 * one mirrors the key of (LoginID + IMEINumber).
 *
 * A separate table rather than a column on `HMC_Sanad_DeviceRegn_tbl`: that row
 * is the MPIN/trust record and outlives a notification registration, and a user
 * legitimately has more than one device. `tools/notifications-schema.sql` holds
 * the DDL.
 *
 * Until the table exists every method degrades to a warning instead of an
 * exception. Push is an accessory to a request, and a missing table must not
 * turn submitting a leave request into a 500.
 */
@Injectable()
export class MssqlDeviceTokenRepository implements DeviceTokenStorePort {
  private static readonly log = new Logger(MssqlDeviceTokenRepository.name);
  /** Logged once, not per call — a missing table is a deployment step. */
  private static warned = false;

  constructor(private readonly db: MssqlService) {}

  async save(token: DeviceToken): Promise<void> {
    await this.guard('save', async () => {
      // One row per device: re-registering the same device replaces its token
      // rather than leaving the previous one behind to fail forever.
      await this.db.execute(
        `MERGE ${TABLE} AS target
          USING (SELECT @username AS LoginID, @imei AS IMEINumber) AS source
             ON target.LoginID = source.LoginID AND target.IMEINumber = source.IMEINumber
         WHEN MATCHED THEN
              UPDATE SET DeviceTokenValue = @token, Platform = @platform,
                         AppVersion = @appVersion, UpdatedAt = GETDATE()
         WHEN NOT MATCHED THEN
              INSERT (LoginID, IMEINumber, DeviceTokenValue, Platform, AppVersion, UpdatedAt)
              VALUES (@username, @imei, @token, @platform, @appVersion, GETDATE());`,
        {
          username: token.username,
          imei: token.imei,
          token: token.token,
          platform: token.platform ?? null,
          appVersion: token.appVersion ?? null,
        },
      );
    });
  }

  async findByUsername(username: string): Promise<DeviceToken[]> {
    return (
      (await this.guard('findByUsername', async () => {
        const rows = await this.db.query<Record<string, unknown>>(
          `SELECT LoginID, IMEINumber, DeviceTokenValue, Platform, AppVersion, UpdatedAt
             FROM ${TABLE}
            WHERE LoginID = @username AND DeviceTokenValue IS NOT NULL`,
          { username },
        );
        return rows.map((r) => ({
          username: String(r.LoginID),
          imei: String(r.IMEINumber),
          token: String(r.DeviceTokenValue),
          platform: (r.Platform as DevicePlatform) ?? undefined,
          appVersion: r.AppVersion ? String(r.AppVersion) : undefined,
          updatedAt: r.UpdatedAt ? new Date(r.UpdatedAt as string) : undefined,
        }));
      })) ?? []
    );
  }

  async remove(username: string, imei: string): Promise<void> {
    await this.guard('remove', async () => {
      await this.db.execute(
        `DELETE FROM ${TABLE} WHERE LoginID = @username AND IMEINumber = @imei`,
        { username, imei },
      );
    });
  }

  async removeDevices(
    devices: readonly { username: string; imei: string }[],
  ): Promise<void> {
    if (!devices.length) return;
    await this.guard('removeDevices', async () => {
      // Keyed on (LoginID, IMEINumber) — the pair the unique index already
      // covers. Deleting by token value instead would need an index over a
      // 4000-character column, and SQL Server caps a nonclustered key at 1700
      // bytes: it warns that inserting a long token could fail.
      //
      // Named binds only; the driver has no array parameter and building the
      // predicate by interpolation would be an injection point.
      const binds: Record<string, unknown> = {};
      const predicates = devices.map(({ username, imei }, i) => {
        binds[`u${i}`] = username;
        binds[`i${i}`] = imei;
        return `(LoginID = @u${i} AND IMEINumber = @i${i})`;
      });
      await this.db.execute(
        `DELETE FROM ${TABLE} WHERE ${predicates.join(' OR ')}`,
        binds,
      );
    });
  }

  /**
   * Run `work`, downgrading every failure to a warning.
   *
   * Registering for push is an accessory to using the app, and the two
   * foreseeable failures here are both deployment states rather than bugs: the
   * table not created yet, and the Users DB pool being down. Neither should
   * turn a login — or a leave request — into a 500.
   *
   * The missing table is matched on the SQL Server error NUMBER; the message
   * is only a fallback, since it is localized on some servers.
   */
  private async guard<T>(operation: string, work: () => Promise<T>): Promise<T | undefined> {
    try {
      return await work();
    } catch (err) {
      const message = (err as Error)?.message ?? '';
      const missingTable =
        (err instanceof MssqlQueryError && err.sqlErrorNumber === INVALID_OBJECT_NAME) ||
        /invalid object name/i.test(message);

      if (missingTable) {
        if (!MssqlDeviceTokenRepository.warned) {
          MssqlDeviceTokenRepository.warned = true;
          MssqlDeviceTokenRepository.log.warn(
            `${TABLE} does not exist yet — push registrations are being discarded. ` +
              'Apply tools/notifications-schema.sql.',
          );
        }
        return undefined;
      }
      MssqlDeviceTokenRepository.log.warn(`Device-token ${operation} failed: ${message}`);
      return undefined;
    }
  }
}
