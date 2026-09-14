import { Module } from '@nestjs/common';
import { CoreModule } from '@core/core.module';
import { LookupsModule } from '@lookups/lookups.module';
import { AuthModule } from '@modules/auth/auth.module';
import { ProfileModule } from '@modules/profile/profile.module';
import { EmployeeModule } from '@modules/employee/employee.module';
import { PayslipModule } from '@modules/payslip/payslip.module';
import { LeaveModule } from '@modules/leave/leave.module';
import { LettersModule } from '@modules/letters/letters.module';
import { IdentityModule } from '@modules/identity/identity.module';
import { ContactModule } from '@modules/contact/contact.module';
import { DependentsModule } from '@modules/dependents/dependents.module';
import { SchoolFeesModule } from '@modules/school-fees/school-fees.module';
import { AppointmentsModule } from '@modules/appointments/appointments.module';
import { AnnualTicketModule } from '@modules/annual-ticket/annual-ticket.module';
import { ApprovalsModule } from '@modules/approvals/approvals.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AppIntegrityModule } from './modules/app-integrity/app-integrity.module';

/**
 * Root module. Imports core cross-cutting concerns, the shared lookups kernel,
 * and the 14 feature modules (one per Sanaad bounded context).
 * See Docs_Ai/Project Structure/README.md.
 */
@Module({
  imports: [
    CoreModule,
    LookupsModule,
    // ── Feature modules (14) ──
    AuthModule,
    ProfileModule,
    EmployeeModule,
    PayslipModule,
    LeaveModule,
    LettersModule,
    IdentityModule,
    ContactModule,
    DependentsModule,
    SchoolFeesModule,
    AppointmentsModule,
    AnnualTicketModule,
    ApprovalsModule,
    NotificationsModule,
    AppIntegrityModule,
  ],
})
export class AppModule {}
