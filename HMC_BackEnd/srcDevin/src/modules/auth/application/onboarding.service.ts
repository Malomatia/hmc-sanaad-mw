import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AuditService } from '@core/audit/audit.service';
import { AuthLifecycleEvent } from '@core/audit/audit-event';
import { LDAP_USER_PORT, LdapUserPort } from '../domain/ports/ldap-user.port';
import { OTP_PORT, OtpPort, SendOtpResult } from '../domain/ports/otp.port';
import {
  DEVICE_REGISTRY_PORT,
  DeviceRegistration,
  DeviceRegistryPort,
} from '../domain/ports/device-registry.port';
import { EmployeeIdentity } from '../domain/auth-identity';
import {
  SendOtpRequestDto,
  SendOtpResponseDto,
  UserValidateRequestDto,
  UserValidateResponseDto,
  ValidateOtpRequestDto,
} from '../interface/dto/onboarding.dto';
import { StatusMessageDto } from '../interface/dto/auth.dto';
import { devIdentity } from './dev-fallback';
import { maskEmail, maskPhone } from './mask.util';
import { DEFAULT_LANG, Lang } from '@shared/domain/lang';

/** User-facing initiate messages, per the request's `lang` header/query. */
const MESSAGES: Record<'invalidUsername' | 'otpSent' | 'otpPending', Record<Lang, string>> = {
  invalidUsername: { en: 'Invalid Username.', ar: 'اسم المستخدم غير صحيح.' },
  otpSent: { en: 'OTP sent successfully', ar: 'تم إرسال رمز التحقق بنجاح' },
  otpPending: {
    en: 'An OTP was already sent and is still valid',
    ar: 'تم إرسال رمز التحقق مسبقاً وما زال صالحاً',
  },
};

