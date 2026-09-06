# PROJECT_ANALYSIS — HMC Sanaad B2E Platform

> Technical analysis produced before writing the handover documentation.
> Date: 2026-08-30. Sources: full repository exploration of `HMC_BackEnd/` and
> `HMC_Gateway/`, the live Swagger document (106 backend endpoints), package
> manifests, Docker files, and the workspace `AGENTS.md` operational notes.
> Nothing in this file is invented; anything not determinable from source is
> marked **Requires Knowledge Transfer**.

---

## 1. System Overview

The workspace contains **two sibling NestJS 11 projects** that together form the
Sanaad B2E (business-to-employee) mobile backend for HMC (Hamad Medical
Corporation):

| Project | Name | Role |
|---|---|---|
| `HMC_BackEnd/` | `hmc-sanaad-backend` v0.1.0 | The Sanaad API: re-exposes 71 legacy Sanaad operations over the existing Oracle `XXHMC_SND_*` views/procedures, plus the full mobile authentication journey (SQL Server legacy tables + LDAP/Entra + MOTC SMS OTP). |
| `HMC_Gateway/` | `hmc-gateway` v0.1.0 | Public entry point for the mobile app. Forwards the pre-login auth journey verbatim to the backend, validates issued JWTs **locally** (shared secret), throttles brute-force surfaces, and proxies every other request via a wildcard controller. |

Consumers: the Sanaad mobile application (employees of HMC). The backend is a
*thin orchestration layer* — business logic lives in Oracle procedures and the
legacy SQL Server tables; the Node services translate, validate, localize and
secure access to them.

## 2. Project Map

```text
C:\projects\hmc\development
│
├── AGENTS.md                     ← operational knowledge base (build cmds, DB facts, verified staging behavior)
├── Docs Project/                 ← client-provided legacy service mapping (source of truth for proc params)
├── Docs_Ai/                      ← architecture/domain docs referenced by the backend README
│
├── HMC_BackEnd/                  ← THE API (this is where most work happens)
│   ├── src/
│   │   ├── main.ts               ← bootstrap: body limits (15mb), helmet, CORS, prefix, Swagger (+DIAGNOSTICS strip)
│   │   ├── app.module.ts         ← CoreModule + LookupsModule + 13 feature modules
│   │   ├── core/                 ← cross-cutting: config, 3 DB pools, auth, http pipeline, audit, api-logs, dev-console, health
│   │   ├── shared/               ← constants (ORACLE_OBJECTS allow-list), common DTOs, utils (dates, localization), swagger helpers
│   │   ├── lookups/              ← shared-kernel LOV service (cached Oracle view reads) used by every feature module
│   │   └── modules/              ← 13 feature modules (auth, profile, employee, payslip, leave, letters, identity,
│   │                                contact, dependents, school-fees, appointments, annual-ticket, approvals)
│   ├── test/                     ← jest-e2e config (no e2e specs yet; 23+ unit specs live in src/**)
│   ├── postman/                  ← generated Postman collection + sync scripts
│   ├── Dockerfile                ← node:20-slim + Oracle Instant Client, multi-stage
│   ├── docker-compose.yml        ← env injection contract (host env > .env)
│   └── .env.example              ← every configuration variable, documented
│
└── HMC_Gateway/                  ← THE PUBLIC GATEWAY
    ├── src/
    │   ├── main.ts               ← helmet, CORS, prefix, Swagger (gateway-owned routes only)
    │   ├── app.module.ts         ← CoreModule → AuthModule → ProxyModule (wildcard LAST)
    │   ├── core/                 ← config, JWT guard/strategy (local validation), shared axios client + TLS agent,
    │   │                            correlation-id middleware, minimal exceptions filter, health controller
    │   └── modules/
    │       ├── auth/             ← @Public forwarded journey routes (throttled: otp/validate, login, mpin/forgot, reset, token/refresh)
    │       └── proxy/            ← @All('*') wildcard → ProxyService (byte-for-byte relay, 502/504 on network failure only)
    ├── test/                     ← mock-backend.ts + gateway.e2e-spec.ts (real e2e with mocked backend)
    ├── Dockerfile / docker-compose.yml
    └── .env.example
```

## 3. Technology Stack (verified from package.json)

