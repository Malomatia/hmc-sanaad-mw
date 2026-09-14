import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Typed wrapper around a raw `mssql` driver error so the global exception
 * classifier can categorize Users-DB failures as DATABASE_ERROR without
 * leaking driver types (or SQL text) upward.
 */
export class MssqlQueryError extends Error {
  /** SQL Server error number, when the driver exposes one. */
  readonly sqlErrorNumber?: number;

  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MssqlQueryError';
    const num = (cause as { number?: unknown } | undefined)?.number;
    this.sqlErrorNumber = typeof num === 'number' ? num : undefined;
  }

  static from(err: unknown): MssqlQueryError {
    if (err instanceof MssqlQueryError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new MssqlQueryError(message, err);
  }
}

/**
 * Thrown when the Users DB pool itself isn't available (disabled, missing
 * credentials, or not yet connected). A distinct type from
 * ServiceUnavailableException so the classifier reports DATABASE_ERROR rather
 * than a generic external-service failure — mirrors OracleUnavailableException.
 */
export class MssqlUnavailableException extends ServiceUnavailableException {}
