# Employee Management Rules

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative Employee Management Directive

Governance: Approved 2026-06-18 — GD-M12-1 through GD-M12-5

References:

- spec/01_requirements.md (FR-110 through FR-114)
- spec/04_domain_model.md
- spec/05_database_schema.md
- spec/06_api_contracts.md
- state/02_employee_lifecycle.md
- directives/02_position_management_rules.md
- directives/10_role_based_access_rules.md
- data/06_pii_handling.md

---

# Purpose

This directive defines the business rules governing employee management.

These rules control:

- Employee record creation
- Employee profile updates
- Employee lifecycle state machine
- Employee RBAC and authorization
- Employee availability representation
- Employee PII handling
- Employee auditability
- Phase 2 scope boundaries

These rules are mandatory for all M12 implementations.

---

# Governance Decisions Incorporated

This directive incorporates the following approved governance decisions:

- GD-M12-1: Employee Lifecycle State Authority (2026-06-18)
- GD-M12-2: Employee Position Field Authority (2026-06-18)
- GD-M12-3: Employee RBAC Authority (2026-06-18)
- GD-M12-4: Skills and Certifications Scope Boundary (2026-06-18)
- GD-M12-5: Employee Availability Authority (2026-06-18)
- GD-M12-6: Employee Number Immutability (2026-06-18)
- GD-M12-8: Employee Date Integrity — Termination Before Hire Date (2026-06-19)
- GD-PRE-M13-001: VAC-401 Hiring Workflow — Dual-Path Authority Classification and Appointment Authority Design (2026-06-19)
- GD-M13-1: Skills and Certifications Catalog Tenant Scope (2026-06-19)
- GD-M13-2: Skills and Certifications Catalog API Design (2026-06-19)
- GD-M13-3: Employee Certification Status Enumeration (2026-06-19)
- GD-M13-4: Employee Skills and Certifications History Retention Strategy (2026-06-19)

---

# Employee Principles

## EMP-001

Every employee belongs to exactly one department.

---

## EMP-002

Every employee belongs to exactly one tenant.

Tenant identity is sourced from the JWT only. It must never be accepted from a request body or route parameter.

---

## EMP-003

Employee records are workforce operations entities.

They may exist without a position assignment in Phase 2.

The employee-to-position relationship is mediated through the Scheduling domain (Phase 3).

---

## EMP-004

Employee records contain PII.

PII handling must comply with data/06_pii_handling.md.

Executive Users may not access individual employee records (RBAC-952).

---

## EMP-005

Employee changes must be auditable.

Every state change generates an audit event with actor, timestamp, and reason.

---

## EMP-006

The employee lifecycle is governed exclusively by state/02_employee_lifecycle.md.

No implementation may introduce lifecycle states or transitions not defined in this directive.

---

# Employee Lifecycle (GD-M12-1)

## Canonical State Values

The `employment_status` column stores exactly the following values.

No other values are permitted.

```text
PENDING_ONBOARDING
ACTIVE
ON_LEAVE
SUSPENDED
SEPARATED
```

These values are final. Changing them requires a schema migration and a new governance decision.

---

## State Definitions

### PENDING_ONBOARDING

Employee record created. Onboarding not yet complete.

```text
No Active Workforce Assignment
Limited System Access
Not available for scheduling
```

---

### ACTIVE

Employee actively participating in workforce operations.

```text
Available for scheduling
Scheduling allowed
Reporting included
```

---

### ON_LEAVE

Employee temporarily unavailable.

```text
Position retained
Scheduling restricted
Reporting included
Not available for assignment
```

---

### SUSPENDED

Employee temporarily restricted.

```text
Access restricted
Scheduling blocked
Operational restrictions active
```

---

### SEPARATED

Employment relationship ended. Terminal state.

```text
Read only
No system access
No assignment
Historical reporting only
May not be exited
```

---

## Separation Reasons (Not States)

The following are not lifecycle states. They are sub-classifications within SEPARATED.

```text
TERMINATION
RETIREMENT
RESIGNATION
TRANSFER_OUT
```

Separation reason is accepted as an optional field in the status change request body for SEPARATED transitions only.

It is recorded in the audit event metadata.

It does not require a dedicated database column in M12.

