import { Controller, Get, Inject, Optional, Res, UseGuards, Version } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { App } from 'firebase-admin/app';
import { OracleService } from '../database/oracle.service';
import { MssqlService } from '../database/mssql.service';
import { MotcSmsDbService } from '../database/motc-sms-db.service';
import { FIREBASE_APP } from '../firebase/firebase-app';
import { AppIntegrityConfig, FirebaseConfig } from '../config/configuration';
import { Public } from '../auth/decorators/public.decorator';
import { SkipEnvelope } from '../http/response.interceptor';
import { DiagnosticsEnabledGuard } from '../http/diagnostics-enabled.guard';
import { SkipIntegrity } from '../integrity/skip-integrity.decorator';

@ApiTags('health')
// Uptime probes are not the mobile app; App Check would fail them all.
@SkipIntegrity()
@Controller('health')
export class HealthController {
  constructor(
    private readonly oracle: OracleService,
    private readonly usersDb: MssqlService,
    private readonly motcSmsDb: MotcSmsDbService,
    private readonly config: ConfigService,
    @Optional() @Inject(FIREBASE_APP) private readonly firebase?: App,
  ) {}

  @Public()
  @SkipEnvelope()
  @Get('ready')
  @ApiOperation({ summary: 'Oracle pool readiness', operationId: 'health_ready' })
  ready(@Res({ passthrough: true }) response: Response) {
    const readiness = this.oracle.getReadiness();
    response.status(readiness.ready ? 200 : 503);
    return readiness;
  }

