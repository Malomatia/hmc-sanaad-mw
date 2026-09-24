import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { MssqlService } from '@core/database/mssql.service';
import { AppIntegrityConfig } from '@core/config/configuration';
import { AppIntegrityService } from './application/app-integrity.service';
import {
  ANDROID_INTEGRITY_PORT,
  ATTEST_KEY_STORE_PORT,
  AndroidIntegrityPort,
  CHALLENGE_STORE_PORT,
  IOS_ATTESTATION_PORT,
  IosAttestationPort,
} from './domain/ports/integrity.ports';
import {
  AppleAppAttestAdapter,
  DisabledIosAttestation,
} from './infrastructure/adapters/apple-app-attest.adapter';
import {
  DisabledAndroidIntegrity,
  GooglePlayIntegrityAdapter,
} from './infrastructure/adapters/google-play-integrity.adapter';
import {
  MssqlAttestKeyStore,
  MssqlChallengeStore,
} from './infrastructure/adapters/mssql-integrity-store.repository';
import { AppIntegrityController } from './interface/app-integrity.controller';
import { AppIntegrityGuard } from './interface/app-integrity.guard';

/**
 * Apple App Attest and Google Play Integrity, verified directly.
 *
 * Each platform binds a real adapter only when it is configured, and a
 * refusing stub otherwise — so a half-configured environment (iOS ready,
 * Android credential still being issued) runs, and reports precisely which
 * half is missing rather than failing to start.
 *
 * The guard is global but does nothing while `APP_INTEGRITY_MODE=off`, which
 * is the default. Nothing here can stop the API from booting.
 */
@Module({
  controllers: [AppIntegrityController],
  providers: [
    AppIntegrityService,
    MssqlAttestKeyStore,
    { provide: ATTEST_KEY_STORE_PORT, useExisting: MssqlAttestKeyStore },
    {
      provide: CHALLENGE_STORE_PORT,
      inject: [MssqlService, ConfigService],
      useFactory: (db: MssqlService, config: ConfigService) =>
        new MssqlChallengeStore(
          db,
          config.getOrThrow<AppIntegrityConfig>('appIntegrity').challengeTtlMs,
        ),
    },
    {
      provide: IOS_ATTESTATION_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): IosAttestationPort => {
        const cfg = config.getOrThrow<AppIntegrityConfig>('appIntegrity');
        if (!cfg.ios.enabled) {
          return new DisabledIosAttestation();
        }
        return new AppleAppAttestAdapter(cfg.ios);
      },
    },
    {
      provide: ANDROID_INTEGRITY_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AndroidIntegrityPort => {
        const cfg = config.getOrThrow<AppIntegrityConfig>('appIntegrity');
        if (!cfg.android.enabled) {
          return new DisabledAndroidIntegrity();
        }
        return new GooglePlayIntegrityAdapter(cfg.android.packageName, cfg.android.serviceAccount!);
      },
    },
    { provide: APP_GUARD, useClass: AppIntegrityGuard },
  ],
  exports: [AppIntegrityService],
})
export class AppIntegrityModule {}
