import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { AuthStateService } from '@core/auth/auth-state.service';
import { OtpConfig } from '@core/config/configuration';
import { UsersDbService } from '@core/database/users-db/users-db.service';
import {
  OtpPort,
  SendOtpCommand,
  SendOtpResult,
  VerifyOtpCommand,
} from '../../domain/ports/otp.port';
import { OTP_DELIVERY_PORT, OtpDeliveryPort } from '../../domain/ports/otp-delivery.port';
import {
  OTP_EMAIL_DELIVERY_PORT,
  OtpEmailDeliveryPort,
} from '../../domain/ports/otp-email-delivery.port';
import { generateOtp } from './otp-generator.util';
import { mysqlSecureOtp } from './secure-otp.mysql';

@Injectable()
export class SecureOtpRepository implements OtpPort {
  private readonly cfg: OtpConfig;

  constructor(
    private readonly db: UsersDbService,
    private readonly state: AuthStateService,
    @Inject(OTP_DELIVERY_PORT) private readonly delivery: OtpDeliveryPort,
    @Inject(OTP_EMAIL_DELIVERY_PORT) private readonly email: OtpEmailDeliveryPort,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<OtpConfig>('otp');
  }

  async send(cmd: SendOtpCommand): Promise<SendOtpResult> {
    const requestId = randomBytes(32).toString('base64url');
    if (!cmd.phoneNumber && !cmd.email) {
      return { requestId, status: 'NEW', mode: 'SMS', validForSeconds: this.cfg.ttlSeconds };
    }
    const otp = generateOtp(this.cfg);
    const username = cmd.username.trim().toUpperCase();
    const requestType = cmd.purpose === 'ONBOARDING' ? 'USER_REG' : 'FORGET_MPIN';
    const scope = { requestId: this.storageId(requestId), username, imei: cmd.imei, requestType };
    const suppliedDate = cmd.appDatetime ? new Date(cmd.appDatetime) : new Date();
    const stored = {
      ...scope,
      otp,
      appName: cmd.appName || 'Sanaad',
      appVersion: cmd.appVersion || '1.0.0',
      appDatetime: Number.isNaN(suppliedDate.getTime()) ? new Date() : suppliedDate,
      sendMode: cmd.phoneNumber ? 'SMS' : 'Email',
    };
    if (this.db.dialect === 'mysql') await mysqlSecureOtp.store(this.db, stored);
    else
      await this.db.execute(
        `SET XACT_ABORT ON;
       BEGIN TRANSACTION;
       BEGIN TRY
         DECLARE @seqNo bigint;
         SELECT @seqNo = MAX(SeqNo) FROM HMC_RHAP_OTP_tbl WITH (UPDLOCK, HOLDLOCK)
          WHERE LoginID = @username AND DeviceIMEINumber COLLATE Latin1_General_100_BIN2 = @imei;
         IF @seqNo IS NULL
           INSERT INTO HMC_RHAP_OTP_tbl
             (LoginID, DeviceIMEINumber, OTPValue, OTPSentDateTime, RequestId,
              AppName, AppVersion, AppDatetime, OTPValidationAttemptCount, RequestType, OTPStatus, OTPSendMode)
           VALUES (@username, @imei, @otp, GETDATE(), @requestId,
                   @appName, @appVersion, @appDatetime, 0, @requestType, '0', @sendMode);
         ELSE
           UPDATE HMC_RHAP_OTP_tbl
              SET OTPValue = @otp, OTPSentDateTime = GETDATE(), RequestId = @requestId,
                  AppName = @appName, AppVersion = @appVersion, AppDatetime = @appDatetime,
                  OTPValidationAttemptCount = 0, RequestType = @requestType, OTPStatus = '0', OTPSendMode = @sendMode
            WHERE SeqNo = @seqNo;
         COMMIT;
       END TRY
       BEGIN CATCH
         IF @@TRANCOUNT > 0 ROLLBACK;
         THROW;
       END CATCH;`,
        stored,
      );
    if (cmd.phoneNumber) {
      await this.delivery.sendOtpSms(
        cmd.phoneNumber,
        otp,
        cmd.purpose,
        cmd.lang ?? 'en',
        cmd.smsTemplate,
      );
    } else {
      await this.email.sendOtpEmail(cmd.email!, otp, cmd.purpose, cmd.lang ?? 'en');
    }
    const activation = { ...scope, ttl: this.cfg.ttlSeconds };
    const activated =
      this.db.dialect === 'mysql'
        ? await mysqlSecureOtp.activate(this.db, activation)
        : (
            await this.db.execute(
              `UPDATE HMC_RHAP_OTP_tbl SET OTPStatus = '1'
        WHERE RequestId COLLATE Latin1_General_100_BIN2 = @requestId AND LoginID = @username
          AND DeviceIMEINumber COLLATE Latin1_General_100_BIN2 = @imei AND RequestType = @requestType
          AND OTPStatus = '0' AND OTPSentDateTime > DATEADD(SECOND, -@ttl, GETDATE())`,
              activation,
            )
          ).rowsAffected;
    if (activated !== 1)
      throw new ConflictException(
        'The verification request is no longer valid. Please request a new code.',
      );
    return {
      requestId,
      status: 'NEW',
      mode: cmd.phoneNumber ? 'SMS' : 'Email',
      validForSeconds: this.cfg.ttlSeconds,
      ...(this.cfg.inResponse && cmd.purpose === 'ONBOARDING' ? { otp } : {}),
    };
  }