  @Public()
  @SkipEnvelope()
  @Get()
  async check() {
    let oracleReachable = false;
    if (this.oracle.isConfigured()) {
      try {
        oracleReachable = await this.oracle.ping();
      } catch {
        oracleReachable = false;
      }
    }
    const usersDbReachable = this.usersDb.isEnabled() ? await this.usersDb.ping() : false;
    const motcSmsDbReachable = this.motcSmsDb.isEnabled()
      ? await this.motcSmsDb.ping()
      : false;
    const integrity = this.config.get<AppIntegrityConfig>('appIntegrity');
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      oracle: this.describe(this.oracle.isConfigured(), oracleReachable),
      usersDb: this.describe(this.usersDb.isConfigured(), usersDbReachable),
      motcSmsDb: this.describe(this.motcSmsDb.isConfigured(), motcSmsDbReachable),
      // Whether the server can actually SEND a push, and whether attestation
      // can actually verify anything. Both degrade silently by design - an
      // unconfigured credential binds a no-op rather than refusing to boot -
      // so from outside a working deployment and a dormant one answered
      // identically, and the only way to tell them apart was the boot log.
      push: this.describePush(),
      appIntegrity: {
        mode: integrity?.mode ?? 'off',
        ios: integrity?.ios.enabled ? 'ok' : 'disabled',
        android: integrity?.android.enabled ? 'ok' : 'disabled',
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * `enabled` answers "are we configured to use it", NOT "did the pool come
   * up" - those two were conflated, so a database that was switched off and
   * one that was broken produced the identical `enabled:false,
   * reachable:false`. `status` states which of the three it is, so an outage
   * can be read straight off /health:
   *   disabled    - switched off on purpose
   *   unreachable - configured, but the pool never came up (check the config)
   *   ok          - connected
 */
  /**
   * Push has three states, not two, and the third is the one that wastes a
   * day: a credential WAS supplied and could not be used. That reads as
   * `rejected` here, with the length of what arrived, because a value that
   * was truncated, quoted or line-wrapped on the way in is the usual cause
   * and is invisible from every other angle.
 */
  private describePush() {
    const firebase = this.config.get<FirebaseConfig>('firebase');
    const enabled = Boolean(this.firebase);
    return {
      enabled,
      projectId: this.firebase?.options?.projectId ?? null,
      credentialProvided: firebase?.credentialProvided ?? false,
      credentialLength: firebase?.credentialLength ?? 0,
      status: enabled ? 'ok' : firebase?.credentialProvided ? 'rejected' : 'disabled',
    };
  }

  private describe(configured: boolean, reachable: boolean) {
    return {
      enabled: configured,
      reachable,
      status: !configured ? 'disabled' : reachable ? 'ok' : 'unreachable',
    };
  }

  /**
   * Dedicated Oracle connectivity test. Acquires a real connection, runs a
   * probe query, and reports latency, server version and DB time - or the
   * exact failure reason (message + ORA code) when the database is unreachable.
   * Always responds 200; inspect `status`/`connected` for the result.
   * 404 with DIAGNOSTICS_ENABLED=false (plain /health stays on).
 */
  @UseGuards(DiagnosticsEnabledGuard)
  @Public()
  @SkipEnvelope()
  @Get('db')
  @ApiOperation({ summary: 'Oracle DB connectivity test', operationId: 'health_db' })
  @ApiOkResponse({ description: 'Connectivity diagnostics (status=ok when connected).' })
  async db() {
    const diagnostics = await this.oracle.diagnose();
    return { status: diagnostics.connected ? 'ok' : 'error', ...diagnostics };
  }

  /**
   * Dedicated Users DB (SQL Server) connectivity test - the auth-cycle
   * database (device/MPIN/OTP + API-1 tables). Same contract as /health/db:
   * always 200, inspect `status`/`connected` and `error` for the reason.
 */
  @UseGuards(DiagnosticsEnabledGuard)
  @Public()
  @SkipEnvelope()
  @Get('users-db')
  @ApiOperation({ summary: 'Users DB (SQL Server) connectivity test', operationId: 'health_users_db' })
  @ApiOkResponse({ description: 'Connectivity diagnostics (status=ok when connected).' })
  async usersDbHealth() {
    const diagnostics = await this.usersDb.diagnose();
    return { status: diagnostics.connected ? 'ok' : 'error', ...diagnostics };
  }

  /**
   * Dedicated MOTC SMS gateway DB connectivity test - the OTP push-table
   * database (MOTC_SMS_PushTable). Same contract as /health/users-db.
 */
  @UseGuards(DiagnosticsEnabledGuard)
  @Public()
  @SkipEnvelope()
  @Get('motc-sms-db')
  @ApiOperation({
    summary: 'MOTC SMS DB (SQL Server) connectivity test',
    operationId: 'health_motc_sms_db',
  })
  @ApiOkResponse({ description: 'Connectivity diagnostics (status=ok when connected).' })
  async motcSmsDbHealth() {
    const diagnostics = await this.motcSmsDb.diagnose();
    return { status: diagnostics.connected ? 'ok' : 'error', ...diagnostics };
  }

  @Version('2')
  @Public()
  @SkipEnvelope()
  @Get('ready')
  @ApiOperation({ summary: 'Oracle pool readiness', operationId: 'health_ready_v2' })
  readyV2(@Res({ passthrough: true }) response: Response) {
    return this.ready(response);
  }

  @Version('2')
  @Public()
  @SkipEnvelope()
  @Get()
  async checkV2() {
    return this.check();
  }

  @Version('2')
  @UseGuards(DiagnosticsEnabledGuard)
  @Public()
  @SkipEnvelope()
  @Get('db')
  @ApiOperation({ summary: 'Oracle DB connectivity test', operationId: 'health_db_v2' })
  @ApiOkResponse({ description: 'Connectivity diagnostics (status=ok when connected).' })
  async dbV2() {
    return this.db();
  }

  @Version('2')
  @UseGuards(DiagnosticsEnabledGuard)
  @Public()
  @SkipEnvelope()
  @Get('users-db')
  @ApiOperation({ summary: 'Users DB (SQL Server) connectivity test', operationId: 'health_users_db_v2' })
  @ApiOkResponse({ description: 'Connectivity diagnostics (status=ok when connected).' })
  async usersDbHealthV2() {
    return this.usersDbHealth();
  }

  @Version('2')
  @UseGuards(DiagnosticsEnabledGuard)
  @Public()
  @SkipEnvelope()
  @Get('motc-sms-db')
  @ApiOperation({
    summary: 'MOTC SMS DB (SQL Server) connectivity test',
    operationId: 'health_motc_sms_db_v2',
  })
  @ApiOkResponse({ description: 'Connectivity diagnostics (status=ok when connected).' })
  async motcSmsDbHealthV2() {
    return this.motcSmsDbHealth();
  }
}
