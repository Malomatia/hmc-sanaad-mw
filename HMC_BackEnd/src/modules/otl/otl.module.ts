import { Module } from '@nestjs/common';
import { OtlApprovalsController, OtlController } from './interface/otl.controller';
import { OtlService } from './application/otl.service';
import { OTL_REPOSITORY } from './domain/otl.repository';
import { OtlOracleRepository } from './infrastructure/oracle/otl.oracle.repository';

@Module({
  controllers: [OtlController, OtlApprovalsController],
  providers: [OtlService, { provide: OTL_REPOSITORY, useClass: OtlOracleRepository }],
})
export class OtlModule {}
