import { Injectable } from '@nestjs/common';
import { createPool, Pool, PoolOptions, ResultSetHeader } from 'mysql2/promise';
import { toPositional } from './named-params.util';
import { UsersDbDiagnostics, UsersDbRawResult, UsersDbService } from './users-db.service';

/**
 * USERS_DB_DRIVER=mysql — the Users DB tables hosted on MySQL, through
 * `mysql2`. Repositories keep writing `@name` binds; they are rewritten to
 * positional `?` here (see `toPositional`) and run as prepared statements.
 */
@Injectable()
export class MysqlUsersDbService extends UsersDbService {
  readonly dialect = 'mysql' as const;
  private pool: Pool | undefined;

  /** Pool options, separate so the mapping from USERS_DB_* can be tested. */
  poolOptions(): PoolOptions {
    return {
      host: this.cfg.host,
      port: this.cfg.port,
      database: this.cfg.database,
      user: this.cfg.user,
      password: this.cfg.password,
      connectionLimit: this.cfg.poolMax,
      maxIdle: this.cfg.poolMin,
      connectTimeout: this.cfg.connectTimeoutMs,
      // Dates travel as UTC, like `mssql`'s default useUTC.
      timezone: 'Z',
      // affectedRows = rows MATCHED, as on SQL Server. By default MySQL counts
      // only rows that CHANGED, so re-setting the same MPIN would report 0
      // and the insert fallback would create a duplicate registration.
      flags: ['+FOUND_ROWS'],
      multipleStatements: false,
      ...(this.cfg.encrypt
        ? { ssl: { rejectUnauthorized: !this.cfg.trustServerCertificate } }
        : {}),
    };
  }

  protected async connect(): Promise<void> {
    const pool = createPool(this.poolOptions());
    try {
      // createPool is lazy; borrow one connection so bad credentials fail here.
      (await pool.getConnection()).release();
    } catch (err) {
      await pool.end().catch(() => undefined);
      throw err;
    }
    this.pool = pool;
  }

  protected hasPool(): boolean {
    return this.pool !== undefined;
  }

  protected async closePool(): Promise<void> {
    await this.pool?.end();
  }

  protected async rawQuery(
    statement: string,
    params: Record<string, unknown>,
  ): Promise<UsersDbRawResult> {
    const { sql, values } = toPositional(statement, params);
    const [result] = await this.pool!.execute({
      sql,
      values: values as never,
      timeout: this.cfg.requestTimeoutMs,
    });
    if (Array.isArray(result)) {
      return { rows: result as Record<string, any>[], rowsAffected: 0 };
    }
    const header = result as ResultSetHeader;
    return {
      rows: [],
      rowsAffected: header.affectedRows ?? 0,
      ...(header.insertId ? { insertId: Number(header.insertId) } : {}),
    };
  }

  protected async probe(): Promise<{ version: string; dbTime: string }> {
    const { rows } = await this.rawQuery('SELECT VERSION() AS version, NOW() AS dbTime', {});
    return {
      version: `MySQL ${String(rows[0]?.version ?? 'unknown')}`,
      dbTime: String(rows[0]?.dbTime ?? 'unknown'),
    };
  }

  /** mysql2 does not expose pool counters publicly. */
  protected poolStats(): UsersDbDiagnostics['pool'] {
    return null;
  }
}
