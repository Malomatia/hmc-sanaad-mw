import { Module } from '@nestjs/common';
import { LookupsModule } from '@lookups/lookups.module';
import { LettersController } from './interface/letters.controller';
import { LettersService } from './application/letters.service';
import { LETTER_REPOSITORY } from './domain/letters.repository';
import { LettersOracleRepository } from './infrastructure/oracle/letters.oracle.repository';

@Module({
  imports: [LookupsModule],
  controllers: [LettersController],
  providers: [
    LettersService,
    { provide: LETTER_REPOSITORY, useClass: LettersOracleRepository },
  ],
})
export class LettersModule {}
