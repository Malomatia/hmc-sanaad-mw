import * as fs from 'fs';

/**
 * Typed configuration factory consumed via `ConfigService`.
 * Grouped into namespaces (app, oracle, auth, cerner).
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  corsOrigins: string[];
  gatewayBaseUrl: string;
  requestTimeoutMs: number;
  /**
   * Per-sub-read deadline (ms) for endpoints that fan out several Oracle reads
   * in parallel (e.g. leave defaults). Kept well under `requestTimeoutMs` so one
   * slow view degrades to a partial result instead of a whole-request timeout.
   */
  aggregateReadTimeoutMs: number;
  lovCacheTtlMs: number;
  logLevel: string;
  /**
   * Identity provider for the auth journey: LDAPS, Entra ID (Graph), or the
   * legacy Users DB itself (`usersdb` â€” HMC_Sanad_DeviceRegn_tbl, no directory).
   */
  directory: 'ldap' | 'entra' | 'usersdb';
}

export interface OracleConfig {
  user: string;
  password: string;
  dsn: string;
  poolMin: number;
  poolMax: number;
  poolTimeout: number;
  queueTimeout: number;
  callTimeout: number;
  disabled: boolean;
  /**
   * Enables POST /diagnostics/oracle/sql (ad-hoc SELECT-only console over the
   * XXHMC_SND_* schema). Ignored in production â€” always 403 there.
   */
  sqlConsoleEnabled: boolean;
  /** Use node-oracledb Thick mode (requires Oracle Client libraries at runtime). */
  thickMode: boolean;
  /** Optional path to the Oracle Client / Instant Client libraries for Thick mode. */
  libDir?: string;
}

/**
 * Internal developer console (SQL worksheet + API tester). NOT part of the
 * public API: hidden from Swagger (`@ApiExcludeController`).
 *
 * Works with ZERO configuration: every setting below has a working default, so
 * the console is available on any deployment as soon as the build ships. It
 * starts READ-ONLY (SELECT/WITH/EXPLAIN, rolled back); write/PLSQL mode is a
 * deliberate switch in the UI itself (per process, reset on restart) rather
 * than an env variable. All env vars are optional hardening:
 *   DEV_CONSOLE_ENABLED=false â†’ kill switch
 *   DEV_CONSOLE_TOKEN=<secret> â†’ require `x-console-token` / `?token=`
 *   DEV_CONSOLE_ALLOW_WRITE=true â†’ start already in write mode
 */
export interface DevConsoleConfig {
  /** Master switch (DEV_CONSOLE_ENABLED). Defaults to ON â€” set `false` to remove the routes. */
  enabled: boolean;
  /** Shared secret required in the `x-console-token` header / `?token=`. Empty = no token check. */
  token: string;
  /** Initial write mode. Off = SELECT/WITH/EXPLAIN only; the UI can switch it at runtime. */
  allowWrite: boolean;
  /** Hard cap on rows returned by one statement. */
  maxRows: number;
  /** Per-statement Oracle call timeout (ms). */
  timeoutMs: number;
}

/**
 * Master switch for the observability/test surface: the diagnostics APIs
 * (`/diagnostics/*` â€” Oracle logs, oracle-object, the users-db and motc-sms-db
 * SQL consoles), the API request/response log (`/api-logs/*`), and the DB
 * connection-test endpoints (`/health/db`, `/health/users-db`,
 * `/health/motc-sms-db`). The plain `/health` liveness endpoint is NOT gated
 * (the gateway's dependency check relies on it). Disabled routes return 404,
 * so probing cannot tell the features exist. Finer-grained flags
 * (USERS_DB_SQL_ENABLED, MOTC_SMS_SQL_ENABLED, DEV_CONSOLE_ENABLED) still
 * apply on top when this is on.
 */
export interface DiagnosticsConfig {
  /** DIAGNOSTICS_ENABLED â€” defaults to true; set false to remove the routes. */
  enabled: boolean;
}

export interface AuthConfig {
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  jwtExpiresIn: string;
  /** Refresh-token lifetime (JWT_REFRESH_EXPIRES_IN, default 7d). */
  jwtRefreshExpiresIn: string;
  disabled: boolean;
  /**
   * TESTING ONLY (AUTH_STATIC_LOGIN): /auth/login skips MPIN/directory/DB and
   * returns a fixed AIBRAHIM39 payload whose FULL user data (employee fields +
   * functionaccesslist) is also embedded in the signed JWT (`userdata` claim).
   * Off by default; never enable in production.
   */
  staticLogin: boolean;
  /**
   * Users-DB view/table holding the login `functionaccesslist` (module name/
   * code/status per function). The documented legacy query is
   * `SELECT FunctionName, FunctionCode, Description, StatusCode FROM
   *  HMC_Sanad_AppMaster_VW WHERE AppID = 1`; columns are resolved tolerantly
   * when that projection fails.
   */
  functionAccessView: string;
  /** AppID filter of the documented AppMaster query (Sanaad = 1). */
  functionAccessAppId: number;
}

