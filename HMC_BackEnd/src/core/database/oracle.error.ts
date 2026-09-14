import { ServiceUnavailableException } from '@nestjs/common';
import { extractOraCode } from '@shared/constants/error-codes';

/**
 * Typed wrapper around a raw node-oracledb driver error, so the
 * OracleExceptionFilter can `@Catch(OracleQueryError)` and map ORA/PLS codes
 * to the Sanaad error envelope without leaking driver types upward.
 */
export class OracleQueryError extends Error {
  readonly oraCode?: number;

  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'OracleQueryError';
    this.oraCode = extractOraCode(message);
  }

  static from(err: unknown): OracleQueryError {
    if (err instanceof OracleQueryError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new OracleQueryError(message, err);
  }
}

/**
 * Thrown when the Oracle connection pool itself isn't available (disabled,
 * missing credentials, or not yet created). A distinct type from
 * ServiceUnavailableException so the global exception classifier can categorize
 * it as a DATABASE_ERROR rather than lumping it in with genuinely external
 * services (Cerner, LDAP).
 */
export class OracleUnavailableException extends ServiceUnavailableException {}

export class OracleContractUnavailableException extends ServiceUnavailableException {
  static readonly publicMessage =
    'This API operation is not configured: its Oracle contract is missing or incomplete.';

  constructor(readonly object: string, readonly contractPart: string) {
    super(OracleContractUnavailableException.publicMessage);
    this.name = 'OracleContractUnavailableException';
    this.message = `Missing static Oracle ${contractPart} contract for ${object}.`;
  }
}