---

## FR-111 Reconciliation Note

spec/01_requirements.md FR-111 lists: Active, Leave, Suspended, Terminated, Retired.

**GD-M12-1 ruling:** state/02_employee_lifecycle.md is the authoritative lifecycle specification.

- FR-111 "Leave" maps to canonical value `ON_LEAVE`
- FR-111 "Terminated" and "Retired" are separation reasons within `SEPARATED`
- FR-111's list is a requirements summary; state/02_employee_lifecycle.md governs implementation

---

## Allowed Transitions

```text
PENDING_ONBOARDING → ACTIVE
ACTIVE → ON_LEAVE
ACTIVE → SUSPENDED
ACTIVE → SEPARATED
ON_LEAVE → ACTIVE
SUSPENDED → ACTIVE
```

---

## Forbidden Transitions

The following must return HTTP 422. No exceptions.

```text
PENDING_ONBOARDING → SUSPENDED
PENDING_ONBOARDING → SEPARATED
PENDING_ONBOARDING → ON_LEAVE
ON_LEAVE → SUSPENDED
ON_LEAVE → SEPARATED
SUSPENDED → ON_LEAVE
SUSPENDED → SEPARATED
SEPARATED → PENDING_ONBOARDING
SEPARATED → ACTIVE
SEPARATED → ON_LEAVE
SEPARATED → SUSPENDED
```

SEPARATED is terminal. Any outbound transition from SEPARATED is forbidden.

---

## Approval Gates (Phase 3 — Deferred)

GD-M12-1 defers formal approval workflows to Phase 3 Approval Management (D-010).

In M12, lifecycle transitions are controlled by RBAC only.

Any authorized role (SA, HR Director) may trigger any valid transition.

The following role mappings are reserved for Phase 3 D-010 implementation:

```text
PENDING_ONBOARDING → ACTIVE    : HR Director (mapped from "HR Administration")
ACTIVE → ON_LEAVE              : Hiring Manager (mapped from "Manager")
ON_LEAVE → ACTIVE              : Hiring Manager (mapped from "Manager")
ACTIVE → SUSPENDED             : HR Director
SUSPENDED → ACTIVE             : HR Director
ACTIVE → SEPARATED             : HR Director
```

---

# Employee Position Field (GD-M12-2)

## EMP-100 — No Position Field in Phase 2

**No position field of any kind exists on the employee record in M12.**

Specifically prohibited:

```text
positionId UUID — NOT IMPLEMENTED (spec deviation; not authorized)
positionTitle VARCHAR — NOT IMPLEMENTED (no spec authority)
Any other position reference field — NOT IMPLEMENTED
```

The workforce.employees table follows spec/05_database_schema.md exactly.

The Create Employee API follows spec/06_api_contracts.md exactly.

---

## EMP-101 — Rationale

The domain model (spec/04_domain_model.md) defines no position FK on the Employee entity.

The schema (spec/05_database_schema.md) defines no position_id column.

The API contract (spec/06_api_contracts.md) defines no position field in the Create Employee request body.

The behavioral specification documents (FR-110, state/02_employee_lifecycle.md, execution/03_phase_2_core_workforce_platform.md) assert that an employee has a position. This is a business invariant enforced at the Scheduling domain layer (Phase 3 Assignments), not a Phase 2 schema field.

---

## EMP-102 — Impact on POS-400 Through POS-500

```text
POS-400: Employees may be assigned only to Active Positions
  → Not enforceable in Phase 2. Deferred to Scheduling domain (Phase 3).

POS-401: Closed positions may not receive employees
  → Not enforceable in Phase 2. Deferred to Phase 3.

POS-402: Position closure requires employee reassignment validation
  → Not enforceable in Phase 2. Deferred to Phase 3.

POS-500 "No Active Employees" sub-condition
  → Remains deferred after M12.
  → No query path exists without position FK or Assignment entity.
  → Activation requires one of:
      (a) governance decision to add position_id (spec deviation)
      (b) Phase 3 Scheduling Assignments (D-005)
      (c) spec amendment defining a position association table
```

This deferral is intentional and documented. The `closePosition()` implementation is not modified in M12.

---

## EMP-103 — Future Resolution Path

