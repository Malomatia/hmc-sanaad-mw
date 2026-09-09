/**
 * Audit taxonomy for the Sanaad auth & access-control framework (backend-only).
 * Levels mirror the framework doc §5.2 (L1 API call, L2 lifecycle, L3 device
 * binding, L4 security incident, L5 function access).
 */

export enum AuditLevel {
  API_CALL = 'L1_API_CALL',
  LIFECYCLE = 'L2_LIFECYCLE',
  DEVICE_BINDING = 'L3_DEVICE_BINDING',
  SECURITY_INCIDENT = 'L4_SECURITY_INCIDENT',
  FUNCTION_ACCESS = 'L5_FUNCTION_ACCESS',
}

/** Level-2 authentication lifecycle milestones. */
export enum AuthLifecycleEvent {
  HEALTH_CHECK_CALLED = 'HEALTH_CHECK_CALLED',
  USER_VALIDATE_SUCCESS = 'USER_VALIDATE_SUCCESS',
  USER_VALIDATE_FAILURE = 'USER_VALIDATE_FAILURE',
  OTP_SENT = 'OTP_SENT',
  OTP_VALIDATED = 'OTP_VALIDATED',
  OTP_FAILED = 'OTP_FAILED',
  MPIN_SET = 'MPIN_SET',
  MPIN_RESET = 'MPIN_RESET',
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILURE = 'LOGIN_FAILURE',
  LOGOUT = 'LOGOUT',
  TOKEN_REFRESHED = 'TOKEN_REFRESHED',
  ACCOUNT_LOCK = 'ACCOUNT_LOCK',
  BIOMETRIC_ENABLED = 'BIOMETRIC_ENABLED',
}

/** Level-4 security incidents. */
export enum SecurityIncident {
  EXCESSIVE_OTP_REQUESTS = 'EXCESSIVE_OTP_REQUESTS',
  REPEATED_LOGIN_FAILURES = 'REPEATED_LOGIN_FAILURES',
  DEVICE_SPOOFING = 'DEVICE_SPOOFING',
  TOKEN_TAMPERING = 'TOKEN_TAMPERING',
}

export interface AuditContext {
  username?: string;
  deviceImei?: string;
  platform?: string;
  appName?: string;
  appVersion?: string;
  functionId?: string;
  actionTaken?: 'view' | 'submit';
  source?: string;
  correlationId?: string;
  status?: string;
  errorCode?: string;
  meta?: Record<string, unknown>;
}

export interface AuditRecord extends AuditContext {
  auditId: string;
  level: AuditLevel;
  apiName?: string;
  functionName?: string;
  event?: string;
  timestamp: string;
}