export interface CernerConfig {
  baseUrl: string;
  timeoutMs: number;
}

/** App-launch health check (API-1): downtime window + forced/optional update. */
export interface AppLaunchConfig {
  minSupportedVersion: string;
  latestVersion: string;
  downtime: boolean;
  downtimeStart: string;
  downtimeEnd: string;
  /** App name matched against HMC_Sanad_AppMaster_Tbl.AppName (DB-backed API-1). */
  appName: string;
}

/**
 * Users/Sanaad SQL Server database â€” backs the auth cycle (device registration,
 * MPIN, OTP rows) and the API-1 downtime/app-update tables. Legacy tables:
 * HMC_Sanad_DeviceRegn_tbl, HMC_RHAP_OTP_tbl, HMC_Sanad_AppDownTime_tbl, ...
 */
export interface UsersDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  poolMin: number;
  poolMax: number;
  /** Per-request timeout (ms) â€” mirrors ORACLE_CALL_TIMEOUT_MS convention. */
  requestTimeoutMs: number;
  connectTimeoutMs: number;
  /** TLS to the SQL Server (true unless the instance has no cert). */
  encrypt: boolean;
  /** Accept the server cert without CA validation (self-signed instances). */
  trustServerCertificate: boolean;
  /**
   * IGNORED since 2026-08-31 (client request): the Users DB pool is always
   * created directly â€” eagerly at boot, retried lazily on first use. Kept only
   * so existing .env/compose files with USERS_DB_DISABLED don't break parsing.
   */
  disabled: boolean;
  /**
   * Enables POST /diagnostics/users-db/sql (ad-hoc SELECT console). Ignored in
   * production â€” the endpoint is always 403 there regardless of this flag.
   */
  sqlConsoleEnabled: boolean;
}

/**
 * SMS gateway used for OTP delivery. Generic config-driven HTTP adapter until
 * the corporate gateway contract is finalized; unset base URL = log-only in
 * non-production, hard failure in production.
 */
export interface SmsConfig {
  baseUrl: string;
  apiKey: string;
  senderId: string;
  timeoutMs: number;
  /** Message body; `{otp}` is substituted with the raw OTP at send time. */
  messageTemplate: string;
}

/**
 * MOTC SMS gateway database (client request 2026-08-25): the OTP is generated
 * by us, INSERTed into `MOTC_SMS_PushTable` (the government SMS push outbox â€”
 * the insert IS the SMS delivery) and validated back against the same table.
 * A second SQL Server pool next to the Users DB (named instance, static port).
 */
export interface MotcSmsConfig {
  /** Server host, optionally with a named instance (e.g. HSHCL7VVSQ1\SQL1). */
  host: string;
  /** Static port of the instance (9001 per the client). 0 = resolve via the instance name. */
  port: number;
  database: string;
  user: string;
  password: string;
  poolMin: number;
  poolMax: number;
  requestTimeoutMs: number;
  connectTimeoutMs: number;
  encrypt: boolean;
  trustServerCertificate: boolean;
  disabled: boolean;
  /**
   * POST /diagnostics/motc-sms-db/sql (ad-hoc SELECT console). TEMPORARILY
   * ignored (client request 2026-09-03): the console is ungated like the
   * Oracle one â€” restore the flag + production checks before hardening.
   */
  sqlConsoleEnabled: boolean;
  /** Push/outbox table name (interpolated as an identifier â€” validated). */
  table: string;
  /**
   * Live-employee master view (HMC_SND_LIV_EMP_MASTER_VW) used by the
   * AUTH_DIRECTORY=usersdb identity adapter: /auth/initiate resolves the
   * username against it (UserName column) and a user absent from the view is
   * refused. Interpolated as an identifier (validated).
   */
  employeeMasterView: string;
  /**
   * <AppId> of the client's INSERT â€” written to ServiceID, ApplicationID and
   * (unless fromAddress overrides it) FromAddress.
   */
  appId: string;
  /** FromAddress column; empty = use appId (mirrors the client's INSERT). */
  fromAddress: string;
  /** <Subject> â†’ SubjectID column. */
  subjectId: string;
  priority: string;
  languageId: string;
  recipientAddressType: string;
  /** ProcessedState of a freshly queued message (0 = pending push). */
  processedState: string;
  messageExpireMinutes: string;
  /** CustomerID column; empty = NULL. */
  customerId: string;
  maskMessageLog: string;
  /**
   * BusinessParam1/2 column values. Leave BOTH empty (recommended) and the
   * adapter uses them to correlate OTP rows to username (1) + device IMEI (2),
   * which is what makes DB-side validation per-user possible. Setting static
   * values disables that correlation (verification then keys on MessageID only).
   */
  businessParam1: string;
  businessParam2: string;
  /**
   * ProcessedState written for EMAIL-delivered OTP rows: the row is stored for
   * validation exactly like an SMS OTP, but with a state the SMS gateway does
   * NOT push (we deliver by SMTP ourselves). Default '1' (= already
   * processed); confirm the gateway's skip value with the MOTC team.
   */
  emailProcessedState: string;
}

