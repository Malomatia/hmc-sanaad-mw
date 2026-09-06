import { Injectable, Logger } from '@nestjs/common';
import * as oracledb from 'oracledb';
import { OracleArgumentInfo, OracleMetadataService } from './oracle-metadata.service';
import { SchemaColumnNotFoundException } from './schema-column-not-found.error';

/** One formal parameter of a procedure, reduced to what binding needs. */
export interface ProcedureParam {
  name: string;
  /** `IN`, `OUT` or `IN/OUT` as reported by ALL_ARGUMENTS. */
  direction: string;
  dataType: string;
  defaulted: boolean;
  typeOwner?: string;
  typeName?: string;
  typeSubname?: string;
}

/** A function's `RETURN <type>` clause — absent for procedures. */
export interface ReturnType {
  dataType: string;
  typeOwner?: string;
  typeName?: string;
  typeSubname?: string;
}

export interface ProcedureSignature {
  owner: string;
  ownerRank: number;
  overload: string | null;
  subprogramId: number;
  params: ProcedureParam[];
  /** Set when the program unit is a FUNCTION rather than a PROCEDURE. */
  returnType?: ReturnType;
}

/**
 * Answers schema questions about the `XXHMC_SND_*` objects from the Oracle data
 * dictionary, so adapters bind what the database actually declares.
 *
 * Two classes of runtime failure motivated this:
 *  - `ORA-00904: invalid identifier` — the Sanaad mapping documents the legacy
 *    *request parameter* names (`USER_NAME`, `EMPLOYEE_NUMBER`), not the view
 *    column names, and they differ per object.
 *  - `PLS-00306: wrong number or types of arguments` — the request-input tables
 *    list only the IN parameters, so the OUT contract was assumed to be
 *    `p_status` / `p_message` everywhere, while REASSIGN_PR (for one) declares
 *    `p_success_flag` / `p_error_msg` / `p_error_msg_ar`.
 *
 * Everything is read once per object and cached for the process lifetime.
 */
@Injectable()
export class OracleSchemaService {
  private readonly logger = new Logger(OracleSchemaService.name);
  /** object → upper-cased column names. */
  private readonly columnCache = new Map<string, Set<string>>();
  /** object → column name → declared data type (populated with columnCache). */
  private readonly columnTypeCache = new Map<string, Map<string, string>>();
  /** object → declared parameters, or null when the dictionary knows none. */
  private readonly paramCache = new Map<string, ProcedureSignature[] | null | undefined>();

  constructor(private readonly metadata: OracleMetadataService) {}

  /**
   * Returns the first candidate column that exists on `object`. Falls back to the
   * first candidate when the dictionary lookup yields nothing (e.g. the account
   * cannot read ALL_TAB_COLUMNS) so behaviour stays unchanged rather than
   * breaking.
   */
  async resolveKeyColumn(object: string, candidates: readonly string[]): Promise<string> {
    const available = await this.columnsOf(object);
    if (!available.size) return candidates[0];

    const match = candidates.find((c) => available.has(c.toUpperCase()));
    if (match) return match;

    // A schema mismatch (missing/renamed column) — NOT a connectivity/timeout/
    // permission problem. Distinct type so callers can degrade gracefully
    // instead of failing the whole request (see readByResolvedKey).
    throw new SchemaColumnNotFoundException(object, candidates, [...available]);
  }

  /** True when `object` exposes `column`. */
  async hasColumn(object: string, column: string): Promise<boolean> {
    const available = await this.columnsOf(object);
    return available.has(column.toUpperCase());
  }

  /**
   * True when `column` on `object` holds numbers.
   *
   * Callers that match a value against a column need this because Oracle
   * coerces the OTHER side of the comparison to the column's type: putting a
   * username in an IN-list against the numeric PERSON_ID raises ORA-01722 and
   * kills the whole predicate, not just that one value (see
   * LovOracleRepository.queryLov). Unknown column → false, so the caller keeps
   * its existing behaviour.
   */
  async isNumericColumn(object: string, column: string): Promise<boolean> {
    const types = await this.columnTypesOf(object);
    const type = types.get(column.toUpperCase());
    return type ? /^(NUMBER|FLOAT|INTEGER|BINARY_(FLOAT|DOUBLE))/.test(type) : false;
  }

