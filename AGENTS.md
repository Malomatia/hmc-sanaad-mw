# Working notes

This workspace has two sibling projects: `HMC_BackEnd/` (the Sanaad API, wraps
Oracle) and `HMC_Gateway/` (public-facing gateway in front of it — forwards the
mobile auth journey, validates issued JWTs locally, and proxies everything
else). `npm` is blocked by the PowerShell execution policy in both — call
`npm.cmd` (or `npx.cmd`) instead.

## HMC_BackEnd commands

Run from `HMC_BackEnd/`.

| Task | Command |
|---|---|
| Install | `npm.cmd ci` |
| Build (typecheck) | `npm.cmd run build` |
| Tests | `npm.cmd test` |
| Lint | `npx.cmd eslint src --ext .ts` |

Known environment issues, both pre-existing:

- `npm.cmd run lint` crashes with `TypeError: expand is not a function` (a
  `minimatch` / `brace-expansion` resolution problem inside ESLint 8). Passing the
  directory instead of the glob, as above, works.
- The working copy uses CRLF while Prettier expects LF, so linting reports
  thousands of `Delete ␍` errors. Filter them out when looking for real findings;
  do not run `--fix`, it would rewrite every file.

Smoke-test the dependency-injection graph without a database:

```powershell
$env:ORACLE_DISABLED='true'; $env:AUTH_DISABLED='true'; $env:LDAP_ENABLED='false'
$env:JWT_SECRET='local_dev_secret_local_dev_secret_1234'; $env:PORT='3009'
node dist/main.js
```

## Oracle integration

The backend wraps existing `XXHMC_SND_*` views and procedures. Two facts drive
most of the runtime failures seen on staging:

1. **`Docs Project/sanaad-api-service-mapping.html` is the source of truth** for
   procedure parameters and, in several places, for the exact SQL the legacy
   services run (for example the `WORKLISTS_V` role filter and the
   `ACTION_HISTORY_V` item-type/item-key filter). Check it before assuming a
   signature is unavailable.
2. **It documents the request parameters of the legacy services, not the database
   objects.** View column names and OUT parameter names differ per object, so
   guessing produced `ORA-00904`, `PLS-00306` and `ORA-04044`.

Because of (2), adapters ask the data dictionary rather than hard-coding:

- `OracleSchemaService.resolveKeyColumn` / `hasColumn` — which key column a view
  actually exposes (`BaseOracleRepository.readByResolvedKey`).
- `OracleSchemaService.resolveParams` — the declared argument list of a procedure,
  used by `callSubmitProc` and `callRowsProc` so the call matches the database
  including its OUT contract. It reads `ALL_ARGUMENTS` with
  `OWNER`/`OVERLOAD`/`SUBPROGRAM_ID`/`DATA_LEVEL`/`TYPE_*`, keeps only
  `DATA_LEVEL = 0` formals (collection attributes are not procedure arguments),
  and picks one overload by scoring it against the adapter's documented
  parameter list; a truly ambiguous overload set throws instead of merging.
  Composite (`PL/SQL TABLE`/`RECORD`/`OBJECT`) parameters bind by their declared
  type name.

Related runtime behaviour:

- Submit endpoints have strict request DTOs (required business fields, unknown
  keys rejected 400). Dependent legacy spellings (`p_gendar`,
  `p_relation_ship`, `p_visa_validy`, `p_date_of_issuue_qid`,
  `p_type_of_sponsership`) are accepted and mirrored to the canonical names.
- Submit `POST`s return HTTP 200 (Sanaad convention: business result is in
  `successflag`), not Nest's default 201.
- English/Arabic column twins (`PHONE_TYPE`/`PHONE_TYPE_AR`, `meaning`/
  `meaningAr`, `VALUE`/`VALUEAR`, ...) are collapsed globally by the
  `ResponseInterceptor` via `localizeArTwins` (`shared/utils/localize.util.ts`):
  the base field carries the value for the request's `lang` (Arabic values
  URL-decoded, English fallback when the Arabic twin is empty) and the `*Ar`
  twin is removed from the response for both languages. A key only counts as a
  twin when its base key exists in the same object, so `YEAR`/`calendar` are
  never collapsed.
- **Localization is deliberately out of scope for now** — it is planned as one
  pass over the whole project at the end, so do not commit Arabic-label fixes
  with feature work. Known open items, measured 2026-08-27 and parked in
  `tools/arabic-lov-mapper.patch` (local, untracked): `LovMapper` recognises
  Arabic columns by name and the list covers about half the LOV views, so 15 of
  them (`D_DATA_AR` on the dependent screen, `MARITAL_STATUS_AR`,
  `TYPE_OF_PHONE_AR`, `FLEX_VALUE_AR`, ...) answer `lang=ar` in English;
  deriving the column as `<label column>_AR` fixes all of them. A further four
  (`BEREAV_RELAT_V`, `EDU_STAGE_LOV`, `SCHOOL_NAME_LOV`,
  `ACAD_YR_STRT_END_LOV`) store English in their Arabic column — a DB-team data
  fix, not a code one.
- A LOV whose Oracle object does not exist fails with ORA-00942 and surfaces as
  a bare HTTP 500, with nothing pointing at the name — that is how
  `EMPLOYMENT_STATUS_LOV` stayed broken until a mobile developer reported it
  (the view is `..._STATUS_V`). `tools/gen-lovaudit.js` checks every registered
  name against `all_objects`; it is clean as of 2026-08-27.
- Phone upsert (op 28) submits per phone through the scalar
  `ADD_OR_UPDATE_PHONE` signature and stops at the first failed item.
- LOV reads cache per (object, lang, username, options) for `LOV_CACHE_TTL_MS`
  (default 5 min) and coalesce concurrent identical reads. `SCHOOL_NAME_LOV`
  supports `search`/`page`/`pageSize` (Oracle-side `OFFSET/FETCH`).