/**
 * SMTP email delivery: the OTP fallback channel for users with no mobile
 * number in the directory, and the diagnostics test email. Unset SMTP_HOST =
 * masked log-only in non-production, hard failure in production (same
 * contract as the SMS adapter).
 */
export interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  /** Implicit TLS (SMTPS, usually port 465); false = STARTTLS when offered. */
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  /** Accept self-signed server certs (internal relays) when false. */
  tlsRejectUnauthorized: boolean;
  /** From header, e.g. "Sanaad <no-reply@hamad.qa>". */
  from: string;
  /** Subject line of the OTP email. */
  otpSubject: string;
  /** OTP email body; `{otp}` is substituted with the raw OTP at send time. */
  messageTemplate: string;
  messageTemplateAr: string;
  /** SMTP connection/greeting/socket timeout (ms). */
  timeoutMs: number;
}

export interface MpinConfig {
  minLength: number;
  maxLength: number;
  maxAttempts: number;
  lockoutMinutes: number;
}

export interface OtpConfig {
  length: number;
  ttlSeconds: number;
  maxAttempts: number;
  resendWindowSeconds: number;
  /**
   * TESTING AID (client request 2026-09-03): when non-empty, every generated
   * OTP is this fixed value (e.g. 123456) instead of a random one, so the
   * journey can be exercised without reading the SMS. Empty = random.
   */
  staticValue: string;
  /**
   * Alphabet of a generated OTP: `numeric` (default, digits only) or
   * `alphanumeric` (uppercase letters + digits, ambiguous I/O/0/1 excluded
   * for SMS readability).
   */
  charset: 'numeric' | 'alphanumeric';
  /**
   * How the OTP SMS is delivered when the store is `legacy`: `motc` (default)
   * INSERTs into MOTC_SMS_PushTable (the gateway fires the SMS); `http` uses
   * the generic HTTP adapter (SMS_API_* config).
   */
  delivery: 'motc' | 'http';
  /**
   * Where OTPs are stored and validated: `legacy` (default since 2026-09-03)
   * = HMC_RHAP_OTP_tbl in the Users DB (MssqlOtpRepository), delivery via
   * OTP_DELIVERY; `motc` = the MOTC_SMS push table doubles as store AND
   * delivery (MotcSmsOtpRepository).
   */
  store: 'motc' | 'legacy';
}

export interface LdapConfig {
  enabled: boolean;
  /** Directory host, e.g. HMC.ORG.QA. */
  host: string;
  /** Directory port (636 = LDAPS, 389 = plain LDAP). */
  port: number;
  /** Use LDAPS (SSL) â€” true for port 636. */
  useSsl: boolean;
  /** Connection URL; derived from host/port/useSsl when LDAP_URL is unset. */
  url: string;
  /**
   * UPN domain suffix for direct binds (`username@upnDomain`), e.g. HMC.ORG.QA.
   * Defaults to `host`. Used by `authenticate()`, which binds directly as the
   * user â€” no service-account search needed.
   */
  upnDomain: string;
  /** Search base, e.g. DC=hmc,DC=org,DC=qa. Used by `validate()` only. */
  baseDn: string;
  /** User search filter; `{username}` is substituted at runtime. Used by `validate()` only. */
  searchFilter: string;
  /** Attribute holding the login name (e.g. sAMAccountName). Used by `validate()` only. */
  usernameAttribute: string;
  /** Service account DN used to bind before searching. Used by `validate()` only. */
  bindDn: string;
  /** Service account password. Used by `validate()` only. */
  bindPassword: string;
  /** Reject invalid/self-signed TLS certs (set true in production). */
  tlsRejectUnauthorized: boolean;
  /**
   * CA certificate(s) (PEM) to trust for LDAPS, read once at boot from
   * LDAP_CA_CERT (inline PEM) or LDAP_CA_CERT_PATH (file path) â€” inline wins
   * if both are set. Required to set `tlsRejectUnauthorized: true` against an
   * internal/self-signed AD CA; leave unset only for a quick connectivity
   * test (with tlsRejectUnauthorized=false).
   */
  caCert?: Buffer;
  /** Bind/search timeout in milliseconds. */
  timeoutMs: number;
}

