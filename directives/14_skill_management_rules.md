# Skill Management Rules

Directive ID: 14
File: directives/14_skill_management_rules.md

Project: AI-Driven Staffing Optimization Platform for Government HR

Status: Authoritative Skill Management Directive

Version: 1.0

Date: 2026-06-19

---

## References

- spec/01_requirements.md (FR-113, FR-150)
- spec/04_domain_model.md (Skill entity, Employee Skill entity)
- spec/05_database_schema.md (workforce.skills, workforce.employee_skills)
- spec/06_api_contracts.md (Employee API)
- governance/GD-M13-1.md (tenant scope, column set — authoritative for schema)
- governance/GD-M13-2.md (API design, RBAC, request contracts — authoritative for API surface)
- governance/GD-M13-4.md (history retention, upsert semantics, audit event types)
- directives/05_skill_matching_rules.md (SKM-402 — verified skill weighting, Phase 3)
- directives/13_employee_management_rules.md (EMP-302, SEC-003, EMP-601)

---

## Governance Decisions Incorporated

- GD-M13-1 — Catalog Tenant Scope (per-tenant, tenant_id on workforce.skills)
- GD-M13-2 — API Design (endpoint contracts, RBAC, EMP-302 enforcement)
- GD-M13-4 — History Retention (audit event trail, upsert semantics, AuditEventType values)

---

## Purpose

This directive defines the authoritative behavioral rules for the Skills domain
in M13 and all subsequent milestones. It covers the Skills catalog (workforce.skills),
employee skill assignments (workforce.employee_skills), tenant isolation, RBAC,
proficiency levels, verification semantics, and audit requirements.

This directive supplements spec/04 and spec/05 with governance-authorized behavioral
rules. Where this directive conflicts with the unamended spec, this directive governs.

---

## SKL-001 — Tenant Scope

The workforce.skills table is per-tenant. Every skill entry belongs to exactly one
tenant. Catalog entries are not visible across tenant boundaries.

Tenant scope is enforced by:
- tenant_id on workforce.skills (GD-M13-1 Decision 2)
- All catalog reads and writes must WHERE-filter on tenant_id extracted from the JWT
- No cross-tenant reads permitted

Authority: GD-M13-1.

---

## SKL-002 — SEC-003 Enforcement on All Skill Endpoints

All skill endpoint operations must derive tenant_id from the authenticated JWT.
tenant_id must never be accepted from:
- request body
- query parameters
- route parameters

Cross-tenant skill records must return HTTP 404.
The response is identical for absent and cross-tenant records (no tenant enumeration).

Authority: GD-M13-1 Decision 3, SEC-003.

---

## SKL-003 — Skill Name Uniqueness Within Tenant

Skill names must be unique within a tenant.

Duplicate skill name within the same tenant:

```text
HTTP 409, error code: SKILL_NAME_CONFLICT
```

Uniqueness constraint is enforced at both the database (UNIQUE INDEX on tenant_id, name)
and service layer.

Authority: GD-M13-2 Decision 8.

---

## SKL-004 — Skill Soft-Delete

Soft-delete applies to workforce.skills records.
The deleted_at column (TIMESTAMPTZ NULL) is set to the deletion timestamp.
Records with deleted_at IS NOT NULL are excluded from all list and lookup queries
unless explicitly requested.

A skill with active employee assignments (workforce.employee_skills records where
deleted_at IS NULL on the referenced employee) may not be soft-deleted.
Soft-delete attempt when active assignments exist:

```text
HTTP 422, error code: SKILL_HAS_ACTIVE_ASSIGNMENTS
```

This prevents orphaning active employee skill records without deleting them.

Authority: GD-M13-1 Decision 7 (deleted_at column), spec/05 soft-delete strategy.

---

## SKL-100 — Skills Catalog CRUD Authorization

```text
POST  /api/v1/skills          — System Administrator, HR Director
PATCH /api/v1/skills/{id}     — System Administrator, HR Director
GET   /api/v1/skills          — System Administrator, HR Director,
                                Workforce Planner, Compliance Officer
GET   /api/v1/skills/{id}     — System Administrator, HR Director,
                                Workforce Planner, Compliance Officer
```