| Technology | Version | Purpose |
|---|---|---|
| Node.js | 20 (Docker base `node:20-slim`; no `engines` field) | Runtime |
| TypeScript | ^5.x (via nest build/ts-jest) | Language |
| NestJS | ^11.1.17 (`common`/`core`/`platform-express`) | Framework (both projects) |
| node-oracledb | ^6.5.0 | Oracle HR database access (backend) |
| mssql (tedious) | ^11.0.1 | SQL Server access: Users DB + MOTC SMS DB (backend) |
| @nestjs/jwt + passport-jwt | ^11.0.2 / ^4.0.1 | JWT issue/verify |
| ldapts | ^9.0.0 | LDAPS directory lookups (backend) |
| @nestjs/axios + axios | ^4.0.1 / ^1.6.8 | Cerner client, Entra Graph, SMS adapter; gateway proxying |
| @nestjs/config + joi | ^4.0.4 / ^17.13.0 | Typed config + env validation at boot |
| class-validator/transformer | ^0.14.1 / ^0.5.1 | DTO validation (global ValidationPipe) |
| @nestjs/swagger | ^11.2.0 | OpenAPI at `/docs` |
| @nestjs/throttler | ^6.4.0 | Gateway rate limiting (login surfaces) |
| helmet, compression | ^8.1.0 / ^1.7.4 | HTTP hardening/perf |
| jest + ts-jest + supertest | ^29.x / ^7.0.0 | Testing |
| Docker | multi-stage, node:20-slim | Deployment |

Note: backend `README.md` still says "NestJS 10" — outdated; package.json is v11.

## 4. Backend Feature Modules (13 + lookups)

Complete endpoint inventory extracted from the live Swagger document
(106 paths). Per module: purpose, Oracle/external objects, endpoints.

### 4.1 auth (`src/modules/auth`) — Sanaad auth framework APIs 1-7 + sessions
- Ports & adapters architecture; every dependency is swappable by env var:
  - Identity directory (`AUTH_DIRECTORY`): `ldap` (LdapUserRepository/ldapts) | `entra` (Microsoft Graph) | `usersdb` (legacy device table only).
  - OTP store (`OTP_STORE`): `motc` (default — MOTC_SMS_PushTable is store *and* SMS delivery) | `legacy` (HMC_RHAP_OTP_tbl + HTTP SMS adapter).
  - MPIN + device binding: `HMC_Sanad_DeviceRegn_tbl` (MPIN stored as received — client pre-hashes; legacy-compatible by explicit decision).
  - Function access list: `HMC_Sanad_AppMaster_VW` (view name/AppID configurable).
- Test/dev switches: `AUTH_DISABLED` (dev bypass everywhere), `AUTH_STATIC_LOGIN` (fixed AIBRAHIM39 login payload with full `userdata` claim in the JWT).
- Sessions: access JWT (jti) + refresh JWT (`typ=refresh`, rotated, one-time use); logout revokes via in-memory `TokenRevocationService`.
- Endpoints: POST /healthcheck (API-1), /auth/initiate, /auth/otp/validate, /auth/mpin/update, /auth/login, /auth/mpin/forgot, /auth/mpin/update/reset, /auth/token/refresh, /auth/logout, GET /auth/me.

### 4.2 profile (`src/modules/profile`) — ops 2, 48, 63
- GET /profile (5-view fan-out: PERSONAL_DETAILS_V, EMP_PHONE_V, EMP_IN/OUT_ADDRESS_V, EMP_CONTACT_V + dependent child rows), POST /profile/personal (UPD_PERSONAL_INFO_PR), GET /profile/lov/marital-status.

### 4.3 employee (`src/modules/employee`) — ops 3, 7, 8, 35, 36
- GET /employee/employment (+salary/assignment history), /basic, /performance, /supervisor/views (table function), POST /supervisor (SUPERVISOR_PR; new supervisor must be PERSON_ID).

### 4.4 payslip (`src/modules/payslip`) — ops 5, 6, 11
- GET /payslip/periods, /count, /payslip — PAYSLIP_PR returns 7 REF CURSORs (earnings, deductions, housing, etc.) via `callMultiCursorProc`.

