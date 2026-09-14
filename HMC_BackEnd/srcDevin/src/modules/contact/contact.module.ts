import { Module } from '@nestjs/common';
import { LookupsModule } from '@lookups/lookups.module';
import { ContactController } from './interface/contact.controller';
import { AddressService, PhoneService } from './application/contact.service';
import { ADDRESS_REPOSITORY, PHONE_REPOSITORY } from './domain/contact.repository';
import {
  AddressOracleRepository,
  PhoneOracleRepository,
} from './infrastructure/oracle/contact.oracle.repository';

@Module({
  imports: [LookupsModule],
  controllers: [ContactController],
  providers: [
    PhoneService,
    AddressService,
    { provide: PHONE_REPOSITORY, useClass: PhoneOracleRepository },
    { provide: ADDRESS_REPOSITORY, useClass: AddressOracleRepository },
  ],
})
export class ContactModule {}
