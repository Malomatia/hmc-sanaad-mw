import { Inject, Injectable } from '@nestjs/common';
import { Lang } from '@shared/domain/lang';
import { SubmitResult } from '@shared/domain/submit-result';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import {
  APPOINTMENTS_REPOSITORY,
  AppointmentsRepository,
  ClinicMasters,
  UpcomingAppointment,
} from '../domain/appointments.repository';

/** Appointments service (ops 41-44). op 43 aggregates masters + upcoming. */
@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(APPOINTMENTS_REPOSITORY) private readonly repo: AppointmentsRepository,
  ) {}

  getUpcoming(employeeNumber: string, lang: Lang): Promise<UpcomingAppointment[]> {
    return this.repo.getUpcoming(employeeNumber, lang);
  }

  getMasters(lang: Lang): Promise<ClinicMasters> {
    return this.repo.getMasters(lang);
  }

  async initBooking(
    employeeNumber: string,
    lang: Lang,
  ): Promise<{ masters: ClinicMasters; upcoming: UpcomingAppointment[] }> {
    const [masters, upcoming] = await Promise.all([
      this.repo.getMasters(lang),
      this.repo.getUpcoming(employeeNumber, lang),
    ]);
    return { masters, upcoming };
  }

  book(fields: Record<string, unknown>, user: AuthenticatedUser, lang: Lang): Promise<SubmitResult> {
    return this.repo.book({ username: user.username, lang, fields });
  }
}
