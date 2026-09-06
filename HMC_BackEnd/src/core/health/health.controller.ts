import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OracleService } from '../database/oracle.service';
import { MssqlService } from '../database/mssql.service';
import { MotcSmsDbService } from '../database/motc-sms-db.service';
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
  ) {}

  @Public()
  @SkipEnvelope()
  @Get()
  async check() {
    let oracleReachable = false;
    if (this.oracle.isEnabled()) {
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
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      oracle: this.describe(this.oracle.isConfigured(), oracleReachable),
      usersDb: this.describe(this.usersDb.isConfigured(), usersDbReachable),
      motcSmsDb: this.describe(this.motcSmsDb.isConfigured(), motcSmsDbReachable),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * `enabled` answers "are we configured to use it", NOT "did the pool come
   * up" â€” those two were conflated, so a database that was switched off and
   * one that was broken produced the identical `enabled:false,
   * reachable:false`. `status` states which of the three it is, so an outage
   * can be read straight off /health:
   *   disabled    â€” switched off on purpose
   *   unreachable â€” configured, but the pool never came up (check the config)
   *   ok          â€” connected
   */
  private describe(configured: boolean, reachable: boolean) {
    return {
      enabled: configured,
      reachable,
      status: !configured ? 'disabled' : reachable ? 'ok' : 'unreachable',
    };
  }

  /**
   * Dedicated Oracle connectivity test. Acquires a real connection, runs a
   * probe query, and reports latency, server version and DB time â€” or the
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
   * Dedicated Users DB (SQL Server) connectivity test â€” the auth-cycle
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
   * Dedicated MOTC SMS gateway DB connectivity test â€” the OTP push-table
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
}
