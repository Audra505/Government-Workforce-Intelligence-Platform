# State Model: Employee Certification States

State Model ID: 07
File: state/07_employee_certification_states.md

Project: AI-Driven Staffing Optimization Platform for Government HR

Status: Authoritative State Model

Version: 1.0

Date: 2026-06-19

Governance Authority: GD-M13-3

Related Files:

- governance/GD-M13-3.md (status enumeration authority)
- governance/GD-M13-4.md (audit event requirements per transition)
- directives/15_certification_management_rules.md (CRT-300 through CRT-501)
- spec/01_requirements.md (FR-114, FR-151, FR-153)
- spec/05_database_schema.md (workforce.employee_certifications.status VARCHAR(50))
- state/02_employee_lifecycle.md (employee state model — SEPARATED read-only rule)

---

## Purpose

This file defines the authoritative lifecycle states for employee certification
assignments (workforce.employee_certifications.status). It establishes permitted
states, transition rules, terminal states, and the required audit event per transition.

---

## States

```text
┌──────────────────────────────────────────────────────────────────┐
│  workforce.employee_certifications.status                        │
│                                                                  │
│  Canonical values (GD-M13-3 Decision 1):                         │
│    ACTIVE   — certification is currently held and valid          │
│    EXPIRED  — certification is no longer valid                   │
│    REVOKED  — certification was invalidated by issuing authority │
└──────────────────────────────────────────────────────────────────┘
```

### ACTIVE

```text
Meaning:     The employee holds this certification and it is within
             its validity period.

Initial:     Yes — all new assignments default to ACTIVE (GD-M13-3 Decision 2).

Terminal:    No — transitions to EXPIRED or REVOKED are permitted.

HR-managed:  Yes — HR assigns ACTIVE; future system process may set EXPIRED
             by detecting past expirationDate.
```

### EXPIRED

```text
Meaning:     The certification's validity period has lapsed.
             The employee does not currently hold a valid version of
             this certification.

Initial:     No — may only be reached by transition from ACTIVE.

Terminal:    No — may transition back to ACTIVE via renewal.

HR-managed:  Yes (explicit status update via assignment endpoint upsert).
             OR system-detected: an ACTIVE certification with expirationDate
             in the past is treated as expired in all query logic regardless
             of stored status (GD-M13-3 Decision 4).
```

### REVOKED

```text
Meaning:     The issuing authority has formally invalidated this
             certification before its natural expiration date.
             Cannot be renewed; cannot be reversed in M13.

Initial:     No — may only be reached by transition from ACTIVE.

Terminal:    Yes — no outbound transitions from REVOKED in M13.

HR-managed:  Always. REVOKED cannot be derived from date fields.
             Requires explicit HR action.
```

---

## State Transition Table

```text
From        To          Trigger               Permitted   Audit Event
──────────  ──────────  ────────────────────  ──────────  ─────────────────────────────────
(none)      ACTIVE      First assignment      Yes         WORKFORCE_EMPLOYEE_CERT_ASSIGNED
ACTIVE      EXPIRED     HR explicit / date    Yes         WORKFORCE_EMPLOYEE_CERT_UPDATED
ACTIVE      REVOKED     HR explicit only      Yes         WORKFORCE_EMPLOYEE_CERT_REVOKED
EXPIRED     ACTIVE      HR renewal action     Yes         WORKFORCE_EMPLOYEE_CERT_RENEWED
EXPIRED     REVOKED     HR explicit           Yes         WORKFORCE_EMPLOYEE_CERT_REVOKED
REVOKED     (any)       —                     No          (blocked at service layer)
```

### Transition Notes

**Initial assignment → ACTIVE:**
Occurs when POST /api/v1/employees/{id}/certifications is called for a
certification the employee does not yet hold. The record is INSERTed.
Status defaults to ACTIVE when omitted from the request body.

**ACTIVE → EXPIRED:**
Occurs when HR explicitly updates status to EXPIRED via the assignment
endpoint (upsert semantics — same endpoint, UPDATE path).
Certification remains in the record as a historical artifact.

