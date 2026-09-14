import { Module } from '@nestjs/common';
import { LookupsModule } from '@lookups/lookups.module';
import { LeaveController } from './interface/leave.controller';
import { LeavesController } from './interface/leaves.controller';
import { LeaveService } from './application/leave.service';
import { LEAVE_REPOSITORY } from './domain/leave.repository';
import { LeaveOracleRepository } from './infrastructure/oracle/leave.oracle.repository';

@Module({
  imports: [LookupsModule],
  controllers: [LeaveController, LeavesController],
  providers: [
    LeaveService,
    { provide: LEAVE_REPOSITORY, useClass: LeaveOracleRepository },
  ],
})
export class LeaveModule {}
