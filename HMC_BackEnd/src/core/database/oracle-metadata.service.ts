import { BadRequestException, Injectable } from '@nestjs/common';
import { isKnownOracleObject } from '@shared/constants/oracle-objects';
import { OracleService } from './oracle.service';

/** One column of a table/view, as reported by ALL_TAB_COLUMNS. */
export interface OracleColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  position: number;
}

/** One formal parameter of a procedure/function, as reported by ALL_ARGUMENTS. */
export interface OracleArgumentInfo {
  owner: string;
  ownerRank: number;
  packageName: string | null;
  objectName: string;
  overload: string | null;
  subprogramId: number;
  /** NULL position/name marks a function return value. */
  name: string | null;
  position: number;
  sequence: number;
  dataLevel: number;
  dataType: string | null;
  typeOwner: string | null;
  typeName: string | null;
  typeSubname: string | null;
  direction: string | null;
  defaulted: boolean;
}

/** What kind of Oracle object a name resolves to (view vs procedure vs package). */
export interface OracleObjectKind {
  owner: string;
  objectName: string;
  objectType: string;
  status: string;
}

export interface OracleObjectDescription {
  object: string;
  kinds: OracleObjectKind[];
  columns: OracleColumnInfo[];
  arguments: OracleArgumentInfo[];
  checkedAt: string;
}

/**
 * Reads the Oracle data dictionary so the exact shape of an `XXHMC_SND_*`
 * object can be confirmed from the running app instead of guessed.
 *
 * Motivation: several adapters previously assumed key columns (`employee_number`)
 * and bind names that do not exist, producing ORA-00904 / PLS-00306 / ORA-04044.
 * `describe()` answers all three questions at once — object type, column list and
 * formal parameter list — which is exactly what the ALL_OBJECTS / ALL_TAB_COLUMNS
 * / ALL_ARGUMENTS queries a DBA would run return.
 */
@Injectable()
export class OracleMetadataService {
  constructor(private readonly ora: OracleService) {}

  /**
   * Describe a known Oracle object. The name is validated against the central
   * allow-list, and it is only ever used as a bind value (never interpolated).
   */
  async describe(name: string): Promise<OracleObjectDescription> {
    const object = this.normalize(name);
    const [kinds, columns, args] = await Promise.all([
      this.readKinds(object),
      this.readColumns(object),
      this.readArguments(object),
    ]);
    return {
      object,
      kinds,
      columns,
      arguments: args,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Columns of a known object, without the object-kind and argument lookups that
   * `describe()` also performs. Used by the hot path that only needs to know
   * whether a view exposes a key column (see OracleSchemaService.hasColumn):
   * running the full `describe()` there fired the expensive ALL_ARGUMENTS query
   * (`... OR package_name = :pkg`) on every user-scoped LOV read, which was the
   * cause of the request timeouts, and held three pool connections instead of one.
   */
  async describeColumns(name: string): Promise<OracleColumnInfo[]> {
    return this.readColumns(this.normalize(name));
  }

  /**
   * Formal parameters of a known program unit, without the column and
   * object-kind lookups `describe()` also performs. Used when only the bind
   * signature is needed (see OracleSchemaService.resolveParams).
   */
  async describeArguments(name: string): Promise<OracleArgumentInfo[]> {
    return this.readArguments(this.normalize(name));
  }

  private normalize(name: string): string {
    const object = (name ?? '').trim().toUpperCase();
    // A package member (PKG.PROC) is described by its package name.
    const root = object.split('.')[0];
    // Accept anything in the central allow-list PLUS any XXHMC_SND_-prefixed
    // identifier: the Sanaad schema contains views the app has not (yet)
    // registered, and describing them is exactly what the diagnostics surface
    // is for. Names are only ever used as BIND VALUES (never interpolated),
    // so the identifier check is about intent, not injection.
    const isSanaadName = /^XXHMC_SND_[A-Z0-9_$#]*$/.test(root);
    if (!isKnownOracleObject(root) && !isSanaadName) {
      throw new BadRequestException(`Unknown Oracle object: ${name}`);
    }
    return object;
  }

  private async readKinds(object: string): Promise<OracleObjectKind[]> {
    const [pkg, member] = object.split('.');
    const rows = await this.ora.query<Record<string, any>>(
      `SELECT owner, object_name, object_type, status
         FROM all_objects
        WHERE object_name IN (:pkg, :member)
        ORDER BY object_name, object_type`,
      { pkg, member: member ?? pkg },
    );
    return rows.map((r) => ({
      owner: String(r.OWNER),
      objectName: String(r.OBJECT_NAME),
      objectType: String(r.OBJECT_TYPE),
      status: String(r.STATUS),
    }));
  }

  private async readColumns(object: string): Promise<OracleColumnInfo[]> {
    const rows = await this.ora.query<Record<string, any>>(
      `SELECT column_name, data_type, nullable, column_id
         FROM all_tab_columns
        WHERE table_name = :object
        ORDER BY column_id`,
      { object: object.split('.')[0] },
    );
    return rows.map((r) => ({
      name: String(r.COLUMN_NAME),
      dataType: String(r.DATA_TYPE),
      nullable: r.NULLABLE === 'Y',
      position: Number(r.COLUMN_ID),
    }));
  }

  private async readArguments(object: string): Promise<OracleArgumentInfo[]> {
    const [pkg, member] = object.split('.');
    const rows = await this.ora.query<Record<string, any>>(
      `WITH synonym_owners AS (
          SELECT DISTINCT table_owner
            FROM user_synonyms
           WHERE synonym_name = :pkg
        )
        SELECT a.owner,
               CASE
                 WHEN a.owner = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') THEN 0
                 WHEN s.table_owner IS NOT NULL THEN 1
                 WHEN a.owner = 'APPS' THEN 2
                 ELSE 3
               END owner_rank,
               a.package_name, a.object_name, a.overload, a.subprogram_id,
               a.argument_name, a.position, a.sequence, a.data_level, a.data_type,
               a.type_owner, a.type_name, a.type_subname, a.in_out, a.defaulted
          FROM all_arguments a
          LEFT JOIN synonym_owners s ON a.owner = s.table_owner
         WHERE (:member IS NOT NULL AND a.package_name = :pkg AND a.object_name = :member)
            OR (:member IS NULL AND a.package_name IS NULL AND a.object_name = :pkg)
         ORDER BY owner_rank, a.owner, a.subprogram_id, a.overload NULLS FIRST, a.sequence`,
      { pkg, member: member ?? null },
    );
    return rows.map((r) => ({
      owner: String(r.OWNER),
      ownerRank: Number(r.OWNER_RANK),
      packageName: r.PACKAGE_NAME ? String(r.PACKAGE_NAME) : null,
      objectName: String(r.OBJECT_NAME),
      overload: r.OVERLOAD ? String(r.OVERLOAD) : null,
      subprogramId: Number(r.SUBPROGRAM_ID),
      name: r.ARGUMENT_NAME ? String(r.ARGUMENT_NAME) : null,
      position: Number(r.POSITION),
      sequence: Number(r.SEQUENCE),
      dataLevel: Number(r.DATA_LEVEL),
      dataType: r.DATA_TYPE ? String(r.DATA_TYPE) : null,
      typeOwner: r.TYPE_OWNER ? String(r.TYPE_OWNER) : null,
      typeName: r.TYPE_NAME ? String(r.TYPE_NAME) : null,
      typeSubname: r.TYPE_SUBNAME ? String(r.TYPE_SUBNAME) : null,
      direction: r.IN_OUT ? String(r.IN_OUT) : null,
      defaulted: r.DEFAULTED === 'Y',
    }));
  }
}
