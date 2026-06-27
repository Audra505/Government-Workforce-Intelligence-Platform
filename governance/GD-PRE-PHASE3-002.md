# Governance Decision: GD-PRE-PHASE3-002
# Candidate Domain Data Model, Schema Authority, and Tenant Isolation

Project: AI-Driven Staffing Optimization Platform for Government HR

Decision ID: GD-PRE-PHASE3-002

Status: Approved

Date: 2026-06-27

Approved By: Product Owner — Pre-Phase-3 Governance Review

Milestone Context:
Pre-Phase-3 governance recording. Establishes canonical recruiting domain schema
authority for Phase 3, resolves tenant isolation defects in existing spec/05
recruiting tables, defines lifecycle status values, and creates the missing offers
table definition. Required before any Phase 3 schema migration can be written.

Depends On:
- GD-PRE-PHASE3-001 (Phase 3 scope boundary; Phase 3 implementation not yet authorized)
- GD-PRE-PHASE3-004 (FR-152 excluded from Phase 3; Phase 4 assignment confirmed)
- GD-PRE-M13-001 (VAC-401 dual-path authority; COMPETITIVE_APPOINTMENT system-only)
- GD-M13-1 (SEC-003 tenant isolation precedent for catalog tables)
- GD-M13-4 (AuditEventType naming pattern; audit trail precedent)

References:

- spec/01_requirements.md — FR-300 (Candidate Intake), FR-302 (Resume Processing),
  FR-303 (Candidate Matching), FR-304 (Hiring Workflow)
- spec/04_domain_model.md — Candidate, Application, Interview entities
- spec/05_database_schema.md — recruiting schema (candidates, resumes, applications,
  interviews tables as currently defined; offers table absent)
- spec/06_api_contracts.md — Candidate API and Hiring Workflow API stubs
- spec/07_security_architecture.md — SEC-003 tenant isolation
- execution/04_phase_3_recruiting_and_staffing.md — Phase 3 deliverables and
  lifecycle states
- governance/GD-PRE-M13-001.md — COMPETITIVE_APPOINTMENT reserved value;
  VAC-401 Path B hire-to-employee contract scope
- governance/GD-PHASE2-CLOSURE-001.md — Notification Integration Phase 5;
  spec/15 governs over execution plan documents

---

# Context

## Why This Decision Is Required

Phase 3 recruiting and staffing implementation cannot begin from the current
spec/05 recruiting schema definitions. The following defects were identified
during pre-Phase-3 governance inspection:

**Tenant Isolation Violations (SEC-003):**
The following tables in spec/05 are missing `tenant_id`:

```text
recruiting.resumes       — no tenant_id column defined
recruiting.applications  — no tenant_id column defined
recruiting.interviews    — no tenant_id column defined
```

`recruiting.candidates` has `tenant_id` defined in spec/05. The other three
tables do not. Implementing these tables without `tenant_id` would produce
a multi-tenant security defect: tenant-scoped list queries would have no
isolation predicate, and a sufficiently crafted request could access another
tenant's application or interview records.

SEC-003 applies to all tenant-owned data. This is not a spec deviation from
this GD — it is a correction of a spec/05 oversight, following the precedent
established in GD-M13-1 Decision 7 (where `tenant_id` was added to
`workforce.skills` and `workforce.certifications` under the same authority).

**Missing Table:**
The `recruiting.offers` table does not exist in spec/05. Execution/04
Deliverable 4 (Offer Management) is Required and defines a 7-state offer
lifecycle. No table definition exists to support it. This GD creates the
canonical definition.

**Application Lifecycle State Conflict:**
Two source documents define incompatible application status state lists:

```text
execution/04 Deliverable 2:
  Submitted / Screening / Interview / Offer / Hired / Rejected / Withdrawn

spec/01 FR-304:
  Applied / Screening / Interview / Evaluation / Offer / Hired / Rejected
```

These lists conflict on: the initial state name (Submitted vs Applied), the
presence of Evaluation as a stage, and the presence of Withdrawn. Neither list
is authoritative without a governance decision. This GD resolves the conflict.

