# Governance Decision: GD-PRE-PHASE3-003
# Recruiting RBAC Authority — Phase 3 Endpoint Access Matrix

Project: AI-Driven Staffing Optimization Platform for Government HR

Decision ID: GD-PRE-PHASE3-003

Status: Approved

Date: 2026-06-27

Approved By: Product Owner — Pre-Phase-3 Governance Review

Milestone Context:
Pre-Phase-3 governance recording. Establishes canonical RBAC authority for all
Phase 3 Recruiting & Staffing endpoints, resolves conflicts between spec/06 and
directives/10 on HR Director and Hiring Manager candidate access, scopes Hiring
Manager access to application/vacancy context, and defines the minimum RBAC
required for M16. Required before any Phase 3 API implementation begins.

Depends On:
- GD-PRE-PHASE3-001 (Phase 3 scope boundary; implementation not yet authorized)
- GD-PRE-PHASE3-002 (recruiting schema authority; tenant isolation rules)
- GD-PRE-PHASE3-004 (FR-152 Phase 4 assignment; excluded from Phase 3)
- GD-M12-3 (Employee RBAC authority precedent; EMP-AUTH series pattern)
- GD-M13-2 (Catalog RBAC authority precedent; per-endpoint RBAC pattern)
- GD-M15-1 Decision 10 (SA + HR Director authority for assign-position precedent)

References:

- spec/06_api_contracts.md — RBAC matrix (line 839; conflicts identified below)
- directives/10_role_based_access_rules.md — RBAC-700, RBAC-701, role definitions
- spec/01_requirements.md — FR-300 (Candidate Intake), FR-304 (Hiring Workflow)
- spec/07_security_architecture.md — SEC-003 tenant isolation
- spec/15_implementation_roadmap.md — Phase 3 success criteria
- governance/GD-PRE-M13-001.md — COMPETITIVE_APPOINTMENT system-only; Path B authority
- governance/GD-PRE-PHASE3-002.md — recruiting schema; lifecycle status values

---

# Context

## RBAC Conflicts Requiring Resolution

Two source documents assign conflicting access to the Candidates domain:

**spec/06 RBAC matrix (line 839):**

```text
| Endpoint Group | Admin | HR Director | Planner | Recruiter | Compliance |
|----------------|-------|-------------|---------|-----------|------------|
| Candidates     | Yes   | No          | No      | Yes       | No         |
```

Issues with this matrix:
- HR Director is classified as No on Candidates — contradicts RBAC-700
- Hiring Manager column is absent entirely
- Compliance Officer read-only access is not addressed
- The matrix applies to endpoint groups, not individual endpoints; no
  read/write distinction is made within a group

**directives/10 RBAC-700:**

```text
Candidate management allowed for:
  Recruiter
  Hiring Manager
  HR Director
```

Issues with RBAC-700:
- Hiring Manager is granted candidate management access with no scope constraint;
  unrestricted global candidate pool access for Hiring Manager is inappropriate
  for a government HR platform where candidates may apply to positions in other
  departments
- "Management" is undefined — read and write access are not distinguished

**Resolution:** This GD is the authoritative RBAC definition for Phase 3
recruiting endpoints. It supersedes the spec/06 RBAC matrix and RBAC-700
for Phase 3 implementation. Both documents must be amended in a future PR.

## Endpoint-Level RBAC Absent

spec/06 recruiting API contracts define endpoint paths only — no per-endpoint
RBAC rules, no read/write distinction, and no explicit excluded roles. Phase 3
API implementation cannot safely determine access control from spec/06 alone.
This GD defines per-endpoint authority before any controller is written.

---

# Decisions

## Decision 1 — RBAC Principles for Phase 3 Recruiting

The following principles govern all Phase 3 recruiting RBAC decisions:

```text
1. NestJS guards are authoritative.
   Frontend canWrite/canRead gates are UX-only. Authorization decisions
   are enforced at the NestJS guard layer, not at the UI layer.

2. tenantId is derived from JWT/session context exclusively.
   No Phase 3 endpoint accepts tenantId from the request body (SEC-003;
   GD-PRE-PHASE3-002 Decision 1).

3. Tenant-scoped data access applies to all recruiting endpoints.
   Every list, detail, update, and archive operation must include a
   tenant_id predicate derived from the JWT.

4. Recruiting data contains PII.
   Candidate records (name, email, phone) are PII. Access must be granted
   only to roles that require it for their operational workflow. Broad
   exposure to operational or reporting roles is not permitted in Phase 3.

5. Least privilege.
   Each role receives the minimum access needed for its Phase 3 workflow.
   Access not explicitly granted in this GD is denied.

6. Read access and write access are separate grants.
   A role with read access to an endpoint family does not automatically
   have write access. Both must be explicitly stated.

7. Hiring Manager access is scoped, not global.
   Hiring Manager may not access the global candidate list. Hiring Manager
   access to candidates is mediated through application and vacancy
   relationships, which begin in M17. Hiring Manager has no direct
   candidate access in M16.

8. Executive User does not receive Phase 3 recruiting record access.
   Executive User access to recruiting data is a Phase 5 dashboard
   capability (GD-PHASE2-CLOSURE-001). No recruiting endpoint is
   accessible to Executive User in Phase 3.

9. Approval gates follow HR Director / SA authority.
   Offer approval and hire-to-employee conversion require HR Director or
   System Administrator. Recruiter cannot bypass these gates.

10. Competitive appointment creation is system-assigned only.
    COMPETITIVE_APPOINTMENT is set by the hire workflow — never by manual
    user input. No role may submit a request body with
    appointmentAuthority = COMPETITIVE_APPOINTMENT (GD-PRE-M13-001).
```

---

## Decision 2 — Phase 3 Role Definitions

### System Administrator

```text
Full administrative access to Phase 3 recruiting endpoints within the
tenant and security model.

Candidate scope:  create, read (list + detail), update, archive
Application scope: create, read, update, advance, reject, withdraw
Interview scope:  create, read, update, feedback, cancel
Offer scope:      create (DRAFT), read, update (DRAFT), submit, approve, send,
                  record-response, withdraw
Hire action:      authorized (POST /applications/{id}/hire)
Approval gates:   authorized equivalent to HR Director within tenant model
```

### HR Director

```text
Full HR operational authority for competitive recruiting workflow.

Candidate scope:  create, read (list + detail), update, archive
Application scope: create, read, update, advance, reject, withdraw
Interview scope:  create, read, update, feedback, cancel
Offer scope:      create (DRAFT), read, update (DRAFT), submit, approve, send,
                  record-response, withdraw
Hire action:      authorized (POST /applications/{id}/hire)
Approval gates:   primary authority for offer approval, hire conversion,
                  and critical vacancy review gate (VAC-601)
```

HR Director candidate access resolves the spec/06 conflict: spec/06 classifies
HR Director as No on Candidates. This GD overrides that classification.
HR Director is the primary owner of the competitive appointment hiring path
and must have full candidate and application access.

### Recruiter

```text
Operational recruiting coordinator.

Candidate scope:  create, read (list + detail), update, archive
                  (archive subject to service-layer check: cannot archive
                  a candidate with an active non-terminal application)
Application scope: create, read, update, advance stages
                  (cannot force-reject without HR Director authority;
                  can reject in normal workflow stages)
Interview scope:  create, read, update, cancel, record feedback
Offer scope:      create (DRAFT), read, update (DRAFT), submit for approval
                  Cannot approve offers
                  Cannot send offers (send authority follows approval gate)
                  Can record response after offer is sent
Hire action:      NOT authorized
                  Recruiter cannot perform hire-to-employee conversion.
                  Hire is an HR Director / SA action.
Approval gates:   cannot bypass; can submit for approval only
```

Rationale for Recruiter hire restriction: VAC-401 hire-to-employee conversion
creates an employee record with COMPETITIVE_APPOINTMENT authority. This is a
consequential, audit-sensitive action that produces a permanent HR record.
It follows the SA + HR Director authority precedent established in GD-M15-1
Decision 10 (assign-position is SA + HR Director only). Hire-to-employee is
at least as consequential as position assignment.

### Hiring Manager