### 4.5 leave (`src/modules/leave`) — ops 9, 10, 12-14, 45-47, 55-58, 61, 62 (+ /leaves history)
- 17 GET/POST endpoints; balance keyed by `?username=` (bound as-is to LEAVE_BALANCE_PR), apply via LeaveApplyBinds builder, amend/cancel/return submits, and a family of LOVs (cancel/amend LOVs support `?leave_type=` filtering on the view's NAME column). `settle()` wrapper gives per-read timeouts with graceful degradation on fan-outs.

### 4.6 letters (`src/modules/letters`) — ops 16, 17
- GET /letters/lov (7 LOVs in parallel), POST /letters/apply (HR_EMPLYMNT_LTR_PR).

### 4.7 identity (`src/modules/identity`) — ops 18, 19, 53b, 54, 59, 60
- QID details/update (QID_DET_V/QID_CHG_PR), company-ID request (COID_REQ_PR), 3 location/reason LOVs.

### 4.8 contact (`src/modules/contact`) — ops 25, 27-30, 32
- Phone upsert (PHONE_PKG.ADD_OR_UPDATE_PHONE — per-phone scalar calls), phone delete, address create/update (date-tracked), phone-type + country LOVs.

### 4.9 dependents (`src/modules/dependents`) — ops 24, 31, 33, 34, 49, 64, 65
- Add/update/delete dependent (ADD_DEPENDENT_PKG), passport types/apply/issue-place. Accepts legacy `p_*` misspellings (`p_gendar`, `p_relation_ship`, …) and mirrors them to canonical names. Strict flexfield requirements documented in DTOs from live verification.

### 4.10 school-fees (`src/modules/school-fees`) — ops 37-40, 50, 52, 53
- Apply (SCHOOL_FEE_PR), 5 LOVs (SCHOOL_NAME_LOV supports search/page/pageSize Oracle-side), children (CHILD_DETS_VIEW table function via `callRowsOrTableFunction`).

### 4.11 appointments (`src/modules/appointments`) — ops 41-44 — **Cerner HTTP, not Oracle**
- Upcoming/masters/booking-init/book through `CernerClient`; hard 503 when `CERNER_BASE_URL` unset (known staging state — environment issue, not code).

### 4.12 annual-ticket (`src/modules/annual-ticket`) — ops 66, 67, 72
- Master LOV, apply (TICKET_REQ_PR — `p_employee` must be PERSON_ID; contractual-year string must exist in HMC_HR_CONTRACTUAL_YEAR_SIT), cancel-options (3-view fan-out) + cancel.

### 4.13 approvals (`src/modules/approvals`) — ops 20-23, 68-71 + RFMI
- Summary/my-requests (`readByResolvedKeyAny` — views key on username OR employee number), worklist (WORKLISTS_V, keyed by USERNAME), action history, dynamic per-service detail views behind the REQUEST_DETAIL_VIEWS allow-list, attachment download (HR_ATTACHMENTS_V), decision/RFMI/reassign procedures.

### 4.14 lookups (`src/lookups`) — shared kernel, ops 15, 26 + generic reads
- GET /lookups/yes-no, /rfmi-user, /lov?lovname=, /master?lookupname=. In-memory cache per (object, lang, username, options) with `LOV_CACHE_TTL_MS` (default 5 min) and request coalescing; dictionary-resolved filter columns (user scoping, search, dataType, leaveType/NAME).

## 5. Backend Core (`src/core`)

- **config**: 15 typed namespaces (app, oracle, devConsole, diagnostics, usersDb, motcSms, sms, auth, cerner, appLaunch, mpin, otp, ldap, entra) + Joi env schema — boot fails fast on invalid env.
- **database**:
  - `OracleService` — single pool, `query`/`call`/`callCursor`/`callMultiCursor`, per-call structured logging into `OracleLogStore` (in-memory ring buffer, `/diagnostics/oracle-logs*`), `ORACLE_CALL_TIMEOUT_MS` + queue timeout so hung statements can't exhaust the pool. Thick mode optional (Instant Client).
  - `OracleSchemaService` — data-dictionary resolution (ALL_TAB_COLUMNS / ALL_ARGUMENTS): key columns for views, full formal-parameter lists (incl. overload scoring) for procedures. This is the project's signature pattern: **never guess Oracle shapes**.
  - `BaseOracleRepository` — `readByResolvedKey[Any|In]` (schema-mismatch degrades to `[]` with a SCHEMA_MISMATCH warning), `callSubmitProc` (OUT contract → `SubmitResult`), `callRowsProc` (REF CURSOR), `callRowsOrTableFunction`, `callMultiCursorProc`, `queryTableFunction`, tolerant `p_` prefix matching.
  - `MssqlService` (Users/Sanaad DB) + `MotcSmsDbService` (MOTC SMS gateway DB, named instance + static port, OTP redaction) — parameterized-only, ping/diagnose.
  - `DiagnosticsController` — oracle-object describe, oracle-logs, two read-only SQL consoles (`assertReadOnlySelect` guard; env-gated; always 403 in production).
- **auth**: JwtStrategy (rejects refresh-typ tokens + revoked jtis), JwtAuthGuard (@Public skip, AUTH_DISABLED dev user), RolesGuard, FunctionAccessGuard (@RequireFunction vs JWT `functions` claim), TokenRevocationService (in-memory jti denylist).
- **http**: ResponseInterceptor (Sanaad envelope + `localizeArTwins` EN/AR collapsing; @SkipEnvelope opt-out), TimeoutInterceptor (REQUEST_TIMEOUT_MS→408), AllExceptionsFilter (classified, safe, bilingual messages), CorrelationIdMiddleware (AsyncLocalStorage), DiagnosticsEnabledGuard (DIAGNOSTICS_ENABLED kill switch → 404 + Swagger strip).
- **audit**: 5-level audit taxonomy → LoggerAuditSink (JSON lines).
- **logging**: ApiLogInterceptor (outermost) → in-memory ApiLogStore + file writer; `/api-logs` REST + HTML dashboard; sensitive-data redaction.
- **dev-console**: `/dev-console` SQL worksheet + object browser + API tester (guard: DEV_CONSOLE_ENABLED, token, prod-disabled).
- **health**: `/health` (ungated liveness) + gated `/health/db`, `/health/users-db`, `/health/motc-sms-db`.

**Global pipeline order (CoreModule):** ValidationPipe → ApiLogInterceptor → AuditInterceptor → TimeoutInterceptor → ResponseInterceptor → JwtAuthGuard → RolesGuard → FunctionAccessGuard → AllExceptionsFilter; CorrelationIdMiddleware on `*`.

## 6. Data Stores (3 + 1 external API)

| Store | Tech | Access | Purpose |
|---|---|---|---|
| Oracle HR (XXHMC_SND_* schema) | Oracle, node-oracledb pool | ~95 allow-listed views/LOVs/procedures (`ORACLE_OBJECTS`) | All 71 business operations |
| Users/Sanaad DB | SQL Server, `mssql` pool | HMC_Sanad_DeviceRegn_tbl, HMC_RHAP_OTP_tbl, app master/downtime/update tables | Device binding, MPIN, legacy OTP, API-1 healthcheck, function access |
| MOTC SMS DB | SQL Server (named instance, port 9001), second `mssql` pool | MOTC_SMS_PushTable (read/write) | OTP store + SMS delivery (insert = send); OTP validation reads it back |
| Cerner | HTTP (axios) | CernerClient | Staff-clinic appointments (ops 41-44) |
| LDAP / Entra ID | ldapts (LDAPS 636) / Microsoft Graph | validate() only (passwordless lookup) | Employee identity + phone for OTP |

No ORM, no entities, no migrations — deliberate: the DB objects are owned by the
legacy Oracle/SQL Server teams; this codebase reads/calls them through
parameterized SQL and dictionary-resolved signatures.

## 7. Authentication (as implemented)

1. `POST /healthcheck` (API-1) — app version/downtime gate (Users DB, env fallback).
2. `POST /auth/initiate` (API-2) — directory lookup (no password) → new-vs-existing user (MPIN store) → OTP generated and INSERTed into MOTC_SMS_PushTable (requestid = MessageID).
3. `POST /auth/otp/validate` (API-3) — validates against the same push table (TTL/resend/attempts/single-use policy from OTP_* env).
4. `POST /auth/mpin/update` (API-4) — first-time MPIN into device table.
5. `POST /auth/login` (API-5) — MPIN verify → directory identity → function access list → **access JWT (1h, jti) + refresh JWT (7d, typ=refresh)**. Claims: sub, username, employeeNumber, roles, functions, name, dept, company (+ full `userdata` when AUTH_STATIC_LOGIN).
6. `POST /auth/token/refresh` — public; verifies + rotates refresh token (one-time use), returns new pair.
7. `POST /auth/logout` — revokes access jti (+ optional refresh) in the in-memory denylist.
8. Gateway validates the access token **locally** (shared JWT_SECRET) and proxies; the backend re-validates and is the revocation enforcement point.

Authorization: roles claim (EMPLOYEE/SUPERVISOR/APPROVER) via RolesGuard; per-function codes via FunctionAccessGuard (@RequireFunction).

## 8. Gateway (HMC_Gateway)

- CoreModule: config+Joi, ThrottlerModule (THROTTLE_LOGIN_LIMIT=5/60s default), shared axios client with backend TLS agent (BACKEND_CA_CERT[_PATH], BACKEND_TLS_REJECT_UNAUTHORIZED), global ValidationPipe + JwtAuthGuard + minimal AllExceptionsFilter, correlation-id middleware.
- AuthController: 7 forwarded @Public journey routes (throttled: otp/validate, login, mpin/forgot, mpin/update/reset, token/refresh) + POST /healthcheck. `/auth/me`, `/auth/logout` intentionally flow through the wildcard (need bearer).
- ProxyController `@All('*')` → ProxyService: forwards `authorization/content-type/accept/accept-language` + correlation id, relays backend responses byte-for-byte; ONLY real network failures become gateway 502/504.
- Health: GET /health (liveness), GET /health/backend (5s probe of backend /health).
- Tests: 16 unit + 5 e2e (mock backend that mints real JWTs).

## 9. Configuration Inventory (backend)

Namespaces → env vars (all documented in `.env.example`): app (PORT, API_PREFIX, CORS, timeouts, LOG_LEVEL, AUTH_DIRECTORY), oracle (ORACLE_*), usersDb (USERS_DB_*), motcSms (MOTC_SMS_DB_* + fixed INSERT column values + OTP_STORE), sms (SMS_*), auth (JWT_*, AUTH_DISABLED, AUTH_STATIC_LOGIN, FUNCTION_ACCESS_*), cerner (CERNER_*), appLaunch (APP_*), mpin/otp policy (MPIN_*, OTP_*), ldap (LDAP_*), entra (ENTRA_*), diagnostics (DIAGNOSTICS_ENABLED), devConsole (DEV_CONSOLE_*). Gateway: GATEWAY_PORT, BACKEND_*, JWT_* (must match backend), THROTTLE_*, AUTH_DISABLED.

Known deployment caveat: docker-compose `environment:` blocks only pass through
the vars they list — newer vars (MOTC_SMS_*, OTP_STORE, DIAGNOSTICS_ENABLED,
AUTH_STATIC_LOGIN) currently reach the container **only via `.env`** (env_file),
not via host-env injection.

## 10. Testing

- Backend: 22 unit-test suites / ~170 tests co-located as `src/**/*.spec.ts` (repositories with mocked pools, guards, utils, OTP stores, auth service). `test:e2e` script exists but **no e2e specs**.
- Gateway: 4 unit suites + 1 real e2e suite (supertest against the app with a mock backend; covers forwarding, auth guard, throttling, 502 mapping).
- No CI/CD pipelines exist in either repo.

## 11. Verified Operational Knowledge (from AGENTS.md — must survive handover)

- Windows dev: `npm` is blocked by PowerShell policy → use `npm.cmd`/`npx.cmd`. Backend `npm run lint` crashes (minimatch issue) → `npx.cmd eslint src --ext .ts`. CRLF working copy → don't run prettier `--fix` on the backend.
- Never re-add `"incremental": true` to tsconfig (stale tsbuildinfo ships incomplete dist).
- `Docs Project/sanaad-api-service-mapping.html` is the source of truth for legacy service params; the DB objects' actual names come from the data dictionary (that's why OracleSchemaService exists).
- Many live-verified Oracle facts (PERSON_ID vs username per procedure, flexfield requirements for op 65/67, date-track rules for addresses, staging DB defects in SCHOOL_FEE_PR/ADD_OR_UPDATE_PHONE) are recorded in AGENTS.md and pinned into DTO docs/Postman examples.

## 12. Gaps / Requires Knowledge Transfer (carried into the handover doc)

- Production infrastructure, deployment process (no CI/CD in repo), server/jumpstation access.
- Real credentials: Oracle, Users DB, MOTC SMS DB (password shared via SMS), LDAP bind account, Entra app secret, JWT production secret, Cerner base URL.
- MOTC_SMS fixed INSERT values (`MOTC_SMS_APP_ID`, `MOTC_SMS_SUBJECT_ID`, priority/language codes) — pending from client.
- Corporate SMS gateway contract for the legacy HTTP adapter (placeholder).
- Business ownership of Oracle procedures / staging DB defects; op-51; Cerner environment.
- README drift (says NestJS 10; some "known gaps" already closed).
