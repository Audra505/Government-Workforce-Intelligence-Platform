# Employee Lifecycle

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative Employee State Model

References:

- spec/04_domain_model.md
- directives/02_position_management_rules.md
- directives/10_role_based_access_rules.md
- directives/11_government_policy_rules.md

---

# Purpose

This document defines the authoritative lifecycle for Employee entities.

All employee workflows must follow this lifecycle.

No implementation may violate these transitions.

---

# Lifecycle Overview

```text
Candidate
 ↓
Pending Onboarding
 ↓
Active
 ↓
On Leave
 ↓
Active
 ↓
Suspended
 ↓
Active
 ↓
Separated
```

---

# State Definitions

## Candidate

Description:

Individual is participating in recruiting processes.

Characteristics:

```text
Not Employee
No System Access
No Workforce Assignment
```

---

## Pending Onboarding

Description:

Candidate accepted and awaiting onboarding.

Characteristics:

```text
Employee Record Created
No Active Workforce Assignment
Limited Access
```

---

## Active

Description:

Employee actively participating in workforce operations.

Characteristics:

```text
Position Assigned
System Access Allowed
Scheduling Allowed
Reporting Included
```

---

## On Leave

Description:

Employee temporarily unavailable.

Characteristics:

```text
Position Retained
Scheduling Restricted
Reporting Included
```

---

## Suspended

Description:

Employee temporarily restricted from workforce participation.

Characteristics:

```text
Access Restricted
Scheduling Blocked
Operational Restrictions
```

---

## Separated

Description:

Employment relationship ended.

Characteristics:

```text
Read Only
No Access
No Assignment
Historical Reporting Only
```

---

# Allowed Transitions

## Candidate → Pending Onboarding

Requirements:

```text
Offer Accepted
Hiring Approved
```

Approval:

```text
Recruiter
HR Director
```

---

## Pending Onboarding → Active

Requirements:

```text
Employee Record Complete
Position Assigned
Required Documentation Complete
```

Approval:

```text
HR Administration
```

---

## Active → On Leave

Requirements:

```text
Approved Leave Request
```

Approval:

```text
Manager
HR Director
```

---

## On Leave → Active

Requirements:

```text
Leave Completed
```

Approval:

```text
Manager
```

---

## Active → Suspended

Requirements:

```text
Authorized Workforce Action
```

Approval:

```text
HR Director
```

---

## Suspended → Active

Requirements:

```text
Suspension Cleared
```

Approval:

```text
HR Director
```

---

## Active → Separated

Requirements:

```text
Termination
Retirement
Resignation
Transfer Out
```

Approval:

```text
HR Director
```

---

# Forbidden Transitions

```text
Candidate → Active
Candidate → Separated
Separated → Active
Separated → On Leave
Separated → Suspended
```

---

# Position Rules

## Active Employees

Must have:

```text
Department
Position
Tenant
```

---

## Separated Employees

Must not have:

```text
System Access
Schedule Assignments
Pending Workforce Actions
```

---

# Access Rules

## Active

Access:

```text
Allowed
```

---

## On Leave

Access:

```text
Configurable
```

---

## Suspended

Access:

```text
Restricted
```

---

## Separated

Access:

```text
Revoked
```

---

# Entry Events

Generated:

```text
Employee Created
Employee Activated
Employee Leave Started
Employee Suspended
Employee Separated
```

---

# Exit Events

Generated:

```text
Employee State Changed
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
Onboarding Started
Leave Approved
Suspension Applied
Separation Processed
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

Employee must exist in exactly one state.

Multiple simultaneous states prohibited.

---

# Acceptance Criteria

Lifecycle is valid when:

1. State transitions enforced.
2. Access rules enforced.
3. Position rules enforced.
4. Audit logging active.
5. Notifications active.

---

# Next State Model

state/03_schedule_lifecycle.md