- Oracle calls carry `ORACLE_CALL_TIMEOUT_MS` (connection `callTimeout`) and the
  pool `ORACLE_QUEUE_TIMEOUT_MS`, both default 25 s, so a hung statement cannot
  outlive the HTTP 30 s timeout or exhaust the pool.

Diagnostics endpoints for investigating a failure:

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/diagnostics/oracle-object?name=XXHMC_SND_...` | Object type, columns and formal parameters of an allow-listed object |
| `GET /api/v1/diagnostics/oracle-logs` | Every Oracle call made, with SQL, sanitized binds, duration and ORA code |
| `GET /api/v1/diagnostics/oracle-logs/stats` | Aggregates per object |

Submit endpoints accept the specification's `p_*` payload directly; parameter
lookup tolerates the `p_` prefix being present on only one side.

**Request body limit is 15mb, set in BOTH `main.ts` files** (`BODY_LIMIT`
constant — deliberately not env-driven: it follows the payload shape, not the
environment). Attachments arrive as base64 inside the JSON body and op 65 takes
ten of them, so Express's 100kb default capped an upload at ~73kb of actual
file — a 2 MB photo became a 2.7 MB body and was refused. The gateway parses
the body before proxying, so the smaller of the two limits is what applies:
keep them equal. body-parser's rejection is an http-errors object, not an
`HttpException`, so both projects match it structurally (`type ===
'entity.too.large'` / status 413) and answer **413** with a "compress the file"
message; previously it fell through to 500 "Internal server error" and read as
a server bug. Oracle needs nothing here — every `P_ATTACHMENT*` parameter is a
`BLOB`, not a `VARCHAR2`.

## Users/Sanaad SQL Server DB (auth cycle + healthcheck)

A second database next to Oracle: the legacy Sanaad SQL Server, pooled by the
global `MssqlService` (`core/database/mssql.module.ts`, `mssql` driver,
`USERS_DB_*` env vars — see `.env.example`; `USERS_DB_DISABLED=true` skips the
pool like `ORACLE_DISABLED`). It backs the auth cycle with the legacy tables
and SQL from the client's service mapping, values bound as `@params` and
mpin/otp params redacted from logs:

- `HMC_Sanad_DeviceRegn_tbl` — device binding (`DeviceRegistryPort`) and MPIN
  (`MpinStorePort`); MPIN stored **as received** (client pre-hashes) and
  compared with SQL equality — legacy-compatible by explicit decision, do not
  switch to scrypt without a migration plan. Reworked initiate flow
  (2026-09-03): `/auth/initiate` reads the exact user+device row
  (`DeviceRegistryPort.find`); registered WITH an MPIN = existing user (full
  identity returned, NO OTP), otherwise a missing row is created with MPIN
  NULL + `Status` `'Inactive'` and an OTP is sent. `MpinStorePort.set`
  (API-4 `/auth/mpin/update`) sets `DateFirstRegistered = GETDATE()`, the
  MPIN and `Status = 'Active'`. API-4 requires a non-empty string only:
  no 4–6 digit check on the client-hashed value, which must pass through
  unchanged. This validation change is scoped to `/auth/mpin/update`; the
  separate reset endpoint still retains its numeric policy.
- `HMC_RHAP_OTP_tbl` — OTP rows (`OtpPort`, `OTP_STORE=legacy`, the default
  since 2026-09-03): `TOP 1 ... ORDER BY SeqNo DESC` + `DATEDIFF` freshness;
  `SeqNo` doubles as the mobile `requestid`. Resend window/TTL/max-attempts
  come from `OTP_*` config (attempts + single-use are tracked in-memory; the
  legacy table has no columns for them). Delivery is separate
  (`OTP_DELIVERY`): `motc` (default) INSERTs the SMS into
  `MOTC_SMS_PushTable` (`MotcPushOtpDeliveryAdapter`), `http` is the generic
  SMS adapter. OTP generation is shared (`otp-generator.util.ts`):
  `OTP_STATIC_VALUE` (testing only) pins every OTP to a fixed value — leave
  empty in production — and `OTP_CHARSET` picks `numeric` (default) or
  `alphanumeric` (unambiguous A-Z/2-9).
- `HMC_Sanad_AppDownTime_tbl` / `HMC_Sanad_App_Update_tbl` — API-1
  `/healthcheck` downtime + update-type (`APP_NAME` matches
  `HMC_Sanad_AppMaster_Tbl.AppName`); falls back to the `APP_*` env config when
  no pool is available or a query fails. A successful update lookup matches
  `appname`, `version` via `FromVersionID`, and `A.Status = 1`, then returns
  that row's `UpdateType`. No matching row, no supplied version, or a
  null/blank `UpdateType` returns `updatetype: ""`, not a default `R`. A real
  database value `R` remains `R`; database-unavailable config fallback is
  separate and unchanged.

OTP delivery is `OtpDeliveryPort` → `SmsOtpDeliveryAdapter`, a generic
config-driven HTTP POST (`SMS_API_BASE_URL`/`SMS_API_KEY`/`SMS_SENDER_ID`/
`SMS_MESSAGE_TEMPLATE` with `{otp}`) pending the corporate gateway contract.
Unset base URL = masked log-only in non-production, hard 503 in production.
Raw OTPs and unmasked phone numbers must never be logged.

Identity (employee name + phone for the OTP SMS) still comes from the
directory (LDAP/Entra, below) — the SQL DB only holds device/MPIN/OTP state.
`FunctionAccessPort` is still the 501 stub, so a full production (non-bypass)
login stops at `functionAccess.list()` until its source is wired (the legacy
query against `HMC_Sanad_AppMaster_VW` is documented in the client mapping).
The `AUTH_DISABLED`/non-production dev bypass is unchanged.

## Auth directory provider (LDAPS vs Entra ID)

The corporate-directory lookup behind `LDAP_USER_PORT` (auth journey API-2/5) is
switchable via `AUTH_DIRECTORY`: `ldap` (default) uses `LdapUserRepository`
(LDAPS/`ldapts`), `entra` uses `EntraGraphUserRepository` (Microsoft Graph,
app-only client-credentials over the existing `@nestjs/axios`), `usersdb` uses
`MssqlUserRepository`, which since 2026-09-03 checks the username against the
live-employee master view `HMC_SND_LIV_EMP_MASTER_VW` on the **MOTC_SMS** DB
(`MOTC_SMS_EMPLOYEE_MASTER_VIEW`, `UserName` column; absent = refused, and
`EMPLOYEE_NAME`/`EMPLOYEE_NUMBER`/`MOBILE_NUMBER` feed the identity + OTP SMS
destination — previously it was only the `HMC_Sanad_DeviceRegn_tbl` device
lookup on the Users DB). The factory is in
`src/modules/auth/auth.module.ts`. Only `validate()` (passwordless lookup) is
used by the journey — the mobile credential stays OTP + MPIN — so `authenticate()`
is a 501 in the Entra adapter. Entra config lives in the `entra` namespace
(`ENTRA_TENANT_ID`/`ENTRA_CLIENT_ID`/`ENTRA_CLIENT_SECRET`/…); the Graph app needs
`User.Read.All` (Application) with admin consent. Switching back to `ldap` is an
instant rollback (no code redeploy). No mobile/gateway/DTO/JWT changes.

`/auth/login` always returns `employeeusername` in uppercase, including the
same field in static-login JWT `userdata`. This is output formatting only:
authentication lookup inputs and the JWT's principal `username` retain their
existing values.

## Push notifications (FCM)

`src/modules/notifications/` — ports + adapters, exported so any module can
notify a person without knowing about FCM, tokens or how many devices they
have (`NotificationsService.notifyUser(username, message)`).

- **Multi-device by design.** Tokens live in `HMC_Sanad_DeviceToken_tbl` keyed
  by `(LoginID, IMEINumber)` — the same pair as the device-binding table — not
  in a column on `HMC_Sanad_DeviceRegn_tbl`. Phone plus tablet is ordinary and
  a single column would silently drop one of them; the token is also the
  volatile part (FCM reissues it on reinstall/data-clear/periodically), so
  keying on the DEVICE makes re-registration a replace. DDL is
  `tools/notifications-schema.sql`; **it has not been applied yet** — until it
  is, registrations are discarded with one warning and nothing else breaks.
- **Nothing here may fail a request.** A notification is a side effect of an
  action that already succeeded, so `notifyUser` never throws, the store
  degrades to warnings, and an unconfigured credential binds `NoopPushSender`
  instead of refusing to boot.
- The credential is a PRIVATE KEY for the **production** project `sanaadprd`.
  It is read once at boot from `FIREBASE_SERVICE_ACCOUNT` (raw JSON or base64)
  or `FIREBASE_SERVICE_ACCOUNT_PATH`, inline winning — the same rule as
  `LDAP_CA_CERT`. `.gitignore` blocks the generated key filenames; never commit
  one.
- `POST/DELETE /notifications/device-token` take the user from the JWT and
  reject a `username` in the body — a registration redirects a person's
  notifications to a handset, so the client must not get to name the person.
  The app should re-register on every launch, and unregister on logout.
- Tokens FCM reports as permanently dead (`UNREGISTERED`,
  `INVALID_REGISTRATION_TOKEN`, `INVALID_ARGUMENT`) are pruned after a send; a
  merely failed send is transient and must NOT cost a device its registration.
- **What triggers one.** `NotificationTriggerInterceptor` is global and watches
  every POST: an interceptor rather than a call in each feature, because
  submits live in ten modules and the eleventh would be forgotten. It fires
  only on business success (`successflag === 'S'`, not HTTP 200), and the work
  is NOT awaited — the caller never waits for Oracle or FCM, and a rejection is
  swallowed.
  - a decision (`/approvals/:id/decision`) notifies the REQUESTOR of the
    outcome;
  - any other submit notifies the APPROVER. This one is **best-effort**: the
    procedures return only `successflag`, so the new request is found by
    reading the submitter's newest row in MY_REQEST_SUMMARY_V, and Oracle
    writes that row asynchronously. When it is not there yet nobody is
    notified — the approver still sees it in their worklist.
- The summary views hold a person as their EMPLOYEE NUMBER while device tokens
  are keyed by LOGIN, so `OracleRequestLookupRepository` translates via
  PERSONAL_DETAILS_V (cached). Anything non-numeric is already a login.
- `RequestLookupPort` is declared in the notifications domain rather than
  reusing the approvals repository, so the dependency points inward — approvals
  would otherwise need to know notifications exist, and a later "notify from
  approvals" would close the cycle.

## Device attestation (App Attest + Play Integrity)

`src/modules/app-integrity/` — Apple and Google verified directly, not through
Firebase App Check. (App Check was built first and then removed on the client's
decision; do not reintroduce it alongside this.)

The two platforms are genuinely different, and that shapes the module:

- **iOS** registers ONCE (`POST /app-integrity/ios/register`) and afterwards
  signs each request with the Secure Enclave key, so the server issues a nonce
  and keeps a public key per installation.
- **Android** has no registration. Every call carries a fresh token that
  already contains a hash of the request body, so nothing is stored.

Facts worth not rediscovering:

- **There is no Apple endpoint that validates an attestation.** The widely
  copied `validate_device_token` call belongs to DeviceCheck — a different,
  older feature — and neither accepts an attestation object nor returns a
  public key. Verification is local: parse the CBOR, check the certificate
  chain against Apple's App Attest root CA (`node-app-attest` does this).
- **App Attest therefore needs no Apple secret** — `APPLE_TEAM_ID` and
  `APPLE_BUNDLE_ID` are the whole setup. The `.p8` keys people associate with
  it are for DeviceCheck and for APNs.
- **Play Integrity needs its own credential**, not the Firebase one:
  `PLAY_INTEGRITY_SERVICE_ACCOUNT` with the `playintegrity` scope. The method
  is `playintegrity.v1.decodeIntegrityToken` — not a top-level
  `decodePlayIntegrity`, which does not exist on the client.
- A challenge is **stored and single-use**; consuming it is one conditional
  UPDATE so two racing requests cannot both spend it. It is spent even when
  the attestation then fails, or a captured one could be retried until
  accepted. Generating a nonce and forgetting it — as most samples do — makes
  the whole exercise decorative.
- The iOS **sign counter must advance**; a repeated value is a replay.
- `APP_INTEGRITY_MODE` = `off` (default) | `observe` | `enforce`. **Roll out
  via `observe`**: enforcement rejects real devices (no Play Services, rooted,
  sideloaded, simulator) and observe reports what would have been refused while
  letting everything through. An unrecognised value means `off`.
- `POST /app-integrity/android/verify` is a **development aid, not the
  enforcement path** — in production the token rides as a header on the real
  request and the guard checks it there; calling this first would make every
  action two round trips. It exists because attestation ships `off`, so an app
  can send a completely invalid token and learn nothing until enforcement is
  switched on and everything fails at once. Unlike the guard it RETURNS
  Google's verdicts, which is the point. Android has no `register` route
  because it has no key to store.
- `@SkipIntegrity()` (`core/integrity/`) exempts a controller — health,
  diagnostics, the dev console and the attestation routes themselves, since a
  device cannot prove itself before registering. Mobile routes including login
  stay covered.
- Each platform binds a refusing stub when unconfigured, so iOS can be live
  while the Android credential is still being issued. Storage is
  `tools/app-integrity-schema.sql`; a missing table warns once and means
  "cannot verify", never a crash.
- **The gateway does a first pass** (`HMC_Gateway`, `core/integrity/`,
  `GATEWAY_INTEGRITY_MODE`) — defence in depth, nothing was moved out of the
  backend. It holds no database and no platform credentials by design, so it
  checks only what needs neither: headers present, shaped like real values, and
  the request hash matching the body received. Two things this required, both
  of which had made the backend's verification unreachable:
  - `FORWARD_REQUEST_HEADERS` in `proxy.service.ts` is an allow-list, and the
    attestation headers were not on it — they were being dropped, so the
    backend guard could never have seen one.
  - The proxy forwarded `req.body`, which axios re-serializes. Play Integrity
    binds a token to a hash of exactly what the client sent, so a re-encoded
    body is a different string. `main.ts` now keeps the raw bytes via the
    body-parser `verify` hook and the proxy forwards those.

## Outstanding — not a code issue

**Appointments (ops 41-44) return HTTP 503 on staging.** The module talks to
Cerner over HTTP and `CernerClient` refuses to call an unconfigured service, so
all four endpoints report "The appointments service is currently unavailable."
This is environment configuration, not application code: set `CERNER_BASE_URL`
(and `CERNER_TIMEOUT_MS` if the default is not suitable) in the staging
environment. Do not work around it in code.

## HMC_Gateway

Public entry point for mobile: forwards the pre-login Sanaad auth journey
(`/healthcheck`, `/auth/initiate`, `/auth/otp/validate`, `/auth/mpin/update`,
`/auth/login`, `/auth/mpin/forgot`, `/auth/mpin/update/reset`) verbatim to
`HMC_BackEnd`, then validates the JWT the backend issued **locally** (shared
`JWT_SECRET`/`JWT_ISSUER`/`JWT_AUDIENCE` — same env var names as
`HMC_BackEnd`, must be kept in sync) on every other request before proxying it
through via a generic `@All('*')` wildcard controller
(`src/modules/proxy/proxy.controller.ts`). Backend responses (success and
error bodies) are relayed byte-for-byte and never re-wrapped; only a real
network failure to the backend (timeout/connection refused) produces a
gateway-originated minimal `{status:'error', message, httpStatusCode}` 502/504
(`ProxyService.handleNetworkError`).

Run from `HMC_Gateway/`.

| Task | Command |
|---|---|
| Install | `npm.cmd ci` |
| Build (typecheck) | `npm.cmd run build` |
| Unit tests | `npm.cmd test` |
| E2E tests (mocked backend) | `npm.cmd run test:e2e` |
| Lint | `npx.cmd eslint src test --ext .ts` |
| Format | `npx.cmd prettier --write "src/**/*.ts" "test/**/*.ts"` |

Notes:

- The working copy now has the same CRLF debt as `HMC_BackEnd` (checked out on
  Windows), so `prettier --check` and ESLint flag every file with `Delete ␍`
  — 1438 findings, all line endings. Do NOT run `--write`/`--fix` across the
  project; check only the files you touched, e.g. by comparing
  `prettier.format()` output against the file with `\r\n` normalized away.
- `test/mock-backend.ts` is a minimal `http` stand-in for `HMC_BackEnd` used by
  `test/gateway.e2e-spec.ts`; it mints a real JWT with the same secret the
  gateway is configured with so the proxy/auth-guard path can be exercised
  without a live backend or Oracle/LDAP.
- Route registration order: `ProxyModule` (the wildcard) is imported last in
  `AppModule`. Nest 11's `RouteSpecificitySorter` already registers literal
  routes before wildcards regardless of import order, so this is
  belt-and-suspenders, not load-bearing — see the doc comment on
  `ProxyCoreModule`.
- Manual smoke test against a real backend (mirrors the backend's own
  no-Oracle smoke test):
  ```powershell
  # Terminal 1 — HMC_BackEnd
  cd HMC_BackEnd
  $env:ORACLE_DISABLED='true'; $env:AUTH_DISABLED='true'; $env:LDAP_ENABLED='false'
  $env:JWT_SECRET='local_dev_secret_local_dev_secret_1234'; $env:PORT='3009'
  node dist/main.js

  # Terminal 2 — HMC_Gateway
  cd HMC_Gateway
  $env:BACKEND_BASE_URL='http://localhost:3009'; $env:BACKEND_API_PREFIX='api/v1'
  $env:JWT_SECRET='local_dev_secret_local_dev_secret_1234'; $env:AUTH_DISABLED='true'
  $env:GATEWAY_PORT='3001'
  node dist/main.js
  ```
  Then `GET http://localhost:3001/api/v1/health` (gateway liveness),
  `GET http://localhost:3001/api/v1/health/backend` (dependency check, proxies
  to the backend's own `/health`), and any other `GET`/`POST
  http://localhost:3001/api/v1/...` route falls through to the wildcard and is
  proxied to the real backend untouched (confirmed against
  `/healthcheck`, `/health/db`, and the Oracle diagnostics response).
## Staging verification facts (2026-08-23, via https://sndstgmobileapi.hamad.qa)

Learned by live-testing contact/dependents/school-fees/appointments/
annual-ticket/approvals; the Postman collection carries the captured real
responses as examples.

- Staging runs `AUTH_DISABLED=true`: the gateway forwards without a token and
  the backend injects dev user `AIBRAHIM39`/`037400` (401/403 not reproducible
  there). `POST /auth/login` still returns a signed JWT (dev bypass).
- Approvals/worklist views are keyed by USERNAME (`enum=AIBRAHIM39`), not the
  employee number — `WORKLISTS_V` returned 44 real rows for the username and
  none for `037400`/`053613`. `NOTYFY_APPR_V` (op 21 details) appears to hold
  only OPEN actionable notifications for the recipient.
- ops 61/62 `GET /leave/lov/cancel|amend`: ALL caller identifiers sent
  (`person_id`/`username`/`enum`) are matched together via `key IN (...)`
  against whichever scoping column the view exposes (LEAVE_CANCEL_V/AMEND_V
  key on PERSON_ID — a username-only call used to return an empty list).
  Identifiers that cannot match the column's TYPE are dropped first
  (`OracleSchemaService.isNumericColumn`): Oracle coerces the other side of the
  comparison, so one username in `person_id IN (...)` raised ORA-01722 and lost
  the whole predicate — `?person_id=26023&username=…` answered 0 rows where
  `?person_id=26023` alone answered 15, i.e. sending more identifiers made the
  result worse. Pinned in `lov-scope-types.spec.ts`.
- op 56 `POST /leave/return`: `p_leave_details` is the leave's
  ABSENCE_ATTENDANCE_ID as a numeric string ('56949953'), NOT a composite —
  RET_FRM_LEAV_PR runs TO_NUMBER on it and every text form answers ORA-01722
  (verified 2026-09-01). The op 55 LOV publishes it as a new, additive `id`
  field — `code`/`meaning`/`used_value` still carry the display string, so
  clients that do not need the id see no change. The three RFL LOVs (`return-details`/`related1`/`related2`) had
  been answering ORA-00904/500 because `readByUsername` defaults to the column
  literal `username` while those views spell it `USER_NAME` — they resolve the
  column now, which is what makes the id reachable at all.
- **Nothing in the system grants APPROVER or SUPERVISOR.** Every identity
  adapter hard-codes `roles: [Role.EMPLOYEE]` (LDAP, Users DB, Entra, the dev
  fallback and the static login), and `AuthService` defaults to the same, so
  `@Roles(Role.APPROVER, Role.SUPERVISOR)` is unreachable for every user — not
  just untested. The approvals views hold real rows meanwhile (8 for `037400`
  in MY_REQEST_SUMMARY_V, 31 for approver `027303` in APPROVE_SUMRY_V), so a
  403 there is the guard, never missing data. Ops 20 and 23 (`GET /approvals`,
  `GET /approvals/my-requests`) are exempt via an empty `@Roles()` on the
  handler: both already filter on the caller, so identity is the whole
  protection and the role added nothing but a permanent 403. Their `?enum=` is
  accepted and IGNORED — required for the pipe (`forbidNonWhitelisted` rejects
  an unknown property, and ProfileQueryDto's required `enum` would reject a
  client that stops sending it), and ignored so an employee-open route cannot
  be pointed at someone else's rows. The routes that ACT on a request
  (decision, request-info, reassign) keep the role and so still need a real
  source — deriving it from those views at login is the obvious candidate.
  **Note this cannot be verified by running locally:** `AUTH_DISABLED=true`
  injects `DEV_USER`, which holds EMPLOYEE + SUPERVISOR + APPROVER, so every
  route passes. `roles-guard-override.spec.ts` pins the behaviour instead.
- **Testing an approver journey (dev only).** With `AUTH_DISABLED=true` the
  identity now follows the presented token instead of being pinned to
  `DEV_USER`, so logging in as an approver actually acts as them — previously
  every request fell back to DEV_USER and their queue came back empty, which
  made the journey impossible to exercise. Log in with any credentials as one
  of these (login form ← employee number, rows waiting):
  `EALJASSIM` ← 027303 (33) · `MSALEM4` ← 024799 (11) · `RABOOBACKER` ← 037911
  (8) · `MIMRAN2` ← 048945 (2) · `AGAD1` ← 030728 (2) · `MASHWAR` ← 043914 (1).
  The last four hold `037400`'s own pending requests, so a full
  submit → approve loop can be run end to end. `devIdentity` deliberately
  leaves `employeeNumber` unset — a placeholder like '000000' matches no view
  while looking like an answer; adapters resolve the real one from the
  username.
- **Pointing the approvals reads at someone else (non-production only).** Ops
  20, 21, 21b and 23 honour a client-supplied `?enum=`/`?username=` as an
  ADDITIONAL scope when `NODE_ENV !== 'production'`, and ignore it inside
  production — the same rule the SQL consoles use, so there is no extra switch
  to set or to leak. That is how a tester gets real rows without an approver
  account: `GET /approvals?enum=027303` returns that approver's 33, and
  `:id/details` will open one of their requests because the ownership check is
  widened by the same value. In production the parameter is dropped, because
  honouring it would let any employee read another's requests — and read a
  detail view whose notification ids are sequential — by passing their number.
  `act-as-scope.spec.ts` is that boundary.
- ops 21 and 21b (`GET /approvals/:id/details`, `attachments/:documentId`) are
  open to any employee — that is how they open their own request — but they
  resolve a request by ID ALONE, with no caller in the query, and the
  notification ids are SEQUENTIAL. The role gate was the only thing preventing
  an employee from walking the range and reading every request in the
  organisation, so it is replaced by an ownership check (`isOwnedBy` /
  `isItemOwnedBy`), not removed: the caller must be the requestor or the
  approver, checked BEFORE any data is read. `request-ownership.spec.ts` is the
  security boundary — do not relax one side without the other.
- op 17 `POST /letters/apply` rejects a value it cannot look up, and the two
  inputs a client could not previously obtain were the pair `p_letter_name` +
  `p_letter_language` and `p_mobile_number`. Both come from op 16 now:
  `name[].description` carries the ONE language that letter exists in
  (LETTER_NAME_LOV.DESCRIPTION — the mapper used to drop it, so the pairing had
  to be guessed), and `/letters/lov` passes the authenticated username
  alongside `?enum=` because LETTER_MOBILE_NO_LOV keys on the login, not the
  employee number, which is why `mobileNo` came back empty for a documented
  call. `description` is additive and never localized.
- ORA-01403 escaping a submit means a value WE sent did not resolve, so it maps
  to `UNRESOLVED_VALUE` → **422**, not 404. As 404 "resource not found" it hid
  the cause of op 17 failures: a bad letter/language pair, an unknown delivery
  location and a mobile that is not the employee's were indistinguishable, and
  the only way to tell was the Oracle log.
  Optional `?leave_type=` is a case-insensitive CONTAINS match on the view's
  `NAME` column (NAME holds display strings with dates); a dedicated
  `LEAVE_TYPE` column (op 13 ABSENCE_REASON_V) still gets an exact match.
  Implemented generically in `LovOracleRepository` via
  `LovReadOptions.scopeAlternatives`/`leaveType`.
- op 67 `TICKET_REQ_PR.p_employee` must be the Oracle **PERSON_ID** (26023 for
  AIBRAHIM39): the employee number fails the
  `HMC_HR_PASSAGE_TICKET_EMPLOYEE_NAME` flexfield check and a name string
  raises ORA-01722. `p_contractual_year` must exist in
  `HMC_HR_CONTRACTUAL_YEAR_SIT` ('01-SEP-2025 to 31-AUG-2026' passes,
  calendar-year strings do not). With correct values the test user gets the
  real business answer "No ticket balance available..." (no entitlement).
- `UPD_ADDRESS_PR`: `p_country` takes the country NAME (`Qatar`; `QA` →
  "Invalid Country"), `p_address_type` must equal the target address's own
  type, and repeating an update on the same `p_effective_date` fails
  (date-track). `CREATE_ADDRESS_PR` rejects overlapping same-type addresses.
  Both verified with successflag S.
- op 65 add dependent returns successflag S only when the flexfield's extra
  requirements are met (the wire shows a sanitized message; the FLEX-NULL /
  FLEX-VALUE detail is only in oracle-logs): >=1 attachment,
  `p_passport_number`, `p_pp_expiry_date`, `p_country_of_issue`,
  `p_visa_type` ('QID(Qatari)'|'Residence Permit'), `p_visa_validity`
  (Yes|No), unique `p_id_number` (QID), and `p_relationship` from the op 64
  CONTACT group ('Child', not "Son"). Working example pinned in the DTO and
  Postman.
- op 71 reassign and RFMI request-info returned successflag S when run against
  an OPEN notification owned by the caller (from WORKLISTS_V). op 22 decision
  needs an open actionable APPROVAL assigned to the caller (FYI notifications
  reject APPROVE) — none existed for the dev user.
- Staging DB issues (request format is correct, procedure fails internally):
  `ADD_OR_UPDATE_PHONE` rejects every phone type (all LOV meanings+codes and
  the user's own stored type — the spec's own recorded sample shows the same
  error); `SCHOOL_FEE_PR` raises ORA-01403 at line 197 / ORA-00027 at line 114
  for fully valid payloads; `UPDATE_DEPENDENT_PR` intermittently hits
  ORA-00027 at package line 3506 once an attachment is supplied.

## OTP email language

OTP email bodies follow the request's `lang` header (`en`/`ar`, default English)
through `/auth/initiate`, `/auth/send-otp`, and `/auth/mpin/forgot`, with the
existing `?lang=` query taking precedence. The gateway must forward `lang` in
its request-header allowlist; deploying only the backend leaves header-based
mobile requests in English. Both OTP stores pass the language to
`EmailOtpDeliveryAdapter`. `EMAIL_MESSAGE_TEMPLATE` overrides the English body,
`EMAIL_MESSAGE_TEMPLATE_AR` overrides Arabic, and `{otp}` is replaced with the
generated code. An existing environment override still wins over code defaults.
The email subject, SMS templates, and diagnostics test-email body are unchanged.

## OTP bilingual SMS

SMS delivery ignores request `lang` and uses only `SMS_MESSAGE_TEMPLATE` for
both languages in one message. Its default is `OTP to register for Sanaad App
is {otp}`, a blank line, then `رمز التحقق للتسجيل في تطبيق سند هو {otp}`.
Server environment values can contain literal `\n\n` or actual line breaks;
HTTP and MOTC delivery normalize escaped newlines and replace EVERY `{otp}`
with the same generated string, preserving leading zeroes. The alternate
`OTP_STORE=motc` uses the normalized template for storage and verification,
including repeated placeholders. `SMS_MESSAGE_TEMPLATE_AR` is no longer used.
Docker Compose forwards the single template. Email still follows request
language and its separate English/Arabic templates. MOTC `LANGUAGE_ID` remains
controlled by `MOTC_SMS_LANGUAGE_ID`; no language-code mapping is assumed.

## Testing OTP in responses

`OTP_IN_RESPONSE` is a boolean, default `false`, forwarded by Docker Compose.
When `true` outside production, `/api/v1/auth/initiate` and
`/api/v1/auth/send-otp` include an optional top-level `otp` string. Both legacy
and MOTC stores return the exact generated/stored code after successful delivery;
legacy PENDING replies expose the existing code without generating or sending
another. Leading zeroes and alphanumeric codes are preserved. Production forces
this off, and the onboarding service also guards the response boundary.

Disabled/unset flags omit the property entirely. Existing-user initiate responses
and `AUTH_DISABLED` bypass responses omit it because they do not generate an OTP.
Forgot-MPIN responses are unchanged. OTPs remain masked in API log previews and
are not added to audit events. Restart the backend after changing the flag.

## SQL Server API audit logs

`MssqlAuditSink` reuses the existing `USERS_DB_*` pool (SND_DEV on development)
and retains the structured console audit. Each L1 API record inserts into
`HMC_Sanad_FunctionAccessLogs_tbl`; `auth_login` also inserts exactly one row
into `HMC_Sanad_UserLogs_tbl`. Lifecycle events remain console-only, avoiding
duplicate login rows. `FunctionID` is the Swagger `operationId` (fallback:
controller + handler name), `ActionTaken` is HTTP method + route template
without query values, and both result columns use `success` / `error`, including
business failures returned with HTTP 200. Inserts are parameterized, best-effort,
and not awaited by the HTTP request; asynchronous sink failures are caught.

Login JWTs now retain `deviceImei`, `appName`, `appVersion`, and `platform`, also
preserved by refresh and the development auth guard. Audits prefer authenticated
identity/session claims to request body fields. Missing context (including old
tokens and anonymous requests) is bound as SQL NULL, not invented. The database
account needs INSERT access and the existing column types/nullability must allow
these values. These tables never receive request/response bodies or credentials.
Requests rejected by gateway/backend guards before the audit interceptor runs
are outside this logging path.

Swagger exports `DECORATORS` from `@nestjs/swagger`; importing it from
`@nestjs/swagger/dist/constants` typechecks but fails at runtime because that
subpath is not exported.

## School-fees academic-year LOV

`/school-fees/lov/academic-year` (op 50) preserves `code`, `meaning`, and
`used_value`, and adds `ACCAD_YEAR`, `ACD_START_DT`, and `ACD_END_DT`. These JSON
spellings are intentional: the view exposes `ACAD_YEAR` and `ACD_STARD_DT`;
the mapper also accepts the corrected aliases. Dates use `DD-MON-YYYY`, with
NULL dates preserved as JSON null. The specialized mapping is restricted to
`ACAD_YR_STRT_END_LOV`, including generic lookup access to that same object;
other LOV responses are unchanged.

## Pending request counts

`GET /approvals/pending-count?pendreq=XXHMC_SND_PNDNG_UPD_PERSON_V&username=...`
reads `XXHMC_SND_PEND_COUNT`, selecting `COUNT_DATA`, `REQUESTOR_USER_NAME`, and
`PENDING_REQ` into `result.items`. Both filters are exact, bound values joined
with AND; `pendreq` is never interpreted as an object to query. There is no
count cache or synthesized zero: no matching rows returns an empty array.
`pendreq` is required, `username` is optional and defaults to the authenticated
login. As with the other approvals reads, a supplied username is honored only
outside production; production always binds the caller's login, not their
employee number. The route is open to authenticated employees with `@Roles()`
overriding the controller's approver role. Swagger/audit operation ID:
`approvals_pendingCount`.

## Dependent effective date

`POST /dependents` and `POST /dependents/update` generate `p_effective_date`
server-side for each Oracle call as `YYYYMMDD`, using the server's local calendar
date. The field is absent from both request DTOs and Swagger examples; clients
must omit it (the strict request whitelist rejects it). Other endpoints' date
fields are unchanged.

## Oracle username casing

Oracle-bound login values are uppercase. `OracleService` normalizes named
username IN/INOUT binds before logging and execution (`p_user_name`, `username`,
`user_name`, `p_username`, `p_dusername`, and from/to/requestor/approver variants).
`BaseOracleRepository` also normalizes values using the resolved username column
or formal parameter before they become generic `kN`/`argN` binds; LOV scopes
and worklist/leave `u` binds cover the remaining anonymous username bindings.
The supervisor employee directory reads a view and binds the uppercase request
username in its exclusion predicate.
Do not uppercase every string bind: IDs, comments, file
contents, dates, and other business values must remain unchanged. This is an
Oracle input boundary only, not a change to JWTs, directory/SQL Server auth,
Oracle connection credentials, or response casing.

## Initiate phone masking

`POST /auth/initiate` shows only the last three digits of `employeephonenumber`,
masking preceding digits with `X` (for example, `31141206` becomes `XXXXX206`)
for existing, new, and pending-OTP users. The response helper `maskPhone` preserves
phone formatting and fully masks numbers containing three or fewer digits.
OTP delivery still receives the original number; SMS log masking and email
masking are unchanged.

## Contact country LOV submit value

`GET /contact/lov/country` returns `used_value` equal to `code` (for example,
`AD`), with `meaning` and its existing localization unchanged. This override
lives in `AddressService.countryLov` and copies the shared cached LOV items;
it does not alter generic lookup responses, other LOVs, or address submit binds.

## Oracle API error descriptions

Oracle errors now prefer the readable Oracle description, not the category's
generic message: `ORA-01403: no data found` becomes `no data found`.
`extractOracleErrorText` strips ORA/PLS prefixes, stack frames, and driver help
links while still rejecting SQL, schema names, and credential assignments.
`BaseOracleRepository.toSubmitResult` handles OUT-bind errors (including blank
`p_message` ahead of a populated `p_error_msg`), and `classifyException` handles
thrown Oracle errors. The exception filter keeps extracted descriptions for
both languages instead of replacing them with category text on `lang=ar`;
returned Arabic OUT messages are cleaned independently. Leave calculation and
payslip generation use `sanitizeOracleMessage` for their separate `errorMessage`
fields. HTTP statuses are unchanged: failed submit results remain 200, thrown
ORA-01403 remains 422. The English database fallback is now `The database request
failed.` when no usable detail is available. Full Oracle diagnostics/logs are
unchanged and retain the original error.

## Supervisor employee directory view

`GET /employee/supervisor/views` now reads `XXHMC_SND_DELEGATE_EMP_V` directly,
not the former `XXHMC_SND_SUPERVISOR_VIEW` table function. A view must not be
called as `TABLE(view(username, NULL))`; that SQL raised ORA-00904. The request's
`username` is excluded using `UPPER(USERNAME) != :username` (uppercase bound
value), including when no search keyword is supplied. Other employees remain
eligible.
`searchKeyWord` applies a bound, case-insensitive contains match to `GLOBAL_NAME`
before the 2,000-row cap. Omitted, empty, or whitespace-only search values omit
the name predicate. Returned view columns remain unchanged; supervisor submit
and the generic table-function helper are unaffected.

## Profile outside address selection

`GET /profile` reads at most one `EMP_OUT_ADDRESS_V` row for the requested user,
filtered by `ADDRESS_TYPE IN ('Recruiting', 'Primary Home Country Address')`
before `ROWNUM <= 1`. No address-type priority or latest-row ordering is implied.
`outsideAddresses` keeps its array shape (zero or one item); all other profile
reads are unchanged. The existing resolved username-column lookup and graceful
schema-mismatch behavior are preserved through optional `ResolvedKeyReadOptions`
on the shared read helper. Additional predicates are code-owned SQL with bound
values, grouped with AND; they must not come from request-supplied SQL. Scope
binds take precedence over additional binds.

## malomatia handover documents

`Docs_Ai/Project Structure/PROJECT_HANDOVER_MALOMATIA_REVISED.html` is a
self-contained, printable revision of the handover (source version 1.0,
2026-08-30), not a technical-status update. Its companion PDF is rendered with
local Microsoft Edge; `PROJECT_HANDOVER.md` is the editable generation source.
The obsolete NestJS 10 README warning was removed after the README was corrected
to NestJS v11. The requested document scope excludes logging, diagnostics,
operational tools/endpoints, and appointments/Cerner coverage. Keep these out of
the delivered text, tables, diagrams, and contents. Document commands use `npm`
and `npx`, without the Windows execution-policy note; terminal commands in this
workspace still require `npm.cmd`/`npx.cmd`. These are document-only omissions,
not instructions to remove application capabilities or technical working notes.
Build tooling is isolated in `Docs_Ai/Project Structure/.handover-build/`:
run `node build.mjs`, then `node verify.mjs` there. Both accept an optional output
basename. The corrected export uses `PROJECT_HANDOVER_MALOMATIA_REVISED`
(the original branded PDF was open/locked); pass that basename to both commands
to regenerate the corrected HTML/PDF pair. The checks compare all content,
table rows, and code lines, extract PDF text, check clipping and navigation,
and render PDF contact sheets. No application dependencies are involved.
The HTML embeds the supplied malomatia assets and fonts; its editable content
is in `<template id="source">`, with automatic pagination on load. Equestrienne
Light is used for lowercase display headings; the supplied Book face renders
small-cap glyphs.

## Oracle pool recovery

`OracleService` shares one on-demand pool-recovery promise across concurrent
requests, including startup and health probes. Each cycle makes at most TWO
`createPool` attempts, with a 1-second delay before the second. Each candidate
must acquire a connection and pass a ping before publication. Two failures
produce `OracleUnavailableException` (HTTP 503), followed by a 2-second cooldown;
a later request can start another cycle. Disabled or unconfigured Oracle is
never retried. These timings are code constants, not new environment settings.

Recognized broken-pool/connectivity errors replace the pool; queue saturation
(`NJS-040`/`NJS-076`), business errors, and SQL mistakes do not. Acquisition can
retry before executing SQL. An execution failure marks its own pool generation
for replacement on a later request, but NEVER replays the failed query/procedure
or submit: the commit outcome may be unknown. Late failures from an old pool
cannot invalidate its replacement. Retired pools drain in parallel with recovery
for twice the configured call timeout (minimum 5 seconds); shutdown waits for
tracked cleanup and prevents late pool publication.

All Oracle query/call helpers and `/health`/`/health/db` use this recovery path.
Acquisition errors are now included in Oracle diagnostics logs, and health
connections receive `callTimeout`. Recovery tests use mocked drivers and fake
timers in `src/core/database/db-boot-resilience.spec.ts`. This change does NOT
address the separate process-lifetime caching of failed schema metadata lookups
in `OracleSchemaService`.
