import { Injectable } from '@nestjs/common';
import { MssqlService } from '@core/database/mssql.service';
import { MpinStorePort, SetMpinCommand, VerifyMpinQuery } from '../../domain/ports/mpin-store.port';

/**
 * MPIN store backed by the legacy Sanaad SQL Server table
 * `HMC_Sanad_DeviceRegn_tbl` (LoginID + IMEINumber → MPIN), using the exact
 * legacy semantics from the client's service mapping:
 *
 *  - UpdateMPIN/resetMPIN → `UPDATE ... SET DateFirstRegistered = GETDATE(),
 *    MPIN = @mpin WHERE LoginID = @username AND IMEINumber = @imei`
 *  - LoginMPIN → `SELECT DeviceID ... WHERE IMEINumber = @imei AND
 *    LoginID = @username AND MPIN = @mpin`
 *
 * The MPIN is stored AS RECEIVED (the mobile client pre-hashes it per the
 * framework doc) and compared with SQL equality — legacy-compatible with rows
 * the existing Sanaad app wrote, per the confirmed decision. Values are still
 * never logged (MssqlService redacts `mpin` params).
 */
@Injectable()
export class MssqlMpinStoreRepository implements MpinStorePort {
  constructor(private readonly db: MssqlService) {}

  async set(cmd: SetMpinCommand): Promise<void> {
    // Setting the MPIN also activates the registration (client flow
    // 2026-09-03: initiate creates the row with MPIN NULL + Status
    // 'Inactive'; the MPIN update flips it to 'Active').
    const updated = await this.db.execute(
      `UPDATE HMC_Sanad_DeviceRegn_tbl
          SET DateFirstRegistered = GETDATE(), MPIN = @mpin, Status = 'Active'
        WHERE LoginID = @username AND IMEINumber = @imei`,
      { username: cmd.username, imei: cmd.imei, mpin: cmd.mpin },
    );
    // The legacy flow assumes the registration row already exists (created by
    // DeviceRegistryPort.bind during onboarding). Insert as a fallback so a
    // first-time set on a fresh device cannot silently do nothing.
    if (updated.rowsAffected === 0) {
      await this.db.execute(
        `INSERT INTO HMC_Sanad_DeviceRegn_tbl (LoginID, IMEINumber, MPIN, DateFirstRegistered, AddedDt, Status)
         VALUES (@username, @imei, @mpin, GETDATE(), GETDATE(), 'Active')`,
        { username: cmd.username, imei: cmd.imei, mpin: cmd.mpin },
      );
    }
  }

  async verify(query: VerifyMpinQuery): Promise<boolean> {
    const rows = await this.db.query(
      `SELECT DeviceID
         FROM HMC_Sanad_DeviceRegn_tbl
        WHERE IMEINumber = @imei AND LoginID = @username AND MPIN = @mpin`,
      { username: query.username, imei: query.imei, mpin: query.mpin },
    );
    return rows.length > 0;
  }

  async exists(username: string, imei: string): Promise<boolean> {
    const rows = await this.db.query(
      `SELECT DeviceID
         FROM HMC_Sanad_DeviceRegn_tbl
        WHERE LoginID = @username AND IMEINumber = @imei AND MPIN IS NOT NULL`,
      { username, imei },
    );
    return rows.length > 0;
  }
}
