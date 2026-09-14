import { Module } from '@nestjs/common';
import { LookupsModule } from '@lookups/lookups.module';
import { DependentsController } from './interface/dependents.controller';
import { DependentService, PassportService } from './application/dependents.service';
import { DEPENDENT_REPOSITORY, PASSPORT_REPOSITORY } from './domain/dependents.repository';
import {
  DependentOracleRepository,
  PassportOracleRepository,
} from './infrastructure/oracle/dependents.oracle.repository';

@Module({
  imports: [LookupsModule],
  controllers: [DependentsController],
  providers: [
    DependentService,
    PassportService,
    { provide: DEPENDENT_REPOSITORY, useClass: DependentOracleRepository },
    { provide: PASSPORT_REPOSITORY, useClass: PassportOracleRepository },
  ],
})
export class DependentsModule {}
