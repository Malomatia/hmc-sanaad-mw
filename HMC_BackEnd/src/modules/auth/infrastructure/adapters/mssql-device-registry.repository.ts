import { Injectable } from '@nestjs/common';
import { UsersDbDialect, UsersDbService } from '@core/database/users-db/users-db.service';
import {
  DeviceBindingCommand,
  DeviceRegistration,
  DeviceRegistryPort,
} from '../../domain/ports/device-registry.port';

const BIND_COLUMNS = `(LoginID, IMEINumber, MobileType, DeviceModel, OSVersion,
          DateFirstRegistered, AddedDt, AddedBy, Status, Department)`;

/** Statements that differ between the two Users DB engines. */
const SQL: Record<UsersDbDialect, { bind: string; touch: string; find: string }> = {
  mssql: {
    bind: `IF NOT EXISTS (
         SELECT 1 FROM HMC_Sanad_DeviceRegn_tbl WHERE LoginID = @username AND IMEINumber = @imei
       )
       INSERT INTO HMC_Sanad_DeviceRegn_tbl
         ${BIND_COLUMNS}
       VALUES (@username, @imei, @mobileType, @deviceModel, @osVersion,
               GETDATE(), GETDATE(), 'NODEJS', 'Inactive', @department)`,
    touch: `UPDATE HMC_Sanad_DeviceRegn_tbl
          SET LastActive = GETDATE()
        WHERE LoginID = @username AND IMEINumber = @imei`,
    find: `SELECT TOP 1 *
         FROM HMC_Sanad_DeviceRegn_tbl
        WHERE LoginID = @username AND IMEINumber = @imei`,
  },
  mysql: {
    bind: `INSERT INTO HMC_Sanad_DeviceRegn_tbl
         ${BIND_COLUMNS}
       SELECT @username, @imei, @mobileType, @deviceModel, @osVersion,
              NOW(), NOW(), 'NODEJS', 'Inactive', @department
         FROM DUAL
        WHERE NOT EXISTS (
          SELECT 1 FROM HMC_Sanad_DeviceRegn_tbl WHERE LoginID = @username AND IMEINumber = @imei
        )`,
    touch: `UPDATE HMC_Sanad_DeviceRegn_tbl
          SET LastActive = NOW()
        WHERE LoginID = @username AND IMEINumber = @imei`,
    find: `SELECT *
         FROM HMC_Sanad_DeviceRegn_tbl
        WHERE LoginID = @username AND IMEINumber = @imei
        LIMIT 1`,
  },
};

/**
 * Device-binding registry backed by the legacy `HMC_Sanad_DeviceRegn_tbl`
 * (LoginID ↔ IMEINumber). `isBound` is the exact userValidate/forgetMPIN check
 * from the client's service mapping:
 * `SELECT DeviceID FROM HMC_Sanad_DeviceRegn_tbl WHERE LoginID = @u AND IMEINumber = @imei`.
 *
 * Per the reworked initiate flow (client request 2026-09-03), a fresh binding
 * is created by /auth/initiate itself with MPIN NULL and Status 'Inactive';
 * the MPIN store flips Status to 'Active' when the MPIN is set (API-4).
 */
@Injectable()
export class MssqlDeviceRegistryRepository implements DeviceRegistryPort {
  constructor(private readonly db: UsersDbService) {}

  async bind(cmd: DeviceBindingCommand): Promise<void> {
    // Idempotent registration: create the row only when this user↔device pair
    // is not registered yet (the MPIN is written separately by the MPIN store).
    // Device context (MobileType/DeviceModel/OSVersion) comes from the request,
    // Department is the employee view's FACILITY_NAME, AddedBy marks the writer.
    await this.db.execute(
      SQL[this.db.dialect].bind,
      {
        username: cmd.username,
        imei: cmd.imei,
        mobileType: cmd.platform ?? null,
        deviceModel: cmd.deviceModel ?? null,
        osVersion: cmd.osVersion ?? null,
        department: cmd.department ?? null,
      },
    );
  }

  async isBound(username: string, imei: string): Promise<boolean> {
    const rows = await this.db.query(
      `SELECT DeviceID
         FROM HMC_Sanad_DeviceRegn_tbl
        WHERE LoginID = @username AND IMEINumber = @imei`,
      { username, imei },
    );
    return rows.length > 0;
  }

  async touch(username: string, imei: string): Promise<void> {
    await this.db.execute(SQL[this.db.dialect].touch, { username, imei });
  }

  async find(username: string, imei: string): Promise<DeviceRegistration | undefined> {
    const rows = await this.db.query<Record<string, unknown>>(SQL[this.db.dialect].find, {
      username,
      imei,
    });
    const row = rows[0];
    if (!row) return undefined;
    const value = (name: string) =>
      row[Object.keys(row).find((k) => k.toLowerCase() === name.toLowerCase()) ?? ''];
    const mpin = value('MPIN');
    const status = value('Status');
    const registered = value('DateFirstRegistered');
    return {
      mpinSet: mpin !== null && mpin !== undefined && String(mpin).trim() !== '',
      status: status === null || status === undefined ? undefined : String(status),
      registeredAt: registered instanceof Date ? registered : undefined,
    };
  }
}
