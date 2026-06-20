# Certification Management Rules

Directive ID: 15
File: directives/15_certification_management_rules.md

Project: AI-Driven Staffing Optimization Platform for Government HR

Status: Authoritative Certification Management Directive

Version: 1.0

Date: 2026-06-19

---

## References

- spec/01_requirements.md (FR-114, FR-151, FR-152, FR-153)
- spec/04_domain_model.md (Certification entity, Employee Certification entity)
- spec/05_database_schema.md (workforce.certifications, workforce.employee_certifications)
- spec/06_api_contracts.md (Employee API)
- governance/GD-M13-1.md (tenant scope, column set — authoritative for schema)
- governance/GD-M13-2.md (API design, RBAC, request contracts — authoritative for API surface)
- governance/GD-M13-3.md (status enumeration, ACTIVE default, REVOKED terminal)
- governance/GD-M13-4.md (history retention, upsert semantics, audit event types)
- state/07_employee_certification_states.md (authoritative state transition model)
- directives/05_skill_matching_rules.md (SKM-302 — expired cert matching behavior)
- directives/13_employee_management_rules.md (EMP-302, SEC-003, EMP-601)

---

## Governance Decisions Incorporated

- GD-M13-1 — Catalog Tenant Scope (per-tenant, tenant_id on workforce.certifications)
- GD-M13-2 — API Design (endpoint contracts, RBAC, request contracts, EMP-302 enforcement)
- GD-M13-3 — Status Enumeration (ACTIVE/EXPIRED/REVOKED; ACTIVE default; REVOKED terminal)
- GD-M13-4 — History Retention (audit event trail, upsert semantics, AuditEventType values)

---

## Purpose

This directive defines the authoritative behavioral rules for the Certifications domain
in M13 and all subsequent milestones. It covers the Certifications catalog
(workforce.certifications), employee certification assignments
(workforce.employee_certifications), tenant isolation, RBAC, certification status
lifecycle, expiration tracking, and audit requirements.

This directive supplements spec/04 and spec/05 with governance-authorized behavioral
rules. Where this directive conflicts with the unamended spec, this directive governs.

The authoritative certification status state machine is in
state/07_employee_certification_states.md.

---

## CRT-001 — Tenant Scope

The workforce.certifications table is per-tenant. Every certification type entry
belongs to exactly one tenant. Catalog entries are not visible across tenant boundaries.

Tenant scope is enforced by:
- tenant_id on workforce.certifications (GD-M13-1 Decision 2)
- All catalog reads and writes must WHERE-filter on tenant_id from the JWT
- No cross-tenant reads permitted

Authority: GD-M13-1.

---

## CRT-002 — SEC-003 Enforcement on All Certification Endpoints

All certification endpoint operations must derive tenant_id from the authenticated JWT.
tenant_id must never be accepted from:
- request body
- query parameters
- route parameters

Cross-tenant certification records must return HTTP 404.
The response is identical for absent and cross-tenant records (no tenant enumeration).

Authority: GD-M13-1 Decision 3, SEC-003.

---

## CRT-003 — Certification Name Uniqueness Within Tenant

Certification names must be unique within a tenant.

Duplicate certification name within the same tenant:

```text
HTTP 409, error code: CERTIFICATION_NAME_CONFLICT
```

Uniqueness constraint is enforced at both the database (UNIQUE INDEX on tenant_id, name)
and service layer.

Authority: GD-M13-2 Decision 9.

---

## CRT-004 — Certification Soft-Delete

Soft-delete applies to workforce.certifications records.
The deleted_at column (TIMESTAMPTZ NULL) is set to the deletion timestamp.
Records with deleted_at IS NOT NULL are excluded from all list and lookup queries
unless explicitly requested.

A certification type with active employee assignment records (workforce.employee_certifications
records where the referenced employee has deleted_at IS NULL and certification status is
ACTIVE) may not be soft-deleted.
Soft-delete attempt when active assignments exist:

```text
HTTP 422, error code: CERTIFICATION_HAS_ACTIVE_ASSIGNMENTS
```

Authority: GD-M13-1 Decision 7 (deleted_at column), spec/05 soft-delete strategy.

---

## CRT-100 — Certifications Catalog CRUD Authorization

```text
POST  /api/v1/certifications          — System Administrator, HR Director
PATCH /api/v1/certifications/{id}     — System Administrator, HR Director
GET   /api/v1/certifications          — System Administrator, HR Director,
                                        Workforce Planner, Compliance Officer
GET   /api/v1/certifications/{id}     — System Administrator, HR Director,
                                        Workforce Planner, Compliance Officer
```

Roles not listed above: HTTP 403 on any certifications catalog endpoint.

Authority: GD-M13-2 Decision 12.

---

## CRT-101 — POST /api/v1/certifications Request Requirements

```text
Required: name (string, max 255 characters)
Required: expirationRequired (boolean)
Optional: issuer (string, max 255 characters)
```

Validation failures return HTTP 422 with a descriptive error code.
tenant_id: derived from JWT only.

