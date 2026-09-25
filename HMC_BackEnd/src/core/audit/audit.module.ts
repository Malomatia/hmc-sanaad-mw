import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AUDIT_SINK } from './ports/audit-sink.port';
import { LoggerAuditSink } from './sinks/logger-audit.sink';
import { MssqlAuditSink } from './sinks/mssql-audit.sink';
import { SqlDatabasesModule } from '../database/sql-databases.module';

/**
 * Global audit module. Exposes AuditService app-wide and binds the default
 * structured-log sink. Re-bind AUDIT_SINK to persist audits (Oracle/SIEM).
 */
@Global()
@Module({
  imports: [SqlDatabasesModule],
  providers: [AuditService, LoggerAuditSink, { provide: AUDIT_SINK, useClass: MssqlAuditSink }],
  exports: [AuditService],
})
export class AuditModule {}
