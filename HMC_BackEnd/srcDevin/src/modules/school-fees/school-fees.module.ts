import { Module } from '@nestjs/common';
import { LookupsModule } from '@lookups/lookups.module';
import { SchoolFeesController } from './interface/school-fees.controller';
import { SchoolFeeService } from './application/school-fees.service';
import { SCHOOL_FEE_REPOSITORY } from './domain/school-fees.repository';
import { SchoolFeeOracleRepository } from './infrastructure/oracle/school-fees.oracle.repository';

@Module({
  imports: [LookupsModule],
  controllers: [SchoolFeesController],
  providers: [
    SchoolFeeService,
    { provide: SCHOOL_FEE_REPOSITORY, useClass: SchoolFeeOracleRepository },
  ],
})
export class SchoolFeesModule {}