/**
 * API-2 (User Validate) + API-3 (Validate OTP). Reworked flow (client request
 * 2026-09-03):
 *
 *  1. The username is resolved through the identity port (AUTH_DIRECTORY=
 *     usersdb → HMC_SND_LIV_EMP_MASTER_VW on the MOTC_SMS DB). Unknown user →
 *     "Invalid Username." error.
 *  2. The exact user+device registration is read from HMC_Sanad_DeviceRegn_tbl.
 *  3. Registered WITH an MPIN → existing user: the response carries the full
 *     identity from both tables and NO OTP is sent (they log in with MPIN).
 *  4. Otherwise a missing registration row is created (MPIN NULL, Status
 *     'Inactive'), an OTP is stored (HMC_RHAP_OTP_tbl) and delivered (MOTC
 *     push table), and the response says "OTP sent successfully".
 *
 * When AUTH_DISABLED=true a dev bypass synthesizes identity and accepts any
 * well-formed OTP; otherwise the real path runs in every environment.
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);
  private readonly devBypass: boolean;
  private readonly otpInResponse: boolean;
  /** OTP TTL for the dev-bypass response's elapsedtimeinmins. */
  private readonly otpTtlSeconds: number;

  constructor(
    @Inject(LDAP_USER_PORT) private readonly ldap: LdapUserPort,
    @Inject(OTP_PORT) private readonly otp: OtpPort,
    @Inject(DEVICE_REGISTRY_PORT) private readonly devices: DeviceRegistryPort,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.devBypass = config.get<boolean>('auth.disabled', false);
    this.otpTtlSeconds = config.get<number>('otp.ttlSeconds', 300);
    this.otpInResponse =
      config.get<boolean>('otp.inResponse', false) === true &&
      config.get<string>('app.nodeEnv', 'development') !== 'production';
  }

  async validateUser(
    dto: UserValidateRequestDto,
    lang: Lang = DEFAULT_LANG,
  ): Promise<UserValidateResponseDto> {
    const ctx = {
      username: dto.username,
      deviceImei: dto.imeinumber,
      platform: dto.platform,
      appVersion: dto.version,
    };

    // Step 1 — the user must exist in the live-employee master view (or the
    // configured directory).
    let identity: EmployeeIdentity;
    if (this.devBypass) {
      this.logger.warn(`DEV bypass: synthesizing identity for "${dto.username}" (no directory).`);
      identity = devIdentity(dto.username);
    } else {
      identity = await this.ldap.validate({
        username: dto.username,
        imei: dto.imeinumber,
        platform: dto.platform,
      });
    }

    if (!identity.isEmployee) {
      this.audit.lifecycle(AuthLifecycleEvent.USER_VALIDATE_FAILURE, { ...ctx, status: 'error' });
      return { status: 'error', message: MESSAGES.invalidUsername[lang] };
    }

    // Step 2 — this exact user+device registration.
    const device = this.devBypass
      ? undefined
      : await this.devices.find(dto.username, dto.imeinumber);

    // Step 3 — registered with an MPIN: existing user, no OTP (vflag=Exist).
    // Everything the client needs comes back from both tables.
    if (device?.mpinSet) {
      this.audit.lifecycle(AuthLifecycleEvent.USER_VALIDATE_SUCCESS, { ...ctx, status: 'success' });
      return {
        status: 'success',
        ...this.userData(identity, device),
        newuser: 'No',
        vflag: 'Exist',
      };
    }

    // Step 3b — first time on this device: create the registration with no
    // MPIN and Status 'Inactive' (activated when the MPIN is set, API-4).
    // Device context comes from the request; Department is the employee
    // view's FACILITY_NAME.
    if (!this.devBypass && !device) {
      await this.devices.bind({
        username: dto.username,
        imei: dto.imeinumber,
        platform: dto.platform,
        deviceModel: dto.devicemodel,
        osVersion: dto.osversion,
        department: identity.facility,
      });
    }

    // Step 4 — the OTP upsert (HMC_RHAP_OTP_tbl) + delivery. NEW = a fresh
    // code was stored (vflag=New); PENDING = a valid unused one was kept
    // (vflag=Pending, same requestid).
    const sent: SendOtpResult = this.devBypass
      ? {
          requestId: randomUUID().replace(/-/g, '').toUpperCase(),
          status: 'NEW' as const,
          mode: 'SMS' as const,
          validForSeconds: this.otpTtlSeconds,
        }
      : await this.otp.send({
          username: dto.username,
          phoneNumber: identity.phoneNumber,
          email: identity.email,
          imei: dto.imeinumber,
          purpose: 'ONBOARDING',
          lang,
          appName: dto.appname,
          appVersion: dto.version,
          appDatetime: dto.sysdate,
        });

    this.audit.lifecycle(AuthLifecycleEvent.USER_VALIDATE_SUCCESS, { ...ctx, status: 'success' });
    this.audit.lifecycle(AuthLifecycleEvent.OTP_SENT, ctx);

    return {
      status: 'success',
      message: sent.status === 'PENDING' ? MESSAGES.otpPending[lang] : MESSAGES.otpSent[lang],
      ...this.userData(identity, device),
      newuser: 'Yes',
      vflag: sent.status === 'PENDING' ? 'Pending' : 'New',
      otpmode: sent.mode,
      // Minutes this OTP is still usable for (rounded up to a whole minute).
      elapsedtimeinmins: Math.ceil(sent.validForSeconds / 60),
      requestid: sent.requestId,
      ...this.otpResponse(sent.otp),
    };
  }

  /**
   * Response fields drawn from the employee view + the device registration.
   * Contact data goes out MASKED (client request 2026-09-05) — the clear
   * phone/email never leave the server.
   */
  private userData(identity: EmployeeIdentity, device?: DeviceRegistration) {
    return {
      employeeusername: identity.username,
      employeename: identity.employeeName,
      employeenumber: identity.employeeNumber,
      jobname: identity.jobName,
      email: maskEmail(identity.email),
      department: identity.department,
      employeeflag: 'Yes',
      employeephonenumber: maskPhone(identity.phoneNumber),
      devicestatus: device?.status,
    };
  }

  /**
   * POST /auth/send-otp — standalone OTP send (client request 2026-08-31).
   * Same machinery as API-2's OTP step: OtpPort.send upserts the code into
   * HMC_RHAP_OTP_tbl (a still-valid unused OTP is kept — PENDING) and the
   * SMS goes out via the MOTC push table. The returned requestid pairs with
   * /auth/otp/validate.
   */
  async sendOtp(dto: SendOtpRequestDto, lang: Lang = DEFAULT_LANG): Promise<SendOtpResponseDto> {
    const ctx = {
      username: dto.username,
      deviceImei: dto.imeinumber,
      platform: dto.platform,
      appVersion: dto.version,
    };

    const sent: Pick<SendOtpResult, 'requestId' | 'otp'> = this.devBypass
      ? { requestId: randomUUID().replace(/-/g, '').toUpperCase() }
      : await this.otp.send({
          username: dto.username,
          phoneNumber: dto.phonenumber,
          email: dto.email,
          imei: dto.imeinumber,
          purpose: 'ONBOARDING',
          lang,
          appName: dto.appname,
          appVersion: dto.version,
          appDatetime: dto.sysdate,
        });

    this.audit.lifecycle(AuthLifecycleEvent.OTP_SENT, ctx);
    return { status: 'success', requestid: sent.requestId, ...this.otpResponse(sent.otp) };
  }

  private otpResponse(otp: string | undefined): { otp?: string } {
    return this.otpInResponse && otp ? { otp } : {};
  }

  async validateOtp(dto: ValidateOtpRequestDto): Promise<StatusMessageDto> {
    const ctx = {
      username: dto.username,
      deviceImei: dto.imeinumber,
      platform: dto.platform,
      appVersion: dto.version,
    };

    const ok = this.devBypass
      ? /^\d{4,8}$/.test(dto.otp)
      : await this.otp.verify({
          username: dto.username,
          imei: dto.imeinumber,
          requestId: dto.requestid,
          otp: dto.otp,
        });

    this.audit.lifecycle(ok ? AuthLifecycleEvent.OTP_VALIDATED : AuthLifecycleEvent.OTP_FAILED, {
      ...ctx,
      status: ok ? 'success' : 'error',
    });

    return ok
      ? { status: 'success', message: 'OTP Validated successfully' }
      : { status: 'error', message: 'Invalid OTP' };
  }

}
