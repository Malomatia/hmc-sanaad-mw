/**
 * Thrown internally by `OracleSchemaService.resolveKeyColumn` when NONE of the
 * candidate key columns exist on a view/table (a schema mismatch, not a
 * connectivity/permission/timeout problem). Never meant to reach a client:
 *
 *  - `BaseOracleRepository.readByResolvedKey` catches it and degrades
 *    gracefully (empty result for that one read) instead of failing the whole
 *    request — see readByResolvedKey.
 *  - `AllExceptionsFilter` also recognizes it as a safety net, in case some
 *    future call site calls `resolveKeyColumn` directly without catching it,
 *    so the "never hard-fail on a missing optional column" guarantee holds
 *    globally rather than per call site.
 */
export class SchemaColumnNotFoundException extends Error {
  constructor(
    readonly object: string,
    readonly candidates: readonly string[],
    readonly availableColumns: readonly string[],
  ) {
    super(
      `None of the expected key columns [${candidates.join(', ')}] exist on ${object}. ` +
        `Available columns: ${availableColumns.join(', ')}.`,
    );
    this.name = 'SchemaColumnNotFoundException';
  }
}