**Soft Delete Absent:**
`deleted_at` is missing from all four existing recruiting tables in spec/05.
The platform uses soft delete as the standard record disposition pattern
(established across Phase 2 tables). Recruiting tables must follow the same
pattern.

**Interview Table Structural Gap:**
`spec/05 recruiting.interviews` defines `interviewer VARCHAR(255)` as a
freetext field. Execution/04 Deliverable 3 defines 4 interview types
(Phone Screening, Panel Interview, Technical Interview, Final Interview)
but the table has no `interview_type` column. This GD corrects both defects.

---

# Decisions

## Decision 1 — SEC-003 Tenant Isolation Authority for Recruiting Domain

All tenant-owned tables in the `recruiting` schema must include `tenant_id`.

This applies to every table in the `recruiting` schema, including tables
defined in this GD and any future recruiting tables created in Phase 3 or
later milestones.

The following rules apply to `tenant_id` across all recruiting endpoints:

```text
tenant_id must be derived exclusively from the JWT/session context.
  — NestJS extracts tenantId from the decoded JWT payload (SEC-003).
  — No recruiting endpoint may accept tenantId from the request body.
  — Any request body containing tenantId is rejected.

tenant_id must never be exposed in public API response bodies.
  — tenant_id must be excluded from all response DTOs.
  — This applies to candidates, applications, interviews, offers, and
    any other recruiting entity.
  — Exception requires an explicit future governance decision.

All list, detail, update, and delete operations must be tenant-scoped.
  — Every database query on a recruiting table must include a WHERE
    tenant_id = :tenantId predicate.
  — tenant_id is injected from JWT context at the service layer, not
    passed from the controller.
```

Rationale: SEC-003 is a platform-wide invariant. The recruiting schema
represents a new domain with multiple tables. Defining tenant isolation
authority here, before any migration is written, prevents the Phase 2
pattern where individual milestones had to correct oversight table by
table (GD-M13-1).

---

## Decision 2 — Soft Delete Authority for Recruiting Domain

All tenant-owned operational records in the `recruiting` schema must support
soft delete using a `deleted_at TIMESTAMPTZ` nullable column.

```text
deleted_at IS NULL     — record is active
deleted_at IS NOT NULL — record is soft-deleted (archived/withdrawn/closed)
```

Hard (physical) delete is not part of early Phase 3 scope. No endpoint in
Phase 3 milestones may perform a `DELETE FROM recruiting.*` statement on
a candidate, application, interview, or offer record. All disposal operations
use the soft-delete pattern.

Exceptions to hard delete prohibition require an explicit governance decision
citing the specific record type and business justification (e.g., GDPR/PII
erasure requests in a future compliance milestone).

---

## Decision 3 — Canonical Table: recruiting.candidates

The authoritative column set for `recruiting.candidates` is:

```sql
CREATE TABLE recruiting.candidates (
    id           UUID PRIMARY KEY,
    tenant_id    UUID NOT NULL,
    first_name   VARCHAR(100) NOT NULL,
    last_name    VARCHAR(100) NOT NULL,
    email        VARCHAR(255) NOT NULL,
    phone        VARCHAR(50),
    status       VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    source       VARCHAR(100),
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at   TIMESTAMPTZ
);
```

Required indexes:

```sql
CREATE INDEX idx_candidates_tenant
    ON recruiting.candidates(tenant_id);

CREATE INDEX idx_candidates_tenant_status
    ON recruiting.candidates(tenant_id, status)
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_candidates_tenant_email
    ON recruiting.candidates(tenant_id, email)
    WHERE deleted_at IS NULL;
```

The email uniqueness index is per-tenant and excludes soft-deleted records.
A re-applicant whose old record is archived may create a new active candidate
record with the same email.

Spec/05 Deviation: The existing `recruiting.candidates` definition in spec/05
lacks `phone` type precision, is missing `source`, `notes`, `deleted_at`,
and the uniqueness constraint. This GD is the authoritative definition.
spec/05 must be amended to match.

---

## Decision 4 — Canonical Table: recruiting.applications

The authoritative column set for `recruiting.applications` is:

