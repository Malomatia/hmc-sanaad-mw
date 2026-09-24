import { SKIP_INTEGRITY_KEY } from '@core/integrity/skip-integrity.decorator';
import { HealthController } from '@core/health/health.controller';
import { DiagnosticsController } from '@core/database/diagnostics.controller';
import { ApiLogsController } from '@core/logging/api-logs.controller';
import { DevConsoleController } from '@core/dev-console/dev-console.controller';
import { HealthCheckController } from '@modules/auth/interface/healthcheck.controller';
import { AppSettingController } from '@modules/auth/interface/app-setting.controller';
import { AuthController } from '@modules/auth/interface/auth.controller';
import { LeaveController } from '@modules/leave/interface/leave.controller';
import { NotificationsController } from '@modules/notifications/interface/notifications.controller';
import { AppIntegrityController } from './app-integrity.controller';

const exempt = (controller: object) => Reflect.getMetadata(SKIP_INTEGRITY_KEY, controller) === true;

/**
 * The list of routes that need no attestation headers is a published contract
 * (Docs_Ai/API/mobile-notifications-and-attestation.md, "Exempt routes"). It is
 * pinned here because the two halves drift apart quietly: a controller without
 * `@SkipIntegrity()` is invisible while APP_INTEGRITY_MODE=off and only fails
 * the day enforcement is switched on.
 */
describe('device attestation exempt routes', () => {
  it.each([
    ['/health (uptime probes)', HealthController],
    ['/healthcheck (API-1, first call on launch, before attesting)', HealthCheckController],
    ['/app-setting (launch-time static settings)', AppSettingController],
    ['/app-integrity/* (cannot prove itself before registering)', AppIntegrityController],
    ['/diagnostics (curl and Postman, not the app)', DiagnosticsController],
    ['/api-logs (curl and Postman, not the app)', ApiLogsController],
    ['/dev-console (a browser page for developers)', DevConsoleController],
  ])('exempts %s', (_label, controller) => {
    expect(exempt(controller)).toBe(true);
  });

  it.each([
    ['/auth/* including login — scripted credential attempts are the point', AuthController],
    ['/leave/* — a business submit', LeaveController],
    ['/notifications/* — redirects a person\'s notifications to a handset', NotificationsController],
  ])('keeps %s covered', (_label, controller) => {
    expect(exempt(controller)).toBe(false);
  });
});