When expirationRequired is true, all employee assignments for this certification type
must provide expirationDate (enforced at assignment time — see CRT-204).

Authority: GD-M13-2 Decision 5.

---

## CRT-102 — PATCH /api/v1/certifications/{id} Request Requirements

All fields are optional on PATCH. Only provided fields are updated.
Partial update is supported. Omitted fields retain their current values.

If name is provided, it must not conflict with an existing certification name
in the tenant. Name conflict on PATCH: HTTP 409, error code: CERTIFICATION_NAME_CONFLICT.

---

## CRT-103 — Certification Catalog Audit Events

Every write operation on workforce.certifications must produce an immutable audit event:

```text
POST  /api/v1/certifications      → WORKFORCE_CERTIFICATION_CREATED
PATCH /api/v1/certifications/{id} → WORKFORCE_CERTIFICATION_UPDATED
```

Failure to emit an audit event is a service error — the write must not succeed
without a corresponding audit event.

Authority: GD-M13-4 Decision 4.

---

## CRT-200 — Employee Certification Assignment Authorization

```text
POST /api/v1/employees/{id}/certifications — System Administrator, HR Director
GET  /api/v1/employees/{id}/certifications — System Administrator, HR Director,
                                             Workforce Planner, Compliance Officer
```

Roles not listed above: HTTP 403.

Authority: GD-M13-2 Decision 12.

---

## CRT-201 — POST /api/v1/employees/{id}/certifications Request Requirements

```text
Required: certificationId (UUID) — must reference an existing certification in
          the same tenant
Optional: status — must be ACTIVE, EXPIRED, or REVOKED (GD-M13-3)
          Default: ACTIVE when omitted (GD-M13-3 Decision 2)
Optional: issueDate (ISO 8601 date)
Optional: expirationDate (ISO 8601 date)
```

If certificationId references a certification that does not exist in the requesting
tenant:

```text
HTTP 422, error code: CERTIFICATION_NOT_FOUND
```

The response must not distinguish between a certification that does not exist
in the platform at all versus one that belongs to a different tenant.
Both return CERTIFICATION_NOT_FOUND.

Authority: GD-M13-2 Decision 7.

---

## CRT-202 — EMP-302 Enforcement on Assignment

Before performing any write to workforce.employee_certifications, the service must
verify that the target employee's employment_status is not SEPARATED.

```text
Target employee is SEPARATED:
  HTTP 422, error code: EMPLOYEE_SEPARATED
```

This check is performed regardless of the requesting user's role.

Authority: EMP-302.

---

## CRT-203 — Status Value Validation

If status is provided in the request body, it must be one of:

```text
ACTIVE, EXPIRED, REVOKED
```

Any other value:

```text
HTTP 422, error code: INVALID_CERTIFICATION_STATUS
```

When status is omitted, ACTIVE is assigned by the system.

Authority: GD-M13-3 Decisions 1 and 2.

---

## CRT-204 — Expiration Date Requirement Enforcement

When the referenced certification type has expirationRequired = true:

```text
expirationDate is required in the request.
Omission: HTTP 422, error code: EXPIRATION_DATE_REQUIRED
```

When both issueDate and expirationDate are provided:

```text
expirationDate must be >= issueDate.
Violation: HTTP 422, error code: INVALID_DATE_RANGE
```

Authority: GD-M13-2 Decision 7.

---

## CRT-205 — Upsert Semantics for Employee Certification Assignments

workforce.employee_certifications uses a composite primary key (employee_id, certification_id).

```text
First assignment (no existing record):
  INSERT the record. Status defaults to ACTIVE when not provided.
  Emit WORKFORCE_EMPLOYEE_CERT_ASSIGNED audit event.

Repeat assignment (record already exists):
  UPDATE the record with new field values.
  Emit WORKFORCE_EMPLOYEE_CERT_UPDATED, WORKFORCE_EMPLOYEE_CERT_RENEWED,
  or WORKFORCE_EMPLOYEE_CERT_REVOKED (see CRT-300 for event selection).
```

No error is returned on repeat assignment. The record is updated.

Authority: GD-M13-4 Decision 3.

---

## CRT-300 — Status Transition Rules

Permitted status transitions:

```text
ACTIVE  → EXPIRED  — HR-managed update
ACTIVE  → REVOKED  — HR-managed update; emits CERT_REVOKED
EXPIRED → ACTIVE   — Renewal; emits CERT_RENEWED
EXPIRED → REVOKED  — HR-managed update; emits CERT_REVOKED
REVOKED → (any)    — BLOCKED; returns HTTP 422, error code: CERTIFICATION_REVOKED
```

REVOKED is a terminal state in M13. No outbound transitions from REVOKED.

Authority: GD-M13-3 Decision 3, state/07_employee_certification_states.md.

---

## CRT-301 — REVOKED Terminal Enforcement

Any attempt to update a workforce.employee_certifications record where the
current status is REVOKED must be blocked at the service layer before any
database write is performed.

```text
HTTP 422, error code: CERTIFICATION_REVOKED
```

