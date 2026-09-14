import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { CernerConfig } from '@core/config/configuration';
import { AppointmentsController } from './interface/appointments.controller';
import { AppointmentsService } from './application/appointments.service';
import { APPOINTMENTS_REPOSITORY } from './domain/appointments.repository';
import { CernerClient } from './infrastructure/cerner/cerner.client';
import { AppointmentsCernerRepository } from './infrastructure/cerner/appointments.cerner.repository';

@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const cfg = config.getOrThrow<CernerConfig>('cerner');
        return { timeout: cfg.timeoutMs, maxRedirects: 3 };
      },
    }),
  ],
  controllers: [AppointmentsController],
  providers: [
    AppointmentsService,
    CernerClient,
    { provide: APPOINTMENTS_REPOSITORY, useClass: AppointmentsCernerRepository },
  ],
})
export class AppointmentsModule {}
