import { Global, Module } from '@nestjs/common';
import { OracleService } from './oracle.service';
import { OracleLogStore } from './oracle-log.store';
import { OracleMetadataService } from './oracle-metadata.service';
import { OracleSchemaService } from './oracle-schema.service';
import { OracleContractCatalog } from './oracle-contracts';
import { DiagnosticsController } from './diagnostics.controller';

/**
 * Global module exposing the single OracleService pool to every data-touching
 * module (see Docs_Ai/Dependencies/README.md — OracleModule is @Global).
 * Also provides the in-memory Oracle call log + its diagnostics API.
 */
@Global()
@Module({
  controllers: [DiagnosticsController],
  providers: [OracleService, OracleLogStore, OracleMetadataService, OracleContractCatalog, OracleSchemaService],
  exports: [OracleService, OracleLogStore, OracleSchemaService],
})
export class OracleModule {}
