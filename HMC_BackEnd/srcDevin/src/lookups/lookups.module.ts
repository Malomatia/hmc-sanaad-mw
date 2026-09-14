import { Module } from '@nestjs/common';
import { LookupsController } from './interface/lookups.controller';
import { LookupsService } from './application/lookups.service';
import { LOV_REPOSITORY } from './domain/lov.repository';
import { LovOracleRepository } from './infrastructure/oracle/lov.oracle.repository';

/**
 * Shared-kernel lookups module. Exports LookupsService so feature modules can
 * read domain-branded LOVs without reimplementing LOV access or importing each
 * other. See Docs_Ai/Dependencies/README.md.
 */
@Module({
  controllers: [LookupsController],
  providers: [
    LookupsService,
    { provide: LOV_REPOSITORY, useClass: LovOracleRepository },
  ],
  exports: [LookupsService],
})
export class LookupsModule {}
