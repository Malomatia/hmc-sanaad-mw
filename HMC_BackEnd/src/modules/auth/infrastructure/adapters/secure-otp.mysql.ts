import { mysqlExact as exact, UsersDbService } from '@core/database/users-db/users-db.service';

/**
 * MySQL versions of SecureOtpRepository's statements (USERS_DB_DRIVER=mysql).
 * Same approach as auth-state.mysql.ts: SQL Server's single batches become a
 * transaction of separate statements, `FOR UPDATE` replaces
 * `WITH (UPDLOCK, HOLDLOCK)`, `mysqlExact` replaces
 * `COLLATE Latin1_General_100_BIN2`, and the results keep the SQL Server shape.
 */

const OTP_TABLE = 'HMC_RHAP_OTP_tbl';

// A type alias, not an interface: only aliases are assignable to the
// `Record<string, unknown>` bind maps the executor takes.
type OtpScope = {
  requestId: string;
  username: string;
  imei: string;
};

export const mysqlSecureOtp = {
  /** Store a new OTP (inactive, OTPStatus '0') in the user+device's single row. */
  store(
    db: UsersDbService,
    params: OtpScope & {
      requestType: string;
      otp: string;
      appName: string;
      appVersion: string;
      appDatetime: Date;
      sendMode: string;
    },
  ): Promise<void> {
    return db.transaction(async (tx) => {
      const [latest] = await tx.query<{ SeqNo: number | null }>(
        `SELECT MAX(SeqNo) AS SeqNo FROM ${OTP_TABLE}
          WHERE LoginID = @username AND ${exact('DeviceIMEINumber', '@imei')}
          FOR UPDATE`,
        params,
      );
      if (latest?.SeqNo == null) {
        await tx.execute(
          `INSERT INTO ${OTP_TABLE}
             (LoginID, DeviceIMEINumber, OTPValue, OTPSentDateTime, RequestId,
              AppName, AppVersion, AppDatetime, OTPValidationAttemptCount, RequestType, OTPStatus, OTPSendMode)
           VALUES (@username, @imei, @otp, NOW(), @requestId,
                   @appName, @appVersion, @appDatetime, 0, @requestType, '0', @sendMode)`,
          params,
        );
      } else {
        await tx.execute(
          `UPDATE ${OTP_TABLE}
              SET OTPValue = @otp, OTPSentDateTime = NOW(), RequestId = @requestId,
                  AppName = @appName, AppVersion = @appVersion, AppDatetime = @appDatetime,
                  OTPValidationAttemptCount = 0, RequestType = @requestType, OTPStatus = '0', OTPSendMode = @sendMode
            WHERE SeqNo = @seqNo`,
          { ...params, seqNo: latest.SeqNo },
        );
      }
    });
  },

  /** Make the delivered OTP usable (OTPStatus '1'); the rows it matched. */
  async activate(
    db: UsersDbService,
    params: OtpScope & { requestType: string; ttl: number },
  ): Promise<number> {
    const result = await db.execute(
      `UPDATE ${OTP_TABLE} SET OTPStatus = '1'
        WHERE ${exact('RequestId', '@requestId')} AND LoginID = @username
          AND ${exact('DeviceIMEINumber', '@imei')} AND RequestType = @requestType
          AND OTPStatus = '0' AND OTPSentDateTime > DATE_SUB(NOW(), INTERVAL @ttl SECOND)`,
      params,
    );
    return result.rowsAffected;
  },

  /**
   * Count the attempt and, on a match, spend the OTP (OTPStatus '0'). One row
   * per matching request, like SQL Server's OUTPUT; the caller accepts
   * exactly one verified row.
   */
  verify(
    db: UsersDbService,
    params: OtpScope & { otp: string; maximum: number; ttl: number },
  ): Promise<{ Verified: number }[]> {
    return db.transaction(async (tx) => {
      const rows = await tx.query<{ SeqNo: number; Matched: number }>(
        `SELECT SeqNo,
                CASE WHEN CAST(TRIM(CAST(OTPValue AS CHAR(256))) AS BINARY) = @otp THEN 1 ELSE 0 END AS Matched
           FROM ${OTP_TABLE}
          WHERE ${exact('RequestId', '@requestId')} AND LoginID = @username
            AND ${exact('DeviceIMEINumber', '@imei')}
            AND OTPStatus = '1' AND IFNULL(OTPValidationAttemptCount, 0) < @maximum
            AND OTPSentDateTime <= NOW() AND OTPSentDateTime > DATE_SUB(NOW(), INTERVAL @ttl SECOND)
          FOR UPDATE`,
        params,
      );
      const verified: { Verified: number }[] = [];
      for (const row of rows) {
        const matched = Number(row.Matched) === 1 ? 1 : 0;
        await tx.execute(
          `UPDATE ${OTP_TABLE}
              SET OTPValidationAttemptCount = IFNULL(OTPValidationAttemptCount, 0) + 1,
                  OTPStatus = CASE WHEN @matched = 1 THEN '0' ELSE OTPStatus END
            WHERE SeqNo = @seqNo`,
          { seqNo: row.SeqNo, matched },
        );
        verified.push({ Verified: matched });
      }
      return verified;
    });
  },
};
