import { Module } from '@nestjs/common';
import { ApprovalsController } from './interface/approvals.controller';
import { ApprovalsService, WorklistService } from './application/approvals.service';
import { APPROVALS_REPOSITORY, WORKLIST_REPOSITORY } from './domain/approvals.repository';
import {
  ApprovalsOracleRepository,
  WorklistOracleRepository,
} from './infrastructure/oracle/approvals.oracle.repository';

@Module({
  controllers: [ApprovalsController],
  providers: [
    ApprovalsService,
    WorklistService,
    { provide: APPROVALS_REPOSITORY, useClass: ApprovalsOracleRepository },
    { provide: WORKLIST_REPOSITORY, useClass: WorklistOracleRepository },
  ],
  // WorklistService is shared with the profile module (GET /profile/notifications
  // reads the same WORKLISTS_V documented query) — the SQL lives here only.
  exports: [WorklistService],
})
export class ApprovalsModule {}
