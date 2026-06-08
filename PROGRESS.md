# PROGRESS.md
# Government Workforce Intelligence Platform
# Implementation Maturity Ledger

> This file is the authoritative repository development ledger and operational memory layer.
> It is governed by CLAUDE.md and must be updated on every meaningful repository change.
> Progress is measured as capability maturity across the 11-layer Production Blueprint model,
> not as code presence or documentation completeness alone.

---

Last Updated: 2026-06-08
Updated By: Claude Code (session: Milestone 5 — Authentication Foundation)

## Repository Status

Current Phase: Phase 1 — Foundation (Milestone 5 In Progress — Step 10 In Progress)
Overall Classification: Integrated Foundation — Application live; DB connected; health endpoint serving; API foundation operational; auth endpoints live at /api/v1/auth/*; JWT issuance, validation, guard, HTTP transport, URI versioning, and dev seed complete; unit and e2e tests in progress
Active Sprint / Milestone: Milestone 5 — Authentication Foundation (Step 10 In Progress)
Implementation Started: Yes (2026-06-05)

## Phase Summary

Milestones 1–4 are complete and validated. The NestJS API is running with a full backend foundation: `ConfigModule` validates environment at startup; `PrismaModule` maintains a live PostgreSQL connection pool; `HealthModule` serves `GET /health` returning HTTP 200 with database connectivity confirmation; `main.ts` enforces global `ValidationPipe` (whitelist, forbidNonWhitelisted, transform), `/api` route prefix with `/health` exclusion, URI versioning (`/api/v1/`), and environment-gated Swagger with bearer auth at `GET /api/docs`. `AuditModule` (Milestone 4) is registered globally — `AuditService.logEvent()` is injectable across all domain modules; `AuditEventType` covers 42 events (AUD-200 through AUD-900); `SYSTEM_USER_ID` sentinel established; `result` column added to `audit.audit_events`. 37 unit tests pass across 5 test suites. Milestone 5 (Authentication Foundation — IdentityModule, FR-001, FR-002) is in progress — Steps 1–9 complete and validated; dev seed user (`admin@dev.gov`, Development Agency tenant, System Administrator role) is live in the development DB; Step 10 (unit tests) is next.

---

# Active Execution State — Milestone 5

> This section is updated in place after each approved and validated implementation step.
> Its purpose is crash/session recovery: the current step state is always readable without
> scanning Zone 5 history. It is overwritten each step — not appended.

Milestone: Milestone 5 — Authentication Foundation
Last Completed Step: Step 9 — Dev seed (bcrypt-hashed admin user)
Last Completed Step Date: 2026-06-08
Current Step: Step 10 — Unit tests + PROGRESS.md update — IN PROGRESS
Step 10 Implementation Started: 2026-06-08
Session Classification: In Progress

## Step 10 Recovery Checkpoint

> If execution is interrupted, this section provides a complete recovery path.
> Sub-steps are updated in place as each test file is completed and validated.

### Planned Files

| File | Type | Tests Planned | Sub-step Status |
|------|------|--------------|----------------|
| `apps/api/src/identity/identity.service.spec.ts` | Unit | 15 | Not Started |
| `apps/api/src/identity/auth.service.spec.ts` | Unit | 16 | Not Started |
| `apps/api/src/identity/jwt.strategy.spec.ts` | Unit | 6 | Not Started |
| `apps/api/src/identity/auth.controller.spec.ts` | Unit | 11 | Not Started |
| `apps/api/test/auth.e2e-spec.ts` | E2e | 22 | Not Started |
| `apps/api/test/app.e2e-spec.ts` | E2e | 0 (comment update) | Not Started |

### Validation Targets

| Target | Expected (end of Step 10) |
|--------|--------------------------|
| `npm test` unit tests | 85 tests, 9 suites, EXIT 0 |
| `npm run test:e2e` | 23 tests (22 if seed absent), 2 suites, EXIT 0 |
| `tsc --noEmit` | EXIT 0 after each file |
| `npm run build` | EXIT 0 at final check |

### Recovery Instructions

To resume after an interrupt, read this section to determine which sub-steps are already Complete,
then continue from the first sub-step marked Not Started or In Progress.
Do not recreate files already marked Complete — they are committed to the repository.
After resuming: run `npm test` to confirm current passing count before adding the next file.

## Step Completion Status

| Step | Name | Status | Validated |
|------|------|--------|-----------|
| 1 | Package Dependencies | Complete | Yes |
| 2 | Database Migration | Complete | Yes |
| 3 | LoginDto | Complete | Yes |
| 4 | IdentityModule + IdentityService | Complete | Yes |
| 5 | AuthService (JWT + Audit integration) | Complete | Yes |
| 6 | JwtStrategy + JwtAuthGuard | Complete | Yes |
| 7 | AuthController | Complete | Yes |
| 8 | main.ts — URI versioning | Complete | Yes |
| 9 | Dev seed (bcrypt-hashed admin user) | Complete | Yes |
| 10 | Unit tests + PROGRESS.md update | In Progress | — |

## Step 1 Validation Evidence

- `npm install --workspace=apps/api` (runtime): EXIT 0 — 23 packages added
- `npm install --workspace=apps/api -D` (dev types): EXIT 0 — 4 packages added
- `npm ls` (all 5 runtime packages): resolved without MISSING
- `tsc --noEmit`: EXIT 0 — zero type errors
- `npm test --workspace=apps/api`: EXIT 0 — 37/37 tests pass; 5 suites pass; zero regressions
- `npm run build --workspace=apps/api`: EXIT 0 — zero build errors

## Resolved Package Versions (Step 1)

| Package | Resolved Version |
|---------|-----------------|
| `@nestjs/jwt` | 11.0.2 |
| `@nestjs/passport` | 11.0.5 |
| `passport` | 0.7.0 |
| `passport-jwt` | 4.0.1 |
| `bcrypt` | 6.0.0 |

Dev type packages installed: `@types/passport`, `@types/passport-jwt`, `@types/bcrypt` — versions recorded in `package-lock.json`.

Note: `npm audit` reports 26 vulnerabilities (3 low, 16 moderate, 7 high). These are pre-existing in the workspace dependency tree — the count did not change after installing auth packages. No new vulnerabilities introduced by Step 1. Audit remediation is a separate governance task outside Milestone 5 scope.

## Step 2 Validation Evidence

- `prisma migrate dev --name add_account_lockout`: EXIT 0 — migration `20260608005045_add_account_lockout` created and applied
- Generated SQL reviewed: two `ADD COLUMN` statements only; no `DROP`, no `ALTER COLUMN`, no destructive operations
- `prisma generate`: EXIT 0 — Prisma Client v5.22.0 regenerated; `failedLoginAttempts: number` and `lockedUntil: Date | null` now present on `User` type
- `tsc --noEmit`: EXIT 0 — zero type errors
- `npm test --workspace=apps/api`: EXIT 0 — 37/37 tests pass; 5 suites pass; zero regressions
- `npm run build --workspace=apps/api`: EXIT 0 — zero build errors
- Live DB: migration `20260608005045_add_account_lockout` applied to `gov_workforce_dev`; columns confirmed in `identity.users`

## Step 2 — Lockout Column Behavior Contract

These columns implement the lockout policy from `spec/07_security_architecture.md` (5 failed attempts → 15-minute lock).
`IdentityService` (Step 4) is the sole writer of these columns.

| Column | Reset on Successful Login | Set on Lockout Threshold |
|--------|--------------------------|-------------------------|
| `failed_login_attempts` | Reset to `0` | Incremented per failure; triggers lockout at `5` |
| `locked_until` | Cleared to `NULL` | Set to `NOW() + INTERVAL '15 minutes'` |

Both columns are updated atomically in the same `prisma.user.update()` call on successful login.
Neither column is exposed in any API response. They are internal authentication state only.

## Step 3 Validation Evidence

- `tsc --noEmit`: EXIT 0 — `LoginDto`, `@IsEmail`, `@MaxLength`, `@IsString`, `@IsNotEmpty`, `@ApiProperty` all resolve without error
- `npm test --workspace=apps/api`: EXIT 0 — 37/37 tests pass; 5 suites pass; zero regressions
- `npm run build --workspace=apps/api`: EXIT 0 — `LoginDto` compiles cleanly; no errors

## Step 3 — LoginDto Design Decisions

| Decision | Value | Rationale |
|----------|-------|-----------|
| `email @MaxLength(254)` | Included | RFC 5321 limit; aligns with `identity.users.email VarChar(255)`; explicit over implicit |
| `password @MaxLength(1000)` | Included | Prevents bcrypt DoS via extremely long inputs |
| `password @MinLength` | Omitted | Complexity rules apply at creation, not login; enforcing at login reveals requirements and could block legacy passwords |
| `tenantId` field | Omitted | Derived from JWT post-login; client never supplies tenant identity (approved Phase 1 design) |
| `@ApiProperty()` on both fields | Included | HTTP-facing DTO; Swagger UI reflects spec contract examples |
| Standalone unit test | Deferred | Runtime validation tested at `AuthController` layer in Step 10; same pattern as `CreateAuditEventDto` |

## Step 4 Validation Evidence

- `tsc --noEmit`: EXIT 0 — `IdentityService`, `UserWithRoles` (Prisma utility type), `IdentityValidationResult` discriminated union, `bcrypt` types all resolve without error
- `npm test --workspace=apps/api`: EXIT 0 — 37/37 tests pass; 5 suites pass; zero regressions
- `npm run build --workspace=apps/api`: EXIT 0 — `IdentityModule` and `IdentityService` compile cleanly
- `npm run test:e2e --workspace=apps/api`: EXIT 0 — 1/1 pass; `AppModule` bootstraps with `IdentityModule` registered; `IdentityService` resolves `PrismaService` from global scope

## Step 4 — IdentityService Design Decisions

| Decision | Value | Rationale |
|----------|-------|-----------|
| `findMany` (not `findFirst`) for email lookup | Used | Enables TENANT_COLLISION detection when `users.length > 1` |
| `deletedAt: null` filter | Applied | Soft-deleted users are excluded; receive same `EMAIL_NOT_FOUND` result |
| Status filter (`status: 'ACTIVE'`) | Deferred | Phase 2 gap — INVITED/SUSPENDED users get 401; seed user (Step 9) is ACTIVE |
| `failedLoginAttempts` reset on lockout expiry | Not implemented | Step 2 contract names successful login as the sole reset trigger; conservative posture for government platform |
| `LOCKOUT_THRESHOLD = 5` | Named constant | Spec source traceable; single change point |
| `LOCKOUT_DURATION_MS = 15 * 60 * 1000` | Named constant | Spec source traceable; single change point |
| `UserWithRoles` via `Prisma.UserGetPayload` | Utility type | Compile-time safe; no manual interface duplication |
| Permission loading in JWT payload | Deferred to Phase 2 | Roles only in Phase 1 JWT; permission loading added when RBAC guard implemented |
| AppModule registration in Step 4 | Yes | Follows AuditModule pattern; e2e bootstrap confirms module loads with global PrismaService |

## Step 5 Validation Evidence

- `tsc --noEmit`: EXIT 0 — zero type errors; `AuthService`, `JwtPayload`, `LoginResult`, `SYSTEM_TENANT_ID`, `JWT_ACCESS_EXPIRES_IN_SECONDS` all resolve correctly
- `npm run build --workspace=apps/api`: EXIT 0 — `identity.constants.ts`, `auth.service.ts`, `identity.module.ts` compile cleanly
- `npm test --workspace=apps/api`: EXIT 0 — 37/37 tests pass across 5 suites; zero regressions
- `npm run test:e2e --workspace=apps/api`: EXIT 0 — 1/1 pass; `AppModule` bootstraps with `IdentityModule` registered; `AuthService` resolves `JwtService` (from `JwtModule.registerAsync`), `IdentityService`, and `AuditService` (from global `AuditModule`) without error

## Step 9 Validation Evidence

- `npm run build --workspace=apps/api`: EXIT 0 — `import * as bcrypt from 'bcrypt'`, Prisma compound keys `tenantId_email` and `userId_roleId`, and `findUniqueOrThrow` all resolve without error
- `npm test --workspace=apps/api`: EXIT 0 — 37/37 tests pass; 5 suites; zero regressions
- `npm run test:e2e --workspace=apps/api`: EXIT 0 — 1/1 pass; `AppModule` bootstraps correctly; seed changes do not affect application startup
- Seed run 1 (`NODE_ENV=development`): EXIT 0 — Tenant `Development Agency` created (id: `a4c143d8-...`); User `admin@dev.gov` created (id: `ee52bdf1-...`); Role `System Administrator` assigned
- Seed run 2 (`NODE_ENV=development`): EXIT 0 — Same tenant and user UUIDs returned; upserts executed update clause; no duplicate records created (idempotency confirmed)
- Guard check — `NODE_ENV` unset: "Dev user seed skipped — not in development environment." (EXIT 0; roles seeded; user section skipped)
- Guard check — `NODE_ENV=production`: "Dev user seed skipped — not in development environment." (EXIT 0; roles seeded; user section skipped)
- Guard check — `NODE_ENV=staging`: "Dev user seed skipped — not in development environment." (EXIT 0; roles seeded; user section skipped)
- DB state verified: `status: ACTIVE`, `failedLoginAttempts: 0`, `lockedUntil: null`, `tenant.code: DEV`, `role: System Administrator`
- Recovery behavior verified: simulated lockout (`failedLoginAttempts: 5`, `lockedUntil: future`, `status: INVITED`); re-seed with `NODE_ENV=development` restored `status: ACTIVE`, `failedLoginAttempts: 0`, `lockedUntil: null`

## Step 9 — Dev Seed Design Decisions

| Decision | Value | Rationale |
|----------|-------|-----------|
| Re-seed behavior | Recovery-oriented — `update` clause resets `passwordHash`, `failedLoginAttempts`, `lockedUntil`, `status` | Lockout testing will break an immutable fixture silently; recovery must be one-command without manual SQL |
| Development safeguard | Allowlist: `NODE_ENV !== 'development'` → skip | Default-deny; unknown/unset environments are safe; exclusion-list approach (`NODE_ENV === 'production'`) has staging/CI failure modes |
| bcrypt rounds | 12 | Consistent with spec/07_security_architecture.md and `IdentityService` |
| Seed email | `admin@dev.gov` | `.gov` TLD signals government context; clearly dev-scoped |
| Seed password | `DevAdmin1234!` | 13 chars; satisfies spec/07 requirements (uppercase, lowercase, number, special); clearly dev-only naming |
| `findUniqueOrThrow` for role | Hard failure if role missing | Makes seed ordering dependency visible immediately rather than creating a user with no role assignment silently |
| Plaintext password in source | Dev fixture pattern; acceptable | Not a production secret; no value outside dev DB; hashed before storage; dev credential committed per standard seed pattern; documented and auditable |

## Step 8 Validation Evidence

- `tsc --noEmit`: EXIT 0 — `VersioningType` import and `enableVersioning({ type: VersioningType.URI })` call resolve without error
- `npm run build --workspace=apps/api`: EXIT 0 — zero build errors
- `npm test --workspace=apps/api`: EXIT 0 — 37/37 tests pass; 5 suites; zero regressions
- `npm run test:e2e --workspace=apps/api`: EXIT 0 — 1/1 pass; `AppModule` bootstraps correctly with URI versioning active

## Step 7 Validation Evidence

- `tsc --noEmit`: EXIT 0 — `AuthController`, `CurrentUser` decorator, `LoginResponseDto`, all imports resolve without error
- `npm run build --workspace=apps/api`: EXIT 0 — zero build errors
- `npm test --workspace=apps/api`: EXIT 0 — 37/37 tests pass; 5 suites; zero regressions
- `npm run test:e2e --workspace=apps/api`: EXIT 0 — 1/1 pass; `AppModule` bootstrap confirms `AuthController` is registered in `IdentityModule`; all route handlers, guard bindings, and decorator dependencies resolve via DI

## Step 7 — AuthController Design Decisions

| Decision | Value | Rationale |
|----------|-------|-----------|
| `tenantId` omitted from `GET /auth/me` | Omitted | Spec contract (`spec/06_api_contracts.md`) does not include it; clients never supply or reference `tenantId` explicitly; server-side enforcement model makes client-side `tenantId` awareness unnecessary |
| User enumeration protection | All failure outcomes produce identical 401 body | `AuthService` collapses `EMAIL_NOT_FOUND`, `ACCOUNT_LOCKED`, `INVALID_PASSWORD` → `UNAUTHORIZED`; controller maps to one body — no information leakage about failure cause |
| `@HttpCode(200)` on `POST /auth/logout` | Explicit | NestJS default for POST is 201; spec contract expects 200 for logout |
| `@CurrentUser()` custom decorator | Created in `decorators/current-user.decorator.ts` | Avoids coupling route handlers to the raw Express `Request` type; cleaner parameter signature |
| `@ApiBearerAuth()` on protected routes | Applied now | Metadata present for Swagger rendering; `DocumentBuilder.addBearerAuth()` in `main.ts` (Step 8) completes the Swagger UI display |
| `version: '1'` in `@Controller` | Applied now | Route annotation in place; `/api/v1/` prefix activates after `app.enableVersioning()` in Step 8; before Step 8 routes accessible at `/api/auth/*` |
| No direct `AuditService` call | Correct separation | All audit events (`AUTH_LOGIN_SUCCESS`, `AUTH_LOGIN_FAILURE`, `AUTH_ACCOUNT_LOCKOUT`, `AUTH_LOGOUT`) emitted inside `AuthService`; controller is HTTP transport only |

## Step 6 Validation Evidence

- `tsc --noEmit`: EXIT 0 — `JwtStrategy` (PassportStrategy generic, `RequestUser`, `JwtPayload` import), `JwtAuthGuard` (AuthGuard('jwt') extension), and `identity.module.ts` additions all resolve without error
- `npm run build --workspace=apps/api`: EXIT 0 — zero build errors
- `npm test --workspace=apps/api`: EXIT 0 — 37/37 tests pass; 5 suites pass; zero regressions
- `npm run test:e2e --workspace=apps/api`: EXIT 0 — 1/1 pass; `AppModule` bootstrap confirms `JwtStrategy` resolves `ConfigService` from global `ConfigModule`; `JwtAuthGuard` resolves as a provider from `IdentityModule`

## Step 6 — Deviation From Presentation

One deviation from the approved presentation occurred during implementation:

| Deviation | Cause | Fix Applied |
|-----------|-------|-------------|
| `config.get<string>('JWT_SECRET')` typed as `string \| undefined` — not assignable to `secretOrKey: string \| Buffer` | TypeScript strict mode; `ConfigService.get<T>()` returns `T \| undefined` by design | Added non-null assertion: `config.get<string>('JWT_SECRET')!` — safe because `env.validation.ts` aborts startup if `JWT_SECRET` is absent or empty, guaranteeing the value exists at strategy construction time |

The non-null assertion follows the same pattern used by `JwtModule.registerAsync` in `identity.module.ts` for the same value. It does not introduce a runtime risk.

## Step 6 — JwtStrategy + JwtAuthGuard Design Decisions

| Decision | Value | Rationale |
|----------|-------|-----------|
| `validate()` performs no DB call | Pure payload mapping | JWT is self-contained for Phase 1; role data baked in at login; DB round-trip per request is unnecessary overhead |
| `tenantId` from `payload.tenantId` only | `RequestUser.tenantId = payload.tenantId` | Structural enforcement of SEC-003: tenant isolation contract; no code path allows caller-supplied tenantId |
| `ignoreExpiration: false` | Default — expired tokens rejected | Passport-jwt handles expiry before `validate()` is called; no additional check needed |
| `JwtAuthGuard` in providers AND exports | Both registered | Correctness: export of an unregistered provider is a no-op in NestJS DI; registered in providers so NestJS owns the lifecycle and future constructor dependencies require no module change |
| `JwtAuthGuard` not global | Per-route application | Phase 1 has two protected endpoints; global guard would require `@Public()` exemptions on `/health` and `POST /auth/login`; per-route is simpler |
| `!` non-null assertion on `JWT_SECRET` | Startup gate guarantees presence | `env.validation.ts` aborts before any module initialises if `JWT_SECRET` is absent; assertion is safe and communicates the contract |
| Flat file placement | `jwt.strategy.ts`, `jwt-auth.guard.ts` in `src/identity/` | Consistent with existing module files; subdirectory deferred until a second strategy or guard warrants it |

## Step 5 Remediation Evidence

During Step 5 validation, two test-environment defects were identified and resolved:

| Defect | Classification | Root Cause | Fix Applied |
|--------|---------------|------------|-------------|
| `env.validation.spec.ts` — 6 tests failing | Test-environment defect | `JWT_SECRET` added as required field but 6 valid test payloads were not updated to include it | Added `JWT_SECRET: 'test-jwt-secret'` to 6 positive test payloads; negative-case tests unchanged |
| `app.e2e-spec.ts` — 1 test failing | Configuration defect | `apps/api/.env` (created in Milestone 2 for Prisma CLI use) contained only `DATABASE_URL`; `JWT_SECRET` was added to root `.env` only; dotenv resolves from `apps/api/` during Jest execution | Added `JWT_SECRET` to `apps/api/.env` matching the value in root `.env` |

Neither defect was in production code. Both fixes are within Step 5 scope. No architectural decisions required.

## Step 5 — AuthService Design Decisions

| Decision | Value | Rationale |
|----------|-------|-----------|
| Transport-agnostic `LoginResult` | No HTTP exceptions thrown; no HTTP responses returned | AuthService may be called from any transport; HTTP mapping is `AuthController`'s sole responsibility (Step 7) |
| `SYSTEM_TENANT_ID` sentinel | Zero UUID — same value as `SYSTEM_USER_ID`; distinct semantic meaning | `EMAIL_NOT_FOUND` has no resolvable tenant; zero UUID preserves AUD-100 required-field contract without nullable column; distinct name prevents semantic confusion |
| `identity.constants.ts` as single source of truth | `JWT_ACCESS_EXPIRES_IN_SECONDS = 3600` | `JwtModule.registerAsync` and `AuthService` login response both consume the same constant; drift between the two values is compile-time impossible |
| `TENANT_COLLISION` → no audit event | `{ outcome: 'INTERNAL_ERROR' }` returned immediately | No valid `userId` or `tenantId` exists to attach to an audit record; `IdentityService` already logged the collision (no PII) |
| AUTH_ACCOUNT_LOCKOUT emitted after AUTH_LOGIN_FAILURE | Both events emitted on 5th consecutive failure | AUTH_LOGIN_FAILURE is the immediate event (password was wrong); AUTH_ACCOUNT_LOCKOUT is the state transition; ordering is intentional |
| `logout()` accepts `userId` and `tenantId` as parameters | Caller supplies values derived from JWT | AuthService has no access to the request context; AuthController (Step 7) extracts these from the validated JWT payload via JwtAuthGuard |

## Open Architectural Decision: User Identity Model

**Status:** Open — not a blocker for Phase 1 or Milestone 5

**Must be resolved before:** FR-001 (User Registration) and Phase 2 tenant-aware login implementation

**Background:** The database enforces per-tenant email uniqueness only (`@@unique([tenantId, email])`). The same email address is permitted across different tenants. Phase 1 global email lookup is safe only because a single tenant exists. When a second tenant is onboarded, the `TENANT_COLLISION` guard becomes load-bearing until Phase 2 tenant-aware login is implemented.

**Option A — Global email uniqueness (application-enforced)**
The user creation service (`FR-001`) checks that the email does not exist in any tenant before inserting. One email = one person across all agencies. Appropriate if the platform treats employees as platform-wide entities who may serve across multiple agencies.

**Option B — Tenant-scoped email uniqueness (DB-enforced)**
The user creation service checks uniqueness only within the tenant. Same email can exist in multiple tenants. Requires Phase 2 tenant-aware login (tenant discriminator in `LoginDto`) as a hard prerequisite before a second tenant is onboarded.

**Decision owner:** Product / compliance review before FR-001 implementation

---

# Zone 1 — Global Platform Acceptance Criteria

Source: spec/01_requirements.md — Global Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | All traceable requirements implemented | Not Started | — |
| 2 | Tenant isolation validated | Not Started | — |
| 3 | Audit logging operational | In Progress | AuditService.logEvent() operational; AuditModule registered globally; 42-event taxonomy defined; no domain module calls logEvent() yet |
| 4 | RBAC enforced | Not Started | — |
| 5 | AI recommendations remain advisory | Not Started | — |
| 6 | Compliance controls functioning | Not Started | — |
| 7 | Forecasting and analytics explainable | Not Started | — |
| 8 | Documentation complete | Satisfied | All 12 blueprint layers documented |
| 9 | Tests pass | In Progress | 37 unit tests passing across 5 suites (platform-roles, env-validation, prisma-service, health-controller, audit-service); integration and E2E tests pending domain implementation |
| 10 | No critical security issues | In Progress | Sensitive data (DATABASE_URL, passwords) confirmed absent from logs, health responses, and Swagger output; full security review deferred to Milestone 6+ |

**Platform Acceptance: NOT MET** (1 of 10 criteria satisfied — criteria 3 and 9 progressed to In Progress)

---

# Zone 2 — Capability Maturity Index

> This table is the at-a-glance current state of all 15 domains.
> It must be updated every session in which implementation work occurs.

| Domain | ID | FRs | Overall Maturity | Code | Tests | Critical Notes |
|--------|----|-----|-----------------|------|-------|----------------|
| Identity & Access | D-001 | 5 | Scaffolded | DB layer live; PrismaService available globally; ConfigService available globally; no identity business logic | 6 unit tests (role set) | Infrastructure foundation ready; IdentityModule implemented Milestone 6 |
| Organization Management | D-002 | 4 | Scaffolded | DB layer live; PrismaService available; no org business logic | None | Required before Employee and Workforce domains |
| Employee Management | D-003 | 5 | Planned | None | None | No dedicated directive — gap |
| Workforce Planning | D-004 | 4 | Planned | None | None | — |
| Scheduling | D-005 | 3 | Planned | None | None | — |
| Talent Acquisition | D-006 | 4 | Planned | None | None | No dedicated hiring state file |
| Workforce Intelligence | D-007 | 4 | Planned | None | None | Depends on AI Governance constraints |
| Skills & Certifications | D-008 | 4 | Planned | None | None | No dedicated state model |
| Compliance & Governance | D-009 | 3 | Partially Implemented | AuditModule @Global() registered; AuditService.logEvent() writes to audit.audit_events; SYSTEM_USER_ID sentinel; AuditEventType (42 values); CreateAuditEventDto; result column in schema | 11 unit tests (AuditService: write path, AUD-1300 suppression, PII restriction, SYSTEM_USER_ID) | Domain callers not yet wired (Milestone 5+); FR-501/FR-502 remain Planned; retention directive conflict documented (AUD-1200 7yr vs data/03 10yr — 10yr applied) |
| Approval Management | D-010 | 4 | Planned | None | None | — |
| Notification Management | D-011 | 4 | Planned | None | None | No dedicated state model |
| Reporting & Intelligence | D-012 | 14 | Planned | None | None | No dedicated directive — gap |
| AI Governance | D-013 | 5 | Planned | None | None | Cross-cutting architectural constraint; FR-903 is non-negotiable |
| Workforce Readiness | D-014 | 3 | Planned | None | None | Depends on D-007 |
| Integrations | D-015 | 3 | Planned | None | None | No dedicated directive — gap |

**Total FRs: 69 | Implemented: 0 | Tested: 0 | Verified: 0**

---

# Zone 3 — Domain Capability Detail

> Each domain card uses the 11-layer Production Blueprint maturity format.
> Cards are updated as implementation progresses.
> "Specified (docs only)" means a specification document exists; no executable code or running service exists.

---

## Domain: Identity & Access (D-001)

**Dependency note:** All other domains depend on this domain being at least Integrated before they can reach Verified. RBAC, session management, and tenant isolation are prerequisites for system-wide integration testing.

| FR | Title | Maturity |
|----|-------|----------|
| FR-001 | User Registration | Planned |
| FR-002 | User Authentication | Planned |
| FR-003 | Role-Based Authorization | Planned |
| FR-004 | Session Management | Planned |
| FR-005 | Tenant Isolation | Planned |

- Capability: Identity & Access
- Deliverable Status: Required
- Requirements: Defined — spec/01_requirements.md (FR-001 through FR-005)
- Specs: Defined — spec/07_security_architecture.md, spec/03_system_architecture.md
- Directives: Present and aligned — directives/10_role_based_access_rules.md (updated 2026-06-05: role set aligned with spec)
- Execution Plan: Planned — execution/02_phase_1_foundation.md (updated 2026-06-05: role seed list aligned)
- State Model: Partially derivable — no dedicated identity state document; user lifecycle (Invited → Active → Suspended → Deactivated) defined in spec/04_domain_model.md; session states not yet formalized
- Test Scenarios: Specified (docs only) — tests/04_security_tests.md; no executable tests
- System Loop: Specified (docs only) — runtime/01_runtime_orchestration.md; not implemented
- Failure Playbook: Specified (docs only) — failure/01_failure_playbook.md; not integrated
- Environment Model: Specified (docs only) — environment/01_environment_strategy.md; not validated
- Data Lifecycle: Specified (docs only) — data/06_pii_handling.md; not implemented
- Evolution Strategy: Specified (docs only) — evolution/01_versioning_strategy.md; not formalized for auth
- Overall Maturity: **Planned**
- Remaining Gaps: All implementation; no auth service, no RBAC enforcement, no session management code, no tenant isolation logic, no executable security tests; session states not yet in a dedicated state document
- Next Recommended Step: Begin Phase 1 Foundation — monorepo scaffold, then FR-001 (User Registration) and FR-002 (User Authentication)

---

## Domain: Organization Management (D-002)

**Dependency note:** Agency and department hierarchy must exist before Employee Management or Workforce Planning records can be associated to an organizational unit.

| FR | Title | Maturity |
|----|-------|----------|
| FR-050 | Agency Management | Planned |
| FR-051 | Department Management | Planned |
| FR-052 | Organizational Hierarchy | Planned |
| FR-053 | Cost Center Management | Planned |

- Capability: Organization Management
- Deliverable Status: Required
- Requirements: Defined — spec/01_requirements.md (FR-050 through FR-053)
- Specs: Defined — spec/04_domain_model.md, spec/05_database_schema.md
- Directives: Partial — directives/11_government_policy_rules.md covers policy; no dedicated organization management directive exists
- Execution Plan: Planned — execution/02_phase_1_foundation.md
- State Model: Not yet formalized — no organization hierarchy or agency state lifecycle document exists
- Test Scenarios: Specified (docs only) — tests/01_acceptance_tests.md; no executable tests
- System Loop: Specified (docs only) — runtime/01_runtime_orchestration.md; not implemented
- Failure Playbook: Specified (docs only) — failure/01_failure_playbook.md; not integrated
- Environment Model: Specified (docs only) — environment/01_environment_strategy.md; not validated
- Data Lifecycle: Specified (docs only) — data/01_data_lifecycle.md; not implemented
- Evolution Strategy: Specified (docs only) — evolution/01_versioning_strategy.md; not formalized
- Overall Maturity: **Planned**
- Remaining Gaps: All implementation; no agency/department CRUD, no hierarchy traversal logic, no cost center association, no dedicated directive, no state lifecycle document, no executable tests
- Next Recommended Step: Author a dedicated organization management directive; implement FR-050 (Agency Management) and FR-051 (Department Management) in Phase 1 Foundation

---

## Domain: Employee Management (D-003)

| FR | Title | Maturity |
|----|-------|----------|
| FR-110 | Employee Profile Management | Planned |
| FR-111 | Employee Lifecycle Management | Planned |
| FR-112 | Employee Availability Management | Planned |
| FR-113 | Employee Skill Assignment | Planned |
| FR-114 | Employee Certification Assignment | Planned |

- Capability: Employee Management
- Deliverable Status: Required
- Requirements: Defined — spec/01_requirements.md (FR-110 through FR-114)
- Specs: Defined — spec/04_domain_model.md, spec/05_database_schema.md
- Directives: **Missing** — no dedicated employee management directive exists; this is a known gap
- Execution Plan: Planned — execution/03_phase_2_core_workforce_platform.md
- State Model: Present — state/02_employee_lifecycle.md covers employee lifecycle states (Active, Leave, Suspended, Terminated, Retired)
- Test Scenarios: Specified (docs only) — tests/01_acceptance_tests.md; no executable tests
- System Loop: Specified (docs only) — runtime/01_runtime_orchestration.md; not implemented
- Failure Playbook: Specified (docs only) — failure/01_failure_playbook.md; not integrated
- Environment Model: Specified (docs only) — environment/01_environment_strategy.md; not validated
- Data Lifecycle: Specified (docs only) — data/01_data_lifecycle.md, data/06_pii_handling.md; not implemented
- Evolution Strategy: Specified (docs only) — evolution/01_versioning_strategy.md; not formalized
- Overall Maturity: **Planned**
- Remaining Gaps: All implementation; missing employee management directive (must be authored before implementation); no profile CRUD, no lifecycle state machine, no availability logic, no skill/certification assignment code, no executable tests
- Next Recommended Step: Author directives/12_employee_management_rules.md before implementing any FR in this domain

---

## Domain: Workforce Planning (D-004)

| FR | Title | Maturity |
|----|-------|----------|
| FR-100 | Position Management | Planned |
| FR-103 | Vacancy Management | Planned |
| FR-105 | Workforce Forecasting | Planned |
| FR-106 | Coverage Analysis | Planned |

- Capability: Workforce Planning
- Deliverable Status: Required
- Requirements: Defined — spec/01_requirements.md (FR-100, FR-103, FR-105, FR-106)
- Specs: Defined — spec/04_domain_model.md, spec/05_database_schema.md
- Directives: Present — directives/01_workforce_forecasting_rules.md, directives/02_position_management_rules.md, directives/03_vacancy_management_rules.md
- Execution Plan: Planned — execution/03_phase_2_core_workforce_platform.md
- State Model: Present — state/01_position_lifecycle.md, state/04_forecast_lifecycle.md
- Test Scenarios: Specified (docs only) — tests/02_forecasting_tests.md, tests/01_acceptance_tests.md; no executable tests
- System Loop: Specified (docs only) — runtime/01_runtime_orchestration.md; not implemented
- Failure Playbook: Specified (docs only) — failure/01_failure_playbook.md; not integrated
- Environment Model: Specified (docs only) — environment/01_environment_strategy.md; not validated
- Data Lifecycle: Specified (docs only) — data/01_data_lifecycle.md; not implemented
- Evolution Strategy: Specified (docs only) — evolution/01_versioning_strategy.md; not formalized
- Overall Maturity: **Planned**
- Remaining Gaps: All implementation; no position CRUD, no vacancy tracking, no forecasting engine, no coverage calculation logic, no executable tests
- Next Recommended Step: Implement FR-100 (Position Management) in Phase 2 after Foundation domains are integrated

---

## Domain: Scheduling (D-005)

| FR | Title | Maturity |
|----|-------|----------|
| FR-200 | Schedule Creation | Planned |
| FR-202 | Employee Assignment | Planned |
| FR-204 | Schedule Optimization | Planned |

- Capability: Scheduling
- Deliverable Status: Required
- Requirements: Defined — spec/01_requirements.md (FR-200, FR-202, FR-204)
- Specs: Defined — spec/04_domain_model.md, spec/05_database_schema.md
- Directives: Present — directives/04_scheduling_rules.md
- Execution Plan: Planned — execution/03_phase_2_core_workforce_platform.md
- State Model: Present — state/03_schedule_lifecycle.md
- Test Scenarios: Specified (docs only) — tests/03_scheduling_tests.md; no executable tests
- System Loop: Specified (docs only) — runtime/03_scheduler_engine.md; not implemented
- Failure Playbook: Specified (docs only) — failure/01_failure_playbook.md; not integrated
- Environment Model: Specified (docs only) — environment/01_environment_strategy.md; not validated
- Data Lifecycle: Specified (docs only) — data/01_data_lifecycle.md; not implemented
- Evolution Strategy: Specified (docs only) — evolution/01_versioning_strategy.md; not formalized
- Overall Maturity: **Planned**
- Remaining Gaps: All implementation; no schedule creation logic, no assignment validation, no optimization engine, no executable tests
- Next Recommended Step: Implement FR-200 (Schedule Creation) in Phase 2 after Employee and Workforce Planning domains are integrated

---

## Domain: Talent Acquisition (D-006)

| FR | Title | Maturity |
|----|-------|----------|
| FR-300 | Candidate Intake | Planned |
| FR-302 | Resume Processing | Planned |
| FR-303 | Candidate Matching | Planned |
| FR-304 | Hiring Workflow | Planned |

- Capability: Talent Acquisition
- Deliverable Status: Required
- Requirements: Defined — spec/01_requirements.md (FR-300, FR-302, FR-303, FR-304)
- Specs: Defined — spec/04_domain_model.md, spec/05_database_schema.md
- Directives: Partial — directives/05_skill_matching_rules.md covers candidate matching; no dedicated talent acquisition or hiring workflow directive exists
- Execution Plan: Planned — execution/04_phase_3_recruiting_and_staffing.md
- State Model: Not yet formalized — hiring workflow states (Applied → Hired/Rejected) are defined in the spec but no dedicated hiring state lifecycle document exists; state/02_employee_lifecycle.md covers post-hire only
- Test Scenarios: Specified (docs only) — tests/01_acceptance_tests.md; no executable tests
- System Loop: Specified (docs only) — runtime/01_runtime_orchestration.md; not implemented
- Failure Playbook: Specified (docs only) — failure/01_failure_playbook.md; not integrated
- Environment Model: Specified (docs only) — environment/01_environment_strategy.md; not validated
- Data Lifecycle: Specified (docs only) — data/01_data_lifecycle.md, data/06_pii_handling.md; candidate PII lifecycle not specifically addressed
- Evolution Strategy: Specified (docs only) — evolution/01_versioning_strategy.md; not formalized
- Overall Maturity: **Planned**
- Remaining Gaps: All implementation; missing dedicated hiring workflow state document; no candidate CRUD, no resume parsing, no matching algorithm, no hiring state machine, no executable tests
- Next Recommended Step: Author state/07_hiring_workflow_states.md and a dedicated talent acquisition directive before implementing FR-304

---

## Domain: Workforce Intelligence (D-007)

| FR | Title | Maturity |
|----|-------|----------|
| FR-400 | Demand Forecasting | Planned |
| FR-401 | Vacancy Risk Prediction | Planned |
| FR-402 | Attrition Prediction | Planned |
| FR-404 | Executive Workforce Analytics | Planned |

- Capability: Workforce Intelligence
- Deliverable Status: Required
- Requirements: Defined — spec/01_requirements.md (FR-400, FR-401, FR-402, FR-404)
- Specs: Defined — spec/11_ai_architecture.md, spec/04_domain_model.md
- Directives: Present — directives/01_workforce_forecasting_rules.md, directives/06_attrition_scoring_rules.md
- Execution Plan: Planned — execution/05_phase_4_workforce_intelligence.md
- State Model: Present — state/04_forecast_lifecycle.md
- Test Scenarios: Specified (docs only) — tests/02_forecasting_tests.md, tests/08_ai_validation_tests.md; no executable tests
- System Loop: Specified (docs only) — runtime/04_ai_inference_pipeline.md; not implemented
- Failure Playbook: Specified (docs only) — failure/03_ai_failure_modes.md; not integrated
- Environment Model: Specified (docs only) — environment/01_environment_strategy.md; not validated
- Data Lifecycle: Specified (docs only) — data/01_data_lifecycle.md; not implemented
- Evolution Strategy: Specified (docs only) — evolution/01_versioning_strategy.md; not formalized
- Overall Maturity: **Planned**
- Remaining Gaps: All implementation; AI Governance (D-013) constraints must be enforced before any model is built; no forecasting engine, no risk scoring, no attrition model, no analytics pipeline, no executable tests
- Next Recommended Step: Do not begin until D-013 AI Governance is at least Scaffolded; then implement FR-400 (Demand Forecasting) first

---

## Domain: Skills & Certification Management (D-008)

| FR | Title | Maturity |
|----|-------|----------|
| FR-150 | Skill Management | Planned |
| FR-151 | Certification Management | Planned |
| FR-152 | Competency Framework | Planned |
| FR-153 | Certification Expiration Tracking | Planned |

- Capability: Skills & Certification Management
- Deliverable Status: Required
- Requirements: Defined — spec/01_requirements.md (FR-150 through FR-153)
- Specs: Defined — spec/04_domain_model.md, spec/05_database_schema.md
- Directives: Present — directives/05_skill_matching_rules.md
- Execution Plan: Planned — execution/03_phase_2_core_workforce_platform.md
- State Model: Not yet formalized — no skill or certification state lifecycle document exists
- Test Scenarios: Specified (docs only) — tests/01_acceptance_tests.md; no executable tests
- System Loop: Specified (docs only) — runtime/01_runtime_orchestration.md; not implemented
- Failure Playbook: Specified (docs only) — failure/01_failure_playbook.md; not integrated
- Environment Model: Specified (docs only) — environment/01_environment_strategy.md; not validated
- Data Lifecycle: Specified (docs only) — data/01_data_lifecycle.md; expiration and renewal lifecycle not specifically addressed
- Evolution Strategy: Specified (docs only) — evolution/01_versioning_strategy.md; not formalized
- Overall Maturity: **Planned**
- Remaining Gaps: All implementation; no skill catalog, no certification registry, no competency model, no expiration tracking or alert logic, no state lifecycle document, no executable tests
- Next Recommended Step: Implement FR-150 (Skill Management) and FR-151 (Certification Management) in Phase 2 as they underpin Employee and Scheduling domains

---

## Domain: Compliance & Governance (D-009)

**Dependency note:** Audit logging (FR-500) was implemented in Milestone 4 ahead of Authentication Foundation per approved sequencing. AuditService is globally injectable — all domain modules wired in Milestone 5+ can call logEvent() without importing AuditModule.

| FR | Title | Maturity |
|----|-------|----------|
| FR-500 | Audit Logging | Partially Implemented |
| FR-501 | Compliance Reporting | Planned |
| FR-502 | Policy Enforcement | Planned |

- Capability: Compliance & Governance
- Deliverable Status: Required
- Requirements: Defined — spec/01_requirements.md (FR-500 through FR-502)
- Specs: Defined — spec/07_security_architecture.md
- Directives: Present — directives/07_compliance_rules.md, directives/08_audit_rules.md, directives/11_government_policy_rules.md; known conflict: AUD-1200 states 7-year minimum retention; data/03_retention_policy.md states 10 years for Audit Events and Security Events; 10 years applied (conservative); directive requires update before retention enforcement is implemented
- Execution Plan: Partially Implemented — FR-500 write infrastructure implemented as Phase 1 Deliverable 8 (execution/02_phase_1_foundation.md); FR-501 and FR-502 remain in execution/06_phase_5_compliance_reporting.md
- State Model: Present — state/06_compliance_review_states.md
- Test Scenarios: Partially Covered — 11 unit tests for AuditService (apps/api/src/audit/audit.service.spec.ts); no integration tests; no E2E tests; tests/05_compliance_tests.md and tests/04_security_tests.md remain specification documents only
- System Loop: Partially Integrated — AuditService registered globally via @Global() AuditModule and injectable; no domain module calls logEvent() yet; first domain callers expected in Milestone 5 (Authentication events)
- Failure Playbook: Partially Integrated — AUD-1300 non-blocking catch block implemented in AuditService.logEvent(); alerting, retry, and outbox pattern (Phase 2 upgrade) not yet implemented; failure/01_failure_playbook.md not yet integrated
- Environment Model: Specified (docs only) — environment/01_environment_strategy.md; not validated
- Data Lifecycle: Partially — audit.audit_events schema present with result column; write path operational; retention enforcement not implemented; known directive-spec conflict on retention period (AUD-1200 7yr vs data/03_retention_policy.md 10yr)
- Evolution Strategy: Partial — metadata column promotion schedule documented in code (AuditMetadata interface and comments in audit.service.ts): actorType/ipAddress → Milestone 5; correlationId → Phase 2; no formal audit schema evolution document
- Overall Maturity: **Partially Implemented** (advanced from Planned — Milestone 4, 2026-06-07)
- Remaining Gaps: No domain module calls logEvent() yet (System Loop not fully integrated); no integration test for end-to-end write path; no outbox pattern (silent loss on Prisma failure); FR-501 and FR-502 have no implementation; retention enforcement not implemented; AUD-1200 directive requires update to align with 10-year retention
- Next Recommended Step: Milestone 5 — Authentication Foundation; wire AUTH_LOGIN_SUCCESS, AUTH_LOGIN_FAILURE, AUTH_LOGOUT, AUTH_PASSWORD_RESET, AUTH_ACCOUNT_LOCKOUT events to AuditService.logEvent() from AuthService

---

## Domain: Approval Management (D-010)

| FR | Title | Maturity |
|----|-------|----------|
| FR-600 | Approval Workflow | Planned |
| FR-601 | Forecast Approval | Planned |
| FR-602 | Workforce Plan Approval | Planned |
| FR-603 | Compliance Exception Approval | Planned |

- Capability: Approval Management
- Deliverable Status: Required
- Requirements: Defined — spec/01_requirements.md (FR-600 through FR-603)
- Specs: Defined — spec/04_domain_model.md, spec/05_database_schema.md
- Directives: Partial — directives/11_government_policy_rules.md covers policy approval context; no dedicated approval workflow directive exists
- Execution Plan: Planned — execution/03_phase_2_core_workforce_platform.md
- State Model: Present — state/05_approval_workflow_states.md
- Test Scenarios: Specified (docs only) — tests/01_acceptance_tests.md; no executable tests
- System Loop: Specified (docs only) — runtime/02_event_processing.md; not implemented
- Failure Playbook: Specified (docs only) — failure/01_failure_playbook.md; not integrated
- Environment Model: Specified (docs only) — environment/01_environment_strategy.md; not validated
- Data Lifecycle: Specified (docs only) — data/01_data_lifecycle.md; not implemented
- Evolution Strategy: Specified (docs only) — evolution/01_versioning_strategy.md; not formalized
- Overall Maturity: **Planned**
- Remaining Gaps: All implementation; no approval workflow engine, no state machine, no notification trigger logic, no executable tests; missing dedicated approval directive
- Next Recommended Step: Author a dedicated approval workflow directive; implement FR-600 (Approval Workflow) as shared infrastructure in Phase 2

---

## Domain: Notification Management (D-011)

| FR | Title | Maturity |
|----|-------|----------|
| FR-700 | Notification Management | Planned |
| FR-701 | Alert Generation | Planned |
| FR-702 | Approval Notifications | Planned |
| FR-703 | Compliance Notifications | Planned |

- Capability: Notification Management
- Deliverable Status: Required
- Requirements: Defined — spec/01_requirements.md (FR-700 through FR-703)
- Specs: Defined — spec/04_domain_model.md
- Directives: Present — directives/09_notification_rules.md
- Execution Plan: Planned — execution/03_phase_2_core_workforce_platform.md
- State Model: Not yet formalized — no notification delivery state lifecycle document exists
- Test Scenarios: Specified (docs only) — tests/01_acceptance_tests.md; no executable tests
- System Loop: Specified (docs only) — runtime/02_event_processing.md; not implemented
- Failure Playbook: Specified (docs only) — failure/04_external_integration_failures.md (covers external channel failures); not integrated
- Environment Model: Specified (docs only) — environment/01_environment_strategy.md; not validated
- Data Lifecycle: Specified (docs only) — data/01_data_lifecycle.md; notification retention lifecycle not specifically addressed
- Evolution Strategy: Specified (docs only) — evolution/01_versioning_strategy.md; not formalized
- Overall Maturity: **Planned**
- Remaining Gaps: All implementation; no in-app notification system, no email delivery, no alert generation engine, no state lifecycle document, no executable tests; workers must never send real notifications during tests
- Next Recommended Step: Implement FR-700 (Notification Management) as shared infrastructure in Phase 2; establish test isolation pattern (mock delivery) before any notification code is written

---

## Domain: Reporting & Intelligence (D-012)

| FR | Title | Maturity |
|----|-------|----------|
| FR-800 | Report Generation | Planned |
| FR-801 | Scheduled Reporting | Planned |
| FR-802 | Workforce Reporting | Planned |
| FR-803 | Executive Reporting | Planned |
| FR-804 | Audit Reporting | Planned |
| FR-820 | Dashboard Framework | Planned |
| FR-821 | Personalized Dashboards | Planned |
| FR-822 | KPI Dashboard Widgets | Planned |
| FR-850 | Global Search | Planned |
| FR-851 | Workforce Search | Planned |
| FR-852 | Report Search | Planned |
| FR-860 | Data Import | Planned |
| FR-861 | Bulk Update | Planned |
| FR-862 | Data Export | Planned |

- Capability: Reporting & Intelligence
- Deliverable Status: Required
- Requirements: Defined — spec/01_requirements.md (FR-800 through FR-862; 14 requirements)
- Specs: Defined — spec/12_reporting_architecture.md
- Directives: **Missing** — no dedicated reporting directive exists; this is a known gap for a 14-FR domain
- Execution Plan: Planned — execution/06_phase_5_compliance_reporting.md
- State Model: Not yet formalized — no report lifecycle or export state document exists
- Test Scenarios: Specified (docs only) — tests/01_acceptance_tests.md, tests/06_performance_tests.md; no executable tests
- System Loop: Specified (docs only) — runtime/05_background_jobs.md (scheduled reporting); not implemented
- Failure Playbook: Specified (docs only) — failure/01_failure_playbook.md; not integrated
- Environment Model: Specified (docs only) — environment/01_environment_strategy.md; not validated
- Data Lifecycle: Specified (docs only) — data/03_retention_policy.md; report retention lifecycle not implemented
- Evolution Strategy: Specified (docs only) — evolution/01_versioning_strategy.md; not formalized
- Overall Maturity: **Planned**
- Remaining Gaps: All implementation; missing dedicated reporting directive; no report engine, no dashboard framework, no search infrastructure, no import/export pipeline, no bulk update logic, no scheduled report delivery, no executable tests
- Next Recommended Step: Author a dedicated reporting directive before any implementation; this is the largest domain (14 FRs) and requires phased implementation

---

## Domain: AI Governance (D-013)

**Architectural constraint note:** FR-903 (Human Approval Requirement) is non-negotiable and prohibits any autonomous AI decision. This constraint must be enforced in the inference pipeline architecture before any AI feature is built. AI Governance is a cross-cutting constraint, not a standalone feature.

| FR | Title | Maturity |
|----|-------|----------|
| FR-900 | AI Explainability | Planned |
| FR-901 | AI Recommendation Review | Planned |
| FR-902 | Confidence Management | Planned |
| FR-903 | Human Approval Requirement | Planned |
| FR-904 | AI Audit Records | Planned |

- Capability: AI Governance
- Deliverable Status: Required
- Requirements: Defined — spec/01_requirements.md (FR-900 through FR-904)
- Specs: Defined — spec/11_ai_architecture.md
- Directives: Present — directives/06_attrition_scoring_rules.md, directives/05_skill_matching_rules.md (partial coverage; no single unified AI governance directive)
- Execution Plan: Planned — execution/05_phase_4_workforce_intelligence.md
- State Model: Not Applicable — AI governance is a cross-cutting architectural constraint, not a lifecycle
- Test Scenarios: Specified (docs only) — tests/08_ai_validation_tests.md; no executable tests
- System Loop: Specified (docs only) — runtime/04_ai_inference_pipeline.md; not implemented
- Failure Playbook: Specified (docs only) — failure/03_ai_failure_modes.md; not integrated
- Environment Model: Specified (docs only) — environment/01_environment_strategy.md; not validated
- Data Lifecycle: Specified (docs only) — data/01_data_lifecycle.md; AI audit record lifecycle not implemented
- Evolution Strategy: Specified (docs only) — evolution/01_versioning_strategy.md; AI model versioning not formalized
- Overall Maturity: **Planned**
- Remaining Gaps: All implementation; no explainability engine, no confidence scoring, no human-approval gate enforced in code, no AI audit records persisted; missing unified AI governance directive
- Next Recommended Step: Author a unified AI governance directive consolidating FR-900 through FR-904 constraints; enforce human-approval gate in inference pipeline design before any model code is written

---

## Domain: Workforce Readiness (D-014)

| FR | Title | Maturity |
|----|-------|----------|
| FR-410 | Workforce Readiness Scoring | Planned |
| FR-411 | Operational Readiness Dashboard | Planned |
| FR-412 | Readiness Trend Analysis | Planned |

- Capability: Workforce Readiness
- Deliverable Status: Required
- Requirements: Defined — spec/01_requirements.md (FR-410, FR-411, FR-412)
- Specs: Defined — spec/12_reporting_architecture.md, spec/11_ai_architecture.md
- Directives: Partial — directives/01_workforce_forecasting_rules.md covers partial context; no dedicated readiness directive
- Execution Plan: Planned — execution/05_phase_4_workforce_intelligence.md
- State Model: Partial — state/04_forecast_lifecycle.md covers forecast states; readiness score lifecycle not separately documented
- Test Scenarios: Specified (docs only) — tests/02_forecasting_tests.md, tests/08_ai_validation_tests.md; no executable tests
- System Loop: Specified (docs only) — runtime/04_ai_inference_pipeline.md; not implemented
- Failure Playbook: Specified (docs only) — failure/03_ai_failure_modes.md; not integrated
- Environment Model: Specified (docs only) — environment/01_environment_strategy.md; not validated
- Data Lifecycle: Specified (docs only) — data/01_data_lifecycle.md; not implemented
- Evolution Strategy: Specified (docs only) — evolution/01_versioning_strategy.md; not formalized
- Overall Maturity: **Planned**
- Remaining Gaps: All implementation; depends on D-007 (Workforce Intelligence) being at least Integrated; no readiness scoring engine, no dashboard, no trend analysis, no executable tests
- Next Recommended Step: Do not begin until D-007 Workforce Intelligence is Integrated; readiness scoring aggregates intelligence outputs

---

## Domain: Integrations (D-015)

| FR | Title | Maturity |
|----|-------|----------|
| FR-950 | External System Integration | Planned |
| FR-951 | Data Synchronization | Planned |
| FR-952 | Feature Flag Management | Planned |

- Capability: Integrations
- Deliverable Status: Required
- Requirements: Defined — spec/01_requirements.md (FR-950, FR-951, FR-952)
- Specs: Defined — spec/13_integration_architecture.md
- Directives: **Missing** — no dedicated integration or feature flag directive exists
- Execution Plan: Planned — execution/07_phase_6_production_hardening.md
- State Model: Not yet formalized — no integration sync state lifecycle document exists
- Test Scenarios: Specified (docs only) — tests/01_acceptance_tests.md; no executable tests
- System Loop: Specified (docs only) — runtime/02_event_processing.md; not implemented
- Failure Playbook: Specified (docs only) — failure/04_external_integration_failures.md, failure/05_recovery_strategies.md; not integrated
- Environment Model: Specified (docs only) — environment/01_environment_strategy.md, environment/02_configuration_matrix.md; not validated
- Data Lifecycle: Specified (docs only) — data/01_data_lifecycle.md; synchronization data lifecycle not specifically addressed
- Evolution Strategy: Present — evolution/03_backward_compatibility.md is directly relevant to integration versioning
- Overall Maturity: **Planned**
- Remaining Gaps: All implementation; missing dedicated integration and feature flag directive; no integration adapter, no sync engine, no feature flag system, no executable tests
- Next Recommended Step: Author a dedicated integration directive and feature flag directive; implement FR-952 (Feature Flag Management) early as it controls phased rollout of all other capabilities

---

# Zone 4 — Blueprint Documentation Status

> This section tracks documentation artifact completeness ONLY.
> Documentation existing does NOT indicate implementation maturity, test coverage, or operational readiness.
> Implementation maturity is tracked in Zone 2 and Zone 3 above.

| Layer | Documentation Status | File Count | Notes |
|-------|---------------------|------------|-------|
| Meta | Complete | 4 files (meta/00–03) | Classification, assumptions, glossary, traceability matrix |
| Specification | Complete | 15 files (spec/01–15) | Functional requirements through implementation roadmap |
| Directives | Complete | 11 files (directives/01–11) | 3 known directive gaps (Employee Mgmt, Reporting, Integrations) |
| Execution Plans | Complete | 8 files (execution/01–08) | These are plan documents, not executable scripts |
| State Models | Complete | 6 files (state/01–06) | 4 known state model gaps (Identity, Org, Skills, Notifications, Talent Acq) |
| Test Specifications | Complete | 8 files (tests/01–08) | Specification documents only — zero executable test files exist |
| Runtime Specifications | Complete | 5 files (runtime/01–05) | Design documents only — no running services exist |
| Failure Specifications | Complete | 5 files (failure/01–05) | Design documents only — not integrated into any code |
| Environment Specifications | Complete | 5 files (environment/01–05) | Design documents only — no environment has been validated |
| Data Specifications | Complete | 6 files (data/01–06) | Design documents only — no data pipelines exist |
| Evolution Specifications | Complete | 5 files (evolution/01–05) | Design documents only — no versioning strategy has been applied |
| UX Specifications | Complete | 6 files (ux/01–06) | Design documents only — no UI has been built |

**Documentation Completeness: 12 / 12 layers documented**
**Implementation Completeness: 0 / 15 domains implemented**
**Executable Test Coverage: 0 / 69 functional requirements**

---

# Zone 5 — Chronological Implementation History

> This section is append-only. Entries are prepended (most recent first).
> No entry is ever modified or deleted after it is written.
> Every meaningful repository change produces one entry.

---

### Entry: 2026-06-08 — Milestone 5 Step 9: Dev Seed User (Complete and Validated)

Phase: Phase 1 — Foundation
Status: Complete and Validated
Capability Affected: D-001 Identity & Access (FR-002 User Authentication — dev fixture enables happy-path login testing)
FR References: FR-002 (Integrated — all HTTP endpoints and auth infrastructure live; dev seed user enables end-to-end login; endpoint tests pending Step 10)

#### Capability / Deliverable Alignment

- Capability: Development Fixture — Login-Ready Admin User
- Deliverable Status: Required (execution/02_phase_1_foundation.md — Deliverable 7: seed data for development environment)
- Requirements: Defined — spec/07_security_architecture.md (bcrypt 12 rounds, password requirements)
- Specs: Aligned — spec/05_database_schema.md (Tenant, User, UserRole models)
- Directives: Governing — directives/10_role_based_access_rules.md (System Administrator role)
- Execution Plan: Integrated — `apps/api/prisma/seed.ts` extended; `npm run db:seed` with `NODE_ENV=development` is the one-command setup
- State Model: Integrated — user created with `status: ACTIVE`; seed recovery resets lockout state on every run
- Test Scenarios: Partially Covered — seed idempotency and recovery confirmed manually; endpoint login e2e tests are Step 10 scope
- System Loop: Integrated — seed provides the fixture required for `POST /api/v1/auth/login` → `GET /api/v1/auth/me` → `POST /api/v1/auth/logout` happy-path flow
- Failure Playbook: Integrated — recovery-oriented re-seed resets auth state; `findUniqueOrThrow` fails fast if role is missing
- Environment Model: Integrated — allowlist guard (`NODE_ENV !== 'development'` → skip) confirmed working for unset, `production`, and `staging` environments
- Data Lifecycle: Integrated — dev fixture data created; plaintext credential is a dev fixture, not a production secret; documented and auditable
- Evolution Strategy: Seed constants are named and grouped; adding fields to the seed requires only changes to `seedDevUser()`
- Overall Maturity: **Integrated** (full auth stack live with working dev fixture; endpoint e2e tests pending Step 10)

#### What Changed

**Files Modified (1):**

- `apps/api/prisma/seed.ts` — extended with:
  1. `import * as bcrypt from 'bcrypt'` added at top
  2. Dev-only constant block: `DEV_SEED_EMAIL`, `DEV_SEED_PASSWORD`, `DEV_SEED_FIRST_NAME`, `DEV_SEED_LAST_NAME`, `DEV_SEED_ROLE`, `DEV_TENANT_NAME`, `DEV_TENANT_CODE`
  3. `seedDevUser()` async function: allowlist guard (`NODE_ENV !== 'development'`), tenant upsert (by `code`), bcrypt hash at 12 rounds, user upsert (by `tenantId_email`, recovery-oriented update clause), role `findUniqueOrThrow`, UserRole upsert (by `userId_roleId`)
  4. `await seedDevUser()` call added at end of `main()` — runs after roles are seeded

**Files Not Modified:**

- `apps/api/src/identity/*.ts` — no application code changed
- `apps/api/prisma/schema.prisma` — no schema changes; no migration required
- `apps/api/package.json` — `db:seed` script unchanged (`ts-node --transpile-only prisma/seed.ts`)

#### Seed Fixture Values

| Field | Value |
|-------|-------|
| Email | `admin@dev.gov` |
| Password (dev only) | `DevAdmin1234!` |
| Tenant code | `DEV` |
| Tenant name | `Development Agency` |
| Role | `System Administrator` |
| User status | `ACTIVE` |
| Tenant UUID (dev DB) | `a4c143d8-2725-4eeb-9682-ddabba3a438d` |
| User UUID (dev DB) | `ee52bdf1-e717-4c16-a4fc-078d93a21fb9` |

#### Validation

- `npm run build --workspace=apps/api`: EXIT 0 — zero build errors
- `npm test --workspace=apps/api`: EXIT 0 — 37/37 pass; 5 suites; zero regressions
- `npm run test:e2e --workspace=apps/api`: EXIT 0 — 1/1 pass
- Seed first run (`NODE_ENV=development`): EXIT 0 — tenant, user, role assignment created
- Seed second run (`NODE_ENV=development`): EXIT 0 — same UUIDs; update clause applied; no duplicates (idempotency confirmed)
- Guard: `NODE_ENV` unset → skipped (allowlist confirmed)
- Guard: `NODE_ENV=production` → skipped (allowlist confirmed)
- Guard: `NODE_ENV=staging` → skipped (allowlist confirmed)
- DB state verified: `status: ACTIVE`, `failedLoginAttempts: 0`, `lockedUntil: null`, `tenant.code: DEV`, `role: System Administrator`
- Recovery test: lockout simulated (`failedLoginAttempts: 5`, `lockedUntil: future`, `status: INVITED`) → re-seed restored known-good state

#### Risks / Limitations

1. **No endpoint e2e tests yet:** The dev seed is the prerequisite fixture. Login, logout, and `/me` endpoint tests are Step 10 scope.
2. **Recovery resets password on every run:** The `passwordHash` in the update clause means every `NODE_ENV=development` seed run (~300ms for bcrypt at 12 rounds) resets the password to `DevAdmin1234!`. Minor overhead; no correctness risk.
3. **Single dev tenant:** A second tenant requires resolving the Open Architectural Decision on User Identity Model (recorded in Active Execution State) before Phase 2 multi-tenant login.

#### Next Actions

- Step 10 — Unit tests + PROGRESS.md milestone update (not started; requires approval)

---

### Entry: 2026-06-08 — Milestone 5 Step 8: main.ts URI Versioning (Complete and Validated)

Phase: Phase 1 — Foundation
Status: Complete and Validated
Capability Affected: D-001 Identity & Access (FR-002 — auth endpoints now at canonical `/api/v1/auth/*` paths); cross-cutting (all future versioned controllers benefit immediately)
FR References: FR-002 (Integrated — canonical paths active); API versioning contract from spec/06_api_contracts.md now enforced at runtime

#### What Changed

**Files Modified (1):**

- `apps/api/src/main.ts` — three targeted changes:
  1. `VersioningType` added to `@nestjs/common` import
  2. `app.enableVersioning({ type: VersioningType.URI })` inserted between `setGlobalPrefix` and Swagger setup
  3. `.addBearerAuth()` added to `DocumentBuilder` chain — activates `@ApiBearerAuth()` lock icons and Authorize button in Swagger UI for protected routes

#### Route Changes

| Endpoint | Before Step 8 | After Step 8 |
|----------|--------------|-------------|
| `POST /auth/login` | `/api/auth/login` | `/api/v1/auth/login` |
| `POST /auth/logout` | `/api/auth/logout` | `/api/v1/auth/logout` |
| `GET /auth/me` | `/api/auth/me` | `/api/v1/auth/me` |
| `GET /health` | `/health` | `/health` — unchanged |
| `GET /api/docs` | `/api/docs` | `/api/docs` — unchanged |

#### Swagger Changes

- `DocumentBuilder.addBearerAuth()` added — registers bearer auth security scheme in the OpenAPI document
- `@ApiBearerAuth()` decorators on `POST /auth/logout` and `GET /auth/me` (applied in Step 7) now render in Swagger UI: lock icons on protected routes, "Authorize" button in the UI header
- No route path changes in Swagger document — versioned paths were already reflected once `enableVersioning` activated the routing layer

#### Validation

- `tsc --noEmit`: EXIT 0
- `npm run build --workspace=apps/api`: EXIT 0
- `npm test --workspace=apps/api`: EXIT 0 — 37/37; 5 suites; zero regressions
- `npm run test:e2e --workspace=apps/api`: EXIT 0 — 1/1 pass

#### Risks / Limitations

1. **No endpoint e2e tests yet:** Routes are at canonical paths but no test exercises them over HTTP. Endpoint e2e tests (login, logout, me) are Step 10 scope and require the seed user from Step 9.
2. **Swagger bearer auth requires manual token entry:** No OAuth2 flow; developers testing via Swagger UI must paste the JWT from a successful login response into the Authorize dialog.

#### Next Actions

- Step 9 — Dev seed: bcrypt-hashed admin user (not started; requires approval before implementation)

---

### Entry: 2026-06-08 — Milestone 5 Step 7: AuthController (Complete and Validated)

Phase: Phase 1 — Foundation
Status: Complete and Validated
Capability Affected: D-001 Identity & Access (FR-002 User Authentication — HTTP surface live); D-009 Compliance & Governance (FR-500 Audit Logging — AUTH events now wired to live HTTP requests)
FR References: FR-002 (Integrated — login, logout, and current-user endpoints registered; seed user pending Step 9 before happy-path e2e possible); FR-003 (Scaffolded — routes protected by `JwtAuthGuard`; role-based permission enforcement deferred to Phase 2)

#### Capability / Deliverable Alignment

- Capability: User Authentication HTTP Surface (FR-002)
- Deliverable Status: Required
- Requirements: Defined — spec/01_requirements.md (FR-002), spec/06_api_contracts.md (login/logout/me contracts), spec/07_security_architecture.md (user enumeration protection, tenant isolation)
- Specs: Aligned — `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` match spec/06_api_contracts.md response shapes exactly
- Directives: Governing — directives/08_audit_rules.md (AUD-200 through AUD-210 — all wired via AuthService); directives/10_role_based_access_rules.md (roles in JWT payload; RBAC enforcement Phase 2)
- Execution Plan: Integrated — HTTP transport layer complete; URI versioning pending Step 8
- State Model: Not applicable at controller layer
- Test Scenarios: Partially Covered — bootstrap e2e confirms DI resolution; endpoint-level unit and e2e tests deferred to Step 10 (requires seed user from Step 9 for login happy path)
- System Loop: Integrated — full request path now traceable: HTTP → AuthController → AuthService → IdentityService + JwtService + AuditService
- Failure Playbook: Integrated at HTTP layer — 401 for all auth failures (user enumeration protected); 400 for validation errors; 500 for TENANT_COLLISION (INTERNAL_ERROR path)
- Environment Model: Not applicable — no new environment variables
- Data Lifecycle: Not applicable at controller layer
- Evolution Strategy: `@CurrentUser()` decorator isolates `RequestUser` extraction — adding fields to `RequestUser` requires only `jwt.strategy.ts` change; controllers do not reference `req.user` directly
- Overall Maturity: **Integrated** (HTTP surface complete; endpoint-level tests pending Step 10)

#### What Changed

**Files Created (3):**

- `apps/api/src/identity/decorators/current-user.decorator.ts` — `@CurrentUser()` custom parameter decorator; extracts `RequestUser` from `req.user` (populated by `JwtStrategy.validate()`); avoids coupling handlers to raw Express Request type
- `apps/api/src/identity/dto/login-response.dto.ts` — `LoginResponseDto` and `LoginResponseDataDto`; typed response shape for Swagger schema and `@ApiResponse` type reference
- `apps/api/src/identity/auth.controller.ts` — `AuthController`; three routes: `POST /auth/login` (public), `POST /auth/logout` (guarded), `GET /auth/me` (guarded); full `LoginResult` discriminated union mapping; `@ApiTags`, `@ApiOperation`, `@ApiResponse`, `@ApiBearerAuth` Swagger decorators; `version: '1'` in `@Controller`

**Files Modified (1):**

- `apps/api/src/identity/identity.module.ts` — `AuthController` added to `controllers` array; `AuthController` import added

#### Key Architectural Decisions

1. **`tenantId` omitted from `GET /auth/me` response (pre-implementation clarification, approved):** The spec contract does not include it. Clients never supply or reference `tenantId` explicitly — the server-side enforcement model makes client awareness of the tenant UUID unnecessary. Adding it would be speculative scope. If Phase 2 requires it, it is a deliberate, documented addition.
2. **User enumeration protection structural enforcement:** `AuthService` collapses all credential failure outcomes to `LoginResult.UNAUTHORIZED`. `AuthController` maps that single outcome to one identical 401 body. There is no branching on failure type at the HTTP layer — the protection is structural, not conditional.
3. **`@CurrentUser()` decorator:** Small utility that decouples all protected handlers from the raw `Request` type. Located in `decorators/current-user.decorator.ts` — consistent location for future parameter decorators.
4. **`@ApiBearerAuth()` applied now:** The decorator metadata is present. The Swagger UI "Authorize" button and lock icons for protected routes will render after `DocumentBuilder.addBearerAuth()` is called in Step 8.

#### Validation

- `tsc --noEmit`: EXIT 0 — zero type errors
- `npm run build --workspace=apps/api`: EXIT 0 — zero build errors
- `npm test --workspace=apps/api`: EXIT 0 — 37/37 tests pass; 5 suites; zero regressions
- `npm run test:e2e --workspace=apps/api`: EXIT 0 — 1/1 pass; `AppModule` bootstrap confirms `AuthController` registered and all dependencies resolve

#### Risks / Limitations

1. **Routes accessible at `/api/auth/*` until Step 8:** `version: '1'` annotation is in place; `app.enableVersioning()` has not been called yet (`main.ts` is Step 8). The versioned `/api/v1/auth/*` path activates in Step 8.
2. **`@ApiBearerAuth()` not visible in Swagger UI until Step 8:** `DocumentBuilder.addBearerAuth()` is a `main.ts` concern. Swagger decorator metadata is present and will render after Step 8.
3. **No endpoint-level tests yet:** `AuthController` unit tests and login/logout/me e2e tests are deferred to Step 10. Happy-path login e2e requires a seeded user (Step 9).
4. **No seed user yet:** `POST /auth/login` with valid credentials returns `EMAIL_NOT_FOUND → UNAUTHORIZED` on every call until Step 9 seeds the admin user.

#### Next Actions

- Step 8 — main.ts URI versioning (not started; requires approval before implementation)
- No new blockers introduced

---

### Entry: 2026-06-08 — Milestone 5 Step 6: JwtStrategy + JwtAuthGuard (Complete and Validated)

Phase: Phase 1 — Foundation
Status: Complete and Validated
Capability Affected: D-001 Identity & Access (FR-002 User Authentication — JWT validation infrastructure; FR-003 Role-Based Authorization — guard infrastructure)
FR References: FR-002 (Partially Implemented — JWT validation layer complete; HTTP transport pending Step 7); FR-003 (Scaffolded — guard infrastructure ready; RBAC enforcement logic pending Phase 2)

#### Capability / Deliverable Alignment

- Capability: JWT Validation Infrastructure + Route Guard Foundation
- Deliverable Status: Required
- Requirements: Defined — spec/07_security_architecture.md (JWT Architecture, SEC-003 Tenant Isolation), spec/01_requirements.md (FR-002, FR-003)
- Specs: Aligned — spec/10_backend_architecture.md (Identity Module D-001)
- Directives: Governing — directives/10_role_based_access_rules.md (RBAC foundation; roles present in JWT payload)
- Execution Plan: Partially Implemented — guard infrastructure complete; protected endpoints pending Step 7
- State Model: Not applicable — guard/strategy have no state lifecycle
- Test Scenarios: Partially Covered — DI resolution verified via e2e bootstrap; dedicated unit tests for JwtStrategy and JwtAuthGuard deferred to Step 10
- System Loop: Progressed — JWT issuance (Step 5) and JWT validation (Step 6) are now both implemented; round-trip is complete once AuthController (Step 7) exposes the HTTP surface
- Failure Playbook: Integrated — `JwtAuthGuard` returns HTTP 401 for missing, malformed, or expired tokens; Passport handles failure before `validate()` is invoked
- Environment Model: Not applicable — no new environment variables
- Data Lifecycle: Not applicable at guard layer
- Evolution Strategy: `RequestUser` interface exported from `jwt.strategy.ts`; adding fields requires only a single-file change
- Overall Maturity: **Partially Implemented** (JWT infrastructure complete; no protected HTTP endpoint exists until Step 7)

#### What Changed

**Files Created (2):**

- `apps/api/src/identity/jwt.strategy.ts` — `JwtStrategy extends PassportStrategy(Strategy)`; `RequestUser` interface exported; `validate()` maps `JwtPayload` to `RequestUser` (no DB call); `secretOrKey` uses non-null assertion — safe because `env.validation.ts` startup gate guarantees `JWT_SECRET` presence
- `apps/api/src/identity/jwt-auth.guard.ts` — `JwtAuthGuard extends AuthGuard('jwt')`; registered as provider in `IdentityModule`; apply to protected routes via `@UseGuards(JwtAuthGuard)`; returns HTTP 401 for invalid/missing/expired tokens

**Files Modified (1):**

- `apps/api/src/identity/identity.module.ts` — `JwtStrategy` and `JwtAuthGuard` added to `providers`; `JwtAuthGuard` added to `exports`; imports for both added; module comment updated to reflect Step 6 completion

#### Key Architectural Decisions

1. **`validate()` is a pure transformation — no DB lookup:** JWT payload is self-contained. `RequestUser` is derived from `JwtPayload` fields in memory. A DB round-trip per authenticated request is deferred to Phase 2 if per-request permission fetching is required.
2. **`JwtAuthGuard` in both `providers` and `exports`:** Registering only in `exports` without `providers` is a NestJS anti-pattern — the export would be a no-op in DI. Provider registration gives NestJS lifecycle ownership and makes future constructor dependencies safe to add without module changes.
3. **`!` non-null assertion on `JWT_SECRET`:** `ConfigService.get<T>()` returns `T | undefined` in TypeScript strict mode. The non-null assertion is safe because `env.validation.ts` aborts application bootstrap if `JWT_SECRET` is absent. This is the correct approach — the startup gate is the contract; the assertion documents it.

#### Validation

- `tsc --noEmit`: EXIT 0 — zero type errors (after `!` assertion fix)
- `npm run build --workspace=apps/api`: EXIT 0 — zero build errors
- `npm test --workspace=apps/api`: EXIT 0 — 37/37 tests pass; 5 suites; zero regressions
- `npm run test:e2e --workspace=apps/api`: EXIT 0 — 1/1 pass; DI resolution of `JwtStrategy` and `JwtAuthGuard` confirmed via `AppModule` bootstrap

#### Risks / Limitations

1. **No protected HTTP endpoint yet:** `JwtAuthGuard` is registered and functional but cannot be exercised until `AuthController` (Step 7) is implemented and applies `@UseGuards(JwtAuthGuard)` to protected routes.
2. **No JwtStrategy or JwtAuthGuard unit tests yet:** Deferred to Step 10 per the established milestone pattern. Current coverage is DI resolution via e2e bootstrap.
3. **`RequestUser.roles` carries names only:** Permission-based authorization requires a separate RBAC guard that resolves permissions from the database. `roles[]` in the JWT payload is available for basic role checks in Phase 1; full RBAC is Phase 2.

#### Next Actions

- Step 7 — AuthController (not started; requires approval before implementation)
- No new blockers introduced

---

### Entry: 2026-06-08 — Milestone 5 Step 5: AuthService (Complete and Validated)

Phase: Phase 1 — Foundation
Status: Complete and Validated
Capability Affected: D-001 Identity & Access (FR-002 User Authentication — service layer); D-009 Compliance & Governance (FR-500 Audit Logging — first domain caller)
FR References: FR-002 (Partially Implemented — service layer complete, HTTP transport pending Step 7); FR-500 (System Loop progressed — first real audit event callers implemented)

#### Capability / Deliverable Alignment

- Capability: User Authentication (FR-002) + Audit Logging System Loop closure (FR-500)
- Deliverable Status: Required
- Requirements: Defined — spec/01_requirements.md (FR-002), spec/07_security_architecture.md (JWT Architecture, Account Lockout, User Enumeration Protection, Transport-Agnostic Service Design)
- Specs: Aligned — spec/06_api_contracts.md (POST /api/v1/auth/login, POST /api/v1/auth/logout), spec/10_backend_architecture.md (Identity Module D-001)
- Directives: Governing — directives/08_audit_rules.md (AUD-200 through AUD-210), directives/07_compliance_rules.md
- Execution Plan: Partially Implemented — AuthService layer complete; HTTP transport (AuthController) and guard (JwtStrategy + JwtAuthGuard) pending Steps 6–7
- State Model: Partially Implemented — lockout state transitions implemented (INVALID_PASSWORD → lockedUntil set; SUCCESS → lockedUntil cleared); user lifecycle states (INVITED, SUSPENDED) deferred to Phase 2
- Test Scenarios: Partially Covered — unit tests for env validation updated; dedicated AuthService unit tests deferred to Step 10 (same pattern as IdentityService)
- System Loop: Progressed — `AuditService.logEvent()` called from `AuthService.login()` for all 5 authentication outcome branches (AUTH_LOGIN_SUCCESS, AUTH_LOGIN_FAILURE × 3, AUTH_ACCOUNT_LOCKOUT); `AUTH_LOGOUT` called from `AuthService.logout()`; first real domain callers of AuditModule
- Failure Playbook: Partial — AUD-1300 non-blocking audit writes in all branches; TENANT_COLLISION suppressed and returned as INTERNAL_ERROR; no retry or outbox
- Environment Model: Integrated — `JWT_SECRET` validated at startup via `env.validation.ts`; both `apps/api/.env` and root `.env` now carry the secret for test and runtime respectively
- Data Lifecycle: Not applicable at service layer
- Evolution Strategy: Single constant (`JWT_ACCESS_EXPIRES_IN_SECONDS`) drives both `JwtModule` and `AuthService` response — drift-proof by design
- Overall Maturity: **Partially Implemented** (service logic complete; HTTP transport and guards pending)

#### What Changed

**Files Created (2):**

- `apps/api/src/identity/identity.constants.ts` — `JWT_ACCESS_EXPIRES_IN_SECONDS = 3600`; single source of truth for JWT access token lifetime; consumed by `JwtModule.registerAsync` and `AuthService.login()` response; spec ref: spec/07_security_architecture.md — Access Token: 1 Hour
- `apps/api/src/identity/auth.service.ts` — `AuthService`; transport-agnostic `login(email, password): Promise<LoginResult>` and `logout(userId, tenantId): Promise<void>`; `LoginResult` discriminated union (`SUCCESS | UNAUTHORIZED | INTERNAL_ERROR`); `JwtPayload` interface (`sub`, `tenantId`, `email`, `roles[]`); all 5 `IdentityValidationResult` branches handled; audit events written for all branches; `SYSTEM_TENANT_ID` and `SYSTEM_USER_ID` sentinels used for `EMAIL_NOT_FOUND` case

**Files Modified (5):**

- `apps/api/src/audit/audit.service.ts` — `SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000'` export added alongside `SYSTEM_USER_ID`; distinct semantic meaning documented (actor indeterminate vs tenant indeterminate); import from this file; do not redefine elsewhere
- `apps/api/src/identity/identity.module.ts` — `PassportModule` and `JwtModule.registerAsync({ inject: [ConfigService], useFactory })` added to imports; `AuthService` added to providers and exports; `JWT_ACCESS_EXPIRES_IN_SECONDS` used in `signOptions.expiresIn`
- `apps/api/src/config/env.validation.ts` — `JWT_SECRET @IsString() @IsNotEmpty()` added to `EnvironmentVariables`; application bootstrap now aborts if `JWT_SECRET` is absent or empty
- `.env` (repo root) — `JWT_SECRET` populated with 128-character hex dev value; `JWT_REFRESH_SECRET` intentionally absent (no refresh tokens in Phase 1)
- `.env.example` — Milestone reference corrected from "Milestone 6" to "Milestone 5"

**Files Modified (Step 5 Remediation — 2):**

- `apps/api/src/config/env.validation.spec.ts` — `JWT_SECRET: 'test-jwt-secret'` added to all 6 valid test payloads; negative-case tests unchanged (still throw as expected); test count unchanged at 10
- `apps/api/.env` — `JWT_SECRET` added; now carries both `DATABASE_URL` and `JWT_SECRET` so Jest e2e process (`process.cwd() = apps/api/`) finds both required fields via `dotenv.config()`

#### Key Architectural Decisions

1. **Transport-agnostic AuthService (approved pre-implementation):** `AuthService` throws no HTTP exceptions and returns no HTTP responses. `LoginResult` discriminated union carries structured outcomes only. `AuthController` (Step 7) performs all HTTP mapping. This preserves future transport flexibility and cleanly separates concerns.
2. **SYSTEM_TENANT_ID sentinel (approved pre-implementation):** Zero UUID for pre-authentication contexts where tenant is indeterminate (`EMAIL_NOT_FOUND`). Same value as `SYSTEM_USER_ID` but distinct semantics — `SYSTEM_TENANT_ID` means "tenant unknown"; `SYSTEM_USER_ID` means "actor is the system". Both must be imported from `audit.service.ts`; neither may be redefined.
3. **JWT_ACCESS_EXPIRES_IN_SECONDS single source of truth (approved pre-implementation):** Integer constant in `identity.constants.ts`. `JwtModule.registerAsync` consumes it for `signOptions.expiresIn`; `AuthService.login()` response includes the same value. One change updates both consumers atomically.
4. **apps/api/.env carries JWT_SECRET:** The `apps/api/.env` file was originally a Prisma-only file containing `DATABASE_URL`. It now also carries `JWT_SECRET` because dotenv resolves relative to `process.cwd()` (`apps/api/`) during Jest execution. This is the established pattern (same reason `DATABASE_URL` was placed there in Milestone 2). The file is gitignored; it mirrors the relevant subset of root `.env`.
5. **TENANT_COLLISION produces no audit event:** No audit record can be attached without a valid `userId` and `tenantId`. `IdentityService` already logs the collision (without PII). `AuthService` returns `{ outcome: 'INTERNAL_ERROR' }`. `AuthController` (Step 7) maps this to HTTP 500.

#### Validation

- `tsc --noEmit`: EXIT 0 — zero type errors
- `npm run build --workspace=apps/api`: EXIT 0 — zero build errors
- `npm test --workspace=apps/api`: EXIT 0 — 37/37 tests pass; 5 suites pass; zero regressions
- `npm run test:e2e --workspace=apps/api`: EXIT 0 — 1/1 pass; `AppModule` bootstraps with `IdentityModule` registered; `AuthService`, `IdentityService`, `JwtService`, `AuditService` all resolve from the DI container

#### Risks / Limitations

1. **No HTTP surface yet:** `AuthService` and `IdentityService` are complete but no HTTP endpoint exists. Authentication is not reachable until Step 7 (`AuthController`) is implemented.
2. **No JwtStrategy or guard yet:** Protected routes cannot enforce JWT authentication until Step 6 (`JwtStrategy + JwtAuthGuard`) is complete.
3. **No AuthService unit tests yet:** Dedicated unit tests for `AuthService` (mocking `IdentityService`, `JwtService`, `AuditService`) are deferred to Step 10, consistent with the `IdentityService` pattern. Current coverage is limited to compile-time verification and DI resolution.
4. **User status filter deferred:** `IdentityService` does not filter by `status`. INVITED and SUSPENDED users receive the same credential validation path as ACTIVE users. The seed user (Step 9) is seeded as ACTIVE. Full status enforcement is a Phase 2 task.
5. **TENANT_COLLISION is a Phase 1 design constraint:** Safe only with a single tenant. Becomes load-bearing when a second tenant is onboarded. Must be resolved before FR-001 (User Registration) and Phase 2 tenant-aware login per the Open Architectural Decision recorded above.

#### Next Actions

- Step 6 — JwtStrategy + JwtAuthGuard (not started; requires approval before implementation)
- No new blockers introduced
- Open Architectural Decision: User Identity Model remains open; not a blocker for Steps 6–10

---

### Entry: 2026-06-07 — Milestone 4: Audit Foundation (Complete and Validated)

Phase: Phase 1 — Foundation
Status: Complete and Validated
Capability Affected: D-009 Compliance & Governance (FR-500 Audit Logging — write infrastructure)
FR References: FR-500 (Partially Implemented); FR-501, FR-502 unchanged (Planned)

#### Capability / Deliverable Alignment

- Capability: Compliance & Governance — Audit Logging Infrastructure
- Deliverable Status: Required (execution/02_phase_1_foundation.md — Deliverable 8)
- Architectural Sequencing Decision: Audit Foundation implemented before Authentication Foundation (approved); rationale: authentication, authorization, and user-management events must be auditable from their first implementation; no blueprint changes; implementation sequencing only
- Requirements: Defined — spec/01_requirements.md (FR-500 through FR-502; AUD-001 through AUD-1300)
- Specs: Aligned — spec/07_security_architecture.md, spec/10_backend_architecture.md
- Directives: Present and governing — directives/08_audit_rules.md (AUD-001 through AUD-1300), directives/07_compliance_rules.md, directives/11_government_policy_rules.md
- Execution Plan: Partially Implemented — Deliverable 8 write path complete; domain event generation pending Milestone 5+
- State Model: Present — state/06_compliance_review_states.md
- Test Scenarios: Partially Covered — 11 unit tests for AuditService; no integration or E2E tests
- System Loop: Partially Integrated — AuditService globally injectable via @Global() AuditModule; no domain module calls logEvent() yet
- Failure Playbook: Partially Integrated — AUD-1300 non-blocking catch block implemented; alerting, retry, and outbox pattern not yet implemented
- Environment Model: Specified (docs only) — environment/01_environment_strategy.md; not validated
- Data Lifecycle: Partially — schema present; write path operational; retention enforcement not implemented; directive-spec conflict documented (see Risks)
- Evolution Strategy: Partial — metadata column promotion schedule documented in code comments; no formal audit schema evolution document
- Overall Maturity: **Partially Implemented** (advanced from Planned)

#### What Changed

**Files Created (5):**

- `apps/api/src/audit/enums/audit-event-type.enum.ts` — `AuditEventType` enum; 42 string literal values covering AUD-200 through AUD-900 (Authentication, Authorization, Workforce, Recruiting, Scheduling, AI, Reporting, Integration events); values stored verbatim in `audit.audit_events.action`; must remain stable after first use
- `apps/api/src/audit/dto/create-audit-event.dto.ts` — `CreateAuditEventDto` (internal service contract, not exposed via HTTP); `AuditResult` literal union (`'SUCCESS' | 'FAILURE'`) — single authoritative export; `AuditMetadata` typed JSONB interface with named fields and `[key: string]: unknown` index signature
- `apps/api/src/audit/audit.service.ts` — `AuditService.logEvent(dto: CreateAuditEventDto): Promise<void>`; `SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'` exported sentinel (no FK to identity.users — intentional audit trail independence); AUD-1300 non-blocking try/catch; logger.error on failure; PII (userId, entityId, metadata) excluded from log message
- `apps/api/src/audit/audit.module.ts` — `@Global() @Module` with `AuditService` in providers and exports; PrismaModule not imported (PrismaService resolved from global scope); dependency graph: Domain Modules → AuditModule → PrismaModule (global)
- `apps/api/src/audit/audit.service.spec.ts` — 11 unit tests across 6 groups: instantiation (1), successful write path (5), AUD-1300 failure suppression (2), sensitive-data logging restriction (1), SYSTEM_USER_ID constant (1), FAILURE result coverage (1)

**Files Modified (2):**

- `apps/api/prisma/schema.prisma` — `result String @default("SUCCESS") @db.VarChar(50)` added to `AuditEvent` model between `action` and `metadata`; aligns with AUD-100 required fields; additive migration only
- `apps/api/src/app.module.ts` — `import { AuditModule } from './audit/audit.module'` added; `AuditModule` added to imports array (fourth entry, after ConfigModule/PrismaModule/HealthModule); fulfils the existing module registration comment that anticipated Milestone 4

**Auto-Generated (1):**

- `apps/api/prisma/migrations/20260607215441_add_audit_result/migration.sql` — `ALTER TABLE "audit"."audit_events" ADD COLUMN "result" VARCHAR(50) NOT NULL DEFAULT 'SUCCESS'` — single additive statement; applied and verified in live database

#### Key Architectural Decisions

1. **Audit before Authentication (sequencing):** Approved sequencing places Audit Foundation before Authentication Foundation. All auth events (AUTH_LOGIN_SUCCESS through AUTH_ACCOUNT_LOCKOUT) will be auditable from their first implementation. No blueprint changes; implementation sequencing only.
2. **SYSTEM_USER_ID sentinel:** Zero UUID `'00000000-0000-0000-0000-000000000000'` for system-initiated events with no human actor. No FK to identity.users — audit trail must never be corrupted by cascading deletes. Reporting layer handles via LEFT JOIN + COALESCE with 'System' label.
3. **AUD-1300 non-blocking design:** Synchronous write with try/catch suppression. Primary operations (authentication, scheduling, recruiting, reporting) are never blocked by audit subsystem failure. Failed writes are logged for operator visibility but not propagated. Phase 2 upgrade to outbox pattern documented in service comments.
4. **AuditResult as literal union:** Binary semantics per AUD-100. Promotes to enum only if a third architecturally distinct result state emerges. Single authoritative export from create-audit-event.dto.ts.
5. **AuditMetadata as typed JSONB interface:** Phase 1 flexibility with compile-time safety. Metadata promotion schedule: actorType/ipAddress → dedicated columns in Milestone 5; correlationId → Phase 2.
6. **Retention — 10 years applied:** Conservative reconciliation of directive-spec conflict. AUD-1200 in directives/08_audit_rules.md states 7 years; data/03_retention_policy.md states 10 years for Audit Events and Security Events. 10 years applied as the more restrictive value. Directive requires update before any enforcement job is implemented.
7. **@Global() AuditModule pattern:** Mirrors the established PrismaModule global-provider pattern. Domain modules inject AuditService via constructor without importing AuditModule. Validated by e2e bootstrap test confirming AuditService resolves PrismaService from the global scope.

#### Validation

- `tsc --noEmit` (all steps): EXIT 0 — zero type errors
- `nest build` (all steps): EXIT 0 — zero build errors
- `npm test --workspace=apps/api`: EXIT 0 — 37/37 tests pass across 5 suites (26 prior + 11 new); zero regressions
- `npm run test:e2e --workspace=apps/api`: EXIT 0 — 1/1 pass; full AppModule bootstrap with AuditModule registered confirms AuditService resolves PrismaService from global scope
- Live DB verification (Step 1): `result` column confirmed in `audit.audit_events` — NOT NULL, DEFAULT `'SUCCESS'::character varying`, VARCHAR(50)
- `prisma migrate status`: Migration `20260607215441_add_audit_result` confirmed applied

#### Risks / Limitations

1. **No domain callers yet (System Loop gap):** `logEvent()` has never been called in a production context. First real audit events generated in Milestone 5 when AuthService calls logEvent() for authentication events.
2. **Retention directive-spec conflict (open, requires resolution before enforcement):** `directives/08_audit_rules.md` AUD-1200 states 7-year minimum retention. `data/03_retention_policy.md` states 10 years for Audit Events and Security Events. 10 years applied as the conservative value. AUD-1200 must be updated before any retention enforcement job is implemented.
3. **No integration test for full write path:** The write path is unit-tested against mocks. A full integration test (HTTP request → NestJS context → Prisma → live DB → audit record confirmed) is deferred to Milestone 5+ when real HTTP endpoints with auth context exist.
4. **Silent loss on Prisma failure (Phase 1 limitation):** AUD-1300 suppresses errors per spec. Without outbox pattern, a failed Prisma write in logEvent() is logged but the audit event is permanently lost. Phase 2 upgrade to outbox pattern is documented in audit.service.ts comments.
5. **E2E spec comment outdated (minor documentation gap):** `apps/api/test/app.e2e-spec.ts` comment states "No database connection required." Inaccurate since Milestone 3 added PrismaModule. Test behaviour is correct; only the comment is stale. No functional impact.

#### Next Actions

- Proceed to Milestone 5 — Authentication Foundation (IdentityModule, FR-001 User Registration, FR-002 User Authentication)
- Milestone 5 will produce the first real callers of `AuditService.logEvent()` — closing the System Loop gap for D-009
- Update `directives/08_audit_rules.md` AUD-1200 from 7 to 10 years before retention enforcement is implemented (not a Milestone 5 blocker; no enforcement job exists yet)

---

### Entry: 2026-06-05 — Milestone 1: Repository Foundation

Phase: Phase 1 — Foundation
Status: Milestone 1 Complete / Scaffolded
Capability Affected: All domains (monorepo infrastructure; no domain business logic)
FR References: None — infrastructure milestone, no functional requirements implemented

#### What Changed

**New files created (39):**

Root:
- `package.json` — npm workspace config; 5 workspaces; scripts: build, lint, format, test, db:up, db:down, db:logs, setup
- `tsconfig.base.json` — shared strict TypeScript config inherited by all workspaces
- `.eslintrc.js` — shared ESLint rules (TypeScript + Prettier); consistent-type-imports enforced
- `.prettierrc` — formatting config; LF line endings; singleQuote; trailingComma all
- `.prettierignore` — excludes node_modules, .next, dist, coverage, prisma migrations
- `.nvmrc` — pins Node.js 20
- `.env.example` — documents all required env vars with per-milestone population notes
- `SETUP.md` — cross-platform developer onboarding guide using npm scripts

apps/web (Next.js 14, App Router, Tailwind CSS, shadcn/ui):
- `apps/web/package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.js`, `.eslintrc.js`
- `apps/web/src/app/layout.tsx` — root layout stub with metadata
- `apps/web/src/app/page.tsx` — root page stub
- `apps/web/src/app/globals.css` — Tailwind directives

apps/api (NestJS 10, TypeScript):
- `apps/api/package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `.eslintrc.js`
- `apps/api/src/main.ts` — NestJS bootstrap stub
- `apps/api/src/app.module.ts` — root module stub with milestone sequencing comments
- `apps/api/test/app.e2e-spec.ts` — bootstrap validation test (passes without DB)
- `apps/api/test/jest-e2e.json` — e2e Jest config

packages (all empty barrels with milestone population roadmaps):
- `packages/shared/` — @gov-platform/shared (types, constants, validators)
- `packages/ui/` — @gov-platform/ui (shadcn/ui wrappers)
- `packages/config/` — @gov-platform/config (env var schemas)

infrastructure:
- `infrastructure/docker/docker-compose.yml` — postgres service (Phase 1–2)
- `infrastructure/docker/docker-compose.override.yml` — local dev overrides
- `infrastructure/scripts/setup.sh` — CI/CD setup script

CI/CD:
- `.github/workflows/ci.yml` — GitHub Actions: Install → Lint → Build → Test

**Modified:**
- `.gitignore` — added Node.js/TypeScript/Next.js/NestJS/Docker entries
- `README.md` — updated phase status to "Phase 1 Foundation — In Progress"

**Deleted:**
- `apps/web/next.config.ts` — Next.js 14.2.3 does not support `.ts` config extension; replaced with `next.config.mjs`

**Auto-modified by Next.js lint (expected):**
- `apps/web/tsconfig.json` — Next.js added `noEmit: true` and `isolatedModules: true` (required by SWC)

#### Validation

- `npm install`: EXIT 0 — 886 packages installed across all workspaces (5 min)
- `npm run lint`: EXIT 0 — all 5 workspaces clean, no warnings or errors
- `npm run build`: EXIT 0 — NestJS compiles to dist/; Next.js produces 4 static pages (/, /_not-found); packages type-check clean
- `npm run test`: EXIT 0 — API: no unit tests found (passWithNoTests); web: placeholder passes

#### Risks / Limitations

- 28 npm audit vulnerabilities (3 low, 13 moderate, 11 high, 1 critical) from scaffolding packages. These are library-level vulnerabilities; no application code is at risk in the current stub state. Will re-assess when application packages are added in Milestones 3–4.
- Tailwind warning: "No utility classes detected in source files" — expected at this stage; resolved when UI components are built in Milestone 4.
- Node.js 22.20.0 active on developer machine vs `.nvmrc` pinning 20 — both are supported by all current packages. `.nvmrc` targets LTS 20; `engines` field enforces ≥20. No functional impact.

#### Next Actions

- Milestone 3 complete — see entry below

---

### Entry: 2026-06-05 — Milestone 3: Backend Foundation (Complete and Validated)

Phase: Phase 1 — Foundation
Status: Complete and Validated
Capability Affected: Cross-cutting infrastructure — ConfigModule, PrismaModule, HealthModule, ValidationPipe, global prefix, Swagger

#### Capability / Deliverable Alignment

- Capability: Backend Foundation
- Deliverable Status: Required (execution/02_phase_1_foundation.md — Deliverable 3)
- Requirements: Defined — spec/10_backend_architecture.md (Configuration, Health Checks, Validation, API Documentation)
- Specs: Aligned — spec/03_system_architecture.md (Prisma ORM, NestJS), spec/07_security_architecture.md (SEC-004, SEC-007)
- Directives: Aligned — directives/10_role_based_access_rules.md (7 roles accessible via PrismaService)
- Execution Plan: Implemented — execution/02_phase_1_foundation.md Deliverable 3 complete
- State Model: Not applicable at this infrastructure layer
- Test Scenarios: 26 unit tests passing across 4 suites
- System Loop: Integrated — NestJS application starts, PrismaService connects, HealthModule responds
- Failure Playbook: Partial — fail-fast on missing DATABASE_URL; graceful health 503 on DB failure; full playbook deferred
- Environment Model: Integrated — NODE_ENV gates Swagger; DATABASE_URL validated at startup
- Data Lifecycle: Not applicable at this infrastructure layer
- Evolution Strategy: ConfigModule namespaced factories ready for JwtConfig addition (Milestone 6)
- Overall Maturity: **Integrated**

#### What Changed

**Created:**
- `packages/config/src/app.config.ts` — `AppConfig` interface: `{ port, nodeEnv }`
- `packages/config/src/database.config.ts` — `DatabaseConfig` interface: `{ url }`
- `apps/api/src/config/app.config.ts` — `registerAs('app')` factory
- `apps/api/src/config/database.config.ts` — `registerAs('database')` factory
- `apps/api/src/config/env.validation.ts` — class-validator startup gate; aborts on empty/missing `DATABASE_URL`
- `apps/api/src/config/env.validation.spec.ts` — 10 unit tests for validate()
- `apps/api/src/database/prisma.service.ts` — extends PrismaClient; onModuleInit/$connect; onModuleDestroy/$disconnect; DATABASE_URL never logged
- `apps/api/src/database/prisma.module.ts` — @Global() module; exports PrismaService
- `apps/api/src/database/prisma.service.spec.ts` — 3 unit tests: defined, connect once, disconnect once
- `apps/api/src/health/prisma-health.indicator.ts` — custom Terminus indicator; SELECT 1 ping; no-binding catch prevents raw error exposure
- `apps/api/src/health/health.controller.ts` — GET /health; delegates to HealthCheckService; no auth guard
- `apps/api/src/health/health.module.ts` — imports TerminusModule; provides controller and indicator
- `apps/api/src/health/health.controller.spec.ts` — 7 unit tests: indicator up/down/sanitization (4), controller delegation (2), defined (1)

**Modified:**
- `packages/config/src/index.ts` — exports AppConfig, DatabaseConfig via export type
- `apps/api/src/app.module.ts` — ConfigModule.forRoot(), PrismaModule, HealthModule registered
- `apps/api/src/main.ts` — ValidationPipe; setGlobalPrefix('api') with /health exclusion; environment-gated Swagger at /api/docs; ConfigService for port; Logger for startup
- `apps/api/package.json` — 6 runtime deps added; setupFiles: ["reflect-metadata"] in jest config
- `apps/api/tsconfig.build.json` — rootDir: "./src" maintained
- `apps/api/tsconfig.json` — types: ["jest", "node"] confirmed

#### Key Architectural Decisions Made During Implementation

1. **Cross-package import type not used in tsconfig.build.json files** — TS6059 conflict between rootDir: "./src" and path-alias imports to packages/config/src/. Config factories use inferred return types. packages/config interfaces serve apps/web, spec files, and documentation. Noted in factory comments.
2. **prisma-health.indicator.ts added as a separate file** — Extracted from controller to enable isolation testing of the error-sanitization contract (security-critical path).
3. **@IsNotEmpty() added to DATABASE_URL** — @IsString() alone accepts empty strings; test identified the gap. Added to ensure empty DATABASE_URL fails at startup.
4. **setupFiles: ["reflect-metadata"] in jest config** — Required for class-validator/class-transformer decorators in Jest's isolated environment.

#### Validation

- `npm run type-check` (api): EXIT 0
- `npm run build` (root, all 5 workspaces): EXIT 0
- `npm test` (api): EXIT 0 — 26 tests, 4 suites, 0 failures
- `GET /health`: HTTP 200 — `{"status":"ok","info":{"database":{"status":"up"}},...}`
- `GET /api/health`: HTTP 404 — prefix exclusion confirmed
- `GET /api/docs`: HTTP 200 — Swagger UI HTML
- `GET /api/docs-json`: HTTP 200 — openapi 3.0.0, title and paths confirmed
- Fail-fast test (`DATABASE_URL="" node dist/main.js`): aborts immediately — `Environment validation failed: DATABASE_URL should not be empty`

#### Risks / Limitations

- Cross-package type sharing (packages/config → apps/api build files) constrained by rootDir: "./src". Addressed by inferred return types; no TypeScript project references implemented.
- Swagger is environment-gated; Swagger decorators on future endpoints still need to be authored.
- AuditModule (Milestone 4) is the next dependency: PrismaService globally available; no audit events written until Milestone 4.

#### Next Actions

- Proceed to Milestone 4 — Audit Foundation (AuditModule, AuditService, audit_events write path)
- No outstanding blockers

---

### Entry: 2026-06-05 — Milestone 2: Database Foundation (Complete and Validated)

Phase: Phase 1 — Foundation
Status: Complete and Validated
Capability Affected: D-001 Identity & Access (users, roles, user_roles), D-002 Organization Management (tenants), D-009 Compliance & Governance (audit_events); cross-cutting tenant isolation and RBAC foundation

#### Capability / Deliverable Alignment

- Capability: Database Foundation
- Deliverable Status: Required (execution/02_phase_1_foundation.md — Deliverable 2)
- Requirements: Defined — spec/05_database_schema.md (Tenant Strategy, Schema: identity, organization, audit)
- Specs: Authoritative — three-schema design confirmed against spec/05_database_schema.md
- Directives: Aligned — directives/10_role_based_access_rules.md (7 authoritative roles seeded)
- Execution Plan: Implemented — Prisma 5.22.0, schema.prisma, migration scaffold, seed
- State Model: Not yet formalized as a dedicated document (tenant lifecycle not yet codified)
- Test Scenarios: Unit tests present (6 passing); integration tests pending migration
- System Loop: Not yet integrated — NestJS PrismaModule added in Milestone 3
- Failure Playbook: Not yet integrated
- Environment Model: DATABASE_URL configured in root .env and apps/api/.env; postgres service is native PostgreSQL 18 (not Docker on this machine)
- Data Lifecycle: Not yet implemented
- Evolution Strategy: Not yet formalized
- Overall Maturity: **Integrated** (schema live, migration applied, seed validated, unit tests passing)

#### What Changed

**Created:**
- `.env` — root-level local development environment file (not committed; mirrors .env.example)
- `apps/api/.env` — Prisma-specific DATABASE_URL for CLI operations (not committed)
- `apps/api/prisma/schema.prisma` — Prisma 5.22.0 schema with multiSchema preview feature; three PostgreSQL schemas (identity, organization, audit); 7 models: Tenant, User, Role, Permission, RolePermission, UserRole, AuditEvent; all indexes aligned with spec/05_database_schema.md
- `apps/api/prisma/seed.ts` — idempotent upsert seed for 7 authoritative platform roles; exports PLATFORM_ROLES constant
- `apps/api/prisma/migrations/20260605233955_init_foundation/migration.sql` — generated migration SQL; creates 3 schemas, 7 tables, 15 indexes, 5 FK constraints; applied and verified
- `apps/api/src/platform-roles.spec.ts` — 6 unit tests validating the authoritative role set (no DB required)

**Modified:**
- `apps/api/package.json` — added `@prisma/client ^5.22.0` (dependency), `prisma ^5.22.0` (devDependency); added `prebuild: prisma generate`; added scripts: `db:generate`, `db:migrate`, `db:migrate:deploy`, `db:seed`, `db:reset`; added `prisma.seed` configuration entry

#### Schema Architecture Decision

Tenant entity placed in `organization` schema (not `identity`) per spec/05_database_schema.md which places the agency/tenant record under `organization`. This aligns with the spec's schema taxonomy and avoids a correction migration in Phase 2. Decision approved during Milestone 2 implementation.

AuditEvent intentionally has no Prisma relations to Tenant or User — plain UUID columns only. Cascading deletes must never corrupt the audit trail (spec/05_database_schema.md — Schema: audit).

#### Validation

- `npx prisma generate`: EXIT 0 — Prisma client generated for all 7 models; multiSchema preview feature confirmed active
- `npx prisma migrate dev --name init_foundation`: EXIT 0 — migration `20260605233955_init_foundation` applied; 1 step; `_prisma_migrations` table confirms `finished_at: 2026-06-05`
- `npx prisma db seed`: EXIT 0 — 7 roles upserted: System Administrator, HR Director, Workforce Planner, Recruiter, Hiring Manager, Compliance Officer, Executive User
- Live DB queries (govplatform user against gov_workforce_dev):
  - Schemas: audit, identity, organization — 3 rows confirmed
  - Tables: audit_events, permissions, role_permissions, roles, user_roles, users, tenants — 7 rows confirmed
  - Indexes: 15 indexes confirmed (per spec, including all named indexes)
  - FK constraints: 5 constraints confirmed including cross-schema `identity.users → organization.tenants`
  - Role count: `SELECT COUNT(*) FROM identity.roles` → 7
- `npm test`: EXIT 0 — 6/6 unit tests pass
- Environment note: govplatform user required `CREATEDB` privilege for Prisma shadow database during `migrate dev`. This is a dev-only requirement; `migrate deploy` (used in CI/CD and production) does not require `CREATEDB`.

#### Risks / Limitations

- Docker not available on developer machine (Docker Desktop and WSL not installed); `infrastructure/docker/docker-compose.yml` remains the canonical deployment target for CI and other environments; Milestone 9 (Docker Environment) will validate this path
- AuditEvent.tenantId and AuditEvent.userId are plain UUID columns with no Prisma FK — intentional design; application layer must enforce referential validity for audit events
- govplatform requires CREATEDB for local development with `prisma migrate dev`; CI pipeline must either grant this privilege to the test DB user or use `--shadow-database-url` pointing to a superuser connection

#### Next Actions

- Proceed to Milestone 3 — Backend Foundation (ConfigModule, PrismaModule, HealthModule, NestJS module wiring)
- No outstanding blockers for Milestone 3

---

### Entry: 2026-06-05 — Full Blueprint Technology Stack Alignment

Phase: Pre-Implementation — Blueprint Remediation
Status: Blueprint Fully Aligned / Phase 1 Ready
Capability Affected: All domains (cross-cutting architecture and technology baseline)

#### What Changed

14 blueprint documents updated to align with the approved technology stack (Next.js, TypeScript, Tailwind CSS, shadcn/ui, NestJS, PostgreSQL, Prisma ORM, OpenAI API, Docker, CI/CD, Hetzner):

- **spec/03_system_architecture.md**: Architecture diagram, Presentation/Intelligence/Data/Infrastructure layer technology, AI Architecture section (removed apps/ai-service, introduced NestJS Intelligence Module), Redis Usage and MinIO Usage sections replaced with deferred/PostgreSQL approach, Architecture Decision Summary table updated, Services list updated, Networking section updated
- **spec/09_frontend_architecture.md**: Framework React→Next.js, Build Tool Vite→Next.js built-in, Routing React Router→Next.js App Router, Application Structure updated to App Router conventions, Purpose section updated
- **spec/11_ai_architecture.md**: Service architecture deployment updated (apps/ai-service→apps/api/src/modules/intelligence), Technology Python/FastAPI→TypeScript/NestJS, Module structure updated, Runtime architecture diagram updated, Prompt directory updated, Failure handling updated, Acceptance criteria updated
- **spec/08_deployment_architecture.md**: Local environment characteristics, service topology diagram, Docker services list, container responsibilities (traefik/ai-service/redis/minio sections removed), network segmentation, SSL strategy, storage architecture, backup strategy, recovery process, infrastructure constraints, monitoring metrics, health checks, scalability roadmap updated
- **spec/10_backend_architecture.md**: Background processing BullMQ/Redis→NestJS Scheduled Tasks with PostgreSQL-based approach (deferred), Cache Redis→removed, Services may call AI Services→Intelligence Module, Health check updated, Next Blueprint reference updated
- **meta/01_assumptions_and_decisions.md**: D-006 (Redis) superseded with PostgreSQL-based approach; D-007 (MinIO) deferred to Phase 3; D-023 (Next.js frontend framework) added; D-024 (NestJS AI integration architecture) added
- **spec/02_non_functional_requirements.md**: NFR-012 MinIO backup target replaced with deferred note
- **spec/14_testing_strategy.md**: Integration test scope (Redis/MinIO→OpenAI), reliability testing (Queue/AI Service Recovery→OpenAI failure handling), disaster recovery (MinIO Recovery removed)
- **spec/15_implementation_roadmap.md**: Phase 1 deliverables updated (Traefik/Redis/MinIO removed, FastAPI→NestJS Intelligence Module, React Setup→Next.js Setup)
- **spec/12_reporting_architecture.md**: Report storage updated (MinIO→PostgreSQL with Phase 3 file storage deferred)
- **spec/13_integration_architecture.md**: Document storage Phase 1 updated (MinIO→deferred to Phase 3)
- **spec/06_api_contracts.md**: Resume upload storage updated (MinIO→deferred to Phase 3)
- **spec/07_security_architecture.md**: Data at rest (MinIO removed), network segmentation (Traefik/AI Service/Redis/MinIO removed), Next Blueprint reference (Traefik→Docker Compose config)

#### Validation

- Tests added: None
- Tests passing: None
- Verification: Full grep sweep confirmed zero unintentional occurrences of React (as framework), Vite, FastAPI, MinIO, Traefik, Redis (as mandatory infrastructure) across all blueprint documents; all remaining occurrences are intentional (deferred option notes, library names compatible with Next.js, historical PROGRESS.md entries)
- Known unverified areas: No executable code exists; alignment is blueprint-level only

#### Risks / Limitations

- Background job approach (PostgreSQL-based via NestJS Scheduled Tasks) deferred to Phase 2 — no concrete implementation spec yet; Phase 2 planning must scope this
- File/document storage (resumes, report exports, audit exports) deferred to Phase 3 — Phase 3 planning must select and specify object storage approach
- spec/11_ai_architecture.md acceptance criteria point 1 now reads "AI isolated in dedicated NestJS intelligence module" — this should be validated against the final Phase 4 implementation design

#### Next Actions

- Proceed to Phase 1 Foundation implementation
- No remaining blueprint blockers

---

### Entry: 2026-06-05 — Role Alignment and Phase 1 Readiness Assessment

Phase: Pre-Implementation — Blueprint Remediation
Status: Blueprint Corrected / Phase 1 Unblocked
Capability Affected: D-001 Identity & Access (roles table schema); all domains (cross-cutting RBAC)

#### What Changed

- directives/10_role_based_access_rules.md: "Department Manager" renamed to "Hiring Manager"; "Employee" role removed; "Executive User" role added with capabilities and authorization rules RBAC-950, RBAC-951, RBAC-952; RBAC-700 and RBAC-701 updated to include Hiring Manager in candidate and hiring approval workflows
- execution/02_phase_1_foundation.md: Role seed list updated — "Department Manager" replaced by "Hiring Manager"; "Employee" removed; "Executive User" added
- state/03_schedule_lifecycle.md: Schedule approval role corrected from "Department Manager" to "Hiring Manager"

#### Validation

- Tests added: None
- Tests passing: None
- Verification: Full grep sweep confirmed zero remaining "Department Manager" occurrences across all blueprint documents; "Employee" confirmed as data entity only in remaining references; "Hiring Manager" and "Executive User" now present in all authoritative documents
- Known unverified areas: No executable RBAC tests exist; role alignment is blueprint-level only

#### Risks / Limitations

- New finding during sweep: meta/00_project_classification.md technology baseline lists React + Vite + Python + FastAPI; all other authoritative documents (README.md, execution/02, spec/09, spec/10) specify Next.js + NestJS + TypeScript; this is a documentation inconsistency that does not block Phase 1 but must be corrected before implementation begins
- User session states not in a dedicated state document; user lifecycle (Invited → Active → Suspended → Deactivated) is derivable from spec/04_domain_model.md; accepted risk for Phase 1 schema work
- tests/ folder naming collision: blueprint spec documents live in root-level tests/; Phase 1 monorepo plan also expects a tests/ folder with unit/integration/e2e subdirectories; must be resolved before monorepo scaffold

#### Next Actions

- Seek approval to correct meta/00_project_classification.md technology baseline
- Resolve tests/ folder naming collision before Phase 1 monorepo scaffold
- Begin Phase 1 Foundation implementation

---

### Entry: 2026-06-05 — PROGRESS.md Restructured to Capability Maturity Ledger

Phase: Pre-Implementation
Status: Blueprint Complete / Implementation Not Started
Capability Affected: Repository governance (no domain implementation affected)

#### What Changed

- PROGRESS.md restructured from flat blueprint-completion list to 5-zone capability maturity ledger
- All 15 domains assessed against 11-layer Production Blueprint model at current (Planned) maturity
- All 69 functional requirements enumerated and classified
- Blueprint documentation layer status relabeled to accurately distinguish docs from implementation
- Global platform acceptance criteria table introduced
- Chronological history section established
- Known directive gaps identified: Employee Management (D-003), Reporting & Intelligence (D-012), Integrations (D-015)
- Known state model gaps identified: Identity/Session (D-001), Organization (D-002), Skills (D-008), Notifications (D-011), Hiring Workflow (D-006)
- Audit logging (FR-500) flagged as requiring earlier implementation than execution/06 plan currently places it

#### Validation

- Tests added: None
- Tests passing: None
- Verification performed: Repository file structure verified; all referenced blueprint files confirmed to exist
- Known unverified areas: All implementation; all test specifications are documents, not executable tests

#### Risks / Limitations

- Zero executable code exists — all capability maturity is Planned
- Three directive gaps will block implementation of those domains until authored
- Audit logging placement in Phase 5 plan is a risk — it is a cross-cutting infrastructure requirement that should be wired into Phase 1
- AI Governance has no unified directive; FR-903 (no autonomous decisions) must be architecturally enforced before any AI code is written

#### Next Actions

- Author missing directives before implementing the domains that lack them (Employee Management, Reporting, Integrations)
- Flag audit logging (FR-500) for Phase 1 implementation as shared infrastructure
- Begin Phase 1 Foundation: Identity & Access (D-001) and Organization Management (D-002)
- No approval required for directive authoring; approval required before any schema changes or execution code is committed

---

### Entry: 2026-06-04 — Blueprint Complete

Phase: Pre-Implementation
Status: Blueprint Complete / Implementation Not Started

#### What Changed

- All 12 blueprint documentation layers authored and committed
- 69 functional requirements defined across 15 domains in spec/01_requirements.md
- Architecture, directives, state models, test specifications, runtime specifications, failure playbooks, environment model, data lifecycle, and evolution strategy documented

#### Validation

- Tests added: None
- Tests passing: None
- Verification performed: Documentation reviewed and committed to repository
- Known unverified areas: All — no implementation has been validated

#### Risks / Limitations

- No implementation code exists
- All capabilities are at Planned maturity
- All test specifications are design documents — none are executable

#### Next Actions

- Restructure PROGRESS.md to capability maturity tracking format (completed 2026-06-05)
- Begin Phase 1 implementation: Identity & Access and Organization Management
- Confirm technology stack and environment setup before writing execution code