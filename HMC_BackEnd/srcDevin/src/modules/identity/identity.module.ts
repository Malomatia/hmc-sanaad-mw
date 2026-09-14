import { Module } from '@nestjs/common';
import { LookupsModule } from '@lookups/lookups.module';
import { IdentityController } from './interface/identity.controller';
import { IdCardService, QidService } from './application/identity.service';
import { ID_CARD_REPOSITORY, QID_REPOSITORY } from './domain/identity.repository';
import {
  IdCardOracleRepository,
  QidOracleRepository,
} from './infrastructure/oracle/identity.oracle.repository';

@Module({
  imports: [LookupsModule],
  controllers: [IdentityController],
  providers: [
    QidService,
    IdCardService,
    { provide: QID_REPOSITORY, useClass: QidOracleRepository },
    { provide: ID_CARD_REPOSITORY, useClass: IdCardOracleRepository },
  ],
})
export class IdentityModule {}
