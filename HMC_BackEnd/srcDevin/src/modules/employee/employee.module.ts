import { Module } from '@nestjs/common';
import { EmployeeController } from './interface/employee.controller';
import { EmployeeService, SupervisorService } from './application/employee.service';
import { EMPLOYMENT_REPOSITORY, SUPERVISOR_REPOSITORY } from './domain/employee.repository';
import {
  EmploymentOracleRepository,
  SupervisorOracleRepository,
} from './infrastructure/oracle/employee.oracle.repository';

@Module({
  controllers: [EmployeeController],
  providers: [
    EmployeeService,
    SupervisorService,
    { provide: EMPLOYMENT_REPOSITORY, useClass: EmploymentOracleRepository },
    { provide: SUPERVISOR_REPOSITORY, useClass: SupervisorOracleRepository },
  ],
})
export class EmployeeModule {}