```sql
CREATE TABLE recruiting.applications (
    id             UUID PRIMARY KEY,
    tenant_id      UUID NOT NULL,
    candidate_id   UUID NOT NULL,
    vacancy_id     UUID NOT NULL,
    status         VARCHAR(50) NOT NULL DEFAULT 'APPLIED',
    submitted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_stage  VARCHAR(100),
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at     TIMESTAMPTZ
);
```

Required indexes and constraints:

```sql
CREATE INDEX idx_applications_tenant
    ON recruiting.applications(tenant_id);

CREATE INDEX idx_applications_candidate
    ON recruiting.applications(candidate_id);

CREATE INDEX idx_applications_vacancy
    ON recruiting.applications(vacancy_id);

CREATE INDEX idx_applications_tenant_status
    ON recruiting.applications(tenant_id, status)
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_applications_candidate_vacancy_active
    ON recruiting.applications(tenant_id, candidate_id, vacancy_id)
    WHERE deleted_at IS NULL AND status NOT IN ('REJECTED', 'WITHDRAWN');
```

Required foreign keys:

```sql
ALTER TABLE recruiting.applications
    ADD CONSTRAINT fk_application_candidate
    FOREIGN KEY (candidate_id) REFERENCES recruiting.candidates(id);

ALTER TABLE recruiting.applications
    ADD CONSTRAINT fk_application_vacancy
    FOREIGN KEY (vacancy_id) REFERENCES workforce.vacancies(id);
```

Spec/05 Deviation: The existing `recruiting.applications` definition in spec/05
lacks `tenant_id`, `notes`, `current_stage`, `deleted_at`, and the uniqueness
constraint. The foreign key for `vacancy_id` was not defined in spec/05's FK
section. This GD is the authoritative definition. spec/05 must be amended.

---

## Decision 5 — Canonical Table: recruiting.interviews

The authoritative column set for `recruiting.interviews` is:

```sql
CREATE TABLE recruiting.interviews (
    id                   UUID PRIMARY KEY,
    tenant_id            UUID NOT NULL,
    application_id       UUID NOT NULL,
    interview_type       VARCHAR(50) NOT NULL,
    scheduled_at         TIMESTAMPTZ,
    status               VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
    interviewer_name     VARCHAR(255),
    interviewer_user_id  UUID,
    feedback             TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at           TIMESTAMPTZ
);
```

Required indexes and constraints:

```sql
CREATE INDEX idx_interviews_tenant
    ON recruiting.interviews(tenant_id);

CREATE INDEX idx_interviews_application
    ON recruiting.interviews(application_id);

ALTER TABLE recruiting.interviews
    ADD CONSTRAINT fk_interview_application
    FOREIGN KEY (application_id) REFERENCES recruiting.applications(id);
```

Interviewer Field Authority:

`interviewer VARCHAR(255)` in spec/05 is replaced by two columns:

```text
interviewer_name     — freetext; for external interviewers not on the platform
interviewer_user_id  — nullable UUID FK; for platform users conducting interviews
```

Both are nullable. At least one must be present when an interview record is
created. Enforcement is at the service layer, not the database constraint
layer, to allow flexibility for panel interview records.

`interviewer_user_id` does not carry a database-level FK constraint in Phase 3
because the platform User table is managed separately and user records may be
in a different schema. Service-layer validation confirms that when
`interviewer_user_id` is provided, the referenced user belongs to the same
tenant.

Spec/05 Deviation: The existing `recruiting.interviews` definition in spec/05
lacks `tenant_id`, `interview_type`, `status`, `interviewer_name`,
`interviewer_user_id`, `deleted_at`. The single `interviewer VARCHAR(255)` field
is superseded by the dual-field design above. This GD is the authoritative
definition. spec/05 must be amended.

---

## Decision 6 — Canonical Table: recruiting.offers (New)

The `offers` table does not exist in spec/05. This GD creates its canonical
definition.

```sql
CREATE TABLE recruiting.offers (
    id             UUID PRIMARY KEY,
    tenant_id      UUID NOT NULL,
    application_id UUID NOT NULL,
    status         VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
    offer_date     TIMESTAMPTZ,
    accepted_at    TIMESTAMPTZ,
    declined_at    TIMESTAMPTZ,
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at     TIMESTAMPTZ
);
```

