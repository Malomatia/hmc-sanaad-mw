import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MotcSmsDbService } from '@core/database/motc-sms-db.service';
import { MssqlQueryError } from '@core/database/mssql.error';
import { MotcSmsConfig, SmsConfig } from '@core/config/configuration';
import { OtpDeliveryPort } from '../../domain/ports/otp-delivery.port';
import { OtpPurpose } from '../../domain/ports/otp.port';

/** SQL Server duplicate-key errors (PK violation / unique index). */
const DUPLICATE_KEY_ERRORS = new Set([2601, 2627]);
const INSERT_RETRIES = 5;

/**
 * OTP SMS delivery via the MOTC SMS gateway outbox (OTP_DELIVERY=motc, the
 * default): the OTP message is INSERTed into `MOTC_SMS_PushTable` following
 * the client's documented column list — the row IS the SMS, the gateway
 * pushes pending rows from their side. Pure delivery: storage and validation
 * of the OTP live in the OtpPort store (HMC_RHAP_OTP_tbl with
 * OTP_STORE=legacy), so this adapter keeps no state and returns nothing.
 *
 * MessageID is generated as MAX+1 and retried on a duplicate-key race — the
 * same scheme the MOTC store adapter uses. The raw OTP travels only inside
 * MessageBody and is never logged (MotcSmsDbService redacts the param).
 */
@Injectable()
export class MotcPushOtpDeliveryAdapter implements OtpDeliveryPort {
  private readonly logger = new Logger(MotcPushOtpDeliveryAdapter.name);
  private readonly motc: MotcSmsConfig;
  private readonly messageTemplate: string;

  constructor(
    private readonly db: MotcSmsDbService,
    config: ConfigService,
  ) {
    this.motc = config.getOrThrow<MotcSmsConfig>('motcSms');
    this.messageTemplate = config.getOrThrow<SmsConfig>('sms').messageTemplate;
    if (!/^[A-Za-z0-9_.[\]]+$/.test(this.motc.table)) {
      throw new Error(`Invalid MOTC_SMS_TABLE "${this.motc.table}" — not a SQL identifier.`);
    }
  }

  async sendOtpSms(phoneNumber: string, otp: string, purpose: OtpPurpose): Promise<void> {
    const messageBody = this.messageTemplate.replace('{otp}', otp);
    const appId = this.motc.appId || null;
    for (let attempt = 1; attempt <= INSERT_RETRIES; attempt++) {
      const next = await this.db.query<{ NextId: number }>(
        `SELECT ISNULL(MAX(MessageID), 0) + 1 AS NextId FROM ${this.motc.table} WITH (NOLOCK)`,
      );
      const messageId = next[0]?.NextId ?? 1;
      try {
        await this.db.execute(
          `INSERT INTO ${this.motc.table}
             (MessageID, ToAddress, MessageBody, AddedTimeStamp, ProcessedState,
              ProcessedTimeStamp, Priority, ServiceID, SubjectID, LANGUAGE_ID,
              RecipientAddressType, MessageSendScheduleDateTime, MessageExpireMinutes,
              CustomerID, FromAddress, MaskMessageLog, ApplicationID,
              BusinessParam1, BusinessParam2)
           VALUES
             (@messageId, @toAddress, @messageBody, GETDATE(), @processedState,
              NULL, @priority, @serviceId, @subjectId, @languageId,
              @recipientAddressType, GETDATE(), @messageExpireMinutes,
              @customerId, @fromAddress, @maskMessageLog, @applicationId,
              @businessParam1, @businessParam2)`,
          {
            messageId,
            toAddress: phoneNumber,
            messageBody,
            processedState: this.motc.processedState,
            priority: this.motc.priority,
            serviceId: appId,
            subjectId: this.motc.subjectId || null,
            languageId: this.motc.languageId,
            recipientAddressType: this.motc.recipientAddressType,
            messageExpireMinutes: this.motc.messageExpireMinutes,
            customerId: this.motc.customerId || null,
            fromAddress: this.motc.fromAddress || appId,
            maskMessageLog: this.motc.maskMessageLog,
            applicationId: appId,
            businessParam1: this.motc.businessParam1 || purpose,
            businessParam2: this.motc.businessParam2 || null,
          },
        );
        this.logger.log(`OTP SMS queued (${purpose}) as push MessageID=${messageId}.`);
        return;
      } catch (err) {
        const sqlError = (err as MssqlQueryError).sqlErrorNumber;
        if (sqlError !== undefined && DUPLICATE_KEY_ERRORS.has(sqlError) && attempt < INSERT_RETRIES) {
          this.logger.warn(
            `MessageID ${messageId} raced a concurrent insert — retrying (${attempt}/${INSERT_RETRIES}).`,
          );
          continue;
        }
        throw err;
      }
    }
    throw new HttpException('Could not queue the OTP SMS.', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