/**
 * Azure Entra ID (Microsoft Graph) directory lookup â€” the cloud replacement for
 * the LDAPS `validate()` path. App-only (client-credentials) auth; used only to
 * resolve employee identity + phone (the mobile journey stays OTP + MPIN).
 */
export interface EntraConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Graph API base, e.g. https://graph.microsoft.com/v1.0. */
  graphBaseUrl: string;
  /** AAD login base for the token endpoint, e.g. https://login.microsoftonline.com. */
  loginBaseUrl: string;
  /** User property the mobile `username` maps to (default userPrincipalName). */
  lookupAttribute: string;
  /** Token + Graph request timeout in milliseconds. */
  timeoutMs: number;
}

/**
 * Firebase Admin â€” push notifications (FCM), and later App Check verification.
 * Both are served by the same service-account credential.
 *
 * The credential is a PRIVATE KEY and never lives in the repository. It is read
 * once at boot from FIREBASE_SERVICE_ACCOUNT (the JSON itself, raw or base64 â€”
 * convenient for containers) or FIREBASE_SERVICE_ACCOUNT_PATH (a file on the
 * host), inline winning if both are set. Same shape as LDAP_CA_CERT above, so
 * there is no second convention to learn.
 *
 * Unset means push is DISABLED, not broken: the module binds a no-op sender and
 * the API keeps working. A half-configured deployment must not take the
 * notifications endpoints â€” or anything that emits one â€” down with it.
 */
export interface FirebaseConfig {
  /** Parsed service account, or undefined when push is not configured. */
  serviceAccount?: FirebaseServiceAccount;
  /** `sanaadprd` â€” read from the credential; exposed for logging/diagnostics. */
  projectId?: string;
  /** Whether a usable credential was resolved at boot. */
  enabled: boolean;
  /**
   * Whether a value was SUPPLIED at all, regardless of whether it parsed.
   * With only `enabled`, "DevOps never set it" and "they set it but it
   * arrived truncated" are the same answer — and the fixes are opposite.
   */
  credentialProvided: boolean;
  /** Length of the inline value, so a truncated paste is visible at a glance. */
  credentialLength: number;
}

/**
 * How strictly device attestation is applied.
 *
 * `enforce` can lock real users out â€” Play Integrity refuses a device without
 * Play Services, a rooted phone and a sideloaded build, and App Attest refuses
 * a simulator â€” so the rollout is deliberately staged and the default is
 * `off`. Run `observe` first and read the logs: it reports what WOULD have
 * been rejected while letting every request through.
 */
export type IntegrityMode = 'off' | 'observe' | 'enforce';

/** The fields of a Google service account this project uses. */
export interface FirebaseServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/**
 * Device attestation â€” Apple App Attest and Google Play Integrity, verified
 * directly rather than through Firebase App Check.
 *
 * Same staged rollout as everything else that can refuse a request: `off` by
 * default, `observe` to measure, `enforce` to act. Each platform is judged
 * independently, so iOS can enforce while Android is still only observed.
 */
export interface AppIntegrityConfig {
  mode: IntegrityMode;
  ios: {
    /** Apple Developer Team ID; the app id verified is `<teamId>.<bundleId>`. */
    teamId: string;
    bundleId: string;
    /**
     * Accept attestations produced by the App Attest DEVELOPMENT environment.
     * Xcode debug builds emit those, and a production server must reject them.
     */
    allowDevelopment: boolean;
    /** Configured enough to verify anything. */
    enabled: boolean;
  };
  android: {
    packageName: string;
    /**
     * Service account with the `playintegrity` scope. NOT the Firebase key â€”
     * decoding an integrity token is a separate Google API with its own
     * authorization.
     */
    serviceAccount?: FirebaseServiceAccount;
    enabled: boolean;
  };
  /** How long a challenge stays usable, in milliseconds. */
  challengeTtlMs: number;
}

export interface RootConfig {
  app: AppConfig;
  oracle: OracleConfig;
  devConsole: DevConsoleConfig;
  diagnostics: DiagnosticsConfig;
  usersDb: UsersDbConfig;
  motcSms: MotcSmsConfig;
  sms: SmsConfig;
  email: EmailConfig;
  auth: AuthConfig;
  cerner: CernerConfig;
  appLaunch: AppLaunchConfig;
  mpin: MpinConfig;
  otp: OtpConfig;
  ldap: LdapConfig;
  entra: EntraConfig;
  firebase: FirebaseConfig;
  appIntegrity: AppIntegrityConfig;
}