Roles not listed above: HTTP 403 on any skills catalog endpoint.

Authority: GD-M13-2 Decision 12.

---

## SKL-101 — POST /api/v1/skills Request Requirements

```text
Required: name (string, max 255 characters)
Optional: category (string, max 100 characters)
Optional: description (string, text)
```

Validation failures return HTTP 422 with a descriptive error code.
tenant_id: derived from JWT only.

Authority: GD-M13-2 Decision 4.

---

## SKL-102 — PATCH /api/v1/skills/{id} Request Requirements

All fields are optional on PATCH. Only provided fields are updated.
Partial update is supported. Omitted fields retain their current values.

If name is provided, it must not conflict with an existing skill name in the tenant.
Name conflict on PATCH: HTTP 409, error code: SKILL_NAME_CONFLICT.

---

## SKL-103 — Skill Catalog Audit Events

Every write operation on workforce.skills must produce an immutable audit event:

```text
POST  /api/v1/skills      → WORKFORCE_SKILL_CREATED
PATCH /api/v1/skills/{id} → WORKFORCE_SKILL_UPDATED
```

Audit events are required per GD-M13-4 Decision 4.
Failure to emit an audit event is a service error — the write must not succeed
without a corresponding audit event.

---

## SKL-200 — Employee Skill Assignment Authorization

```text
POST /api/v1/employees/{id}/skills — System Administrator, HR Director
GET  /api/v1/employees/{id}/skills — System Administrator, HR Director,
                                     Workforce Planner, Compliance Officer
```

Roles not listed above: HTTP 403.

Authority: GD-M13-2 Decision 12.

---

## SKL-201 — POST /api/v1/employees/{id}/skills Request Requirements

```text
Required: skillId (UUID) — must reference an existing skill in the same tenant
Optional: proficiencyLevel — must be a canonical value (see SKL-210) if provided
Optional: verifiedAt — ISO 8601 timestamp
```

If skillId references a skill that does not exist in the requesting tenant:

```text
HTTP 422, error code: SKILL_NOT_FOUND
```

The response must not distinguish between a skill that does not exist in the
platform at all versus a skill that belongs to a different tenant. Both return
SKILL_NOT_FOUND.

Authority: GD-M13-2 Decision 6.

---

## SKL-202 — EMP-302 Enforcement on Assignment

Before performing any write to workforce.employee_skills, the service must verify
that the target employee's employment_status is not SEPARATED.

```text
Target employee is SEPARATED:
  HTTP 422, error code: EMPLOYEE_SEPARATED
```

This check is performed regardless of the requesting user's role.

Authority: EMP-302.

---

## SKL-203 — Upsert Semantics for Employee Skill Assignments

workforce.employee_skills uses a composite primary key (employee_id, skill_id).

```text
First assignment (no existing record):
  INSERT the record.
  Emit WORKFORCE_EMPLOYEE_SKILL_ASSIGNED audit event.

Repeat assignment (record already exists):
  UPDATE the record with new field values.
  Emit WORKFORCE_EMPLOYEE_SKILL_UPDATED audit event.
```

No error is returned on repeat assignment. The record is updated with the
provided field values. Fields not provided in the request retain their existing
values (partial update semantics).

Authority: GD-M13-4 Decision 3.

---

## SKL-204 — Employee Skill Assignment Audit Events

```text
First assignment (INSERT path):  WORKFORCE_EMPLOYEE_SKILL_ASSIGNED
Update (UPDATE path):             WORKFORCE_EMPLOYEE_SKILL_UPDATED
```

WORKFORCE_EMPLOYEE_SKILL_UPDATED metadata must include:

```text
prior_proficiency_level, new_proficiency_level
prior_verified_at, new_verified_at (where changed)
```

Authority: GD-M13-4 Decisions 4 and 5.

---

## SKL-210 — Proficiency Levels

The following proficiency level values are the only permitted values for
workforce.employee_skills.proficiency_level in M13.