Required indexes and constraints:

```sql
CREATE INDEX idx_offers_tenant
    ON recruiting.offers(tenant_id);

CREATE INDEX idx_offers_application
    ON recruiting.offers(application_id);

CREATE UNIQUE INDEX idx_offers_application_active
    ON recruiting.offers(application_id)
    WHERE deleted_at IS NULL AND status NOT IN ('DECLINED', 'WITHDRAWN');

ALTER TABLE recruiting.offers
    ADD CONSTRAINT fk_offer_application
    FOREIGN KEY (application_id) REFERENCES recruiting.applications(id);
```

The uniqueness index enforces one active offer per application at a time.
A new offer may only be created after the previous offer reaches a terminal
state (DECLINED or WITHDRAWN).

Spec/05 Amendment Required: spec/05 must be amended to add the
`recruiting.offers` table. Until spec/05 is amended, this GD is the
authoritative definition for offer schema implementation.

---

## Decision 7 — Canonical Table: recruiting.resumes (Boundary)

Resume metadata is excluded from early Phase 3 implementation unless a
separate governing decision explicitly authorizes it.

Resume file storage infrastructure (S3-compatible object storage, local
filesystem, or other mechanism) is not governed by this decision and is not
authorized.

AI resume parsing (FR-302) is Phase 4 per GD-PRE-PHASE3-001 Decision 3.

If resume metadata is implemented in a future Phase 3 milestone, the
`recruiting.resumes` table must conform to the following minimum definition:

```sql
CREATE TABLE recruiting.resumes (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL,
    candidate_id        UUID NOT NULL,
    original_file_name  VARCHAR(500) NOT NULL,
    storage_key         VARCHAR(1000),
    parsed_status       VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);
```

`storage_key` is nullable because metadata-only records may be created before
a storage backend is available.

A governing decision must authorize the storage backend choice, set
`parsed_status` enum values, and authorize the upload endpoint before any
resume implementation begins.

Spec/05 Deviation: The existing `recruiting.resumes` definition lacks
`tenant_id` and `deleted_at`. If implemented, the definition above supersedes
spec/05. spec/05 must be amended.

---

## Decision 8 — Canonical Lifecycle Status Values

### Candidate Status

```text
ACTIVE    — candidate record is active and eligible for applications
ARCHIVED  — candidate record is soft-deleted; no new applications accepted
```

Candidate status is deliberately minimal. Candidates are not workflow
participants in a state machine — they are records that are either active or
archived. Application status carries the workflow progression.

### Application Status (Canonical — Resolves Conflict)

The conflict between `execution/04` (Submitted) and `spec/01 FR-304` (Applied)
is resolved in favor of `spec/01` authority:

```text
APPLIED     — application submitted; initial state (replaces "Submitted")
SCREENING   — recruiter is reviewing the application
INTERVIEW   — candidate is in interview stage
EVALUATION  — candidate is being formally evaluated (post-interview)
OFFER       — offer has been extended or is in progress
HIRED       — candidate has been hired; terminal state
REJECTED    — application rejected; terminal state
WITHDRAWN   — candidate withdrew; terminal state
```

`APPLIED` is the canonical initial state. `Submitted` is superseded for all
Phase 3 implementation. The inclusion of `EVALUATION` from spec/01 is
confirmed — it represents the deliberation stage between interview completion
and offer decision, which is a distinct operational step in government hiring.

Terminal states: `HIRED`, `REJECTED`, `WITHDRAWN`. No transitions out of
terminal states are permitted.

execution/04 Deviation: execution/04 Deliverable 2 uses `Submitted` as the
initial state. This GD supersedes that usage. `APPLIED` is the canonical
value.

### Interview Status

```text
SCHEDULED   — interview has been scheduled; initial state
COMPLETED   — interview took place; feedback may be recorded
CANCELLED   — interview was cancelled; may be rescheduled (not terminal)
NO_SHOW     — candidate did not appear; distinct from cancellation
```

### Interview Type

```text
PHONE_SCREEN  — initial phone or video screening
PANEL         — panel interview with multiple interviewers
TECHNICAL     — technical assessment or skills evaluation interview
FINAL         — final round interview before offer decision
```

