import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { MssqlService } from '@core/database/mssql.service';
import { OtpConfig } from '@core/config/configuration';
import { DEFAULT_LANG } from '@shared/domain/lang';
import {
  OtpMode,
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

/** Latest OTP row for a user+device (legacy OTPValidate/OTPResend projection). */
interface OtpRow {
  SeqNo: number;
  DiffInSeconds: number;
  OTPValue: string | number;
  OTPStatus?: string | number | null;
  OTPSendMode?: string | null;
}

/**
 * OTP storage backed by the legacy `HMC_RHAP_OTP_tbl` — ONE row per
 * (LoginID, DeviceIMEINumber), per the reworked flow (client request
 * 2026-09-05): sending an OTP UPDATEs the user+device's newest row in place
 * (INSERT only when none exists), and a still-valid unused OTP is KEPT and
 * reported as PENDING instead of overwritten (the old 429 resend window is
 * gone). The OTP value is stored as-is for legacy compatibility — per the
 * confirmed decision — but is never logged (MssqlService redacts it).
 *
 * Channel: SMS when the employee has a phone (OtpDeliveryPort); Email
 * (OtpEmailDeliveryPort → SMTP EmailService, OTPSendMode='Email') when they
 * only have an email address.
 *
 * Used/attempts state is durable where the table allows: a successful verify
 * marks OTPStatus='0' (used) and every verify attempt increments
 * OTPValidationAttemptCount; the in-memory maps remain the authoritative
 * fast path within one process.
 */
@Injectable()
export class MssqlOtpRepository implements OtpPort {
  private readonly logger = new Logger(MssqlOtpRepository.name);
  private readonly cfg: OtpConfig;
  /** Failed verify attempts per SeqNo (mirrored best-effort into the table). */
  private readonly attempts = new Map<string, number>();
  /** SeqNos already verified successfully — single-use within the TTL. */
  private readonly consumed = new Set<string>();

  constructor(
    private readonly db: MssqlService,
    @Inject(OTP_DELIVERY_PORT) private readonly delivery: OtpDeliveryPort,
    @Inject(OTP_EMAIL_DELIVERY_PORT) private readonly emailDelivery: OtpEmailDeliveryPort,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<OtpConfig>('otp');
  }

  async send(cmd: SendOtpCommand): Promise<SendOtpResult> {
    const latest = await this.latestRow(cmd.username, cmd.imei);
    // A still-valid, unused OTP is kept: the client can re-enter it, so the
    // caller answers vflag=Pending instead of getting a new code (or a 429).
    if (latest && this.isPending(latest)) {
      return {
        requestId: String(latest.SeqNo),
        status: 'PENDING',
        mode: latest.OTPSendMode === 'Email' ? 'Email' : 'SMS',
        validForSeconds: Math.max(this.cfg.ttlSeconds - latest.DiffInSeconds, 0),
      };
    }

    const mode: OtpMode | undefined = cmd.phoneNumber ? 'SMS' : cmd.email ? 'Email' : undefined;
    if (!mode) {
      throw new HttpException(
        'No registered phone number or email address found for this user.',
        HttpStatus.CONFLICT,
      );
    }

    const otp = generateOtp(this.cfg);
    // Every legacy column is populated except a NULL OTPSendMode is no more —
    // it now records the channel. RequestId is NOT NULL — a fresh opaque
    // correlation id per send (UUID hex, e.g. 04D0B9C63F2142BD84E8D5A9D527AC7D);
    // the mobile `requestid` stays SeqNo, the documented validation key.
    // AppName/AppVersion/AppDatetime mirror the client context.
    const params = {
      username: cmd.username,
      imei: cmd.imei,
      otp,
      requestId: randomUUID().replace(/-/g, '').toUpperCase(),
      appName: cmd.appName || 'Sanaad',
      appVersion: cmd.appVersion || '1.0.0',
      appDatetime: MssqlOtpRepository.safeDate(cmd.appDatetime),
      requestType: MssqlOtpRepository.REQUEST_TYPE[cmd.purpose],
      sendMode: mode,
    };

    // Upsert (client request 2026-09-05): overwrite the user+device's newest
    // row instead of accumulating one row per send; INSERT only the first time.
    const updated = await this.db.execute<{ SeqNo: number }>(
      `UPDATE HMC_RHAP_OTP_tbl
          SET OTPValue = @otp, OTPSentDateTime = GETDATE(), RequestId = @requestId,
              AppName = @appName, AppVersion = @appVersion, AppDatetime = @appDatetime,
              OTPValidationAttemptCount = 0, RequestType = @requestType,
              OTPStatus = '1', OTPSendMode = @sendMode
       OUTPUT INSERTED.SeqNo AS SeqNo
        WHERE SeqNo = (SELECT MAX(SeqNo) FROM HMC_RHAP_OTP_tbl
                        WHERE LoginID = @username AND DeviceIMEINumber = @imei)`,
      params,
    );
    let seqNo = updated.rows[0]?.SeqNo;
    if (updated.rowsAffected === 0) {
      const inserted = await this.db.execute<{ SeqNo: number }>(
        `INSERT INTO HMC_RHAP_OTP_tbl
           (LoginID, DeviceIMEINumber, OTPValue, OTPSentDateTime, RequestId,
            AppName, AppVersion, AppDatetime, OTPValidationAttemptCount,
            RequestType, OTPStatus, OTPSendMode)
         OUTPUT INSERTED.SeqNo AS SeqNo
         VALUES (@username, @imei, @otp, GETDATE(), @requestId,
                 @appName, @appVersion, @appDatetime, 0, @requestType, '1', @sendMode)`,
        params,
      );
      seqNo = inserted.rows[0]?.SeqNo ?? (await this.latestRow(cmd.username, cmd.imei))?.SeqNo;
    }
    if (seqNo === undefined) {
      throw new HttpException(
        'Could not create the OTP request.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // The SeqNo is reused on an overwrite, so its in-memory verify state
    // (consumed / failed attempts) belongs to the PREVIOUS code — reset it.
    const requestId = String(seqNo);
    this.attempts.delete(requestId);
    this.consumed.delete(requestId);

    // Raw OTP goes only to the delivery ports — never logged, never returned.
    // SMS when the user has a phone; email is the no-mobile fallback channel.
    if (mode === 'SMS') {
      await this.delivery.sendOtpSms(cmd.phoneNumber!, otp, cmd.purpose, cmd.lang ?? DEFAULT_LANG);
    } else {
      await this.emailDelivery.sendOtpEmail(cmd.email!, otp, cmd.purpose, cmd.lang ?? DEFAULT_LANG);
    }
    return { requestId, status: 'NEW', mode, validForSeconds: this.cfg.ttlSeconds };
  }

  async verify(cmd: VerifyOtpCommand): Promise<boolean> {
    const row = await this.latestRow(cmd.username, cmd.imei);
    if (!row) return false;
    const requestId = String(row.SeqNo);
    // The verification must target the OTP the client was actually issued.
    if (cmd.requestId !== requestId) return false;
    if (this.consumed.has(requestId)) return false;
    // OTPStatus '0' = already used (durable across restarts).
    if (row.OTPStatus !== null && row.OTPStatus !== undefined && String(row.OTPStatus) === '0') {
      return false;
    }
    if (row.DiffInSeconds > this.cfg.ttlSeconds) return false;

    const failed = this.attempts.get(requestId) ?? 0;
    if (failed >= this.cfg.maxAttempts) {
      this.logger.warn(`OTP request ${requestId} locked after ${failed} failed attempts.`);
      return false;
    }

    if (!MssqlOtpRepository.safeEquals(String(row.OTPValue).trim(), cmd.otp.trim())) {
      this.attempts.set(requestId, failed + 1);
      await this.recordAttempt(row.SeqNo, false);
      return false;
    }

    this.attempts.delete(requestId);
    this.consumed.add(requestId);
    await this.recordAttempt(row.SeqNo, true);
    return true;
  }

  /** Legacy OTPValidate projection: newest row for this user+device. */
  private async latestRow(username: string, imei: string): Promise<OtpRow | undefined> {
    const rows = await this.db.query<OtpRow>(
      `SELECT TOP 1 SeqNo,
              DATEDIFF(SECOND, OTPSentDateTime, GETDATE()) AS DiffInSeconds,
              OTPValue, OTPStatus, OTPSendMode
         FROM HMC_RHAP_OTP_tbl WITH (NOLOCK)
        WHERE LoginID = @username AND DeviceIMEINumber = @imei
        ORDER BY SeqNo DESC`,
      { username, imei },
    );
    return rows[0];
  }

  /** Unexpired, not yet used (durably or in this process). */
  private isPending(row: OtpRow): boolean {
    if (row.DiffInSeconds > this.cfg.ttlSeconds) return false;
    if (this.consumed.has(String(row.SeqNo))) return false;
    if (row.OTPStatus !== null && row.OTPStatus !== undefined && String(row.OTPStatus) !== '1') {
      return false;
    }
    return true;
  }

  /**
   * Best-effort durable verify state: every attempt bumps
   * OTPValidationAttemptCount; success also marks the row used
   * (OTPStatus='0'). A failure here must not change the verify outcome.
   */
  private async recordAttempt(seqNo: number, success: boolean): Promise<void> {
    try {
      await this.db.execute(
        `UPDATE HMC_RHAP_OTP_tbl
            SET OTPValidationAttemptCount = ISNULL(OTPValidationAttemptCount, 0) + 1
                ${success ? ", OTPStatus = '0'" : ''}
          WHERE SeqNo = @seqNo`,
        { seqNo },
      );
    } catch (err) {
      this.logger.warn(`Could not persist verify state for SeqNo ${seqNo}: ${(err as Error).message}`);
    }
  }

  /** Legacy RequestType values per OTP purpose. */
  private static readonly REQUEST_TYPE: Record<SendOtpCommand['purpose'], string> = {
    ONBOARDING: 'USER_REG',
    FORGOT_MPIN: 'FORGET_MPIN',
  };

  /** Client `sysdate` as a Date for the AppDatetime column; now when absent/invalid. */
  private static safeDate(value?: string): Date {
    const parsed = value ? new Date(value) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private static safeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }
}
