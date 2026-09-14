import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MssqlService } from '@core/database/mssql.service';
import { AuthConfig } from '@core/config/configuration';
import { FunctionAccessPort } from '../../domain/ports/function-access.port';
import { FunctionAccess, FunctionStatus } from '../../domain/auth-identity';

/**
 * Function-access list (login API-5 `functionaccesslist`) backed by the legacy
 * Sanaad Users DB view `HMC_Sanad_AppMaster_VW` (name overridable via
 * FUNCTION_ACCESS_VIEW).
 *
 * The client's service mapping documents the exact legacy LoginMPIN companion
 * query, which is tried first:
 *   `SELECT A.FunctionName, A.FunctionCode, A.Description, A.StatusCode
 *      FROM HMC_Sanad_AppMaster_VW A WHERE A.AppID = 1`
 * (`AppID` configurable via FUNCTION_ACCESS_APP_ID, default 1).
 *
 * If that projection fails (renamed columns, different view), the adapter
 * falls back to `SELECT *` and resolves the columns tolerantly by name —
 * mirroring the Oracle side's ask-the-database philosophy:
 *
 *  - function name  ← FunctionName / Function_Name / FuncName / AppFunctionName / Name
 *  - function code  ← FunctionCode / Function_Code / FuncCode / Code
 *  - remarks        ← Remarks / Remark / Description / Descr
 *  - status         ← StatusCode / Status / FunctionStatus / Active / Enabled / ...
 *  - optional per-user column (LoginID/UserName/EmployeeNumber/...) → filtered
 *    by the caller's identifier when present
 *  - optional AppName column → filtered by APP_NAME when the filter matches
 *    at least one row (falls back to the unfiltered list otherwise)
 *
 * When the name/code columns cannot be recognized the adapter throws with the
 * actual column list in the message so the mapping can be pinned immediately.
 */
@Injectable()
export class MssqlFunctionAccessRepository implements FunctionAccessPort {
  private readonly logger = new Logger(MssqlFunctionAccessRepository.name);
  private readonly view: string;
  private readonly appName: string;
  private readonly appId: number;

  private static readonly NAME_COLUMNS = [
    'functionname',
    'function_name',
    'funcname',
    'appfunctionname',
    'name',
  ];
  private static readonly CODE_COLUMNS = ['functioncode', 'function_code', 'funccode', 'code'];
  private static readonly REMARKS_COLUMNS = ['remarks', 'remark', 'description', 'descr'];
  private static readonly STATUS_COLUMNS = [
    'statuscode',
    'status',
    'functionstatus',
    'active',
    'enabled',
    'isactive',
    'isenabled',
  ];
  private static readonly USER_COLUMNS = [
    'loginid',
    'username',
    'employeenumber',
    'empno',
    'empnum',
  ];

  constructor(
    private readonly db: MssqlService,
    config: ConfigService,
  ) {
    const auth = config.getOrThrow<AuthConfig>('auth');
    // The name is config-controlled (never user input) but is interpolated
    // into SQL as an identifier, so keep it to identifier characters.
    if (!/^[A-Za-z0-9_.[\]]+$/.test(auth.functionAccessView)) {
      throw new Error(
        `Invalid FUNCTION_ACCESS_VIEW "${auth.functionAccessView}" — not a SQL identifier.`,
      );
    }
    this.view = auth.functionAccessView;
    this.appId = auth.functionAccessAppId;
    this.appName = config.get<string>('appLaunch.appName', '');
  }

  async list(employeeNumber: string): Promise<FunctionAccess[]> {
    let rows: Record<string, unknown>[];
    try {
      // The exact legacy query from the client's service mapping.
      rows = await this.db.query<Record<string, unknown>>(
        `SELECT A.FunctionName, A.FunctionCode, A.Description, A.StatusCode
           FROM ${this.view} A WHERE A.AppID = @appId`,
        { appId: this.appId },
      );
    } catch (err) {
      this.logger.warn(
        `Documented AppMaster query failed (${(err as Error).message}) — falling back to SELECT * with tolerant column mapping.`,
      );
      rows = await this.db.query<Record<string, unknown>>(`SELECT * FROM ${this.view}`);
    }
    if (rows.length === 0) {
      this.logger.warn(`${this.view} returned no rows — functionaccesslist will be empty.`);
      return [];
    }

    const columns = Object.keys(rows[0]);
    const nameCol = pickColumn(columns, MssqlFunctionAccessRepository.NAME_COLUMNS);
    const codeCol = pickColumn(columns, MssqlFunctionAccessRepository.CODE_COLUMNS);
    if (!nameCol && !codeCol) {
      throw new Error(
        `Cannot resolve function name/code columns of ${this.view} — actual columns: [${columns.join(', ')}]. Set the mapping in MssqlFunctionAccessRepository.`,
      );
    }
    const remarksCol = pickColumn(columns, MssqlFunctionAccessRepository.REMARKS_COLUMNS);
    const statusCol = pickColumn(columns, MssqlFunctionAccessRepository.STATUS_COLUMNS);
    const userCol = pickColumn(columns, MssqlFunctionAccessRepository.USER_COLUMNS);
    const appCol = pickColumn(columns, ['appname']);

    if (userCol) {
      rows = rows.filter((r) => sameText(r[userCol], employeeNumber));
    }
    if (appCol && this.appName) {
      const scoped = rows.filter((r) => sameText(r[appCol], this.appName));
      if (scoped.length > 0) rows = scoped;
      else
        this.logger.warn(
          `${this.view}.${appCol} has no rows for APP_NAME="${this.appName}" — returning the unfiltered list.`,
        );
    }
    if (!statusCol) {
      this.logger.warn(`${this.view} has no status column — treating every function as ENABLED.`);
    }

    return rows.map((r) => ({
      functionname: text(r[nameCol ?? codeCol!]),
      functioncode: text(r[codeCol ?? nameCol!]),
      remarks: remarksCol ? text(r[remarksCol]) : undefined,
      status: statusCol ? toStatus(r[statusCol]) : FunctionStatus.ENABLED,
    }));
  }
}

function pickColumn(columns: string[], candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const hit = columns.find((c) => c.toLowerCase() === candidate);
    if (hit) return hit;
  }
  return undefined;
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function sameText(a: unknown, b: string): boolean {
  return text(a).toLowerCase() === b.trim().toLowerCase();
}

/** Normalizes the legacy status spellings into the FunctionStatus codes. */
function toStatus(value: unknown): FunctionStatus {
  const s = text(value).toLowerCase();
  if (['1', 'y', 'yes', 'true', 'enabled', 'active'].includes(s)) return FunctionStatus.ENABLED;
  if (['2', 'coming soon', 'coming_soon', 'comingsoon'].includes(s))
    return FunctionStatus.COMING_SOON;
  return FunctionStatus.DISABLED;
}
