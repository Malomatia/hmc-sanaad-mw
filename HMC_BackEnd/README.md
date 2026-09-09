# HMC Sanaad B2E — NestJS Backend

NestJS + TypeScript backend that re-exposes the **71 Sanaad Business-to-Employee operations** across **14 modules**, wrapping the existing Oracle (`XXHMC_SND_*`) views / packages / stored procedures. Business logic stays in Oracle; this service is a thin **API + orchestration layer** (auth, validation, i18n, response envelope, error mapping).

> Blueprint: see `../Docs_Ai/` (Architecture, Layers, Domains, API, Repository Pattern, Database, ...).

## Stack

- **NestJS v11** (feature-first modules, Clean Architecture per module)
- **node-oracledb 6** (thin mode — no Oracle Instant Client required)
- **@nestjs/config** + Joi env validation
- **@nestjs/swagger** (OpenAPI at `/docs`)
- **@nestjs/jwt / passport-jwt** (bearer guard; op-1 login flow is out-of-band)
- **class-validator / class-transformer** (global `ValidationPipe`)

## Architecture

Each feature module under `src/modules/<name>/` follows Clean Architecture layers:

```
interface/        Presentation — controllers, DTOs, guards, Swagger
application/      Use cases / services — orchestration, mapping to envelope
domain/           Entities, value objects, repository interfaces (ports) — framework-free
infrastructure/   Oracle repository adapters + mappers (Anticorruption Layer)
```

Cross-cutting concerns live in `src/core/` (config, Oracle pool, http filters/interceptors, auth, i18n) and reusable building blocks in `src/shared/`. The generic LOV/master-lookup reader is the shared kernel in `src/lookups/`.

Dependency rule: `interface -> application -> domain`; `infrastructure` implements domain ports (bound by DI token). Feature modules never import each other — shared behaviour goes through `shared/` or `lookups/`.

## Getting started

```bash
# 1. Install deps (Windows PowerShell: use npm.cmd if npm is blocked by execution policy)
npm install

# 2. Configure environment
cp .env.example .env   # then edit ORACLE_* and JWT_SECRET

# 3. Run
npm run start:dev
```

- API base: `http://localhost:443/api/v1`
- Swagger UI: `http://localhost:443/docs`
- Health: `http://localhost:443/api/v1/health`

### Running without Oracle (local dev)

Set `ORACLE_DISABLED=true` to boot without creating the connection pool (data calls will throw a clear 502 until enabled). Set `AUTH_DISABLED=true` to make guards permissive while the auth spec is finalized.

## Response envelope

```jsonc
// read success
{ "result": { }, "opstatus": 0, "status": "success", "httpStatusCode": 200 }
// action (submit) success
{ "status": "success", "successflag": "S", "errormessage": "Success", "result": { } }
// error
{ "status": "error", "opstatus": 1, "errormessage": "ORA-01403: no data found", "httpStatusCode": 400 }
```

## Module ↔ operations

`auth`(1) · `profile`(2,48,63) · `employee`(3,7,8,35,36) · `payslip`(5,6,11) · `leave`(9,10,12,13,14,45,46,47,55,56,57,58,61,62) · `letters`(16,17) · `identity`(18,19,53b,54,59,60) · `contact`(25,27,28,29,30,32) · `dependents`(24,31,33,34,49,64,65) · `school-fees`(37,38,39,40,50,52,53) · `appointments`(41,42,43,44) · `annual-ticket`(66,67) · `approvals`(20,21,22,23,68,69,70,71) · `lookups`(15,26 + generic).

## Known gaps (carried from the blueprint)

- **Login/auth (op 1)** is out-of-band — JWT guard is a placeholder pending the auth spec.
- **Roles/permissions** inferred from approval/supervisor flows (`APPROVER`/`SUPERVISOR`).
- **Oracle bind signatures** are fully known only for a few procedures (e.g. `LEAV_OF_ABSEN_NEW_PR`, `PHONE_PKG.ADD_OR_UPDATE_PHONE`). Adapters for the rest are marked with `TODO(bind)` and throw `NotImplementedException` until captured.
- **Appointments (41-44)** are **Cerner**-backed (not Oracle) — wrapped in an anticorruption client.

## Scripts

| Script | Purpose |
|---|---|
| `npm run start:dev` | Watch-mode dev server |
| `npm run build` | Compile to `dist/` |
| `npm run lint` | ESLint (+ fix) |
| `npm test` | Unit tests (Jest) |
| `npm run depcruise` | Enforce architecture boundaries |