const toBool = (v: unknown): boolean => v === true || v === 'true';

/**
 * Bundle identifier / package name of the Sanaad app — the same string on both
 * platforms. Kept as a constant so the app's default cannot drift from the one
 * `docker-compose.yml` supplies; two disagreeing defaults would mean
 * attestation quietly works under compose and quietly does not elsewhere.
 */
const SANAAD_APP_ID = 'com.hmc.sanaad';

/**
 * Resolve the Firebase service account: inline JSON (FIREBASE_SERVICE_ACCOUNT,
 * raw or base64 so it survives being a single-line env var) wins over a file
 * path (FIREBASE_SERVICE_ACCOUNT_PATH).
 *
 * Never throws and never logs the credential: this runs before the Nest Logger
 * exists, and an unreadable or malformed key means push is off, not that the
 * API fails to boot.
 */
function loadFirebaseServiceAccount(): FirebaseServiceAccount | undefined {
  return loadServiceAccount(
    process.env.FIREBASE_SERVICE_ACCOUNT,
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    'FIREBASE_SERVICE_ACCOUNT',
  );
}

/** Shared by the Firebase and Play Integrity credentials â€” same file shape. */
function loadServiceAccount(
  inline: string | undefined,
  path: string | undefined,
  label: string,
): FirebaseServiceAccount | undefined {
  let raw: string | undefined;
  if (inline) {
    // A base64 blob has no braces; raw JSON does.
    raw = inline.trim().startsWith('{')
      ? inline
      : Buffer.from(inline, 'base64').toString('utf8');
  } else if (path) {
    try {
      raw = fs.readFileSync(path, 'utf8');
    } catch (err) {
      console.warn(
        `[configuration] Could not read ${label}_PATH="${path}": ${(err as Error).message}`,
      );
      return undefined;
    }
  }
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as Partial<FirebaseServiceAccount>;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      console.warn(`[configuration] ${label} is missing required fields.`);
      return undefined;
    }
    // `\n` survives an env var only escaped; the SDK needs real newlines.
    return { ...parsed, private_key: parsed.private_key.replace(/\\n/g, '\n') } as FirebaseServiceAccount;
  } catch {
    console.warn(`[configuration] ${label} is not valid JSON.`);
    return undefined;
  }
}

/**
 * Resolve the LDAPS CA certificate: an inline PEM (LDAP_CA_CERT, `\n`
 * unescaped so it can be set as a single-line env var) wins over a file path
 * (LDAP_CA_CERT_PATH). Runs once at config-load time (before the Nest Logger
 * exists), so a missing/unreadable file is only ever `console.warn`'d â€”
 * never throws, since LDAP may be disabled or mid-provisioning.
 */
function loadLdapCaCert(): Buffer | undefined {
  const inline = process.env.LDAP_CA_CERT;
  if (inline) return Buffer.from(inline.replace(/\\n/g, '\n'), 'utf8');
  const path = process.env.LDAP_CA_CERT_PATH;
  if (!path) return undefined;
  try {
    return fs.readFileSync(path);
  } catch (err) {
    console.warn(
      `[configuration] Could not read LDAP_CA_CERT_PATH="${path}": ${(err as Error).message}`,
    );
    return undefined;
  }
}