  /**
   * Declared parameters of a procedure (or of `PACKAGE.PROCEDURE`), in
   * positional order, or undefined when the dictionary has no entry for it.
   */
  async resolveParams(
    object: string,
    expectedParams: readonly string[] = [],
  ): Promise<ProcedureParam[] | null | undefined> {
    const signature = await this.resolveSignature(object, expectedParams);
    return signature ? signature.params : (signature as null | undefined);
  }

  /**
   * Full resolved signature (params + `returnType` when the object is a
   * FUNCTION, e.g. a table function like `XXHMC_SND_CHILD_DETS_VIEW` — its
   * `RETURN xxhmc_snd_child_detl_nt` means it must be queried with
   * `SELECT * FROM TABLE(fn(...))`, not `BEGIN fn(...); END;`, which raises
   * `PLS-00221: is not a procedure`). Null when the dictionary reports no
   * arguments (a real table/view); undefined when the dictionary could not be
   * read at all.
   */
  async resolveSignature(
    object: string,
    expectedParams: readonly string[] = [],
  ): Promise<ProcedureSignature | null | undefined> {
    const key = object.toUpperCase();
    if (!this.paramCache.has(key)) {
      this.paramCache.set(key, await this.readSignatures(object));
    }
    const signatures = this.paramCache.get(key);
    if (signatures === null || signatures === undefined) return signatures;
    return this.selectSignature(object, signatures, expectedParams);
  }

  /** Data types whose bind needs the declared user-defined type, not a scalar. */
  private static readonly COMPOSITE_DATA_TYPES = new Set([
    'PL/SQL RECORD',
    'PL/SQL TABLE',
    'TABLE',
    'VARRAY',
    'OBJECT',
    'UNDEFINED',
  ]);

  /** Maps an Oracle argument data type to the OUT bind type to use. */
  static outBindType(param: ProcedureParam): oracledb.DbType | string {
    if (OracleSchemaService.COMPOSITE_DATA_TYPES.has(param.dataType.toUpperCase())) {
      const userType = OracleSchemaService.qualifiedTypeName(param);
      if (userType) return userType;
    }

    switch (param.dataType.toUpperCase()) {
      case 'NUMBER':
      case 'INTEGER':
      case 'FLOAT':
      case 'BINARY_FLOAT':
      case 'BINARY_DOUBLE':
        return oracledb.DB_TYPE_NUMBER;
      case 'DATE':
        return oracledb.DB_TYPE_DATE;
      case 'TIMESTAMP':
      case 'TIMESTAMP WITH LOCAL TIME ZONE':
      case 'TIMESTAMP WITH TIME ZONE':
        return oracledb.DB_TYPE_TIMESTAMP;
      case 'REF CURSOR':
        return oracledb.DB_TYPE_CURSOR;
      case 'CLOB':
      case 'NCLOB':
        return oracledb.DB_TYPE_CLOB;
      case 'BLOB':
        return oracledb.DB_TYPE_BLOB;
      default:
        return oracledb.DB_TYPE_VARCHAR;
    }
  }

  private async readSignatures(object: string): Promise<ProcedureSignature[] | null | undefined> {
    const [pkg, member] = object.toUpperCase().split('.');
    const target = member ?? pkg;
    try {
      const described = await this.metadata.describeArguments(object);
      // Keep `data_level === 0` formals only (collection attributes are not
      // procedure/function arguments), but — unlike before — don't drop the
      // FUNCTION return row (`position === 0`, `name === null`): it's needed
      // to tell a function apart from a procedure.
      const relevant = described.filter((a) => a.objectName === target && a.dataLevel === 0);
      if (!relevant.length) return null;

      const grouped = new Map<string, OracleArgumentInfo[]>();
      for (const arg of relevant) {
        const key = `${arg.owner}|${arg.subprogramId}|${arg.overload ?? ''}`;
        const group = grouped.get(key) ?? [];
        group.push(arg);
        grouped.set(key, group);
      }
      return [...grouped.values()].map((group) => {
        const returnArg = group.find((a) => a.position === 0 && !a.name);
        const params = group
          .filter((a) => a.name && a.position > 0)
          .sort((a, b) => a.sequence - b.sequence)
          .map((a) => this.toParam(a));
        return {
          owner: group[0].owner,
          ownerRank: group[0].ownerRank,
          overload: group[0].overload,
          subprogramId: group[0].subprogramId,
          params,
          returnType: returnArg
            ? {
                dataType: returnArg.dataType ?? 'UNDEFINED',
                typeOwner: returnArg.typeOwner ?? undefined,
                typeName: returnArg.typeName ?? undefined,
                typeSubname: returnArg.typeSubname ?? undefined,
              }
            : undefined,
        };
      });
    } catch (err) {
      this.logger.warn(`Could not read the signature of ${object}: ${(err as Error).message}`);
      return undefined;
    }
  }