```text
Scoped business reviewer. Not an operational recruiting user.

Candidate scope:  NO global access.
                  Hiring Manager may NOT access GET /api/v1/candidates (list).
                  Hiring Manager may NOT access GET /api/v1/candidates/{id}
                  unless a scoped vacancy/application relationship is established
                  in M17 or later. Global candidate PII access is not appropriate
                  for a reviewer role in a multi-department government platform.

Application scope: read-only, scoped to vacancies associated with the
                  Hiring Manager's department or assignment. Scoping mechanism
                  is defined in M17 milestone scope decision.
                  Cannot create, update, advance, or reject applications.

Interview scope:  read own assigned interviews; record feedback when assigned
                  as interviewer_user_id.
                  Cannot create or cancel interviews.

Offer scope:      read-only access to offers for scoped vacancies.
                  Cannot create, approve, or send offers.
                  Participates in VAC-602 manager approval workflow when
                  implemented (M17 or later).

Hire action:      NOT authorized.
Approval gates:   VAC-602 manager approval for CANCELLED vacancies once
                  implemented. No offer approval authority.
```

Hiring Manager access to candidates is explicitly deferred to M17 (Application
and Vacancy Integration), when the scoping relationship between Hiring Manager
and vacancy/application can be enforced. In M16, Hiring Manager has no
candidate endpoint access.

RBAC-700 Conflict Resolution: RBAC-700 grants Hiring Manager "Candidate
management" without scope restriction. This GD overrides RBAC-700 for
Phase 3 implementation. Hiring Manager receives scoped application/vacancy
access in M17+, not global candidate management in M16.

### Compliance Officer

```text
Read-only compliance and audit observer.

Candidate scope:  read-only (list + detail) for audit and compliance purposes
Application scope: read-only
Interview scope:  read-only
Offer scope:      read-only
Hire action:      NOT authorized.
Approval gates:   NOT authorized.
Write authority:  none across all Phase 3 recruiting endpoints.
```

Compliance Officer read access allows audit trail review, policy verification,
and compliance monitoring without operational authority.

### Workforce Planner

```text
No direct Phase 3 recruiting PII access.

Candidate scope:  NO ACCESS.
Application scope: NO ACCESS.
Interview scope:  NO ACCESS.
Offer scope:      NO ACCESS.
Hire action:      NOT authorized.
```

Workforce Planner may receive aggregate recruiting visibility in Phase 5
reporting if separately governed. No Workforce Planner access to recruiting
records is authorized in Phase 3.

### Executive User

```text
No Phase 3 recruiting record access.

All recruiting endpoint families: NO ACCESS.
```

Executive User recruiting data visibility is a Phase 5 dashboard capability
per GD-PHASE2-CLOSURE-001. No Executive User access to any recruiting
endpoint is authorized in Phase 3.

---

## Decision 3 — Endpoint RBAC Matrix

The following table is the canonical per-endpoint RBAC authority for Phase 3.
SA = System Administrator, HRD = HR Director, REC = Recruiter,
HM = Hiring Manager, CO = Compliance Officer, WP = Workforce Planner,
EU = Executive User.

R = read, W = write/create/update, X = action/lifecycle, — = no access,
S = scoped (access limited to vacancy/application relationship context).

### Candidate Endpoints

| Endpoint | SA | HRD | REC | HM | CO | WP | EU |
|---|---|---|---|---|---|---|---|
| POST /api/v1/candidates | W | W | W | — | — | — | — |
| GET /api/v1/candidates | R | R | R | — | R | — | — |
| GET /api/v1/candidates/{id} | R | R | R | — | R | — | — |
| PUT/PATCH /api/v1/candidates/{id} | W | W | W | — | — | — | — |
| POST /api/v1/candidates/{id}/archive | X | X | X | — | — | — | — |

Notes:
- Recruiter archive is subject to service-layer check: a candidate with one
  or more active non-terminal applications cannot be archived until all
  active applications reach a terminal state.
- Hiring Manager has no candidate endpoint access in M16. Scoped read access
  (via vacancy/application relationship) is M17+ scope.
- Compliance Officer read access is tenant-scoped; no update or archive authority.

### Application Endpoints

| Endpoint | SA | HRD | REC | HM | CO | WP | EU |
|---|---|---|---|---|---|---|---|
| POST /api/v1/applications | W | W | W | — | — | — | — |
| GET /api/v1/applications | R | R | R | S | R | — | — |
| GET /api/v1/applications/{id} | R | R | R | S | R | — | — |
| PUT/PATCH /api/v1/applications/{id} | W | W | W | — | — | — | — |
| POST /api/v1/applications/{id}/advance | X | X | X | — | — | — | — |
| POST /api/v1/applications/{id}/hire | X | X | — | — | — | — | — |

