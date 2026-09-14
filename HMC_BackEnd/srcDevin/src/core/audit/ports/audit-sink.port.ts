import { AuditRecord } from '../audit-event';

/**
 * Destination for audit records. The default sink writes structured logs; swap
 * for a persistent store (Oracle audit table / SIEM) by binding AUDIT_SINK to a
 * different adapter. Audit generation is backend-only (framework doc §Conclusion).
 */
export interface AuditSink {
  write(record: AuditRecord): void | Promise<void>;
}

export const AUDIT_SINK = Symbol('AUDIT_SINK');
