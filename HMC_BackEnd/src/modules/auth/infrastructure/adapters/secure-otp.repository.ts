import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'node:crypto';
import { AuthStateService } from '@core/auth/auth-state.service';
import { AuthConfig, OtpConfig } from '@core/config/configuration';
import { MssqlService } from '@core/database/mssql.service';
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

@Injectable()
export class SecureOtpRepository implements OtpPort {
  private readonly cfg: OtpConfig;
  private readonly secret: string;

  constructor(
    private readonly db: MssqlService,
    private readonly state: AuthStateService,
    @Inject(OTP_DELIVERY_PORT) private readonly delivery: OtpDeliveryPort,
    @Inject(OTP_EMAIL_DELIVERY_PORT) private readonly email: OtpEmailDeliveryPort,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<OtpConfig>('otp');
    this.secret = config.getOrThrow<AuthConfig>('auth').jwtSecret;
  }

  async send(cmd: SendOtpCommand): Promise<SendOtpResult> {
    const requestId = randomBytes(32).toString('base64url');
    if (!cmd.phoneNumber && !cmd.email) {
      return { requestId, status: 'NEW', mode: 'SMS', validForSeconds: this.cfg.ttlSeconds };
    }
    const otp = generateOtp(this.cfg);
    const username = cmd.username.trim().toUpperCase();
    await this.db.execute(
      `SET XACT_ABORT ON;
       BEGIN TRANSACTION;
       BEGIN TRY
         UPDATE HMC_Sanad_AuthChallenge_tbl WITH (UPDLOCK, HOLDLOCK) SET ConsumedAt = SYSUTCDATETIME()
          WHERE LoginID = @username AND DeviceIMEI = @imei AND Purpose = @purpose AND ConsumedAt IS NULL;
         INSERT INTO HMC_Sanad_AuthChallenge_tbl
           (RequestId, LoginID, DeviceIMEI, Purpose, OtpHash, ExpiresAt)
         VALUES (@requestId, @username, @imei, @purpose, @otpHash, DATEADD(SECOND, @ttl, SYSUTCDATETIME()));
         COMMIT;
       END TRY
       BEGIN CATCH
         IF @@TRANCOUNT > 0 ROLLBACK;
         THROW;
       END CATCH;`,
      {
        requestId,
        username,
        imei: cmd.imei,
        purpose: cmd.purpose,
        otpHash: this.otpHash(requestId, otp),
        ttl: this.cfg.ttlSeconds,
      },
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
    await this.db.execute(
      `UPDATE HMC_Sanad_AuthChallenge_tbl SET DeliveredAt = SYSUTCDATETIME()
        WHERE RequestId = @requestId AND ConsumedAt IS NULL`,
      { requestId },
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
    if (!cmd.purpose || !/^[A-Za-z0-9_-]{43}$/.test(cmd.requestId) || !cmd.otp) return false;
    await this.state.limit(
      'otp-verify',
      cmd.username.trim().toUpperCase(),
      this.cfg.maxAttempts,
      this.cfg.ttlSeconds,
    );
    const rows = await this.db.query<{ Verified: number }>(
      `UPDATE HMC_Sanad_AuthChallenge_tbl
          SET Attempts = Attempts + 1,
              ConsumedAt = CASE WHEN OtpHash = @otpHash THEN SYSUTCDATETIME() ELSE NULL END
        OUTPUT CASE WHEN INSERTED.ConsumedAt IS NOT NULL THEN 1 ELSE 0 END AS Verified
        WHERE RequestId = @requestId AND LoginID = @username AND DeviceIMEI = @imei
          AND Purpose = @purpose AND ExpiresAt > SYSUTCDATETIME() AND DeliveredAt IS NOT NULL
          AND ConsumedAt IS NULL AND Attempts < @maximum`,
      {
        requestId: cmd.requestId,
        username: cmd.username.trim().toUpperCase(),
        imei: cmd.imei,
        purpose: cmd.purpose,
        otpHash: this.otpHash(cmd.requestId, cmd.otp),
        maximum: this.cfg.maxAttempts,
      },
    );
    return rows[0]?.Verified === 1;
  }

  private otpHash(requestId: string, otp: string): string {
    return createHmac('sha256', this.secret)
      .update(`sanaad-otp\0${requestId}\0${otp}`)
      .digest('hex');
  }
}
