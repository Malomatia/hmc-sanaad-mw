import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AUDIT_SINK, AuditSink } from './ports/audit-sink.port';
import {
  AuditContext,
  AuditLevel,
  AuditRecord,
  AuthLifecycleEvent,
  SecurityIncident,
} from './audit-event';

/**
 * Central audit emitter. Every authentication & business API must trigger audit
 * logging from the backend (framework doc §5). Emission never throws — a failing
 * sink is logged and swallowed so it can never break a request flow.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(AUDIT_SINK) private readonly sink: AuditSink) {}

  private emit(partial: Omit<AuditRecord, 'auditId' | 'timestamp'>): void {
    const record: AuditRecord = {
      auditId: randomUUID(),
      timestamp: new Date().toISOString(),
      ...partial,
    };
    try {
      void Promise.resolve(this.sink.write(record)).catch((err: unknown) => {
        this.logger.error(`Audit sink failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    } catch (err) {
      this.logger.error(`Audit sink failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Level 1 — every authentication/business API invocation. */
  apiCall(apiName: string, ctx: AuditContext = {}): void {
    this.emit({ level: AuditLevel.API_CALL, apiName, ...ctx });
  }

  /** Level 2 — authentication lifecycle milestone. */
  lifecycle(event: AuthLifecycleEvent, ctx: AuditContext = {}): void {
    this.emit({ level: AuditLevel.LIFECYCLE, event, ...ctx });
  }

  /** Level 3 — user↔device trust event. */
  deviceBinding(event: string, ctx: AuditContext = {}): void {
    this.emit({ level: AuditLevel.DEVICE_BINDING, event, ...ctx });
  }

  /** Level 4 — security incident. */
  securityIncident(incident: SecurityIncident, ctx: AuditContext = {}): void {
    this.emit({ level: AuditLevel.SECURITY_INCIDENT, event: incident, ...ctx });
  }

  /** Level 5 — module/function accessed after login. */
  functionAccess(functionName: string, ctx: AuditContext = {}): void {
    this.emit({ level: AuditLevel.FUNCTION_ACCESS, functionName, ...ctx });
  }
}
