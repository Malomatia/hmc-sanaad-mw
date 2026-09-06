# Sanaad B2E → NestJS — Technical Knowledge Base

Forward-design documentation for building a **new NestJS backend** that re-exposes the **71 Sanaad Business-to-Employee operations**, wrapping the existing Oracle (`XXHMC_SND_*`) views/stored procedures. Source of truth: `sanaad-api-service-mapping.html` (Service Configuration Document **v1.9**).

## Context
- There is **no existing NestJS code**; this is a **blueprint**, not a reverse-analysis. Review-style sections are written as **target conventions**.
- **Persistence strategy:** NestJS is an API/orchestration layer over the **same Oracle objects** (business logic stays in Oracle). See Repository Pattern.
- **Scope:** documentation only. Numbers: **71 operations**, **14 modules**, **87 Oracle objects**, UAT gateway `https://apigwuat.api.hamad.qa/sanaad`.

## Suggested reading order
1. **Project Structure** — how the codebase is laid out → `Project Structure/README.md`
2. **Architecture** — building blocks + request lifecycle → `Architecture/README.md`
3. **Layers** — Clean Architecture rules → `Layers/README.md`
4. **Domains** — DDD bounded contexts → `Domains/README.md`
5. **API** — endpoint catalog by module → `API/README.md`
6. **Legacy APIs** — per-operation migration mapping → `Legacy APIs/README.md`
7. **Services** / **Repository Pattern** / **Database** — service, data-access, and Oracle contract → `Services/README.md`, `Repository Pattern/README.md`, `Database/README.md`
8. **Dependencies**, **NestJS Review**, **SOLID Review** — coupling + best practices → `Dependencies/README.md`, `NestJS Review/README.md`, `SOLID Review/README.md`
9. **Postman** — importable collection + environment → `Postman/README.md`

## Deliverables map

| Section | Folder | Contents |
|---|---|---|
| Architecture | `Architecture/` | System context, NestJS blocks, Controller→Service→Repo→Oracle lifecycle, envelope |
| API | `API/` | Target `/api/v1` routes by module: method, DTOs, validation, auth, roles, service, repo, Oracle, errors |
| Database | `Database/` | 87 Oracle objects classified + used-by map + conceptual ER (Mermaid) + data-flow |
| Dependencies | `Dependencies/` | Module graph, shared modules, external packages, circular-dep policy |
| Domains | `Domains/` | 14 bounded contexts (subdomain classification, context map, per-domain DDD) |
| Layers | `Layers/` | Presentation/Application/Domain/Infrastructure roles, violations to prevent |
| Legacy APIs | `Legacy APIs/` | Migration blueprint: every op → module/service/repo/Oracle/auth/workflow |
| NestJS Review | `NestJS Review/` | Best-practice conventions checklist |
| Postman | `Postman/` | `*.postman_collection.json` + `*.postman_environment.json` + README (JSON, by design) |
| Project Structure | `Project Structure/` | Folder tree + responsibilities + module anatomy |
| Repository Pattern | `Repository Pattern/` | Thin Oracle adapters (view read / SP call), DI tokens, port inventory |
| Services | `Services/` | Per-module service design, complexity, split/refactor guidance |
| SOLID Review | `SOLID Review/` | SOLID design guidelines with examples |

## Module ↔ operations (quick index)
`auth`(1) · `profile`(2,48,63) · `employee`(3,7,8,35,36) · `payslip`(5,6,11) · `leave`(9,10,12,13,14,45,46,47,55,56,57,58,61,62) · `letters`(16,17) · `identity`(18,19,53b,54,59,60) · `contact`(25,27,28,29,30,32) · `dependents`(24,31,33,34,49,64,65) · `school-fees`(37,38,39,40,50,52,53; 51 out of scope) · `appointments`(41,42,43,44) · `annual-ticket`(66,67) · `approvals`(20,21,22,23,68,69,70,71) · `lookups`(15,26 + generic).

## Known gaps / assumptions (carry into implementation)
- **Login/auth (op 1)** is out-of-band ("Another document provided") — JWT/bearer guard is a placeholder pending the auth spec.
- **Roles/permissions** inferred from approval/supervisor flows (`APPROVER`/`SUPERVISOR`); confirm the real role model.
- **Methods/paths marked `*` / `[path TBD]`** were inferred (source lacked an explicit badge/URL) — confirm against the live gateway.
- **Oracle bind signatures** are fully known only for a few procedures (e.g., `LEAV_OF_ABSEN_NEW_PR`, `PHONE_PKG.ADD_OR_UPDATE_PHONE`); capture the rest during build.
- **Appointments (41–44)** are **Cerner**-backed, not Oracle — wrap in an anticorruption client.

## AI working files
Extraction backbone and progress live in `Docs_Ai/`: `operation-inventory.md` (master table), `progress-checklist.md`, `auth-otp-env-vars.md` (env vars of the reworked 2026-09 auth/OTP journey).

## Source documents (`Docs Project/`)
`sanaad-api-service-mapping.html` (primary, v1.9) · `HMC_SANAD_Implementation Approach_Document_v5.pdf` · `Sanaad_Master_API_Table_and_Summary.pdf` · `Sanaad_API_REVISEDJune__2026-1.pdf` (superseded by the HTML).