These values supersede the prose labels in execution/04 Deliverable 3
("Phone Screening", "Panel Interview", "Technical Interview", "Final Interview")
with normalized snake-case equivalents suitable for database enforcement.

### Offer Status

```text
DRAFT           — offer is being prepared; not yet submitted for approval
PENDING_APPROVAL — offer submitted for Hiring Manager / HR Director review
APPROVED        — offer approved; ready to send
SENT            — offer sent to candidate
ACCEPTED        — candidate accepted; terminal state
DECLINED        — candidate declined; terminal state
WITHDRAWN       — offer withdrawn by agency; terminal state
```

Terminal states: `ACCEPTED`, `DECLINED`, `WITHDRAWN`.

---

## Decision 9 — Foreign Key and Uniqueness Authority

### Required Foreign Key Relationships

```text
recruiting.applications.candidate_id
  → recruiting.candidates(id)
  — an application must reference a valid candidate

recruiting.applications.vacancy_id
  → workforce.vacancies(id)
  — an application must reference a valid vacancy

recruiting.interviews.application_id
  → recruiting.applications(id)
  — an interview must reference a valid application

recruiting.offers.application_id
  → recruiting.applications(id)
  — an offer must reference a valid application

recruiting.resumes.candidate_id  (if implemented)
  → recruiting.candidates(id)
  — a resume must reference a valid candidate
```

Cross-schema FK from `recruiting.applications.vacancy_id` to
`workforce.vacancies` is required. Prisma handles cross-schema FKs through
the schema attribute on the model.

### Uniqueness: One Active Application Per Candidate Per Vacancy

A candidate may not have more than one active application to the same vacancy
within the same tenant.

```text
Uniqueness constraint:
  tenant_id + candidate_id + vacancy_id
  WHERE deleted_at IS NULL
  AND status NOT IN ('REJECTED', 'WITHDRAWN')
```

A candidate whose prior application reached a terminal state of REJECTED or
WITHDRAWN may submit a new application to the same vacancy if the vacancy
is still open and accepting applications. The uniqueness constraint is
enforced only on active (non-terminal, non-deleted) applications.

---

## Decision 10 — Hire-to-Employee Schema Implications (Boundary Record)

The full hire-to-employee conversion contract (VAC-401 Path B,
`POST /applications/{id}/hire`) requires additional governing decisions that
are outside the scope of this GD.

This decision records the boundaries and open items that a future hire
conversion governance decision must address:

```text
Employee creation at hire:
  — appointmentAuthority: COMPETITIVE_APPOINTMENT (system-assigned, per GD-PRE-M13-001)
  — vacancyId: derived from the application's vacancy_id
  — candidateId: derived from the hiring application
  — positionId: derived from the vacancy's authorized position_id
  — employmentStatus at hire: PENDING_ONBOARDING or ACTIVE (not yet governed)
  — employeeNumber: auto-generated by the existing EMP-100 series or HR-provided
    (not yet governed; follow pattern established in M12)
  — departmentId: derived from the vacancy's position's department_id

Automation at hire:
  — vacancy status → FILLED
  — remaining APPLIED/SCREENING/INTERVIEW applications to same vacancy → REJECTED
    (or a designated CLOSED_BY_HIRE terminal status — not yet governed)
  — offer record status → ACCEPTED (if offer was in SENT state at hire)

Audit event sequence:
  — not yet governed; must follow GD-M13-4 pattern

Whether a hiring_events table is required:
  — not yet governed; open question for future hire conversion GD

Vacancy position availability check at hire:
  — what happens if the vacancy's position was filled by another hire between
    vacancy creation and this hire event (race condition)
  — must be governed before hire-to-employee implementation
```

No implementation of hire-to-employee conversion is authorized by this GD.
A dedicated governing decision covering the above items is required before
M19 (Hire-to-Employee) milestone is planned.

---

## Decision 11 — Resume File Storage and AI Parsing Boundary

The following are explicitly not authorized by this GD:

