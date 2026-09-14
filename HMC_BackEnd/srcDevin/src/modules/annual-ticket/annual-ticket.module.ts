import { Module } from '@nestjs/common';
import { LookupsModule } from '@lookups/lookups.module';
import { AnnualTicketController } from './interface/annual-ticket.controller';
import { AnnualTicketService } from './application/annual-ticket.service';
import { TICKET_REPOSITORY } from './domain/annual-ticket.repository';
import { TicketOracleRepository } from './infrastructure/oracle/annual-ticket.oracle.repository';

@Module({
  imports: [LookupsModule],
  controllers: [AnnualTicketController],
  providers: [
    AnnualTicketService,
    { provide: TICKET_REPOSITORY, useClass: TicketOracleRepository },
  ],
})
export class AnnualTicketModule {}