  private selectSignature(
    object: string,
    signatures: ProcedureSignature[],
    expectedParams: readonly string[],
  ): ProcedureSignature {
    const bestOwnerRank = Math.min(...signatures.map((s) => s.ownerRank));
    const visible = signatures.filter((s) => s.ownerRank === bestOwnerRank);
    const expected = new Set(expectedParams.map((p) => p.toLowerCase()));
    const scored = visible.map((signature) => ({
      signature,
      score: signature.params.reduce((total, param) => {
        if (param.direction.includes('OUT')) return total;
        if (expected.has(param.name)) return total + 10;
        return total - (param.defaulted ? 0 : 1);
      }, 0),
    }));
    const bestScore = Math.max(...scored.map((entry) => entry.score));
    const matches = scored.filter((entry) => entry.score === bestScore).map((entry) => entry.signature);
    if (matches.length === 1) return matches[0];

    const shapes = new Set(matches.map((s) => s.params.map((p) => `${p.name}:${p.dataType}:${p.direction}`).join('|')));
    if (shapes.size === 1) return matches[0];
    throw new Error(`Ambiguous Oracle overload for ${object}; expected [${expectedParams.join(', ')}]`);
  }

  private toParam(arg: OracleArgumentInfo): ProcedureParam {
    return {
      name: (arg.name as string).toLowerCase(),
      direction: (arg.direction ?? 'IN').toUpperCase(),
      dataType: arg.dataType ?? 'VARCHAR2',
      defaulted: arg.defaulted,
      typeOwner: arg.typeOwner ?? undefined,
      typeName: arg.typeName ?? undefined,
      typeSubname: arg.typeSubname ?? undefined,
    };
  }

  private static qualifiedTypeName(param: ProcedureParam): string | undefined {
    if (!param.typeName) return undefined;
    const parts = [param.typeOwner, param.typeName, param.typeSubname].filter(Boolean);
    return parts.join('.');
  }

  /** Fully-qualified collection type name of a function's `RETURN` clause, if any. */
  static returnTypeName(returnType: ReturnType | undefined): string | undefined {
    if (!returnType?.typeName) return undefined;
    return [returnType.typeOwner, returnType.typeName, returnType.typeSubname]
      .filter(Boolean)
      .join('.');
  }

  private async columnsOf(object: string): Promise<Set<string>> {
    const key = object.toUpperCase();
    const cached = this.columnCache.get(key);
    if (cached) return cached;

    let names = new Set<string>();
    const types = new Map<string, string>();
    try {
      const columns = await this.metadata.describeColumns(object);
      names = new Set(columns.map((c) => c.name.toUpperCase()));
      for (const c of columns) types.set(c.name.toUpperCase(), c.dataType.toUpperCase());
    } catch (err) {
      this.logger.warn(`Could not describe ${object}: ${(err as Error).message}`);
    }
    this.columnCache.set(key, names);
    this.columnTypeCache.set(key, types);
    return names;
  }

  /** Column types for `object`, filled by the same dictionary read as columnsOf. */
  private async columnTypesOf(object: string): Promise<Map<string, string>> {
    const key = object.toUpperCase();
    if (!this.columnTypeCache.has(key)) await this.columnsOf(object);
    return this.columnTypeCache.get(key) ?? new Map();
  }
}