```text
Resume file storage infrastructure
  — no S3, GCS, Azure Blob, local volume, or any other storage backend is
    authorized for resume files
  — POST /api/v1/candidates/{id}/resume file upload is not authorized for
    Phase 3 implementation without a separate storage governance decision

AI resume parsing (FR-302)
  — Phase 4 per GD-PRE-PHASE3-001 Decision 3
  — no resume parsing service, parsing queue, or parsed output storage
    is authorized in Phase 3

Parsed skill/certification extraction from resumes
  — not authorized in Phase 3
  — if parsed_status column is implemented as a placeholder, it holds
    the value PENDING only; no parsing workflow exists until Phase 4
```

The `parsed_status` column in `recruiting.resumes` (if implemented) is a
forward-compatibility placeholder. Its only valid value in Phase 3 is PENDING.

---

## Decision 12 — Spec Amendment Authority

Until `spec/05_database_schema.md` and `spec/06_api_contracts.md` are formally
amended to incorporate these definitions, this GD governs over conflicting
spec/05 and spec/06 Phase 3 recruiting schema references.

The authority hierarchy for Phase 3 recruiting schema:

```text
1. This GD (GD-PRE-PHASE3-002)         — authoritative for schema design
2. spec/15_implementation_roadmap.md   — authoritative for phase scope
3. GD-PRE-PHASE3-001                   — authoritative for scope boundary
4. spec/05_database_schema.md          — to be amended; not yet authoritative
   for tables where this GD differs
5. execution/04                        — superseded where it conflicts with
   GDs per GD-PHASE2-CLOSURE-001 D1
   authority hierarchy precedent
```

A future spec/05 amendment PR should update the recruiting schema section
to match the table definitions in Decisions 3–7. A future spec/06 amendment
PR should update recruiting API request/response contracts (governed by
GD-PRE-PHASE3-003 RBAC authority, not this GD).

---

## Decision 13 — M16 Authorization Impact

This GD is necessary but not sufficient for M16 authorization.

M16 (Candidate Management Foundation) may begin milestone planning and
implementation only when both of the following are approved:

```text
GD-PRE-PHASE3-002 (this document) — schema authority    APPROVED
GD-PRE-PHASE3-003 — recruiting RBAC authority           PENDING
```

M16 remains blocked until GD-PRE-PHASE3-003 is approved.

---

## Decision 14 — Explicit Exclusions

This GD does not authorize any of the following:

```text
Prisma schema file changes (apps/api/prisma/schema.prisma)
Database migration files
NestJS service, controller, module, or guard code
DTOs or validation classes
Frontend pages, components, or BFF routes
Resume file upload or storage
AI resume parsing or parsing services
AI candidate matching (FR-303) — Phase 4
Offer workflow implementation
Hire-to-employee conversion implementation
Notification integration — Phase 5
Dashboards or reporting — Phase 5
D-005 Scheduling — Phase 8
FR-152 Competency Framework — Phase 4
Position Skills/Certifications — GD-M13-5-FOLLOWUP pending
User Management UI
Any test file creation or modification
```

---

# Impact on Existing Governance

| Decision | Status | Notes |
|---|---|---|
| GD-M13-1 | Unchanged | SEC-003 tenant isolation precedent confirmed and extended to recruiting domain |
| GD-PRE-M13-001 | Unchanged | COMPETITIVE_APPOINTMENT system-only value; VAC-401 Path B hire-to-employee boundary recorded in Decision 10 |
| GD-PRE-PHASE3-001 | Satisfied (partial) | GD-PRE-PHASE3-002 listed as required; issuing this decision satisfies that requirement; GD-PRE-PHASE3-003 still required |
| GD-PRE-PHASE3-004 | Unchanged | FR-152 excluded from Phase 3; no competency tables authorized here |
| spec/05 (recruiting section) | Superseded where conflicting | Tables in Decisions 3–6 are the authoritative definitions; spec/05 amendment deferred to a future PR |

---

Effective Date: 2026-06-27

Scope: Recruiting domain schema authority; tenant isolation rules; lifecycle
status canonical values; table definitions for candidates, applications,
interviews, offers, and resumes (boundary). Does not authorize Prisma schema
changes, migrations, application code, frontend, or any runtime changes.

Implementation Not Authorized: M16 remains blocked until GD-PRE-PHASE3-003
Recruiting RBAC Authority is approved.