export default (): RootConfig => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
    corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),
    gatewayBaseUrl:
      process.env.SANAAD_GATEWAY_BASE_URL ?? 'https://apigwuat.api.hamad.qa/sanaad',
    requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 30000),
    // Set directly for now (not env-driven). Kept under `requestTimeoutMs`.
    aggregateReadTimeoutMs: 20000,
    lovCacheTtlMs: Number(process.env.LOV_CACHE_TTL_MS ?? 300000),
    logLevel: process.env.LOG_LEVEL ?? 'debug',
    directory:
      process.env.AUTH_DIRECTORY === 'entra'
        ? 'entra'
        : process.env.AUTH_DIRECTORY === 'usersdb'
          ? 'usersdb'
          : 'ldap',
  },
  oracle: {
    user: process.env.ORACLE_USER ?? '',
    password: process.env.ORACLE_PASSWORD ?? '',
    dsn: process.env.ORACLE_DSN ?? '',
    poolMin: Number(process.env.ORACLE_POOL_MIN ?? 2),
    poolMax: Number(process.env.ORACLE_POOL_MAX ?? 10),
    poolTimeout: Number(process.env.ORACLE_POOL_TIMEOUT ?? 60),
    queueTimeout: Number(process.env.ORACLE_QUEUE_TIMEOUT_MS ?? 25000),
    callTimeout: Number(process.env.ORACLE_CALL_TIMEOUT_MS ?? 25000),
    disabled: toBool(process.env.ORACLE_DISABLED),
    // Default ON (client request): production is still a hard 403 regardless.
    sqlConsoleEnabled: toBool(process.env.ORACLE_SQL_ENABLED ?? 'true'),
    thickMode: toBool(process.env.ORACLE_THICK_MODE ?? 'true'),
    libDir: process.env.ORACLE_CLIENT_LIB_DIR || undefined,
  },
  devConsole: {
    // Default ON so the console needs no environment setup anywhere.
    enabled: toBool(process.env.DEV_CONSOLE_ENABLED ?? 'true'),
    token: process.env.DEV_CONSOLE_TOKEN ?? '',
    allowWrite: toBool(process.env.DEV_CONSOLE_ALLOW_WRITE),
    maxRows: Number(process.env.DEV_CONSOLE_MAX_ROWS ?? 500),
    timeoutMs: Number(process.env.DEV_CONSOLE_TIMEOUT_MS ?? 60000),
  },
  diagnostics: {
    // Default ON (matches current behavior); set false to hide the whole
    // diagnostics/logs/db-test surface.
    enabled: toBool(process.env.DIAGNOSTICS_ENABLED ?? 'true'),
  },
  usersDb: {
    host: process.env.USERS_DB_HOST ?? '',
    port: Number(process.env.USERS_DB_PORT ?? 1433),
    database: process.env.USERS_DB_NAME ?? '',
    user: process.env.USERS_DB_USER ?? '',
    password: process.env.USERS_DB_PASSWORD ?? '',
    poolMin: Number(process.env.USERS_DB_POOL_MIN ?? 2),
    poolMax: Number(process.env.USERS_DB_POOL_MAX ?? 10),
    requestTimeoutMs: Number(process.env.USERS_DB_REQUEST_TIMEOUT_MS ?? 25000),
    connectTimeoutMs: Number(process.env.USERS_DB_CONNECT_TIMEOUT_MS ?? 15000),
    encrypt: toBool(process.env.USERS_DB_ENCRYPT ?? 'true'),
    trustServerCertificate: toBool(process.env.USERS_DB_TRUST_SERVER_CERT ?? 'false'),
    disabled: toBool(process.env.USERS_DB_DISABLED),
    sqlConsoleEnabled: toBool(process.env.USERS_DB_SQL_ENABLED),
  },
  motcSms: {
    host: process.env.MOTC_SMS_DB_HOST ?? '',
    port: Number(process.env.MOTC_SMS_DB_PORT ?? 9001),
    database: process.env.MOTC_SMS_DB_NAME ?? 'MOTC_SMS',
    user: process.env.MOTC_SMS_DB_USER ?? '',
    password: process.env.MOTC_SMS_DB_PASSWORD ?? '',
    poolMin: Number(process.env.MOTC_SMS_DB_POOL_MIN ?? 2),
    poolMax: Number(process.env.MOTC_SMS_DB_POOL_MAX ?? 10),
    requestTimeoutMs: Number(process.env.MOTC_SMS_DB_REQUEST_TIMEOUT_MS ?? 25000),
    connectTimeoutMs: Number(process.env.MOTC_SMS_DB_CONNECT_TIMEOUT_MS ?? 15000),
    encrypt: toBool(process.env.MOTC_SMS_DB_ENCRYPT ?? 'true'),
    trustServerCertificate: toBool(process.env.MOTC_SMS_DB_TRUST_SERVER_CERT ?? 'false'),
    disabled: toBool(process.env.MOTC_SMS_DB_DISABLED),
    sqlConsoleEnabled: toBool(process.env.MOTC_SMS_SQL_ENABLED),
    table: process.env.MOTC_SMS_TABLE ?? 'MOTC_SMS_PushTable',
    employeeMasterView: process.env.MOTC_SMS_EMPLOYEE_MASTER_VIEW ?? 'HMC_SND_LIV_EMP_MASTER_VW',
    appId: process.env.MOTC_SMS_APP_ID ?? '',
    fromAddress: process.env.MOTC_SMS_FROM_ADDRESS ?? '',
    subjectId: process.env.MOTC_SMS_SUBJECT_ID ?? '',
    priority: process.env.MOTC_SMS_PRIORITY ?? '1',
    languageId: process.env.MOTC_SMS_LANGUAGE_ID ?? '1',
    recipientAddressType: process.env.MOTC_SMS_RECIPIENT_ADDRESS_TYPE ?? '1',
    processedState: process.env.MOTC_SMS_PROCESSED_STATE ?? '0',
    messageExpireMinutes: process.env.MOTC_SMS_MESSAGE_EXPIRE_MINUTES ?? '5',
    customerId: process.env.MOTC_SMS_CUSTOMER_ID ?? '',
    maskMessageLog: process.env.MOTC_SMS_MASK_MESSAGE_LOG ?? '1',
    businessParam1: process.env.MOTC_SMS_BUSINESS_PARAM1 ?? '',
    businessParam2: process.env.MOTC_SMS_BUSINESS_PARAM2 ?? '',
    emailProcessedState: process.env.MOTC_SMS_EMAIL_PROCESSED_STATE ?? '1',
  },
  sms: {
    baseUrl: process.env.SMS_API_BASE_URL ?? '',
    apiKey: process.env.SMS_API_KEY ?? '',
    senderId: process.env.SMS_SENDER_ID ?? '',
    timeoutMs: Number(process.env.SMS_API_TIMEOUT_MS ?? 25000),
    messageTemplate: process.env.SMS_MESSAGE_TEMPLATE ?? 'Your Sanaad verification code is {otp}',
  },
  email: {
    smtpHost: process.env.SMTP_HOST ?? '',
    smtpPort: Number(process.env.SMTP_PORT ?? 587),
    smtpSecure: toBool(process.env.SMTP_SECURE),
    smtpUser: process.env.SMTP_USER ?? '',
    smtpPassword: process.env.SMTP_PASSWORD ?? '',
    tlsRejectUnauthorized: toBool(process.env.SMTP_TLS_REJECT_UNAUTHORIZED ?? 'true'),
    from: process.env.EMAIL_FROM ?? '',
    otpSubject: process.env.EMAIL_OTP_SUBJECT ?? 'Sanaad verification code',
    messageTemplate: process.env.EMAIL_MESSAGE_TEMPLATE ?? 'OTP to register in Sanaad App is {otp}',
    messageTemplateAr:
      process.env.EMAIL_MESSAGE_TEMPLATE_AR ?? 'رمز التحقق لتسجيل الدخول في تطبيق سند هو {otp}',
    timeoutMs: Number(process.env.SMTP_TIMEOUT_MS ?? 25000),
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
    jwtIssuer: process.env.JWT_ISSUER ?? 'sanaad',
    jwtAudience: process.env.JWT_AUDIENCE ?? 'sanaad-b2e',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    disabled: toBool(process.env.AUTH_DISABLED),
    staticLogin: toBool(process.env.AUTH_STATIC_LOGIN),
    functionAccessView: process.env.FUNCTION_ACCESS_VIEW ?? 'HMC_Sanad_AppMaster_VW',
    functionAccessAppId: Number(process.env.FUNCTION_ACCESS_APP_ID ?? 1),
  },
  cerner: {
    baseUrl: process.env.CERNER_BASE_URL ?? '',
    timeoutMs: Number(process.env.CERNER_TIMEOUT_MS ?? 10000),
  },
  appLaunch: {
    minSupportedVersion: process.env.APP_MIN_SUPPORTED_VERSION ?? '1.0.0',
    latestVersion: process.env.APP_LATEST_VERSION ?? '1.0.0',
    downtime: toBool(process.env.APP_DOWNTIME),
    downtimeStart: process.env.APP_DOWNTIME_START ?? '',
    downtimeEnd: process.env.APP_DOWNTIME_END ?? '',
    appName: process.env.APP_NAME ?? 'SanaadHealth',
  },
  mpin: {
    minLength: Number(process.env.MPIN_MIN_LENGTH ?? 4),
    maxLength: Number(process.env.MPIN_MAX_LENGTH ?? 6),
    maxAttempts: Number(process.env.MPIN_MAX_ATTEMPTS ?? 5),
    lockoutMinutes: Number(process.env.MPIN_LOCKOUT_MINUTES ?? 15),
  },
  otp: {
    length: Number(process.env.OTP_LENGTH ?? 6),
    ttlSeconds: Number(process.env.OTP_TTL_SECONDS ?? 300),
    maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? 5),
    resendWindowSeconds: Number(process.env.OTP_RESEND_WINDOW_SECONDS ?? 60),
    staticValue: process.env.OTP_STATIC_VALUE ?? '',
    charset: process.env.OTP_CHARSET === 'alphanumeric' ? 'alphanumeric' : 'numeric',
    delivery: process.env.OTP_DELIVERY === 'http' ? 'http' : 'motc',
    store: process.env.OTP_STORE === 'motc' ? 'motc' : 'legacy',
  },
  ldap: {
    enabled: toBool(process.env.LDAP_ENABLED),
    host: process.env.LDAP_HOST ?? 'HMC.ORG.QA',
    port: Number(process.env.LDAP_PORT ?? 636),
    useSsl: toBool(process.env.LDAP_USE_SSL ?? 'true'),
    // Use the explicit URL when provided; an empty/unset value derives it from
    // host/port/ssl (matters in Docker where LDAP_URL is passed as "" by default).
    url:
      process.env.LDAP_URL ||
      `${toBool(process.env.LDAP_USE_SSL ?? 'true') ? 'ldaps' : 'ldap'}://${
        process.env.LDAP_HOST ?? 'HMC.ORG.QA'
      }:${Number(process.env.LDAP_PORT ?? 636)}`,
    // Defaults to LDAP_HOST â€” override only if the UPN suffix differs from
    // the directory host (uncommon).
    upnDomain: process.env.LDAP_UPN_DOMAIN || process.env.LDAP_HOST || 'HMC.ORG.QA',
    baseDn: process.env.LDAP_BASE_DN ?? 'DC=hmc,DC=org,DC=qa',
    searchFilter: process.env.LDAP_SEARCH_FILTER ?? '(sAMAccountName={username})',
    usernameAttribute: process.env.LDAP_USERNAME_ATTRIBUTE ?? 'sAMAccountName',
    bindDn: process.env.LDAP_BIND_DN ?? '',
    bindPassword: process.env.LDAP_BIND_PASSWORD ?? '',
    tlsRejectUnauthorized: toBool(process.env.LDAP_TLS_REJECT_UNAUTHORIZED ?? 'false'),
    caCert: loadLdapCaCert(),
    timeoutMs: Number(process.env.LDAP_TIMEOUT_MS ?? 10000),
  },
  entra: {
    tenantId: process.env.ENTRA_TENANT_ID ?? '',
    clientId: process.env.ENTRA_CLIENT_ID ?? '',
    clientSecret: process.env.ENTRA_CLIENT_SECRET ?? '',
    graphBaseUrl: process.env.ENTRA_GRAPH_BASE_URL ?? 'https://graph.microsoft.com/v1.0',
    loginBaseUrl: process.env.ENTRA_LOGIN_BASE_URL ?? 'https://login.microsoftonline.com',
    lookupAttribute: process.env.ENTRA_LOOKUP_ATTRIBUTE ?? 'userPrincipalName',
    timeoutMs: Number(process.env.ENTRA_TIMEOUT_MS ?? 10000),
  },
  firebase: ((): FirebaseConfig => {
    const serviceAccount = loadFirebaseServiceAccount();
    return {
      serviceAccount,
      projectId: serviceAccount?.project_id,
      enabled: !!serviceAccount,
      // Whether anything was SUPPLIED, separate from whether it worked. Both
      // failures look identical from outside otherwise, and they need
      // opposite fixes: nothing supplied is a deployment that never got the
      // value, while supplied-but-unusable is a value that arrived truncated,
      // quoted or line-wrapped. Chasing the wrong one costs a deploy cycle.
      credentialProvided: Boolean(
        process.env.FIREBASE_SERVICE_ACCOUNT?.trim() ||
          process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim(),
      ),
      credentialLength: process.env.FIREBASE_SERVICE_ACCOUNT?.trim().length ?? 0,
    };
  })(),
  appIntegrity: ((): AppIntegrityConfig => {
    const mode = (process.env.APP_INTEGRITY_MODE ?? 'off').toLowerCase();
    const teamId = process.env.APPLE_TEAM_ID ?? '';
    // The app's own identity, not a secret and not environment-specific, so it
    // defaults here to the same value docker-compose supplies. Defaulting to
    // an empty string instead would leave iOS attestation silently disabled
    // (`ios.enabled` requires a bundle id) for any deployment that does not go
    // through compose — Kubernetes, systemd, a bare `node dist/main.js`.
    const bundleId = process.env.APPLE_BUNDLE_ID ?? SANAAD_APP_ID;
    const packageName = process.env.ANDROID_PACKAGE_NAME ?? SANAAD_APP_ID;
    const androidKey = loadServiceAccount(
      process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT,
      process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT_PATH,
      'PLAY_INTEGRITY_SERVICE_ACCOUNT',
    );
    return {
      // Anything unrecognised means off: a typo must not silently enforce.
      mode: (['off', 'observe', 'enforce'].includes(mode) ? mode : 'off') as IntegrityMode,
      ios: {
        teamId,
        bundleId,
        // App Attest needs no Apple secret â€” verification is local, against a
        // public root CA â€” so a Team ID and bundle id are the whole setup.
        allowDevelopment: toBool(process.env.APPLE_APP_ATTEST_ALLOW_DEVELOPMENT),
        enabled: !!teamId && !!bundleId,
      },
      android: {
        packageName,
        serviceAccount: androidKey,
        enabled: !!packageName && !!androidKey,
      },
      challengeTtlMs: Number(process.env.APP_INTEGRITY_CHALLENGE_TTL_MS ?? 300000),
    };
  })(),
});
