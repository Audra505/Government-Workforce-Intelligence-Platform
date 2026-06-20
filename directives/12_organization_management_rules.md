# Organization Management Rules

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative Organization Management Directive

References:

- spec/01_requirements.md
- spec/04_domain_model.md
- spec/05_database_schema.md
- spec/06_api_contracts.md
- spec/10_backend_architecture.md
- directives/08_audit_rules.md
- directives/10_role_based_access_rules.md
- directives/11_government_policy_rules.md
- execution/03_phase_2_core_workforce_platform.md

---

# Governance Decisions Incorporated

This directive incorporates the following approved governance decisions:

- GD-PRE-M13-003: DEP-008 Department Deactivation — Trigger Confirmation and Constraint Activation (2026-06-19)
  — Confirms the DEP-008 Phase 2 trigger condition has been met (M12 established employee FK consumers).
  — Department deactivation with active employees is prohibited effective 2026-06-19.
  — Error code: DEPARTMENT_HAS_ACTIVE_EMPLOYEES.
  — Position constraint (DEPARTMENT_HAS_ACTIVE_POSITIONS) activates at position linkage milestone.
  — No override mechanism. No cascade.
  — See governance/GD-PRE-M13-003.md for full decision text.

---

# Purpose

This directive defines the business rules governing organization management.

These rules control:

- Agency management
- Department creation and lifecycle
- Department code uniqueness
- Organizational hierarchy
- Tenant isolation for organizational entities
- Audit requirements for organizational changes

These rules are mandatory for all implementations.

---

# Organization Principles

## ORG-001

Every department belongs to exactly one tenant.

---

## ORG-002

Department codes must be unique within a tenant.

A department code from one tenant does not conflict with the same code in another tenant.

---

## ORG-003

Organization changes must be auditable.

All create, update, and deactivation operations must emit audit events per AUD-350.

---

## ORG-004

Tenant isolation is mandatory.

No query may return organizational data from a tenant other than the authenticated user's tenant.

---

## ORG-005

Organizational records must not be physically deleted.

Departments are deactivated by setting `status = INACTIVE`. Physical removal is prohibited.

Soft delete (`deleted_at`) is reserved for compliance-governed disposal per `data/03_retention_policy.md`.

---

## ORG-006

Agency and tenant are equivalent concepts in this platform.

The `Tenant` model represents the agency root entity. No separate `agencies` table exists.

`GET /api/v1/agencies/current` reads from `Tenant` and returns agency-shaped data.

This equivalence is a permanent architectural decision, not a gap.

---

# Agency Rules

## AGY-001

Agency data is read-only through the API in Phase 1.

Agency creation is an onboarding operation performed outside the API scope.

---

## AGY-002

Every authenticated user has exactly one agency context.

The agency context is derived from the authenticated user's `tenantId` in the JWT payload.

Clients may not supply or override agency context.

---

## AGY-003

Agency data must not expose internal identifiers or sensitive configuration.

The agency endpoint returns: name, code, status, createdAt.

---

# Department Rules

## DEP-001

Every department must have a name and a code.

Both are required at creation time.

---

## DEP-002

Department code must be unique within the tenant.

Duplicate code within the same tenant must return a CODE_CONFLICT outcome.

Code uniqueness is enforced at the database level (`@@unique([tenantId, code])`).

---

## DEP-003

Department names do not require uniqueness.

Multiple departments may share the same name within a tenant (names are human-readable labels, not identifiers).

---

## DEP-004

Department status lifecycle:

```text
ACTIVE
 → INACTIVE (deactivation)
```

Deactivation emits `ORG_DEPARTMENT_DEACTIVATED` per AUD-350.

Reactivation is not supported in Phase 1.

---

## DEP-005

A deactivated department (`status = INACTIVE`) must not appear in list results by default.

List endpoints must filter `deletedAt IS NULL` by default.

Clients may request inactive departments via a `status` query filter.

---

## DEP-006

Cross-tenant lookup of a department must return NOT_FOUND.

The same outcome is returned for absent and cross-tenant departments.

This prevents tenant enumeration.

---

## DEP-007

Department descriptions are optional.

A department may be created without a description.

---

## DEP-008

Departments that are referenced by positions or employees must not be deactivated.

This constraint is ACTIVE. The Phase 2 trigger condition (FK consumers exist) was
confirmed met by GD-PRE-M13-003 (2026-06-19) following Milestone 12 implementation
of the Employee domain.

Enforcement is implemented in two phases:

Phase A (immediate — employee FK consumers):
The department service must reject deactivation when any employee in
PENDING_ONBOARDING, ACTIVE, ON_LEAVE, or SUSPENDED status references the
department. Error code: DEPARTMENT_HAS_ACTIVE_EMPLOYEES.

Phase B (at position linkage milestone — position FK consumers):
The department service must additionally reject deactivation when any position
in DRAFT, ACTIVE, or FROZEN status references the department.
Error code: DEPARTMENT_HAS_ACTIVE_POSITIONS.

No bypass parameter, force flag, or administrative override may circumvent this
constraint through any API call, regardless of role.

No automated cascade of employee or position status changes occurs on deactivation.

Authority: GD-PRE-M13-003 (approved 2026-06-19).

---

# Authorization Rules

## ORG-AUTH-001

Creating and updating departments requires one of:

```text
System Administrator
HR Director
```

---

## ORG-AUTH-002

Reading departments (list and get by ID) requires one of:

```text
System Administrator
HR Director
Workforce Planner
```

---

## ORG-AUTH-003

The agency endpoint (`GET /api/v1/agencies/current`) requires authentication only.

No role restriction is applied. Every authenticated user needs agency context.

---

# Audit Requirements

All organization management operations must emit audit events per AUD-350.

See `directives/08_audit_rules.md` — AUD-350 for the complete list.

---

# Deferred Capabilities

The following capabilities are explicitly out of scope for Milestone 7:

## FR-052 Organizational Hierarchy

Parent-department relationships and organizational tree traversal are deferred.

A `parent_department_id` column may be added in a future migration without requiring structural change to the department entity.

---

## FR-053 Cost Center Management

Cost center assignment is deferred to the Workforce Planning milestone.

Cost centers relate positions and workforce plans to budget codes — that dependency does not exist until Position Management is implemented.

---

# Verification

Success in this domain is verified when:

```text
Department created with code and name
Department code unique within tenant confirmed
Department retrieved by ID
Department list returns only own-tenant records
Cross-tenant lookup returns NOT_FOUND
Deactivated department excluded from default list
ORG_DEPARTMENT_CREATED audit record written
ORG_DEPARTMENT_UPDATED audit record written
ORG_DEPARTMENT_DEACTIVATED audit record written
Agency endpoint returns current tenant data
401 returned for unauthenticated requests
403 returned for unauthorized role requests
```