Notes:
- Hiring Manager application list and detail access (S) is scoped to vacancies
  associated with their department or hiring assignment. Global application
  list access is denied. Scoping mechanism is defined in M17.
- POST /applications/{id}/hire is restricted to SA and HRD. Recruiter
  cannot perform hire-to-employee conversion.
- Application creation (POST /api/v1/applications) triggers VAC-301:
  vacancy OPEN → IN_RECRUITMENT. This state transition requires no additional
  RBAC gate beyond the application creation right.

### Interview Endpoints

| Endpoint | SA | HRD | REC | HM | CO | WP | EU |
|---|---|---|---|---|---|---|---|
| POST /api/v1/interviews | W | W | W | — | — | — | — |
| GET /api/v1/interviews | R | R | R | S | R | — | — |
| GET /api/v1/interviews/{id} | R | R | R | S | R | — | — |
| PUT/PATCH /api/v1/interviews/{id} | W | W | W | — | — | — | — |
| POST /api/v1/interviews/{id}/feedback | X | X | X | S | — | — | — |
| POST /api/v1/interviews/{id}/cancel | X | X | X | — | — | — | — |

Notes:
- Hiring Manager interview access (S) is scoped: may read interviews tied
  to applications for their vacancies; may record feedback when listed as
  interviewer_user_id on the interview record.
- Interview feedback (POST /interviews/{id}/feedback) is granted to Hiring
  Manager in scoped context — they may be the assigned interviewer and must
  record their assessment.

### Offer Endpoints

| Endpoint | SA | HRD | REC | HM | CO | WP | EU |
|---|---|---|---|---|---|---|---|
| POST /api/v1/offers | W | W | W | — | — | — | — |
| GET /api/v1/offers | R | R | R | S | R | — | — |
| GET /api/v1/offers/{id} | R | R | R | S | R | — | — |
| PUT/PATCH /api/v1/offers/{id} | W | W | W | — | — | — | — |
| POST /api/v1/offers/{id}/submit | X | X | X | — | — | — | — |
| POST /api/v1/offers/{id}/approve | X | X | — | — | — | — | — |
| POST /api/v1/offers/{id}/send | X | X | — | — | — | — | — |
| POST /api/v1/offers/{id}/record-response | X | X | X | — | — | — | — |
| POST /api/v1/offers/{id}/withdraw | X | X | X | — | — | — | — |

Notes:
- Recruiter may create DRAFT offers and submit them for approval.
- Offer approval (POST /offers/{id}/approve) is restricted to SA and HRD.
  Recruiter cannot approve their own offer submissions.
- Offer send (POST /offers/{id}/send) requires the offer to be in APPROVED
  state. SA and HRD only — send is an outward-facing HR action.
- Hiring Manager offer access (S) is read-only, scoped to their vacancies.
  Hiring Manager may view offer status but cannot create, approve, or send.
- PUT/PATCH on an offer is permitted only while the offer is in DRAFT state.
  Status enforcement is at the service layer.

### Phase 3 Approval and Carryover Endpoints

| Authority | SA | HRD | REC | HM | CO | WP | EU |
|---|---|---|---|---|---|---|---|
| Hire-to-employee (POST /applications/{id}/hire) | X | X | — | — | — | — | — |
| Offer approval gate | X | X | — | — | — | — | — |
| Critical vacancy review (VAC-601) | X | X | — | — | — | — | — |
| VAC-602 manager approval (CANCELLED vacancies) | X | X | — | S | — | — | — |
| IN_RECRUITMENT trigger (via first application) | X | X | X | — | — | — | — |
| POS-301 cascade (position close → vacancies) | X | X | — | — | — | — | — |

Notes:
- VAC-602 Hiring Manager (S): Hiring Manager participates in manager approval
  for vacancy cancellation when the approval workflow is implemented in M17 or
  later. Their approval authority is scoped to vacancies within their
  department or assignment, not global vacancy cancellation authority.
- IN_RECRUITMENT trigger fires automatically on first application creation
  (VAC-301). No explicit trigger action endpoint is needed — the trigger is
  a service-layer side effect of POST /applications. RBAC for the trigger
  equals RBAC for application creation.
- POS-301 (position close cascades to vacancies) is executed as part of
  position close action. The existing position management RBAC (SA + HRD per
  GD-M15-1) governs this; no separate recruiting RBAC grant is needed.

