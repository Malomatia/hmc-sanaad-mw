import * as Joi from 'joi';

/**
 * Env schema — fails fast at boot if configuration is missing/invalid.
 * See .env.example for the full list.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(443),
  API_PREFIX: Joi.string().default('api/v1'),
  CORS_ORIGINS: Joi.string().default('*'),

  SANAAD_GATEWAY_BASE_URL: Joi.string()
    .uri()
    .default('https://apigwuat.api.hamad.qa/sanaad'),

  // Oracle
  ORACLE_USER: Joi.string().allow('').default(''),
  ORACLE_PASSWORD: Joi.string().allow('').default(''),
  ORACLE_DSN: Joi.string().allow('').default(''),
  ORACLE_POOL_MIN: Joi.number().default(2),
  ORACLE_POOL_MAX: Joi.number().default(10),
  ORACLE_POOL_TIMEOUT: Joi.number().default(60),
  ORACLE_QUEUE_TIMEOUT_MS: Joi.number().min(1).default(25000),
  ORACLE_CALL_TIMEOUT_MS: Joi.number().min(1).default(25000),
  ORACLE_DISABLED: Joi.boolean().default(false),
  // Enables POST /diagnostics/oracle/sql (SELECT-only console; 403 in production).
  ORACLE_SQL_ENABLED: Joi.boolean().default(true),
  // Thick mode: requires Oracle Client libraries installed at runtime.
  ORACLE_THICK_MODE: Joi.boolean().default(true),
  ORACLE_CLIENT_LIB_DIR: Joi.string().allow('').default(''),

  // Users/Sanaad SQL Server DB (auth cycle: device/MPIN/OTP + API-1 tables)
  USERS_DB_HOST: Joi.string().allow('').default(''),
  USERS_DB_PORT: Joi.number().default(1433),
  USERS_DB_NAME: Joi.string().allow('').default(''),
  USERS_DB_USER: Joi.string().allow('').default(''),
  USERS_DB_PASSWORD: Joi.string().allow('').default(''),
  USERS_DB_POOL_MIN: Joi.number().default(2),
  USERS_DB_POOL_MAX: Joi.number().default(10),
  USERS_DB_REQUEST_TIMEOUT_MS: Joi.number().min(1).default(25000),
  USERS_DB_CONNECT_TIMEOUT_MS: Joi.number().min(1).default(15000),
  USERS_DB_ENCRYPT: Joi.boolean().default(true),
  USERS_DB_TRUST_SERVER_CERT: Joi.boolean().default(false),
  USERS_DB_DISABLED: Joi.boolean().default(false),

  // MOTC SMS gateway DB (OTP store + delivery via MOTC_SMS_PushTable)
  MOTC_SMS_DB_HOST: Joi.string().allow('').default(''),
  MOTC_SMS_DB_PORT: Joi.number().default(9001),
  MOTC_SMS_DB_NAME: Joi.string().default('MOTC_SMS'),
  MOTC_SMS_DB_USER: Joi.string().allow('').default(''),
  MOTC_SMS_DB_PASSWORD: Joi.string().allow('').default(''),
  MOTC_SMS_DB_POOL_MIN: Joi.number().default(2),
  MOTC_SMS_DB_POOL_MAX: Joi.number().default(10),
  MOTC_SMS_DB_REQUEST_TIMEOUT_MS: Joi.number().min(1).default(25000),
  MOTC_SMS_DB_CONNECT_TIMEOUT_MS: Joi.number().min(1).default(15000),
  MOTC_SMS_DB_ENCRYPT: Joi.boolean().default(true),
  MOTC_SMS_DB_TRUST_SERVER_CERT: Joi.boolean().default(false),
  MOTC_SMS_DB_DISABLED: Joi.boolean().default(false),
  MOTC_SMS_SQL_ENABLED: Joi.boolean().default(true),
  MOTC_SMS_TABLE: Joi.string().default('MOTC_SMS_PushTable'),
  MOTC_SMS_EMPLOYEE_MASTER_VIEW: Joi.string().default('HMC_SND_LIV_EMP_MASTER_VW'),
  MOTC_SMS_APP_ID: Joi.string().allow('').default(''),
  MOTC_SMS_FROM_ADDRESS: Joi.string().allow('').default(''),
  MOTC_SMS_SUBJECT_ID: Joi.string().allow('').default(''),
  MOTC_SMS_PRIORITY: Joi.string().default('1'),
  MOTC_SMS_LANGUAGE_ID: Joi.string().default('1'),
  MOTC_SMS_RECIPIENT_ADDRESS_TYPE: Joi.string().default('1'),
  MOTC_SMS_PROCESSED_STATE: Joi.string().default('0'),
  MOTC_SMS_MESSAGE_EXPIRE_MINUTES: Joi.string().default('5'),
  MOTC_SMS_CUSTOMER_ID: Joi.string().allow('').default(''),
  MOTC_SMS_MASK_MESSAGE_LOG: Joi.string().default('1'),
  MOTC_SMS_BUSINESS_PARAM1: Joi.string().allow('').default(''),
  MOTC_SMS_BUSINESS_PARAM2: Joi.string().allow('').default(''),
  MOTC_SMS_EMAIL_PROCESSED_STATE: Joi.string().default('1'),

  // SMS gateway (OTP delivery)
  SMS_API_BASE_URL: Joi.string().uri().allow('').default(''),
  SMS_API_KEY: Joi.string().allow('').default(''),
  SMS_SENDER_ID: Joi.string().allow('').default(''),
  SMS_API_TIMEOUT_MS: Joi.number().min(1).default(25000),
  SMS_MESSAGE_TEMPLATE: Joi.string().default(
    'OTP to register for Sanaad App is {otp}\n\nرمز التحقق للتسجيل في تطبيق سند هو {otp}',
  ),

  // SMTP email (OTP fallback for users with no mobile + diagnostics test email)
  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASSWORD: Joi.string().allow('').default(''),
  SMTP_TLS_REJECT_UNAUTHORIZED: Joi.boolean().default(true),
  SMTP_TIMEOUT_MS: Joi.number().min(1).default(25000),
  EMAIL_FROM: Joi.string().allow('').default(''),
  EMAIL_OTP_SUBJECT: Joi.string().default('Sanaad verification code'),
  EMAIL_MESSAGE_TEMPLATE: Joi.string().default('OTP to register in Sanaad App is {otp}'),
  EMAIL_MESSAGE_TEMPLATE_AR: Joi.string().default('رمز التحقق لتسجيل الدخول في تطبيق سند هو {otp}'),

  // Auth
  JWT_SECRET: Joi.string().min(8).default('dev-only-secret-change-me'),
  JWT_ISSUER: Joi.string().default('sanaad'),
  JWT_AUDIENCE: Joi.string().default('sanaad-b2e'),
  JWT_EXPIRES_IN: Joi.string().default('1h'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  AUTH_DISABLED: Joi.boolean().default(false),
  // TESTING ONLY: static /auth/login payload with full user data embedded in
  // the JWT (`userdata` claim). Never enable in production.
  AUTH_STATIC_LOGIN: Joi.boolean().default(false),

  // Cerner
  CERNER_BASE_URL: Joi.string().uri().allow('').default(''),
  CERNER_TIMEOUT_MS: Joi.number().default(10000),

  // Auth framework — app-launch (API-1)
  APP_NAME: Joi.string().default('SanaadHealth'),
  APP_MIN_SUPPORTED_VERSION: Joi.string().default('1.0.0'),
  APP_LATEST_VERSION: Joi.string().default('1.0.0'),
  APP_DOWNTIME: Joi.boolean().default(false),
  APP_DOWNTIME_START: Joi.string().allow('').default(''),
  APP_DOWNTIME_END: Joi.string().allow('').default(''),

  // Auth framework — MPIN policy
  MPIN_MIN_LENGTH: Joi.number().default(4),
  MPIN_MAX_LENGTH: Joi.number().default(6),
  MPIN_MAX_ATTEMPTS: Joi.number().default(5),
  MPIN_LOCKOUT_MINUTES: Joi.number().default(15),

  // Auth framework — OTP policy
  OTP_LENGTH: Joi.number().default(6),
  OTP_TTL_SECONDS: Joi.number().default(300),
  OTP_MAX_ATTEMPTS: Joi.number().default(5),
  OTP_RESEND_WINDOW_SECONDS: Joi.number().default(60),
  // OTP store/validation: legacy Users-DB table (default) or the MOTC push table.
  OTP_STORE: Joi.string().valid('motc', 'legacy').default('legacy'),
  // Delivery when OTP_STORE=legacy: MOTC push table (default) or the HTTP SMS adapter.
  OTP_DELIVERY: Joi.string().valid('motc', 'http').default('motc'),
  // TESTING: non-empty pins every OTP to this value (e.g. 123456). Empty = random.
  OTP_STATIC_VALUE: Joi.string().allow('').default(''),
  // OTP alphabet: digits only (default) or unambiguous uppercase letters + digits.
  OTP_CHARSET: Joi.string().valid('numeric', 'alphanumeric').default('numeric'),

  // Auth framework — LDAP directory (corporate Active Directory)
  LDAP_ENABLED: Joi.boolean().default(false),
  LDAP_HOST: Joi.string().allow('').default('HMC.ORG.QA'),
  LDAP_PORT: Joi.number().default(636),
  LDAP_USE_SSL: Joi.boolean().default(true),
  LDAP_URL: Joi.string().allow('').default(''),
  LDAP_UPN_DOMAIN: Joi.string().allow('').default(''),
  LDAP_BASE_DN: Joi.string().allow('').default('DC=hmc,DC=org,DC=qa'),
  LDAP_SEARCH_FILTER: Joi.string().allow('').default('(sAMAccountName={username})'),
  LDAP_USERNAME_ATTRIBUTE: Joi.string().allow('').default('sAMAccountName'),
  LDAP_BIND_DN: Joi.string().allow('').default(''),
  LDAP_BIND_PASSWORD: Joi.string().allow('').default(''),
  LDAP_TLS_REJECT_UNAUTHORIZED: Joi.boolean().default(false),
  // CA cert to trust for LDAPS: inline PEM (LDAP_CA_CERT) or a file path
  // (LDAP_CA_CERT_PATH) — inline wins if both are set.
  LDAP_CA_CERT: Joi.string().allow('').default(''),
  LDAP_CA_CERT_PATH: Joi.string().allow('').default(''),
  LDAP_TIMEOUT_MS: Joi.number().default(10000),

  // Auth framework — identity provider selector + Azure Entra ID (Graph).
  // `usersdb` = legacy Users SQL Server only (no corporate directory).
  AUTH_DIRECTORY: Joi.string().valid('ldap', 'entra', 'usersdb').default('ldap'),
  // Login functionaccesslist source (documented AppMaster query).
  FUNCTION_ACCESS_VIEW: Joi.string().default('HMC_Sanad_AppMaster_VW'),
  FUNCTION_ACCESS_APP_ID: Joi.number().default(1),
  ENTRA_TENANT_ID: Joi.string().allow('').default(''),
  ENTRA_CLIENT_ID: Joi.string().allow('').default(''),
  ENTRA_CLIENT_SECRET: Joi.string().allow('').default(''),
  ENTRA_GRAPH_BASE_URL: Joi.string().uri().default('https://graph.microsoft.com/v1.0'),
  ENTRA_LOGIN_BASE_URL: Joi.string().uri().default('https://login.microsoftonline.com'),
  ENTRA_LOOKUP_ATTRIBUTE: Joi.string().default('userPrincipalName'),
  ENTRA_TIMEOUT_MS: Joi.number().default(10000),

  // Master switch for /diagnostics/*, /api-logs/* and the /health/db,
  // /health/users-db, /health/motc-sms-db connection tests (404 when false).
  DIAGNOSTICS_ENABLED: Joi.boolean().default(true),

  // Internal dev console (SQL worksheet + API tester) — hidden from Swagger.
  // Works with no configuration: ON by default and READ-ONLY until the UI
  // switch is flipped. Set DEV_CONSOLE_ENABLED=false to remove the routes.
  DEV_CONSOLE_ENABLED: Joi.boolean().default(true),
  DEV_CONSOLE_TOKEN: Joi.string().allow('').default(''),
  DEV_CONSOLE_ALLOW_WRITE: Joi.boolean().default(false),
  DEV_CONSOLE_MAX_ROWS: Joi.number().min(1).max(10000).default(500),
  DEV_CONSOLE_TIMEOUT_MS: Joi.number().min(1000).default(60000),

  // Misc
  REQUEST_TIMEOUT_MS: Joi.number().default(30000),
  LOV_CACHE_TTL_MS: Joi.number().min(0).default(300000),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'log', 'debug', 'verbose')
    .default('debug'),
});
