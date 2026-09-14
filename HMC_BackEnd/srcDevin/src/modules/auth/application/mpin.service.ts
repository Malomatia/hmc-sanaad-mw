import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
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
    config: ConfigService,
  ) {
    this.devBypass = config.get<boolean>('auth.disabled', false);
    this.mpin = config.getOrThrow<MpinConfig>('mpin');
  }

  async setMpin(dto: SetMpinRequestDto): Promise<StatusMessageDto> {
    const ctx = this.ctx(dto);

    if (this.devBypass) {
      this.logger.warn(`DEV bypass: MPIN set for "${dto.username}" not persisted.`);
    } else {
      await this.devices.bind({
        username: dto.username,
        imei: dto.imeinumber,
        platform: dto.platform,
      });
      await this.store.set({ username: dto.username, imei: dto.imeinumber, mpin: dto.mpin });
    }

    this.audit.lifecycle(AuthLifecycleEvent.MPIN_SET, { ...ctx, status: 'success' });
    return { status: 'success', message: 'MPIN updated successfully' };
  }

  async forgotInitiate(
    dto: ForgotMpinInitRequestDto,
    lang: Lang = DEFAULT_LANG,
  ): Promise<ForgotMpinInitResponseDto> {
    const ctx = this.ctx(dto);
    let requestid: string;
    if (this.devBypass) {
      requestid = randomUUID().replace(/-/g, '').toUpperCase();
    } else {
      // Legacy forgetMPIN semantics: the device must already be registered for
      // this user (SELECT DeviceID ... WHERE IMEINumber AND LoginID).
      if (!(await this.devices.isBound(dto.username, dto.imeinumber))) {
        this.audit.lifecycle(AuthLifecycleEvent.OTP_FAILED, { ...ctx, status: 'error' });
        return { status: 'error', message: 'Device is not registered for this user.' };
      }
      // Phone number for the OTP SMS comes from the corporate directory
      // (LDAP/Entra) — the same identity source API-2 uses. Email is the
      // fallback channel when the directory has no mobile for the user.
      const identity = await this.ldap.validate({
        username: dto.username,
        imei: dto.imeinumber,
        platform: dto.platform,
      });
      requestid = (
        await this.otp.send({
          username: dto.username,
          phoneNumber: identity.phoneNumber,
          email: identity.email,
          imei: dto.imeinumber,
          purpose: 'FORGOT_MPIN',
          lang,
          appName: dto.appname,
          appVersion: dto.version,
          appDatetime: dto.sysdate,
        })
      ).requestId;
    }
    this.audit.lifecycle(AuthLifecycleEvent.OTP_SENT, ctx);
    return { status: 'initiated successfully', requestid };
  }

  async resetMpin(dto: ResetMpinRequestDto): Promise<StatusMessageDto> {
    const ctx = this.ctx(dto);
    const otpOk = this.devBypass
      ? /^\d{4,8}$/.test(dto.otp)
      : await this.otp.verify({
          username: dto.username,
          imei: dto.imeinumber,
          requestId: dto.requestid,
          otp: dto.otp,
        });

    if (!otpOk) {
      this.audit.lifecycle(AuthLifecycleEvent.OTP_FAILED, { ...ctx, status: 'error' });
      return { status: 'error', message: 'Invalid OTP' };
    }
    if (!this.isValidMpin(dto.newmpin)) return this.policyError();

    if (this.devBypass) {
      this.logger.warn(`DEV bypass: MPIN reset for "${dto.username}" not persisted.`);
    } else {
      await this.store.set({ username: dto.username, imei: dto.imeinumber, mpin: dto.newmpin });
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
    return new RegExp(`^\\d{${this.mpin.minLength},${this.mpin.maxLength}}$`).test(mpin);
  }

  private policyError(): StatusMessageDto {
    return {
      status: 'error',
      message: `MPIN must be ${this.mpin.minLength}-${this.mpin.maxLength} digits.`,
    };
  }
}
