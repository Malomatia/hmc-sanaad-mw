import { ServiceUnavailableException } from '@nestjs/common';

/** SQL Server "Invalid object name". */
const MSSQL_INVALID_OBJECT_NAME = 208;
/** MySQL ER_NO_SUCH_TABLE. */
const MYSQL_NO_SUCH_TABLE = 1146;

/**
 * Typed wrapper around a raw SQL driver error (`mssql` or `mysql2`) so the
 * global exception classifier can categorize Users-DB / MOTC-DB failures as
 * DATABASE_ERROR without leaking driver types (or SQL text) upward.
 */
export class SqlQueryError extends Error {
  /** Server error number, when the driver exposes one (`number` / `errno`). */
  readonly sqlErrorNumber?: number;
  /**
   * The statement referenced a table or view that does not exist — a
   * deployment step, which callers degrade to a warning.
   */
  readonly missingObject: boolean;

  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SqlQueryError';
    const source = cause as { number?: unknown; errno?: unknown } | undefined;
    const num = typeof source?.number === 'number' ? source.number : source?.errno;
    this.sqlErrorNumber = typeof num === 'number' ? num : undefined;
    this.missingObject =
      this.sqlErrorNumber === MSSQL_INVALID_OBJECT_NAME ||
      this.sqlErrorNumber === MYSQL_NO_SUCH_TABLE ||
      /invalid object name/i.test(message);
  }

  static from(err: unknown): SqlQueryError {
    if (err instanceof SqlQueryError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new SqlQueryError(message, err);
  }
}

/**
 * Thrown when a SQL pool itself isn't available (missing credentials, an
 * unsupported driver, or not yet connected). A distinct type from
 * ServiceUnavailableException so the classifier reports DATABASE_ERROR rather
 * than a generic external-service failure — mirrors OracleUnavailableException.
 */
export class SqlUnavailableException extends ServiceUnavailableException {}