```text
BEGINNER    — Foundational awareness; requires supervision; limited
              independent application.

DEVELOPING  — Building competency; requires some oversight; can handle
              routine tasks with guidance.

PROFICIENT  — Fully qualified; can perform independently; meets the
              GS-9 to GS-11 journeyman standard. This is the career
              ladder threshold for promotion eligibility in most
              federal occupational series.

ADVANCED    — Applies the skill to complex or non-routine situations;
              may mentor others; recognized subject-matter expertise.

EXPERT      — Authoritative mastery; creates or defines policy,
              standards, or doctrine in this skill area; agency-level
              or department-level recognized authority.
```

Selection rationale: OPM 5-level proficiency scale aligned with federal
occupational competency frameworks. PROFICIENT maps to the standard
GS-9 to GS-11 journeyman fully qualified threshold used across federal
agencies and DoD civilian workforce systems.

Authority: GD-M13-2 Decision 6, GD-M13 Governance Approval Package
(Option B selected, 2026-06-19).

Validation: If proficiencyLevel is provided in a request and its value
is not one of the five values above, the request is rejected:

```text
HTTP 422, error code: INVALID_PROFICIENCY_LEVEL
```

If proficiencyLevel is omitted, the field is stored as NULL. A NULL
proficiency indicates the proficiency was not assessed at assignment time.

---

## SKL-211 — verifiedAt Semantics

The verifiedAt field on workforce.employee_skills records the timestamp
at which an authorized HR professional verified the employee's skill claim.

```text
verifiedAt = NULL:  Self-declared. The employee asserts this skill.
                    Proficiency level is self-reported. No independent
                    verification has been performed.

verifiedAt = set:   HR-verified. An authorized HR actor confirmed the
                    employee's skill claim at the recorded timestamp.
```

This distinction is critical for Phase 3 skill matching weight.
directives/05_skill_matching_rules.md SKM-402 specifies that verified
skills receive higher weight than self-declared skills in AI matching.

SKL-211 Implementation rule: Only System Administrator and HR Director
roles may set verifiedAt. If a non-authorized role provides verifiedAt
in a request body, the field must be silently dropped — verifiedAt is
treated as not provided for that request.

---

## SKL-300 — History Retention via Audit Trail

FR-113 "history retained" is satisfied by the immutable audit event trail
in audit.audit_events. No separate skill history table is required in M13.

The audit trail records who assigned the skill, when, at what proficiency,
and every subsequent update — providing complete, legally admissible history.

Authority: GD-M13-4 Decision 1.

---

## SKL-400 — Deferred Capabilities

The following capabilities are explicitly deferred beyond M13:

```text
Employee skill removal (DELETE endpoint)
  Rationale: No DELETE endpoint for employee skill records in M13.
  The upsert model with audit trail is the only write path.

Position required skills
  Rationale: GD-M13-5 — position_skills table and endpoints deferred.
  FR-100 Required Skills capability maturity: Planned.

Bulk skill import
  Rationale: Not in M13 scope.

Automated proficiency assessment
  Rationale: Phase 3 AI feature; not in M13.
```

---

## Acceptance Criteria (M13 Step 2)

A successful Skills implementation must satisfy ALL of the following:

```text
1. POST /api/v1/skills creates a skill record with tenant_id from JWT
2. Skill name uniqueness enforced per tenant (HTTP 409 on conflict)
3. GET /api/v1/skills returns only skills for the requesting tenant
4. GET /api/v1/skills/{id} returns HTTP 404 for cross-tenant skill IDs
5. PATCH /api/v1/skills/{id} updates allowed fields
6. WORKFORCE_SKILL_CREATED and WORKFORCE_SKILL_UPDATED audit events emitted
7. POST /api/v1/employees/{id}/skills — first assignment INSERTs and emits ASSIGNED
8. POST /api/v1/employees/{id}/skills — repeat assignment UPDATEs and emits UPDATED
9. EMP-302: SEPARATED employee assignment returns HTTP 422 EMPLOYEE_SEPARATED
10. Cross-tenant skillId in assignment returns HTTP 422 SKILL_NOT_FOUND
11. Invalid proficiencyLevel returns HTTP 422 INVALID_PROFICIENCY_LEVEL
12. RBAC enforced on all endpoints (HTTP 403 for Recruiter, Executive User)
13. Full unit test coverage for SkillService and EmployeeSkillService
14. PROGRESS.md updated to reflect M13 Step 2 completion
```
