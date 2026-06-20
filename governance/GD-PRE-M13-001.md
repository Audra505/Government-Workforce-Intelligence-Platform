# Governance Decision: GD-PRE-M13-001
# VAC-401 Hiring Workflow — Dual-Path Authority Classification and Appointment Authority Design

Project: AI-Driven Staffing Optimization Platform for Government HR

Decision ID: GD-PRE-M13-001

Status: Approved

Date: 2026-06-19

Approved By: Product Owner — Pre-M13 Governance Review

Milestone Context:
Pre-M13 governance recording. Governs Phase 3 Talent Acquisition and the future
position linkage milestone. Does not affect M13 (Skills and Certifications).

References:

- directives/03_vacancy_management_rules.md — VAC-401
- directives/13_employee_management_rules.md — EMP-200 through EMP-204
- directives/10_role_based_access_rules.md — RBAC-700, RBAC-701
- state/02_employee_lifecycle.md — PENDING_ONBOARDING entry state

---

# Background

The platform specification (VAC-401) defines a standard employee creation path
through vacancy hiring. The M12 implementation created a direct administrative
creation path (POST /employees) as a Phase 2 operational foundation. No governing
authority had classified whether direct creation was a temporary placeholder or a
permanent path, or whether the two paths would coexist.

This decision formally classifies both paths and governs the appointment authority
field that records which path produced each employee record.

---

# Decision 1 — Dual Creation Path Classification

The platform permanently and simultaneously supports two employee creation paths.
Both are authorized for production use. Neither supersedes the other.

## Path A — Non-Competitive and Administrative Appointment

The existing POST /employees endpoint is the Non-Competitive and Administrative
Appointment path.

Authorized use cases:

```text
Lateral transfers between agencies
Emergency appointments
Schedule A appointments (persons with disabilities)
Schedule C appointments (political and confidential positions)
Reinstatements within the eligibility period
Senior executive appointments
All other appointments made under a non-competitive legal authority
```

Access: System Administrator and HR Director only.

This path is permanent. It is not deprecated upon implementation of Path B.

## Path B — Competitive Appointment (VAC-401)

The VAC-401 hiring workflow, when implemented in Phase 3 Talent Acquisition, is
the Competitive Appointment path.

It is the required path for career civil service positions filled through
competitive examination or rating.

The resulting employee record carries:

```text
vacancyId — reference to the originating vacancy
candidateId — reference to the selected candidate
positionId — derived from the vacancy's authorized position
appointmentAuthority — set to COMPETITIVE_APPOINTMENT (system-assigned)
```

Implementation of this path is deferred to Phase 3 Talent Acquisition.

---

# Decision 2 — Appointment Authority Field

All employee records created through Path A must carry an appointmentAuthority
field identifying the legal basis for the non-competitive action.

The appointmentAuthority field is required at creation on Path A.

Valid values on Path A:

```text
LATERAL_TRANSFER
EMERGENCY_APPOINTMENT
SCHEDULE_A
SCHEDULE_C
REINSTATEMENT
SENIOR_EXECUTIVE
ADMINISTRATIVE
```

ADMINISTRATIVE is the catch-all value for non-competitive appointments not covered
by a more specific authority code.

---

# Decision 3 — COMPETITIVE_APPOINTMENT System-Only Reservation

COMPETITIVE_APPOINTMENT is a reserved system-only value.

```text
It is NOT a valid input on any API request body.
It is assigned exclusively and automatically by the VAC-401 workflow at the
point of hire.
No HR administrator or System Administrator may manually set
appointmentAuthority = COMPETITIVE_APPOINTMENT through the API.
Any request containing this value on Path A is rejected.
```

Rationale: A competitive appointment is not a category that can be self-declared.
It is a system-generated outcome of a specific event chain — position authorized,
vacancy posted, competitive examination, selection, offer accepted, hire event.
Allowing manual selection before VAC-401 exists would produce records claiming
competitive appointment status with no vacancy reference, no candidate reference,
and no examination certificate. Such records would be indistinguishable from
genuine VAC-401 hires in compliance reporting.

---

# Decision 4 — Historical Record Integrity

Employee records created under Path A are not retroactively reclassified as
competitive appointments when VAC-401 is implemented.

The appointment authority recorded at creation is permanent and immutable on the
employee record.

---

# Governing Authority Over

- directives/03_vacancy_management_rules.md (VAC-401 implementation scope)
- directives/13_employee_management_rules.md (EMP-200 series employee creation rules)
- Future position linkage milestone employee schema design
- Phase 3 Talent Acquisition implementation design

---

# M13 Impact

None. M13 (Skills and Certifications) has no dependency on hiring workflow
classification or appointment authority field implementation.

The appointmentAuthority field is a pre-position-linkage-milestone schema addition,
not an M13 requirement.