---

## Decision 4 — M16 Minimum RBAC (Candidate Management Foundation)

M16 implements candidate CRUD and archive only. No application, interview,
offer, or hire endpoints exist in M16.

The minimum RBAC required for M16 NestJS guards:

```text
POST /api/v1/candidates
  Allowed: SA, HRD, REC

GET /api/v1/candidates
  Allowed: SA, HRD, REC, CO

GET /api/v1/candidates/{id}
  Allowed: SA, HRD, REC, CO

PUT/PATCH /api/v1/candidates/{id}
  Allowed: SA, HRD, REC

POST /api/v1/candidates/{id}/archive
  Allowed: SA, HRD, REC
  Guard logic: service layer checks for active applications before allowing archive.
  In M16 no applications exist yet; the check passes trivially.

Denied from all M16 candidate endpoints:
  HM, WP, EU
```

Hiring Manager has no candidate access in M16. This is consistent with
Decision 2 and Decision 3. Hiring Manager access begins in M17 when
application-scoped Hiring Manager access can be enforced.

---

## Decision 5 — Phase 3 Approval Gate Authority

```text
Offer creation (DRAFT):
  Allowed: SA, HRD, REC
  Rationale: creating a DRAFT offer is a low-stakes preparatory action.

Offer approval (PENDING_APPROVAL → APPROVED):
  Allowed: SA, HRD only
  Rationale: offer approval commits the agency to defined compensation and
  terms. This is an HR Director-level authority in government hiring.

Offer send (APPROVED → SENT):
  Allowed: SA, HRD only
  Rationale: sending an offer is an outward-facing official communication.

Hire-to-employee conversion (HIRED):
  Allowed: SA, HRD only
  Rationale: hiring creates a permanent employee record with
  COMPETITIVE_APPOINTMENT status. This is consequential, irreversible, and
  audit-sensitive. Follows SA + HRD authority precedent from GD-M15-1 D10.

Critical vacancy review (VAC-601):
  Allowed: SA, HRD only

VAC-602 manager approval for CANCELLED vacancies:
  Primary: SA, HRD
  Scoped: HM (for vacancies within their department/assignment) — M17+

Competitive appointment creation:
  System-assigned only. No user may submit COMPETITIVE_APPOINTMENT as a
  request body value (GD-PRE-M13-001 D3). The hire action sets this value
  automatically.
```

---

## Decision 6 — Audit Event Categories (Governance Authorization)

The following audit event categories are authorized at governance level for
Phase 3 implementation. Actual AuditEventType string values follow the
SCREAMING_SNAKE_CASE pattern established in GD-M13-4 and GD-M15-1.

Phase 3 milestone scope decisions will define the exact string values. This
decision establishes the categories that must be covered:

```text
Candidate Domain:
  RECRUITING_CANDIDATE_CREATED
  RECRUITING_CANDIDATE_UPDATED
  RECRUITING_CANDIDATE_ARCHIVED

Application Domain:
  RECRUITING_APPLICATION_CREATED
  RECRUITING_APPLICATION_STATUS_CHANGED
  RECRUITING_APPLICATION_ADVANCED
  RECRUITING_APPLICATION_REJECTED
  RECRUITING_APPLICATION_WITHDRAWN

Interview Domain:
  RECRUITING_INTERVIEW_SCHEDULED
  RECRUITING_INTERVIEW_UPDATED
  RECRUITING_INTERVIEW_CANCELLED
  RECRUITING_INTERVIEW_FEEDBACK_RECORDED
  RECRUITING_INTERVIEW_COMPLETED

Offer Domain:
  RECRUITING_OFFER_CREATED
  RECRUITING_OFFER_SUBMITTED
  RECRUITING_OFFER_APPROVED
  RECRUITING_OFFER_SENT
  RECRUITING_OFFER_RESPONSE_RECORDED
  RECRUITING_OFFER_WITHDRAWN

Hire and Vacancy Fulfillment:
  RECRUITING_CANDIDATE_HIRED
  WORKFORCE_EMPLOYEE_CREATED_FROM_HIRE
  WORKFORCE_VACANCY_FILLED_FROM_HIRE
  WORKFORCE_EMPLOYEE_POSITION_ASSIGNED_FROM_HIRE
```

