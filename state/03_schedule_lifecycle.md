# Schedule Lifecycle

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative Schedule State Model

References:

- spec/04_domain_model.md
- directives/04_scheduling_rules.md
- directives/09_notification_rules.md

---

# Purpose

This document defines the authoritative lifecycle for Schedule entities.

All scheduling workflows must follow this lifecycle.

No implementation may violate these transitions.

---

# Lifecycle Overview

```text
Draft
 ↓
Under Review
 ↓
Published
 ↓
Archived
```

---

# State Definitions

## Draft

Description:

Schedule is being created and modified.

Characteristics:

```text
Editable
Assignments Allowed
Coverage Analysis Active
Not Visible To Employees
```

---

## Under Review

Description:

Schedule submitted for approval.

Characteristics:

```text
Assignments Locked
Review Active
Approval Required
```

---

## Published

Description:

Official workforce schedule.

Characteristics:

```text
Visible To Employees
Assignments Active
Read Mostly
Operational
```

---

## Archived

Description:

Historical schedule retained for reporting and audit.

Characteristics:

```text
Read Only
Historical
Not Editable
```

---

# Allowed Transitions

## Draft → Under Review

Requirements:

```text
Coverage Validation Complete
Schedule Dates Valid
Assignments Valid
```

Approval:

```text
Schedule Owner
Manager
```

---

## Under Review → Published

Requirements:

```text
Review Complete
Approval Granted
No Compliance Violations
```

Approval:

```text
Department Manager
HR Director
```

---

## Published → Archived

Requirements:

```text
Schedule End Date Reached
```

Approval:

```text
System Automated
Manager
```

---

# Revision Workflow

Published schedules may require modification.

Process:

```text
Published
 ↓
Create Revision
 ↓
Draft
 ↓
Under Review
 ↓
Published
```

Original schedule remains immutable.

---

# Forbidden Transitions

```text
Draft → Published
Draft → Archived
Archived → Draft
Archived → Published
Archived → Under Review
```

---

# Assignment Rules

## Draft

Allowed:

```text
Create Assignment
Update Assignment
Remove Assignment
```

---

## Under Review

Allowed:

```text
Review Only
```

---

## Published

Allowed:

```text
View Assignments
Create Approved Revisions
```

---

## Archived

Allowed:

```text
View Only
```

---

# Coverage Validation Rules

Required before review:

```text
Minimum Coverage Met
Certification Requirements Met
No Assignment Conflicts
```

---

# Compliance Rules

Schedule publication blocked when:

```text
Coverage Gap Exists
Certification Violation Exists
Assignment Conflict Exists
```

---

# Entry Events

Generated:

```text
Schedule Created
Schedule Submitted
Schedule Published
Schedule Archived
```

---

# Exit Events

Generated:

```text
Schedule State Changed
```

---

# Notification Requirements

Generate notifications for:

```text
Schedule Submitted
Schedule Approved
Schedule Published
Schedule Revision Requested
```

---

# Audit Requirements

Every transition generates:

```text
Audit Event
Timestamp
Actor
Reason
```

---

# Failure Rules

If validation fails:

```text
Block Transition
Generate Audit Event
Notify User
```

---

# State Integrity Rules

Schedule must exist in exactly one state.

Multiple simultaneous states prohibited.

---

# Acceptance Criteria

Lifecycle is valid when:

1. Publication workflow enforced.
2. Coverage validation enforced.
3. Assignment validation enforced.
4. Notifications generated.
5. Audit logging active.

---

# Next State Model

state/04_forecast_lifecycle.md