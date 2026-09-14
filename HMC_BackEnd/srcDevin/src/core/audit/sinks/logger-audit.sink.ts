import { Injectable, Logger } from '@nestjs/common';
import { AuditSink } from '../ports/audit-sink.port';
import { AuditRecord } from '../audit-event';

/**
 * Default audit sink: emits one structured JSON log line per record under the
 * "Audit" context. Replace with a persistent adapter (Oracle table / SIEM) when
 * available by re-binding AUDIT_SINK.
 */
@Injectable()
export class LoggerAuditSink implements AuditSink {
  private readonly logger = new Logger('Audit');

  write(record: AuditRecord): void {
    this.logger.log(JSON.stringify(record));
  }
}