All audit events must record: actorId (user who triggered), tenantId (from
JWT), timestamp, entityType, entityId, and role at the time of action.

These categories are authorized. Exact string enum values are confirmed in
each milestone's scope decision (following GD-M13-4 pattern). No AuditEventType
enum changes are authorized by this GD alone.

---

## Decision 7 — Spec Amendment Authority

Until `spec/06_api_contracts.md` and `directives/10_role_based_access_rules.md`
are formally amended, this GD governs over conflicting RBAC references for
Phase 3 recruiting endpoints.

**Conflicts superseded:**

```text
spec/06 RBAC matrix line 839:
  "HR Director | No" on Candidates
  → Superseded: HR Director has full candidate access per Decision 2 and 3.

spec/06 RBAC matrix line 839:
  Hiring Manager column absent
  → Superseded: Hiring Manager access is scoped per Decision 2 and 3.

directives/10 RBAC-700:
  "Hiring Manager" listed without scope constraint under candidate management
  → Superseded: Hiring Manager access is scoped to application/vacancy
    context starting in M17; no global candidate access in M16.
```

Future amendments to spec/06 and directives/10 must align with this GD.
The amended spec/06 RBAC matrix should replace the endpoint-group table with
per-endpoint rows matching Decision 3.

---

## Decision 8 — M16 Authorization Impact

With both GD-PRE-PHASE3-002 and GD-PRE-PHASE3-003 approved, M16 Candidate
Management Foundation may be planned and implemented.

```text
GD-PRE-PHASE3-002 — schema authority      APPROVED
GD-PRE-PHASE3-003 — RBAC authority        APPROVED (this document)
```

M16 is unblocked by the approval of this governance decision. A milestone
scope decision for M16 must still be created before implementation begins.
That decision confirms M16 implementation steps, test scope, and definition
of done. This GD does not serve as an M16 scope decision.

---

## Decision 9 — Explicit Exclusions

This GD does not authorize any of the following:

```text
API implementation (controllers, services, modules, guards as code)
NestJS RolesGuard implementation
DTOs or validation classes
Frontend pages, components, or BFF routes
Prisma schema file changes
Database migration files
Candidate, application, interview, offer, or hire endpoint implementation
Offer approval workflow implementation
Hire-to-employee conversion implementation
Notification integration — Phase 5
Dashboards or reporting — Phase 5
D-005 Scheduling — Phase 8
FR-152 Competency Framework — Phase 4
AI resume parsing or candidate matching
Resume file storage
Position Skills/Certifications — pending GD-M13-5-FOLLOWUP
Role expansion or new role definitions beyond the seven roles governed here
```

---

# Impact on Existing Governance

| Decision | Status | Notes |
|---|---|---|
| GD-M12-3 | Unchanged | Employee RBAC authority unaffected; recruiting RBAC is a new domain |
| GD-M13-2 | Unchanged | Catalog RBAC authority unaffected; per-endpoint pattern followed here |
| GD-M15-1 D10 | Confirmed | SA + HRD authority for consequential HR actions extended to hire-to-employee and offer approval |
| GD-PRE-M13-001 | Unchanged | COMPETITIVE_APPOINTMENT system-only; Principle 10 of Decision 1 confirms |
| GD-PRE-PHASE3-001 | Satisfied | GD-PRE-PHASE3-003 listed as required; issuing this decision satisfies that requirement |
| GD-PRE-PHASE3-002 | Compatible | Schema authority and RBAC authority are complementary; no conflicts |
| spec/06 RBAC matrix | Superseded (recruiting section) | HR Director No and HM absence resolved; spec/06 amendment deferred to future PR |
| directives/10 RBAC-700 | Superseded (Hiring Manager scope) | HM candidate access restricted to scoped context from M17; RBAC-700 amendment deferred to future PR |

---

Effective Date: 2026-06-27

Scope: Phase 3 recruiting endpoint RBAC; role definitions for candidate,
application, interview, offer, and hire-to-employee endpoints; M16 minimum
RBAC guards; Phase 3 approval gate authority; audit event category governance
authorization. Does not authorize API implementation, guards as code, schema
changes, migrations, or any runtime changes.

M16 Authorization: M16 Candidate Management Foundation may be planned and
implemented now that both GD-PRE-PHASE3-002 and GD-PRE-PHASE3-003 are
approved. A milestone scope decision for M16 must still be created before
implementation begins.