**ACTIVE → REVOKED:**
Occurs when HR explicitly sets status to REVOKED. The REVOKED state
is permanent in M13. Any future re-assignment of this certification
type to the same employee must create a new issuance — the REVOKED
record is not reactivated.

**EXPIRED → ACTIVE (renewal):**
Occurs when HR updates a previously EXPIRED certification with new
issueDate, new expirationDate, and status ACTIVE. This represents a
renewal event. The record is updated in place (composite PK).
The WORKFORCE_EMPLOYEE_CERT_RENEWED audit event captures the prior
expirationDate in its metadata field.

**REVOKED → (any):**
Blocked at the service layer. Attempting to transition from REVOKED
to any state returns HTTP 422, error code: CERTIFICATION_REVOKED.
This is enforced in CertificationService per CRT-403.

---

## State Transition Diagram

```text
                     ┌──────────────────────────────────┐
                     │         (new assignment)          │
                     │               ↓                   │
                     │           ACTIVE                  │
                     │          /       \                │
                     │   (expired)   (revoked)           │
                     │       ↓             ↓             │
                     │   EXPIRED ──(revoked)──▶ REVOKED  │
                     │       |                    (terminal)
                     │  (renewed)                        │
                     │       ↑                           │
                     │   ACTIVE                          │
                     └──────────────────────────────────┘
```

Simplified:

```text
START → ACTIVE ──────────────────────▶ REVOKED (terminal)
              ↘ EXPIRED ─────────────▶ REVOKED (terminal)
              ↗ (renewal path only)
```

---

## Invalid Values

Any status value other than ACTIVE, EXPIRED, or REVOKED:

```text
Rejected at DTO validation layer.
HTTP 422, error code: INVALID_CERTIFICATION_STATUS.
No record written. No audit event emitted.
```

Authority: GD-M13-3 Decision 1.

---

## Expiration Date vs. Status Field

The status field and expirationDate field are independent values
that must both be checked for expiration-related queries.

```text
status = ACTIVE AND expirationDate in the past:
  → The certification has lapsed but status was not yet updated.
  → Expiration tracking queries (FR-153) must surface this record.
  → The system must not treat status = ACTIVE as "currently valid"
    when expirationDate has passed.

status = EXPIRED AND expirationDate in the future:
  → Anomalous but possible if HR explicitly set EXPIRED early.
  → The stored status is authoritative for certification validity checks.
  → Matching engine treats this certification as non-qualifying.
```

Authority: GD-M13-3 Decision 4.

---

## Employee Separation Constraint

```text
All write operations on workforce.employee_certifications require
that the target employee's employment_status is not SEPARATED.

Attempt to modify a SEPARATED employee's certification records:
  HTTP 422, error code: EMPLOYEE_SEPARATED
```

Authority: EMP-302 (directives/13_employee_management_rules.md).

This constraint applies regardless of the requested status transition.

---

## Matching Engine Compatibility

```text
EXPIRED → treated as "certification not held" by Phase 3 AI matching
REVOKED → treated as "certification not held" by Phase 3 AI matching
ACTIVE  → treated as "certification held" subject to expirationDate check
```

Authority: directives/05_skill_matching_rules.md, SKM-302.
Forward-compatibility declaration: GD-M13-3 Decision 5.

---

## Audit Requirements Summary

| Event | Trigger |
|---|---|
| WORKFORCE_EMPLOYEE_CERT_ASSIGNED | First assignment (INSERT path) |
| WORKFORCE_EMPLOYEE_CERT_UPDATED | Any update not matching RENEWED or REVOKED event criteria |
| WORKFORCE_EMPLOYEE_CERT_RENEWED | Status update: EXPIRED → ACTIVE |
| WORKFORCE_EMPLOYEE_CERT_REVOKED | Status update: (any) → REVOKED |

Metadata requirements for CERT_RENEWED and CERT_REVOKED events are defined
in governance/GD-M13-4.md Decision 5.

---

## Out-of-Scope for M13

```text
PENDING_VERIFICATION status value — deferred (GD-M13-3 Decision 6)
SUSPENDED status value            — deferred (GD-M13-3 Decision 6)
Automated expiration job          — deferred to a future maintenance milestone
Position certification linkage    — deferred (GD-M13-5)
```
