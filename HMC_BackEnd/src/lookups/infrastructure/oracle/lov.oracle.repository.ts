import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as oracledb from 'oracledb';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { Lang } from '@shared/domain/lang';
import { LovItem } from '@shared/domain/lov-item';
import { isKnownOracleObject } from '@shared/constants/oracle-objects';
import {
  EMP_KEY_COLUMN,
  PERSON_ID_COLUMN,
  USERNAME_KEY_CANDIDATES,
} from '@shared/constants/oracle-columns';
import { extractOraCode, ORA_OBJECT_NOT_FOUND } from '@shared/constants/error-codes';
import { LovReadOptions, LovRepository } from '../../domain/lov.repository';
import { LovMapper } from './lov.mapper';

/**
 * Generic Oracle adapter for LOV/view reads (Pattern A). Object names are
 * validated against the central allow-list before interpolation (injection-safe).
 *
 * A caller filter is applied only when supplied and when the object really has
 * a matching scoping column: the user-scoped LOVs (SCHOOL_NAME_LOV,
 * REQUEST_TYPE_LOV) are documented with a `USER_NAME` request parameter, and
 * filtering on a hard-coded `username` raised `ORA-00904: "USERNAME": invalid
 * identifier`. The column is therefore resolved from the data dictionary, and
 * a filter value passed for a LOV that is not scoped is ignored instead of
 * failing the request.
 *
 * Some user-scoped views expose no user column at all: LEAVE_AMEND_V is scoped
 * by employee number in the legacy service (`lovname=LEAVE_AMEND_LOV&enum=`),
 * and dropping the filter turned the read into an unfiltered full scan that
 * blew past the 25s call timeout (ORA-03156). When no user column exists we
 * fall back to the employee-number / person-id columns so the filter still
 * applies.
 */
const EMPLOYEE_SCOPING_CANDIDATES = [EMP_KEY_COLUMN, 'emp_num', PERSON_ID_COLUMN] as const;
@Injectable()
export class LovOracleRepository implements LovRepository {
  private static readonly logger = new Logger(LovOracleRepository.name);
  private readonly cache = new Map<string, { expiresAt: number; items: LovItem[] }>();
  private readonly pending = new Map<string, Promise<LovItem[]>>();
  private readonly cacheTtlMs: number;

  constructor(
    private readonly ora: OracleService,
    private readonly schema: OracleSchemaService,
    config: ConfigService,
  ) {
    this.cacheTtlMs = config.get<number>('app.lovCacheTtlMs', 300000);
  }

  async readLov(
    object: string,
    lang: Lang,
    username?: string,
    options: LovReadOptions = {},
  ): Promise<LovItem[]> {
    if (!isKnownOracleObject(object)) {
      throw new BadRequestException(`Unknown Oracle object: ${object}`);
    }
    const cacheKey = JSON.stringify([object, lang, username ?? '', options]);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.items;
    const active = this.pending.get(cacheKey);
    if (active) return active;

    const request = this.queryLov(object, lang, username, options);
    this.pending.set(cacheKey, request);
    try {
      const items = await request;
      if (this.cacheTtlMs > 0) {
        this.cache.set(cacheKey, { expiresAt: Date.now() + this.cacheTtlMs, items });
      }
      return items;
    } finally {
      this.pending.delete(cacheKey);
    }
  }