Before Phase 3 Scheduling implementation, a governance decision must choose one of:

```text
Option A: Scheduling Assignments as the sole employee-position link (no schema change)
Option B: position_id FK on workforce.employees (requires spec amendment)
Option C: workforce.employee_positions association table (requires new spec)
```

This decision must not be made in M12.

---

# Authorization Rules (GD-M12-3)

## EMP-AUTH-001 — Create Employee

```text
Authorized:
  System Administrator
  HR Director

Endpoint: POST /api/v1/employees
Unauthorized response: HTTP 403
```

---

## EMP-AUTH-002 — List Employees

```text
Authorized:
  System Administrator
  HR Director
  Workforce Planner
  Hiring Manager
  Compliance Officer

Unauthorized:
  Recruiter — access scoped to Talent Acquisition domain (Phase 3)
  Executive User — RBAC-952 prohibits individual employee PII records

Endpoint: GET /api/v1/employees
Unauthorized response: HTTP 403
```

---

## EMP-AUTH-003 — View Employee Detail

```text
Authorized:
  System Administrator
  HR Director
  Workforce Planner
  Hiring Manager
  Compliance Officer

Unauthorized:
  Recruiter
  Executive User — RBAC-952 hard prohibition

Endpoint: GET /api/v1/employees/{id}
Unauthorized response: HTTP 403
```

---

## EMP-AUTH-004 — Update Employee

```text
Authorized:
  System Administrator
  HR Director

Endpoint: PUT /api/v1/employees/{id}
Unauthorized response: HTTP 403
```

---

## EMP-AUTH-005 — Change Employee Status

```text
Authorized:
  System Administrator
  HR Director

Endpoint: POST /api/v1/employees/{id}/status
Unauthorized response: HTTP 403
```

---

## EMP-AUTH Cross-Cutting Rules

### Tenant Isolation (SEC-003)

tenantId is sourced from the JWT only.

It must never be accepted from a request body, query parameter, or route parameter.

A request for an employee belonging to a different tenant returns HTTP 404.

The response is identical for absent and cross-tenant records. No tenant enumeration.

### RBAC-952 Enforcement

Executive Users receive HTTP 403 on both:

- GET /api/v1/employees (list contains PII even in summary form)
- GET /api/v1/employees/{id}

This rule is non-negotiable. RBAC-952 is an explicit hard prohibition.

### Soft-Delete Visibility

Employees with `deleted_at` set are excluded from listEmployees by default.

No role may retrieve soft-deleted employees through the standard list endpoint in Phase 2.

---

# Employee Creation Rules

## EMP-200

The Create Employee API follows spec/06_api_contracts.md exactly.

Required fields at creation:

```text
employeeNumber
firstName
lastName
departmentId
```

---

## EMP-201 — Employee Number Rules

employeeNumber is required at creation. The client supplies the value. System-generated employee numbers are not supported.

It must be unique within the tenant (enforced by idx_employee_number_tenant).

Maximum 100 characters (per schema column length). No format constraint is defined by the specification; any non-empty string within the length limit is accepted.

Duplicate employee numbers within the same tenant return HTTP 409 with error code EMPLOYEE_NUMBER_CONFLICT.

**employeeNumber is immutable after creation (GD-M12-6).** See EMP-304.

---

## EMP-202 — Department Validation

departmentId must reference an existing, non-deleted department within the same tenant.

An invalid or cross-tenant departmentId returns HTTP 422.

---

## EMP-203 — Optional Fields at Creation

The following fields are optional at creation and may be set via Update Employee:

```text
email
hireDate
```

employmentStatus defaults to PENDING_ONBOARDING at creation.

---

## EMP-204 — Hire Date

hireDate is a date field (not a timestamp).

It represents the official employment start date.

It is optional at creation and may be set on update.

---

# Employee Update Rules

## EMP-300 — Updatable Fields

The following fields may be updated via PUT /api/v1/employees/{id}:

```text
firstName
lastName
email
departmentId
hireDate
```

---

## EMP-301

employmentStatus may not be updated via PUT /api/v1/employees/{id}.

Status changes are performed exclusively via POST /api/v1/employees/{id}/status.

---

## EMP-302

