import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { AuthStateService } from '@core/auth/auth-state.service';
import { AuditService } from '@core/audit/audit.service';
import { AuthLifecycleEvent } from '@core/audit/audit-event';
import { MpinConfig } from '@core/config/configuration';
import { DEFAULT_LANG, Lang } from '@shared/domain/lang';
import { MPIN_STORE_PORT, MpinStorePort } from '../domain/ports/mpin-store.port';
import { OTP_PORT, OtpPort } from '../domain/ports/otp.port';
import { DEVICE_REGISTRY_PORT, DeviceRegistryPort } from '../domain/ports/device-registry.port';
import { LDAP_USER_PORT, LdapUserPort } from '../domain/ports/ldap-user.port';
import {
  ForgotMpinInitRequestDto,
  ForgotMpinInitResponseDto,
  ResetMpinRequestDto,
  SetMpinRequestDto,
} from '../interface/dto/mpin.dto';
import { StatusMessageDto } from '../interface/dto/auth.dto';

/**
 * MPIN lifecycle: set (API-4), forgot-initiate (API-6), reset (API-7). Policy is
 * enforced here; salting+hashing at rest is delegated to the MPIN store adapter
 * (MpinHasher). The AUTH_DISABLED dev bypass skips persistence and accepts
 * well-formed OTP; with AUTH_DISABLED=false the real DB/OTP path runs in every
 * environment.
 */
@Injectable()
export class MpinService {
  private readonly logger = new Logger(MpinService.name);
  private readonly devBypass: boolean;
  private readonly mpin: MpinConfig;

  constructor(
    @Inject(MPIN_STORE_PORT) private readonly store: MpinStorePort,
    @Inject(OTP_PORT) private readonly otp: OtpPort,
    @Inject(DEVICE_REGISTRY_PORT) private readonly devices: DeviceRegistryPort,
    @Inject(LDAP_USER_PORT) private readonly ldap: LdapUserPort,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly state: AuthStateService,
  ) {
    this.devBypass = config.get<boolean>('auth.disabled', false);
    this.mpin = config.getOrThrow<MpinConfig>('mpin');
  }

  async setMpin(dto: SetMpinRequestDto): Promise<StatusMessageDto> {
    const ctx = this.ctx(dto);
    if (!/^[A-Za-z0-9_-]{43}$/.test(dto.enrollmenttoken ?? '') || !this.isValidMpin(dto.mpin)) {
      return { status: 'error', message: 'Invalid or expired enrollment authorization.' };
    }
    if (this.devBypass) {
      this.logger.warn(`DEV bypass: MPIN set for "${dto.username}" not persisted.`);
    } else {
      await this.state.limit(
        'mpin-enrollment',
        dto.username.trim().toUpperCase(),
        this.mpin.maxAttempts,
        300,
      );
      const identity = await this.ldap.validate({
        username: dto.username,
        imei: dto.imeinumber,
        platform: dto.platform,
      });
      if (
        !identity.isEmployee ||
        (await this.store.exists(dto.username, dto.imeinumber)) ||
        !(await this.state.enroll(dto.username, dto.imeinumber, dto.mpin, dto.enrollmenttoken))
      ) {
        return { status: 'error', message: 'Invalid or expired enrollment authorization.' };
      }
    }

    this.audit.lifecycle(AuthLifecycleEvent.MPIN_SET, { ...ctx, status: 'success' });
    return { status: 'success', message: 'MPIN updated successfully' };
  }

  async forgotInitiate(
    dto: ForgotMpinInitRequestDto,
    lang: Lang = DEFAULT_LANG,
  ): Promise<ForgotMpinInitResponseDto> {
    const ctx = this.ctx(dto);
    let requestid = randomBytes(32).toString('base64url');
    if (!this.devBypass) {
      await this.state.limit(
        'otp-send',
        dto.username.trim().toUpperCase(),
        1,
        this.config.get<number>('otp.resendWindowSeconds', 60),
      );
      // Legacy forgetMPIN semantics: the device must already be registered for
      // this user (SELECT DeviceID ... WHERE IMEINumber AND LoginID).
      const bound = await this.devices.isBound(dto.username, dto.imeinumber);
      // Phone number for the OTP SMS comes from the corporate directory
      // (LDAP/Entra) — the same identity source API-2 uses. Email is the
      // fallback channel when the directory has no mobile for the user.
      const identity = await this.ldap.validate({
        username: dto.username,
        imei: dto.imeinumber,
        platform: dto.platform,
      });
      if (bound && identity.isEmployee) {
        requestid = (
          await this.otp.send({
            username: dto.username,
            phoneNumber: identity.phoneNumber,
            email: identity.email,
            imei: dto.imeinumber,
            purpose: 'FORGOT_MPIN',
            smsTemplate: 'forget',
            lang,
            appName: dto.appname,
            appVersion: dto.version,
            appDatetime: dto.sysdate,
          })
        ).requestId;
      }
    }
    this.audit.lifecycle(AuthLifecycleEvent.OTP_SENT, ctx);
    return {
      status: 'initiated successfully',
      requestid,
      message:
        lang === 'ar'
          ? 'إذا كنت مؤهلاً، فسيتم إرسال رمز التحقق إلى وسيلة الاتصال المسجلة.'
          : 'If eligible, a verification code will be sent to your registered contact.',
    };
  }

  async resetMpin(dto: ResetMpinRequestDto): Promise<StatusMessageDto> {
    const ctx = this.ctx(dto);
    if (!this.isValidMpin(dto.newmpin)) return this.policyError();
    const otpOk = this.devBypass
      ? /^\d{4,8}$/.test(dto.otp)
      : await this.otp.verify({
          username: dto.username,
          imei: dto.imeinumber,
          requestId: dto.requestid,
          otp: dto.otp,
          purpose: 'FORGOT_MPIN',
        });

    if (!otpOk) {
      this.audit.lifecycle(AuthLifecycleEvent.OTP_FAILED, { ...ctx, status: 'error' });
      return { status: 'error', message: 'Invalid OTP' };
    }
    if (this.devBypass) {
      this.logger.warn(`DEV bypass: MPIN reset for "${dto.username}" not persisted.`);
    } else {
      const identity = await this.ldap.validate({
        username: dto.username,
        imei: dto.imeinumber,
        platform: dto.platform,
      });
      if (
        !identity.isEmployee ||
        !(await this.state.resetMpin(dto.username, dto.imeinumber, dto.newmpin))
      ) {
        return { status: 'error', message: 'Invalid OTP' };
      }
    }

    this.audit.lifecycle(AuthLifecycleEvent.MPIN_RESET, { ...ctx, status: 'success' });
    return { status: 'success', message: 'MPIN Changed successfully' };
  }

  private ctx(dto: { username: string; imeinumber: string; platform?: string; version?: string }) {
    return {
      username: dto.username,
      deviceImei: dto.imeinumber,
      platform: dto.platform,
      appVersion: dto.version,
    };
  }

  private isValidMpin(mpin: string): boolean {
    return typeof mpin === 'string' && mpin.trim().length > 0 && mpin.length <= 1024;
  }

  private policyError(): StatusMessageDto {
    return {
      status: 'error',
      message: 'MPIN must be a non-empty client-hashed value of at most 1024 characters.',
    };
  }
}