  private async queryLov(
    object: string,
    lang: Lang,
    username: string | undefined,
    options: LovReadOptions,
  ): Promise<LovItem[]> {
    // One caller may be identified by several forms (username / employee
    // number / PERSON_ID); match ANY of them against the view's scoping
    // column so the client never has to know which form a given view uses.
    const supplied = [
      ...new Set(
        [username, ...(options.scopeAlternatives ?? [])].filter(
          (v): v is string => !!v && v.trim() !== '',
        ),
      ),
    ];
    const keyColumn = supplied.length ? await this.userColumnOf(object) : undefined;
    const scopeValues = keyColumn ? await this.matchable(object, keyColumn, supplied) : supplied;
    const personIdColumn =
      options.personId && (await this.schema.hasColumn(object, PERSON_ID_COLUMN))
        ? PERSON_ID_COLUMN
        : undefined;
    const searchColumn = options.search ? await this.searchColumnOf(object) : undefined;
    const typeColumn = options.dataType ? await this.typeColumnOf(object) : undefined;
    const leaveTypeColumn = options.leaveType ? await this.leaveTypeColumnOf(object) : undefined;
    const conditions: string[] = [];
    const binds: oracledb.BindParameters = {};
    if (keyColumn && scopeValues.length) {
      conditions.push(`${keyColumn} IN (${scopeValues.map((_, i) => `:u${i}`).join(', ')})`);
      scopeValues.forEach((v, i) => ((binds as Record<string, unknown>)[`u${i}`] = v));
    }
    if (personIdColumn && options.personId) {
      conditions.push(`${personIdColumn} = :personId`);
      binds.personId = options.personId.trim();
    }
    if (searchColumn && options.search) {
      conditions.push(`UPPER(${searchColumn}) LIKE :search`);
      binds.search = `%${options.search.trim().toUpperCase()}%`;
    }
    if (typeColumn && options.dataType) {
      conditions.push(`UPPER(${typeColumn}) = :dataType`);
      binds.dataType = options.dataType.trim().toUpperCase();
    }
    if (leaveTypeColumn && options.leaveType) {
      // Dedicated LEAVE_TYPE/ABSENCE_TYPE columns hold the bare type name →
      // exact match. The NAME fallback (LEAVE_CANCEL_V / LEAVE_AMEND_V) holds
      // longer display strings → contains-match so `Casual Leave` still hits
      // e.g. `Casual Leave|19-APR-2026|19-APR-2026`.
      const value = options.leaveType.trim().toUpperCase();
      if (leaveTypeColumn === 'NAME') {
        conditions.push(`UPPER(${leaveTypeColumn}) LIKE :leaveType`);
        binds.leaveType = `%${value}%`;
      } else {
        conditions.push(`UPPER(${leaveTypeColumn}) = :leaveType`);
        binds.leaveType = value;
      }
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit;
    const pagination = limit
      ? ' ORDER BY 1 OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY'
      : '';
    if (limit) {
      binds.offset = options.offset ?? 0;
      binds.limit = limit;
    }
    // A LOV name that resolves to an object the database does not have used to
    // surface as a bare HTTP 500 "A database operation could not be completed",
    // which says nothing about the cause: EMPLOYMENT_STATUS_LOV pointed at
    // XXHMC_SND_EMPLOYMENT_STATUS_LOV while the view is …_STATUS_V, and the
    // mismatch went unnoticed until a client reported it. Name the object in
    // the log so the next one is obvious from a single line.
    const rows = await this.ora
      .query<Record<string, any>>(`SELECT * FROM ${object}${where}${pagination}`, binds)
      .catch((err: unknown) => {
        if (extractOraCode((err as Error)?.message) === ORA_OBJECT_NOT_FOUND) {
          LovOracleRepository.logger.error(
            `LOV object ${object} does not exist in the database (ORA-00942) — the LOV registry ` +
              'points at a name Oracle does not know. Check lov-names.ts / oracle-objects.ts.',
          );
        }
        throw err;
      });
    return LovMapper.toItems(rows, lang);
  }

  /**
   * The scoping column of a user-scoped LOV: the user column when the view
   * has one, otherwise the employee-number / person-id column (LEAVE_AMEND_V
   * case), or undefined when the view is not scoped at all.
   */
  private async userColumnOf(object: string): Promise<string | undefined> {
    for (const candidate of [...USERNAME_KEY_CANDIDATES, ...EMPLOYEE_SCOPING_CANDIDATES]) {
      if (await this.schema.hasColumn(object, candidate)) return candidate;
    }
    return undefined;
  }

  /**
   * Keep only the identifiers that CAN match `keyColumn`.
   *
   * Oracle coerces the other side of a comparison to the column's type, so a
   * username in an IN-list against the numeric PERSON_ID raises ORA-01722 and
   * loses the whole predicate — including the identifier that would have
   * matched. That is what made `?person_id=26023&username=…` answer 0 rows
   * while `?person_id=26023` alone answered 15: sending MORE identifiers made
   * the result worse, the opposite of what scopeAlternatives is for.
   */
  private async matchable(
    object: string,
    keyColumn: string,
    values: readonly string[],
  ): Promise<string[]> {
    if (!(await this.schema.isNumericColumn(object, keyColumn))) return [...values];
    return values.filter((v) => /^\d+$/.test(v.trim()));
  }

  private async searchColumnOf(object: string): Promise<string | undefined> {
    for (const candidate of ['NAME', 'VALUE', 'MEANING', 'FLEX_VALUE_MEANING']) {
      if (await this.schema.hasColumn(object, candidate)) return candidate;
    }
    return undefined;
  }

  /**
   * The grouping column of a multi-type LOV (DEP_LOOKUP_LOV exposes
   * `D_DATA_TYPE`), resolved from the data dictionary like the other filters
   * so a dataType passed for a single-type LOV is ignored instead of failing.
   */
  private async typeColumnOf(object: string): Promise<string | undefined> {
    for (const candidate of ['D_DATA_TYPE', 'DATATYPE', 'DATA_TYPE', 'LOOKUP_TYPE']) {
      if (await this.schema.hasColumn(object, candidate)) return candidate;
    }
    return undefined;
  }

  /**
   * The leave-type column of a type-scoped LOV (ABSENCE_REASON_V exposes
   * `LEAVE_TYPE`; LEAVE_CANCEL_V / LEAVE_AMEND_V carry the type in `NAME` —
   * ops 61/62 `?leave_type=`), resolved from the data dictionary like the
   * other filters so a leaveType passed for an unscoped LOV is ignored
   * instead of failing. `NAME` is last on purpose: it only applies when the
   * view has no dedicated leave-type column.
   */
  private async leaveTypeColumnOf(object: string): Promise<string | undefined> {
    for (const candidate of ['LEAVE_TYPE', 'ABSENCE_TYPE', 'NAME']) {
      if (await this.schema.hasColumn(object, candidate)) return candidate;
    }
    return undefined;
  }
}