SEPARATED employees are read-only. PUT requests on a SEPARATED employee return HTTP 422.

---

## EMP-303

terminationDate is system-managed. It is set automatically when the SEPARATED transition occurs.

It may not be set or updated directly by the client.

---

## EMP-304 — Employee Number Immutability (GD-M12-6)

employeeNumber may not be modified after creation.

If a PUT /api/v1/employees/{id} request body includes an `employeeNumber` field, the request must return HTTP 422.

Error code: EMPLOYEE_NUMBER_IMMUTABLE.

The value is not silently ignored. It is rejected explicitly so the caller understands the field is immutable.

Rationale: External systems (payroll, audit trails, integrations) reference employees by employee number. Allowing post-creation changes would silently break those references.

---

# PII Handling Rules

## EMP-400

Employee records contain PII.

Fields classified as PII:

```text
firstName
lastName
email
employeeNumber (may be PII depending on agency policy)
hireDate
terminationDate
```

---

## EMP-401

PII must not appear in audit event metadata beyond what is required for compliance tracing.

The audit event records the entity ID and action. It does not record PII field values.

---

## EMP-402

Executive Users are prohibited from accessing PII records per RBAC-952.

This applies to both list and detail endpoints.

---

# Availability Rules (GD-M12-5)

## EMP-500 — Phase 2 Availability Representation

Employee availability in Phase 2 is represented through the employment_status field.

```text
PENDING_ONBOARDING  → not available for scheduling
ACTIVE              → available for scheduling
ON_LEAVE            → not available for scheduling (temporary)
SUSPENDED           → not available for scheduling (restricted)
SEPARATED           → not available (terminal)
```

---

## EMP-501 — Scheduler Visibility

The GET /api/v1/employees endpoint accepts employmentStatus as a filter.

Authorized schedulers may filter for ACTIVE employees to determine scheduling availability.

This satisfies FR-112 acceptance criterion 1: "Availability visible to schedulers."

---

## EMP-502 — Scheduling Engine Integration (Deferred)

FR-112 acceptance criterion 2 — "Availability used by scheduling engine" — is deferred to Phase 3.

The scheduling engine (D-005) is not in M12 scope.

Leave request management, training event tracking, and restriction flags are Phase 3 deliverables.

FR-112 maturity after M12: Partially Implemented.

---

# Skills and Certifications Scope Boundary (GD-M12-4)

## EMP-600 — FR-113 and FR-114 Are Deferred to M13

Employee Skill Assignment (FR-113) and Employee Certification Assignment (FR-114) are not implemented in M12.

The following tables are not created in M12:

```text
workforce.skills
workforce.certifications
workforce.employee_skills
workforce.employee_certifications
```

---

## EMP-601 — Reason for Deferral

The assignment endpoints (POST /api/v1/employees/{id}/skills, POST /api/v1/employees/{id}/certifications) require skill_id and certification_id references.

No catalog management API is defined in spec/06_api_contracts.md for creating or listing skills or certifications.

FR-113 and FR-114 require both the catalog management API and the assignment endpoints. Delivering the assignments without the catalog is not operationally useful.

M13 — Skills and Certifications Management will deliver:

```text
Skills catalog CRUD API
Certifications catalog CRUD API
Employee skill assignment
Employee certification assignment
Expiration tracking
Full test coverage
```

---

# Audit Requirements

## EMP-700

Required audit events for M12:

```text
WORKFORCE_EMPLOYEE_CREATED
WORKFORCE_EMPLOYEE_UPDATED
WORKFORCE_EMPLOYEE_ACTIVATED        (PENDING_ONBOARDING → ACTIVE)
WORKFORCE_EMPLOYEE_LEAVE_STARTED    (ACTIVE → ON_LEAVE)
WORKFORCE_EMPLOYEE_RETURNED         (ON_LEAVE → ACTIVE)
WORKFORCE_EMPLOYEE_SUSPENDED        (ACTIVE → SUSPENDED)
WORKFORCE_EMPLOYEE_REINSTATED       (SUSPENDED → ACTIVE)
WORKFORCE_EMPLOYEE_SEPARATED        (ACTIVE → SEPARATED)
```

---

## EMP-701

Every transition generates an audit event.

