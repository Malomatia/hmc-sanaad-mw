import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './interface/auth.controller';
import { HealthCheckController } from './interface/healthcheck.controller';
import { AuthService } from './application/auth.service';
import { OnboardingService } from './application/onboarding.service';
import { MpinService } from './application/mpin.service';
import { HealthCheckService } from './application/healthcheck.service';
import { LDAP_USER_PORT, LdapUserPort } from './domain/ports/ldap-user.port';
import { OTP_PORT, OtpPort } from './domain/ports/otp.port';
import { OTP_DELIVERY_PORT } from './domain/ports/otp-delivery.port';
import { OTP_EMAIL_DELIVERY_PORT } from './domain/ports/otp-email-delivery.port';
import { MPIN_STORE_PORT } from './domain/ports/mpin-store.port';
import { DEVICE_REGISTRY_PORT } from './domain/ports/device-registry.port';
import { FUNCTION_ACCESS_PORT } from './domain/ports/function-access.port';
import { LdapUserRepository } from './infrastructure/adapters/ldap-user.repository';
import { EntraGraphUserRepository } from './infrastructure/adapters/entra-graph-user.repository';
import { MssqlOtpRepository } from './infrastructure/adapters/mssql-otp.repository';
import { MotcSmsOtpRepository } from './infrastructure/adapters/motc-sms-otp.repository';
import { MssqlMpinStoreRepository } from './infrastructure/adapters/mssql-mpin-store.repository';
import { MssqlDeviceRegistryRepository } from './infrastructure/adapters/mssql-device-registry.repository';
import { SmsOtpDeliveryAdapter } from './infrastructure/adapters/sms-otp-delivery.adapter';
import { EmailOtpDeliveryAdapter } from './infrastructure/adapters/email-otp-delivery.adapter';
import { MotcPushOtpDeliveryAdapter } from './infrastructure/adapters/motc-push-otp-delivery.adapter';
import { MssqlFunctionAccessRepository } from './infrastructure/adapters/mssql-function-access.repository';
import { MssqlUserRepository } from './infrastructure/adapters/mssql-user.repository';

/**
 * Auth feature module — Sanaad User Authentication & Access Control framework
 * (APIs 1-7). JWT signing/verification comes from the global core AuthModule.
 *
 * MPIN / device-registry are backed by the legacy Sanaad SQL Server tables
 * (HMC_Sanad_DeviceRegn_tbl) via the global MssqlService pool. The OTP port
 * is bound by OTP_STORE: `legacy` (default since 2026-09-03) stores/validates
 * in HMC_RHAP_OTP_tbl and delivers through OTP_DELIVERY_PORT; `motc` makes
 * MOTC_SMS_PushTable the store AND the delivery (MotcSmsOtpRepository).
 * OTP_DELIVERY picks the delivery adapter for the legacy store: `motc`
 * (default) INSERTs into the push table, `http` is the generic SMS adapter.
 * Either store falls back to EMAIL delivery (OTP_EMAIL_DELIVERY_PORT →
 * EmailOtpDeliveryAdapter → core SMTP EmailService) when the directory has no
 * mobile number but has a corporate email.
 * Function-access reads the Users DB view named by FUNCTION_ACCESS_VIEW
 * (default HMC_Sanad_AppMaster_VW). The dev bypass inside each application
 * service triggers on AUTH_DISABLED=true only.
 *
 * The identity port (LDAP_USER_PORT) is bound at runtime by AUTH_DIRECTORY:
 * `entra` → Microsoft Graph (EntraGraphUserRepository), `usersdb` → the
 * live-employee master view on the MOTC_SMS DB (MssqlUserRepository — no
 * corporate directory; usernames absent from the view are refused), else
 * LDAPS (LdapUserRepository, the default/fallback). HttpModule backs the
 * Graph and SMS adapters' outbound calls.
 */
@Module({
  imports: [HttpModule],
  controllers: [AuthController, HealthCheckController],
  providers: [
    AuthService,
    OnboardingService,
    MpinService,
    HealthCheckService,
    LdapUserRepository,
    EntraGraphUserRepository,
    MssqlUserRepository,
    {
      provide: LDAP_USER_PORT,
      inject: [ConfigService, LdapUserRepository, EntraGraphUserRepository, MssqlUserRepository],
      useFactory: (
        config: ConfigService,
        ldap: LdapUserRepository,
        entra: EntraGraphUserRepository,
        usersDb: MssqlUserRepository,
      ): LdapUserPort => {
        const directory = config.get<string>('app.directory');
        return directory === 'entra' ? entra : directory === 'usersdb' ? usersDb : ldap;
      },
    },
    // Email fallback channel: OTP over SMTP when the user has no mobile number.
    { provide: OTP_EMAIL_DELIVERY_PORT, useClass: EmailOtpDeliveryAdapter },
    SmsOtpDeliveryAdapter,
    MotcPushOtpDeliveryAdapter,
    {
      provide: OTP_DELIVERY_PORT,
      inject: [ConfigService, MotcPushOtpDeliveryAdapter, SmsOtpDeliveryAdapter],
      useFactory: (
        config: ConfigService,
        motc: MotcPushOtpDeliveryAdapter,
        http: SmsOtpDeliveryAdapter,
      ) => (config.get<string>('otp.delivery') === 'http' ? http : motc),
    },
    MssqlOtpRepository,
    MotcSmsOtpRepository,
    {
      provide: OTP_PORT,
      inject: [ConfigService, MotcSmsOtpRepository, MssqlOtpRepository],
      useFactory: (
        config: ConfigService,
        motc: MotcSmsOtpRepository,
        legacy: MssqlOtpRepository,
      ): OtpPort => (config.get<string>('otp.store') === 'motc' ? motc : legacy),
    },
    { provide: MPIN_STORE_PORT, useClass: MssqlMpinStoreRepository },
    { provide: DEVICE_REGISTRY_PORT, useClass: MssqlDeviceRegistryRepository },
    { provide: FUNCTION_ACCESS_PORT, useClass: MssqlFunctionAccessRepository },
  ],
})
export class AuthModule {}
