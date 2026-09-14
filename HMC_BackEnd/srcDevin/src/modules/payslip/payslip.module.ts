import { Module } from '@nestjs/common';
import { PayslipController } from './interface/payslip.controller';
import { PayslipService } from './application/payslip.service';
import { PAYSLIP_REPOSITORY } from './domain/payslip.repository';
import { PayslipOracleRepository } from './infrastructure/oracle/payslip.oracle.repository';

@Module({
  controllers: [PayslipController],
  providers: [
    PayslipService,
    { provide: PAYSLIP_REPOSITORY, useClass: PayslipOracleRepository },
  ],
})
export class PayslipModule {}
