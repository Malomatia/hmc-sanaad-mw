import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLaunchConfig } from '@core/config/configuration';
import { MssqlService } from '@core/database/mssql.service';
import { HealthCheckRequestDto, HealthCheckResponseDto } from '../interface/dto/healthcheck.dto';

/** Active downtime window row (legacy healthcheck query projection). */
interface DowntimeRow {
  SchDownStartTime: Date | string;
  SchDownEndTime: Date | string;
  Description?: string;
  ReasonDesc?: string;
}

/** Pending app-update row (legacy healthcheck query projection). */
interface AppUpdateRow {
  NotifyUsers?: unknown;
  UpdateType?: string | null;
}

/**
 * API-1 app-launch health check. When the Users DB is available, downtime and
 * update-type come from the legacy Sanaad tables using the exact queries from
 * the client's service mapping (HMC_Sanad_AppDownTime_tbl /
 * HMC_Sanad_App_Update_tbl joined via HMC_Sanad_AppMaster_Tbl.AppName);
 * otherwise the config-driven APP_* env values remain the fallback so local
 * dev keeps working without SQL Server.
 */
@Injectable()
export class HealthCheckService {
  private readonly logger = new Logger(HealthCheckService.name);
  private readonly cfg: AppLaunchConfig;

  constructor(
    private readonly db: MssqlService,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<AppLaunchConfig>('appLaunch');
  }

  async check(req: HealthCheckRequestDto): Promise<HealthCheckResponseDto> {
    if (!this.db.isEnabled()) return this.checkFromConfig(req);
    try {
      return await this.checkFromDb(req);
    } catch (err) {
      // API-1 must not hard-fail app launches on a DB hiccup — degrade to config.
      this.logger.error(
        `Users DB healthcheck failed, using config fallback: ${(err as Error).message}`,
      );
      return this.checkFromConfig(req);
    }
  }

  private async checkFromDb(req: HealthCheckRequestDto): Promise<HealthCheckResponseDto> {
    const appName = req.appname || this.cfg.appName;
    const [downtime, update] = await Promise.all([
      this.db.query<DowntimeRow>(
        `SELECT A.SchDownStartTime, A.SchDownEndTime, A.Description, C.ReasonDesc
           FROM HMC_Sanad_AppDownTime_tbl A
           LEFT OUTER JOIN HMC_Sanad_AppMaster_Tbl B ON B.ID = A.APPID
           LEFT OUTER JOIN HMC_Sanad_DTReason_Mast_tbl C ON C.ReasonCode = A.ReasonCode
          WHERE B.AppName = @appName
            AND GETDATE() BETWEEN A.SchDownStartTime AND A.SchDownEndTime`,
        { appName },
      ),
      req.version
        ? this.db.query<AppUpdateRow>(
            `SELECT A.NotifyUsers, A.UpdateType
               FROM HMC_Sanad_App_Update_tbl A
               LEFT OUTER JOIN HMC_Sanad_AppMaster_Tbl B ON B.ID = A.APPID
               LEFT OUTER JOIN HMC_Sanad_AppVersion_Control_tbl C
                 ON C.APPID = A.APPID AND A.FromVersionID = C.ID
              WHERE B.AppName = @appName AND C.Version = @version AND A.Status = 1`,
            { appName, version: req.version },
          )
        : Promise.resolve([] as AppUpdateRow[]),
    ]);

    const window = downtime[0];
    const updatetype = update[0]?.UpdateType?.trim() ?? '';
    return window
      ? {
          appDowntime: 'Yes',
          downtimeStart: HealthCheckService.formatDate(window.SchDownStartTime),
          downtimeEnd: HealthCheckService.formatDate(window.SchDownEndTime),
          updatetype,
        }
      : { appDowntime: 'No', downtimeStart: '', downtimeEnd: '', updatetype };
  }

  /** Config-driven behavior (APP_* env) — dev fallback and pre-DB behavior. */
  private checkFromConfig(req: HealthCheckRequestDto): HealthCheckResponseDto {
    const updatetype = this.resolveUpdateType(req.version);
    return this.cfg.downtime
      ? {
          appDowntime: 'Yes',
          downtimeStart: this.cfg.downtimeStart,
          downtimeEnd: this.cfg.downtimeEnd,
          updatetype,
        }
      : { appDowntime: 'No', downtimeStart: '', downtimeEnd: '', updatetype };
  }

  private static formatDate(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : String(value ?? '');
  }

  /** R = not required, O = optional, M = mandatory (below min supported version). */
  private resolveUpdateType(version?: string): 'R' | 'O' | 'M' {
    if (!version) return 'R';
    if (this.compareVersions(version, this.cfg.minSupportedVersion) < 0) return 'M';
    if (this.compareVersions(version, this.cfg.latestVersion) < 0) return 'O';
    return 'R';
  }

  private compareVersions(a: string, b: string): number {
    const pa = a.split('.').map((n) => Number(n) || 0);
    const pb = b.split('.').map((n) => Number(n) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    }
    return 0;
  }
}
