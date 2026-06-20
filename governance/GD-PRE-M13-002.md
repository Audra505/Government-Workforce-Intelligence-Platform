# Governance Decision: GD-PRE-M13-002
# Employee ↔ Position Linkage Strategy — FTE Slot Model Design Authority

Project: AI-Driven Staffing Optimization Platform for Government HR

Decision ID: GD-PRE-M13-002

Status: Approved

Date: 2026-06-19

Approved By: Product Owner — Pre-M13 Governance Review

Milestone Context:
Pre-M13 governance recording. Governs the future position linkage milestone.
M13 is confirmed as Skills and Certifications — position linkage is deferred to
the milestone following M13. This decision supersedes the implementation timing
assumption in GD-M12-2, which deferred position linkage to M13. M13 is now
confirmed as Skills and Certifications; position linkage is deferred beyond M13
to a dedicated workforce planning milestone.

References:

- GD-M12-2 — Employee Position Field Authority (original deferral decision)
- directives/02_position_management_rules.md — POS-400 and POS-500 series
- state/01_position_lifecycle.md — position lifecycle and closure pre-conditions
- state/02_employee_lifecycle.md — Active state position requirement
- spec/04_domain_model.md — Workforce Planning domain model

---

# Background

GD-M12-2 deferred position linkage (positionId on employees) to M13. M13 is now
confirmed as the Skills and Certifications milestone. Position linkage is therefore
deferred to the next workforce planning milestone after M13.

This decision records the design authority for that future milestone so that its
planning begins with agreed governance inputs rather than implicit schema choices
made during implementation.

---

# Decision 1 — Adopted Model: 1:1 FTE Slot Model

The platform implements the 1:1 FTE Slot Model for the employee-to-position
relationship.

```text
A position may have at most one employee in PENDING_ONBOARDING, ACTIVE, ON_LEAVE,
or SUSPENDED status at any time.

Employees in SEPARATED status are excluded from the occupancy constraint.
Separated employees retain their historical positionId reference.

A position with no employee in the above statuses is a vacant position.
```

Enforcement method: Service layer. No database-level unique constraint is required.
Service-level enforcement must be covered by unit tests proving constraint behavior
for all relevant status combinations.

Error code for violation: POSITION_ALREADY_OCCUPIED

---

# Decision 2 — Assignment Timing

```text
positionId is nullable at employee creation.

Rationale: Supports Path A non-competitive appointments (per GD-PRE-M13-001)
where position assignment follows the hiring action.

positionId must be set at or before the PENDING_ONBOARDING → ACTIVE transition.

An activation attempt by an employee without a positionId is rejected.
Error code: POSITION_REQUIRED_FOR_ACTIVATION
```

---

# Decision 3 — Position State Constraint on Assignment

```text
Employee position assignment is permitted only when the target position is
in ACTIVE status.

Assignment to positions in DRAFT, FROZEN, or CLOSED status is rejected.
Error code: POSITION_NOT_ACTIVE_FOR_ASSIGNMENT
```

---

# Decision 4 — Closure Cascade Prohibition

```text
Closing a position (transition to CLOSED status) does not automatically modify
the employment status of any incumbent employee.

The employee retains their current employment status and their historical
positionId reference.

Reassignment or separation following position closure is a human-initiated
HR process, not a system cascade.
```

---

# Decision 5 — Position Closure Pre-Conditions

```text
Position closure (transition to CLOSED) requires that no employee in
PENDING_ONBOARDING, ACTIVE, ON_LEAVE, or SUSPENDED status holds a positionId
reference to the target position.

This pre-condition is enforced at the service layer when position linkage
is implemented.

Error code: POSITION_HAS_ACTIVE_INCUMBENT
```

---

# Governing Authority Over

- directives/02_position_management_rules.md (POS-400 and POS-500 series)
- state/01_position_lifecycle.md (closure pre-conditions)
- state/02_employee_lifecycle.md (Active state position requirement)
- Future position linkage milestone schema design and service implementation

This decision supersedes the implementation timing assumption in GD-M12-2.
Position linkage is deferred to the milestone following M13, not to M13 itself.

---

# M13 Impact

None. M13 (Skills and Certifications) has no dependency on position linkage.
Skills and certifications are employee-attribute entities that do not reference
positions. This decision is recorded as a design input for the future position
linkage milestone.
