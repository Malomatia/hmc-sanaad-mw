import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Lang } from '@core/i18n/lang.decorator';
import type { Lang as LangCode } from '@shared/domain/lang';
import { CurrentUser } from '@core/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { LangQueryDto } from '@shared/dto/lang-query.dto';
import { ProfileQueryDto } from '@shared/dto/common-query.dto';
import { SubmitResultDto } from '@shared/dto/submit-result.dto';
import { AppointmentsService } from '../application/appointments.service';
import { VerifiedBody } from '@shared/dto/verified-body';
import { BookAppointmentRequestDto } from './dto/appointments.dto';

/** Representative Cerner payloads (docs only): the client passes Cerner rows through unchanged. */
const UPCOMING_EXAMPLE = [
  {
    appointmentId: 'APT-0001',
    clinicId: 'CLINIC-001',
    clinicName: 'Staff Clinic',
    locationId: 'LOC-001',
    locationName: 'Hamad General Hospital',
    serviceId: 'SVC-001',
    serviceName: 'General Consultation',
    slot: '2026-09-01T09:30:00',
    status: 'BOOKED',
  },
];
const MASTERS_EXAMPLE = {
  clinics: [{ clinicId: 'CLINIC-001', clinicName: 'Staff Clinic' }],
  locations: [{ locationId: 'LOC-001', locationName: 'Hamad General Hospital' }],
  services: [{ serviceId: 'SVC-001', serviceName: 'General Consultation' }],
};

/** Appointments endpoints (Cerner — ops 41-44). See Docs_Ai/API/README.md. */
@ApiTags('appointments')
@ApiBearerAuth()
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly service: AppointmentsService) {}

  @Get('upcoming')
  @ApiOperation({ summary: 'op 41 — Upcoming staff-clinic appointments', operationId: 'appointments_upcoming' })
  @ApiOkResponse({
    description:
      'Read envelope; `result` carries the Cerner appointment rows unchanged. Requires CERNER_BASE_URL to be configured (otherwise 503).',
    schema: { example: { result: UPCOMING_EXAMPLE, opstatus: 0, status: 'success', httpStatusCode: 200 } },
  })
  upcoming(@Query() q: ProfileQueryDto) {
    return this.service.getUpcoming(q.enum, q.lang);
  }

  @Get('masters')
  @ApiOperation({ summary: 'op 42 — Clinic master details', operationId: 'appointments_masters' })
  @ApiOkResponse({
    description:
      'Read envelope; `result` = { clinics, locations, services }. Requires CERNER_BASE_URL to be configured (otherwise 503).',
    schema: { example: { result: MASTERS_EXAMPLE, opstatus: 0, status: 'success', httpStatusCode: 200 } },
  })
  masters(@Query() q: LangQueryDto) {
    return this.service.getMasters(q.lang);
  }

  @Get('booking-init')
  @ApiOperation({ summary: 'op 43 — Booking screen init', operationId: 'appointments_bookingInit' })
  @ApiOkResponse({
    description:
      'Read envelope; `result` aggregates { masters, upcoming }. Requires CERNER_BASE_URL to be configured (otherwise 503).',
    schema: {
      example: {
        result: { masters: MASTERS_EXAMPLE, upcoming: UPCOMING_EXAMPLE },
        opstatus: 0,
        status: 'success',
        httpStatusCode: 200,
      },
    },
  })
  bookingInit(@Query() q: ProfileQueryDto) {
    return this.service.initBooking(q.enum, q.lang);
  }

  @Post('book')
  @ApiOperation({ summary: 'op 44 — Book appointment', operationId: 'appointments_book' })
  @ApiOkResponse({ type: SubmitResultDto })
  // Cerner-backed: ids come from GET /appointments/masters and
  // /appointments/booking-init. Not executable on staging yet —
  // CERNER_BASE_URL is unset there, so all four ops answer 503.
  @VerifiedBody(
    BookAppointmentRequestDto,
    {
      clinicId: 'CLINIC-001',
      locationId: 'LOC-001',
      serviceId: 'SVC-001',
      slot: '2026-09-01T09:30:00',
    },
    'Shape only — the appointments module needs CERNER_BASE_URL configured on the environment (503 until then). Ids come from GET /appointments/masters.',
  )
  book(
    @Body() dto: BookAppointmentRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    return this.service.book({ ...dto }, user, lang);
  }
}
