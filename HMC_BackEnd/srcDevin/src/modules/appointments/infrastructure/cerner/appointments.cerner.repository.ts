import { Injectable } from '@nestjs/common';
import { Lang } from '@shared/domain/lang';
import { SubmitResult, failureResult, successResult } from '@shared/domain/submit-result';
import {
  AppointmentsRepository,
  BookAppointmentCommand,
  ClinicMasters,
  UpcomingAppointment,
} from '../../domain/appointments.repository';
import { CernerClient } from './cerner.client';

/** AppointmentsRepository backed by the Cerner ACL client. */
@Injectable()
export class AppointmentsCernerRepository implements AppointmentsRepository {
  constructor(private readonly cerner: CernerClient) {}

  getUpcoming(employeeNumber: string, lang: Lang): Promise<UpcomingAppointment[]> {
    return this.cerner.getUpcoming(employeeNumber, lang);
  }

  getMasters(lang: Lang): Promise<ClinicMasters> {
    return this.cerner.getMasters(lang);
  }

  async book(cmd: BookAppointmentCommand): Promise<SubmitResult> {
    const res = await this.cerner.book({ username: cmd.username, lang: cmd.lang, ...cmd.fields });
    return res.status === 'S' || res.status === 'success'
      ? successResult(res.message ?? 'Appointment booked.')
      : failureResult(res.message ?? 'Booking failed.');
  }
}