This applies regardless of the requested new status or requesting user's role.

---

## CRT-302 — Audit Event Selection for Certification Updates

```text
Status changes to ACTIVE and prior status was EXPIRED: WORKFORCE_EMPLOYEE_CERT_RENEWED
Status changes to REVOKED:                             WORKFORCE_EMPLOYEE_CERT_REVOKED
All other updates:                                     WORKFORCE_EMPLOYEE_CERT_UPDATED
```

WORKFORCE_EMPLOYEE_CERT_RENEWED metadata must include:

```text
prior_expiration_date, new_expiration_date
prior_issue_date (if changed), new_issue_date (if changed)
```

WORKFORCE_EMPLOYEE_CERT_REVOKED metadata must include:

```text
certification_id, certification_name
prior_status, revocation_timestamp
```

Authority: GD-M13-4 Decision 5.

---

## CRT-400 — Expiration Tracking (FR-153)

The GET /api/v1/employees/{id}/certifications response must include expirationDate
and status for each certification assignment.

Expiration tracking queries must surface certifications where:

```text
status is ACTIVE
AND expirationDate is not null
AND expirationDate is within the requested lookahead window
```

An ACTIVE certification with a past expirationDate (status not yet updated to EXPIRED)
must also appear in expiration tracking queries. The query must check BOTH the stored
status field AND the expirationDate value.

Authority: GD-M13-3 Decision 4.

---

## CRT-401 — SKM-302 Matching Compatibility

EXPIRED and REVOKED certifications are treated as "certification not held" by the
Phase 3 AI matching engine per SKM-302.

This directive establishes that no implementation decision in M13 may create a
data model or API contract that conflicts with SKM-302's behavioral requirement.

Authority: GD-M13-3 Decision 5.

---

## CRT-500 — History Retention via Audit Trail

FR-113 "history retained" and FR-114 "expiration monitoring" are satisfied by the
immutable audit event trail in audit.audit_events. No separate certification history
table is required in M13.

The audit trail records who assigned the certification, when, at what status, and
every subsequent update — providing complete, legally admissible history including
renewal and revocation events.

Authority: GD-M13-4 Decision 1.

---

## CRT-501 — Deferred Capabilities

The following capabilities are explicitly deferred beyond M13:

```text
Employee certification removal (DELETE endpoint)
  Rationale: No DELETE endpoint for employee certification records in M13.
  The upsert model with audit trail is the only write path.

Position required certifications
  Rationale: GD-M13-5 — position_certifications table and endpoints deferred.
  FR-100 Required Certifications capability maturity: Planned.

Automated expiration monitoring job
  Rationale: Background job or scheduled process to automatically transition
  ACTIVE → EXPIRED when expirationDate passes is deferred to a future
  maintenance milestone. FR-153 expiration tracking via GET query is in M13;
  automated status update is not.

FR-152 Competency Framework
  Rationale: No schema or API authority for competency frameworks in spec/05
  or spec/06. Explicitly out of scope for M13.

PENDING_VERIFICATION and SUSPENDED status values
  Rationale: GD-M13-3 Decision 6 — deferred.
```

---

## Acceptance Criteria (M13 Step 3)

A successful Certifications implementation must satisfy ALL of the following:

```text
1. POST /api/v1/certifications creates a certification record with tenant_id from JWT
2. Certification name uniqueness enforced per tenant (HTTP 409 on conflict)
3. GET /api/v1/certifications returns only certifications for the requesting tenant
4. GET /api/v1/certifications/{id} returns HTTP 404 for cross-tenant IDs
5. PATCH /api/v1/certifications/{id} updates allowed fields
6. WORKFORCE_CERTIFICATION_CREATED and WORKFORCE_CERTIFICATION_UPDATED events emitted
7. POST /api/v1/employees/{id}/certifications — first assignment INSERTs and emits ASSIGNED
8. POST /api/v1/employees/{id}/certifications — repeat assignment UPDATEs and emits correct event
9. Status defaults to ACTIVE when omitted from request
10. REVOKED terminal state enforced (HTTP 422 CERTIFICATION_REVOKED on attempt to update)
11. expirationRequired = true enforces expirationDate (HTTP 422 EXPIRATION_DATE_REQUIRED)
12. Invalid date range rejected (HTTP 422 INVALID_DATE_RANGE)
13. EMP-302: SEPARATED employee assignment returns HTTP 422 EMPLOYEE_SEPARATED
14. Cross-tenant certificationId returns HTTP 422 CERTIFICATION_NOT_FOUND
15. Invalid status value returns HTTP 422 INVALID_CERTIFICATION_STATUS
16. CERT_RENEWED event emitted on EXPIRED → ACTIVE transition with correct metadata
17. CERT_REVOKED event emitted on revocation with correct metadata
18. RBAC enforced on all endpoints (HTTP 403 for Recruiter, Executive User)
19. Full unit test coverage for CertificationService and EmployeeCertificationService
20. PROGRESS.md updated to reflect M13 Step 3 completion
```
