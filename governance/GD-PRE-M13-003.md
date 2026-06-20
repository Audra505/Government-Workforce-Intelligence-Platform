# Governance Decision: GD-PRE-M13-003
# DEP-008 Department Deactivation — Trigger Confirmation and Constraint Activation

Project: AI-Driven Staffing Optimization Platform for Government HR

Decision ID: GD-PRE-M13-003

Status: Approved

Date: 2026-06-19

Approved By: Product Owner — Pre-M13 Governance Review

Milestone Context:
Pre-M13 governance recording. Closes an M12 implementation gap. Does not affect
M13 (Skills and Certifications) scope. DEP-008 implementation is a pre-M13
standalone deliverable with a verification gate that must be confirmed complete
before M13 implementation begins.

References:

- directives/12_organization_management_rules.md — DEP-008
- directives/13_employee_management_rules.md — EMP-200 (departmentId required)

---

# Background

DEP-008 (directives/12_organization_management_rules.md) specifies:

"Departments that are referenced by positions or employees must not be deactivated.
This constraint is enforced at Phase 2 when foreign key consumers exist.
In Phase 1 (Milestone 7), no FK consumers exist yet. Deactivation is permissive."

Milestone 12 implemented the Employee domain. Employee records carry a required
departmentId foreign key reference. The Phase 2 trigger condition specified in
DEP-008 has been met.

The constraint has not been implemented. This decision formally confirms the
trigger and mandates enforcement.

---

# Decision 1 — Trigger Confirmation

The DEP-008 Phase 2 trigger condition is confirmed satisfied.

The department deactivation constraint is active effective from the date of this
decision.

---

# Decision 2 — Employee Constraint (Phase A — Immediate)

The department service must reject any deactivation request when one or more
employees in the following statuses reference the target department:

```text
PENDING_ONBOARDING
ACTIVE
ON_LEAVE
SUSPENDED
```

Employees in SEPARATED status do not block deactivation.
Employees with a non-null deletedAt do not block deactivation.

Error code: DEPARTMENT_HAS_ACTIVE_EMPLOYEES

The error response must include the count of blocking employees.

Example:

```json
{
  "success": false,
  "error": {
    "code": "DEPARTMENT_HAS_ACTIVE_EMPLOYEES",
    "message": "Cannot deactivate department: 47 active employees must be reassigned first."
  }
}
```

---

# Decision 3 — Position Constraint (Phase B — At Position Linkage Milestone)

When the position linkage milestone is implemented, the department service must
additionally reject deactivation when one or more positions in the following
statuses reference the target department:

```text
DRAFT
ACTIVE
FROZEN
```

Positions in CLOSED status do not block deactivation.

Error code: DEPARTMENT_HAS_ACTIVE_POSITIONS

When both employees and positions are blocking, the error response must enumerate
both counts.

Example:

```json
{
  "success": false,
  "error": {
    "code": "DEPARTMENT_HAS_ACTIVE_DEPENDENTS",
    "message": "Cannot deactivate department: 47 active employees and 12 active positions must be reassigned first."
  }
}
```

---

# Decision 4 — No Override Mechanism

No bypass parameter, force flag, or administrative override may circumvent this
constraint through any API call, regardless of the requesting user's role.

The constraint is absolute at the API level.

---

# Decision 5 — No Cascade

Department deactivation does not trigger any automated status change on referencing
employees or positions.

Deactivation either succeeds cleanly or is rejected entirely.

HR administrators performing reorganizations must reassign all active employees and
close or reassign all active positions before deactivating a department.

---

# Verification Gate

The Phase A (employee constraint) implementation is confirmed complete when:

```text
1. A deactivation attempt on a department with active employees returns HTTP 422
   with error code DEPARTMENT_HAS_ACTIVE_EMPLOYEES and an accurate employee count.

2. A deactivation attempt on a department with no active employees (or only
   SEPARATED employees) succeeds and returns HTTP 200.

3. Both behaviors are covered by unit tests in the department service test suite.

4. Both behaviors are covered by at least one e2e or runtime verification test.
```

This verification gate must be confirmed complete before M13 implementation begins.

---

# Governing Authority Over

- directives/12_organization_management_rules.md (DEP-008)

No new policy is created. This decision records the formal activation of an
existing policy whose trigger condition has been met.

---

# M13 Impact

DEP-008 enforcement is not a functional dependency of M13 Skills and Certifications.
Skills and certifications reference employees, not departments directly.

However, DEP-008 implementation must be completed and verified before M13
implementation begins, per the pre-M13 verification gate above.