The audit event must record:

```text
Actor (userId from JWT)
Tenant (tenantId from JWT)
Entity type: EMPLOYEE
Entity ID
Action (one of EMP-700 event types)
Timestamp
```

For SEPARATED events, separationReason is included in metadata if supplied.

---

## EMP-702

Audit events are immutable.

No employee operation may suppress or bypass audit logging.

---

# Failure Rules

## EMP-800

If employee creation fails due to validation:

```text
Return HTTP 422
Return structured error with field-level details
Do not create partial records
Do not emit audit event
```

---

## EMP-801

If a forbidden transition is attempted:

```text
Return HTTP 422
Error code: INVALID_TRANSITION
No state change occurs
No audit event emitted
```

---

## EMP-802

If employee not found or cross-tenant:

```text
Return HTTP 404
Response identical for absent and cross-tenant (no enumeration)
```

---

## EMP-803

If duplicate employee number within tenant:

```text
Return HTTP 409
Error code: EMPLOYEE_NUMBER_CONFLICT
```

---

## EMP-804

If employeeNumber is included in an Update Employee request body:

```text
Return HTTP 422
Error code: EMPLOYEE_NUMBER_IMMUTABLE
Do not apply any other updates from the same request
```

---

## EMP-805

If a SEPARATED transition is attempted and the employee has a hireDate set that is in the future (terminationDate as current date < hireDate):

```text
Return HTTP 422
Error code: TERMINATION_BEFORE_HIRE_DATE
No state change occurs
No audit event emitted
No other changes from the same request are applied
```

This rule applies only when hireDate is not null. When hireDate is null, no date comparison is performed and the SEPARATED transition proceeds normally.

Rationale: terminationDate is system-managed and reflects the real-world separation date. A separation recorded before the official hire date produces a logically inconsistent record — the employment relationship ends before it officially began. This cannot be corrected post-separation under EMP-302.

Authority: GD-M12-8 (approved 2026-06-19).

---

# Reporting Rules

Employee metrics must support:

```text
Active Headcount (by department, by tenant)
Employees by Status
Recently Separated
Pending Onboarding
```

---

# Acceptance Criteria

Directive satisfied when:

1. Lifecycle state machine enforced per EMP-006 and GD-M12-1.
2. All forbidden transitions return HTTP 422.
3. No position field exists on the employee record (GD-M12-2).
4. EMP-AUTH-001 through EMP-AUTH-005 enforced at all endpoints.
5. RBAC-952 enforced — Executive Users receive HTTP 403.
6. SEC-003 tenant isolation enforced — cross-tenant returns HTTP 404.
7. Audit events emitted for all lifecycle transitions.
8. PII handling compliant with EMP-400 through EMP-402.
9. FR-113 and FR-114 deferred — no skills/certifications tables in M12 migration.
10. FR-112 maturity recorded as Partially Implemented.
11. employeeNumber immutable — PUT with employeeNumber field returns HTTP 422 + EMPLOYEE_NUMBER_IMMUTABLE (GD-M12-6).
12. Separation with future hireDate rejected — POST /:id/status with SEPARATED returns HTTP 422 + TERMINATION_BEFORE_HIRE_DATE when hireDate is set and in the future (GD-M12-8/EMP-805).

---

# Deferred Items

| Item | Deferred To | Rule |
|---|---|---|
| Lifecycle transition approval gates | Phase 3 D-010 | GD-M12-1 Ruling 1-E |
| positionId FK or any position field | Phase 3 governance decision | GD-M12-2 |
| POS-400, POS-401, POS-402 enforcement | Phase 3 Scheduling | GD-M12-2 |
| POS-500 "No Active Employees" | Phase 3 (position association mechanism undefined) | GD-M12-2 |
| FR-113 Employee Skill Assignment | M13 | GD-M12-4 |
| FR-114 Employee Certification Assignment | M13 | GD-M12-4 |
| FR-112 scheduling engine integration | Phase 3 D-005 | GD-M12-5 |
| Candidate → PENDING_ONBOARDING transition | Phase 3 Recruiting hire flow | GD-M12-1 |

---

# Next Directive

directives/02_position_management_rules.md — for position closure rules relevant to M12 position gate deferral