  async verify(cmd: VerifyOtpCommand): Promise<boolean> {
    if (
      !['ONBOARDING', 'FORGOT_MPIN'].includes(cmd.purpose ?? '') ||
      !/^[A-Za-z0-9_-]{43}$/.test(cmd.requestId) ||
      !cmd.otp
    )
      return false;
    await this.state.limit(
      'otp-verify',
      cmd.username.trim().toUpperCase(),
      this.cfg.maxAttempts,
      this.cfg.ttlSeconds,
    );
    // No RequestType predicate: /auth/otp/validate is the shared OTP step of
    // BOTH journeys (onboarding and forgot-MPIN), so it must accept a code
    // sent by either. What a validated OTP can then do is decided by the
    // registration row, not by the OTP: the grant it yields enrolls only an
    // Inactive row without an MPIN, and resets only an Active row with one.
    const params = {
      requestId: this.storageId(cmd.requestId),
      username: cmd.username.trim().toUpperCase(),
      imei: cmd.imei,
      otp: cmd.otp.trim(),
      maximum: this.cfg.maxAttempts,
      ttl: this.cfg.ttlSeconds,
    };
    const rows =
      this.db.dialect === 'mysql'
        ? await mysqlSecureOtp.verify(this.db, params)
        : await this.db.query<{ Verified: number }>(
            `UPDATE HMC_RHAP_OTP_tbl
          SET OTPValidationAttemptCount = ISNULL(OTPValidationAttemptCount, 0) + 1,
              OTPStatus = CASE WHEN LTRIM(RTRIM(CONVERT(nvarchar(256), OTPValue))) COLLATE Latin1_General_100_BIN2 = @otp
                               THEN '0' ELSE OTPStatus END
        OUTPUT CASE WHEN INSERTED.OTPStatus = '0' THEN 1 ELSE 0 END AS Verified
        WHERE RequestId COLLATE Latin1_General_100_BIN2 = @requestId AND LoginID = @username
          AND DeviceIMEINumber COLLATE Latin1_General_100_BIN2 = @imei
          AND OTPStatus = '1' AND ISNULL(OTPValidationAttemptCount, 0) < @maximum
          AND OTPSentDateTime <= GETDATE() AND OTPSentDateTime > DATEADD(SECOND, -@ttl, GETDATE())`,
            params,
          );
    return rows.length === 1 && rows[0].Verified === 1;
  }

  private storageId(requestId: string): string {
    return createHash('sha256').update(requestId).digest('hex').slice(0, 32).toUpperCase();
  }
}
