import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

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
  private readonly devBypass: boolean;
  private readonly mpin: MpinConfig;

  constructor(
    @Inject(MPIN_STORE_PORT) private readonly store: MpinStorePort,
    @Inject(OTP_PORT) private readonly otp: OtpPort,
    @Inject(DEVICE_REGISTRY_PORT) private readonly devices: DeviceRegistryPort,
    @Inject(LDAP_USER_PORT) private readonly ldap: LdapUserPort,

    config: ConfigService,
  ) {
    this.devBypass = config.get<boolean>('auth.disabled', false);
    this.mpin = config.getOrThrow<MpinConfig>('mpin');
  }

  async setMpin(dto: SetMpinRequestDto): Promise<StatusMessageDto> {
    if (!this.devBypass) {
      await this.devices.bind({
        username: dto.username,
        imei: dto.imeinumber,
        platform: dto.platform,
      });
      await this.store.set({ username: dto.username, imei: dto.imeinumber, mpin: dto.mpin });
    }

    return { status: 'success', message: 'MPIN updated successfully' };
  }

  async forgotInitiate(
    dto: ForgotMpinInitRequestDto,
    lang: Lang = DEFAULT_LANG,
  ): Promise<ForgotMpinInitResponseDto> {
    let requestid: string;
    if (this.devBypass) {
      requestid = randomUUID().replace(/-/g, '').toUpperCase();
    } else {
      // Legacy forgetMPIN semantics: the device must already be registered for
      // this user (SELECT DeviceID ... WHERE IMEINumber AND LoginID).
      if (!(await this.devices.isBound(dto.username, dto.imeinumber))) {
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

    return { status: 'initiated successfully', requestid };
  }

  async resetMpin(dto: ResetMpinRequestDto): Promise<StatusMessageDto> {
    const otpOk = this.devBypass
      ? /^\d{4,8}$/.test(dto.otp)
      : await this.otp.verify({
          username: dto.username,
          imei: dto.imeinumber,
          requestId: dto.requestid,
          otp: dto.otp,
        });

    if (!otpOk) {
      return { status: 'error', message: 'Invalid OTP' };
    }
    if (!this.isValidMpin(dto.newmpin)) return this.policyError();

    if (!this.devBypass) {
      await this.store.set({ username: dto.username, imei: dto.imeinumber, mpin: dto.newmpin });
    }

    return { status: 'success', message: 'MPIN Changed successfully' };
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
