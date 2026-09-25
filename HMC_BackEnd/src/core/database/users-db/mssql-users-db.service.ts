import { Injectable } from '@nestjs/common';
import * as sql from 'mssql';
import { UsersDbDiagnostics, UsersDbRawResult, UsersDbService } from './users-db.service';

/**
 * USERS_DB_DRIVER=mssql (default) — the legacy Sanaad SQL Server, through the
 * `mssql` package (tedious, pure JS: no ODBC or native client needed).
 * Named `@params` are native here, so statements run exactly as written.
 */
@Injectable()
export class MssqlUsersDbService extends UsersDbService {
  readonly dialect = 'mssql' as const;
  private pool: sql.ConnectionPool | undefined;

  protected async connect(): Promise<void> {
    const pool = await new sql.ConnectionPool({
      server: this.cfg.host,
      port: this.cfg.port,
      database: this.cfg.database,
      user: this.cfg.user,
      password: this.cfg.password,
      pool: { min: this.cfg.poolMin, max: this.cfg.poolMax },
      options: {
        encrypt: this.cfg.encrypt,
        trustServerCertificate: this.cfg.trustServerCertificate,
      },
      requestTimeout: this.cfg.requestTimeoutMs,
      connectionTimeout: this.cfg.connectTimeoutMs,
    }).connect();
    pool.on('error', (err) => this.logger.error(`Users DB pool error: ${err.message}`));
    this.pool = pool;
  }

  protected hasPool(): boolean {
    return this.pool !== undefined;
  }

  protected async closePool(): Promise<void> {
    await this.pool?.close();
  }

  protected async rawQuery(
    statement: string,
    params: Record<string, unknown>,
  ): Promise<UsersDbRawResult> {
    const request = this.pool!.request();
    for (const [key, value] of Object.entries(params)) {
      request.input(key, value as sql.ISqlType | unknown);
    }
    const result = await request.query(statement);
    return {
      rows: result.recordset ?? [],
      rowsAffected: (result.rowsAffected ?? []).reduce((a, b) => a + b, 0),
    };
  }

  protected async probe(): Promise<{ version: string; dbTime: string }> {
    const result = await this.pool!.request().query<{ version: string; dbTime: Date }>(
      'SELECT @@VERSION AS version, SYSDATETIMEOFFSET() AS dbTime',
    );
    const row = result.recordset[0];
    return {
      version: String(row?.version ?? 'unknown').split('\n')[0].trim(),
      dbTime: String(row?.dbTime ?? 'unknown'),
    };
  }

  protected poolStats(): UsersDbDiagnostics['pool'] {
    const pool = this.pool!;
    return {
      size: pool.size,
      available: pool.available,
      borrowed: pool.borrowed,
      pending: pool.pending,
    };
  }
}
