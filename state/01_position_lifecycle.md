# Position Lifecycle

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative Position State Model

References:

- spec/04_domain_model.md
- directives/02_position_management_rules.md

---

# Purpose

This document defines the authoritative lifecycle for Position entities.

All position workflows must follow this lifecycle.

No implementation may violate these transitions.

---

# Lifecycle Overview

```text
Draft
 ↓
Active
 ↓
Frozen
 ↓
Closed
```

---

# State Definitions

## Draft

Description:

Position created but not yet operational.

Characteristics:

```text
Editable
Not Staffed
No Vacancies
Not Visible Operationally
```

---

## Active

Description:

Position available for workforce operations.

Characteristics:

```text
Visible
Staffable
Vacancies Allowed
Employee Assignment Allowed
```

---

## Frozen

Description:

Position temporarily unavailable.

Characteristics:

```text
Read Mostly
No New Vacancies
No Staffing Changes
Operationally Suspended
```

---

## Closed

Description:

Position retired permanently.

Characteristics:

```text
Read Only
Not Reusable
No Staffing
No Vacancies
```

---

# Allowed Transitions

## Draft → Active

Requirements:

```text
Department Exists
Classification Assigned
Salary Band Assigned
```

Approval:

```text
Optional
```

---

## Active → Frozen

Requirements:

```text
Position Exists
Authorized User
```

Approval:

```text
Manager or HR Director
```

---

## Frozen → Active

Requirements:

```text
Position Valid
Position Not Closed
```

Approval:

```text
Manager or HR Director
```

---

## Active → Closed

Requirements:

```text
No Active Employees
No Active Recruitment
No Open Vacancies
```

Approval:

```text
Required
```

Approver:

```text
HR Director
```

---

## Frozen → Closed

Requirements:

```text
No Active Employees
No Active Recruitment
```

Approval:

```text
Required
```

---

# Forbidden Transitions

```text
Draft → Closed
Closed → Draft
Closed → Active
Closed → Frozen
```

---

# Entry Events

Generated:

```text
Position Created
Position Activated
Position Frozen
Position Closed
```

---

# Exit Events

Generated:

```text
Position State Changed
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

# Notification Requirements

Generate notifications for:

```text
Position Activated
Position Frozen
Position Closed
```

---

# Failure Rules

If transition validation fails:

```text
Block Transition
Generate Audit Event
Notify User
```

---

# State Integrity Rules

Position must exist in exactly one state.

Multiple simultaneous states prohibited.

---

# Acceptance Criteria

Lifecycle is valid when:

1. State transitions enforced.
2. Forbidden transitions blocked.
3. Audit events generated.
4. Notifications generated.
5. Approval rules enforced.

---

# Next State Model

state/02_employee_lifecycle.md