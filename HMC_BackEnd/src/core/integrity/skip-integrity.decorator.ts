import { SetMetadata } from '@nestjs/common';

export const SKIP_INTEGRITY_KEY = 'skipIntegrity';

/**
 * Exempt a route from device attestation.
 *
 * For endpoints that are not called by the mobile app: uptime probes, the
 * diagnostics consoles, anything a monitor or a human reaches with curl —
 * none of them can produce an App Attest assertion or a Play Integrity token,
 * so enforcing would simply block them.
 *
 * Mobile routes, including login, stay covered: refusing scripted credential
 * attempts is much of the point.
 */
export const SkipIntegrity = () => SetMetadata(SKIP_INTEGRITY_KEY, true);
