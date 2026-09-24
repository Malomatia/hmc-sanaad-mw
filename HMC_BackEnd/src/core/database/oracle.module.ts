import { Global, Module } from '@nestjs/common';
import { OracleService } from './oracle.service';

import { OracleSchemaService } from './oracle-schema.service';
import { OracleContractCatalog } from './oracle-contracts';

/**
 * Global module exposing the single OracleService pool to every data-touching
 * module (see Docs_Ai/Dependencies/README.md — OracleModule is @Global).
 * Also provides the in-memory Oracle call log + its diagnostics API.
 */
@Global()
@Module({
  controllers: [],
  providers: [OracleService, OracleContractCatalog, OracleSchemaService],
  exports: [OracleService, OracleSchemaService],
})
export class OracleModule {}
