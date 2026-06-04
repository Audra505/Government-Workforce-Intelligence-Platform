# Approval Workflow States

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative Approval Workflow State Model

References:

- directives/01_workforce_forecasting_rules.md
- directives/02_position_management_rules.md
- directives/07_compliance_rules.md
- directives/10_role_based_access_rules.md
- directives/11_government_policy_rules.md

---

# Purpose

This document defines the authoritative approval workflow used across the platform.

This workflow governs:

- Forecast approvals
- Position closure approvals
- Compliance exceptions
- Policy approvals
- Schedule approvals
- Future approval workflows

No implementation may violate these transitions.

---

# Workflow Overview

```text
Draft
 ↓
Pending Review
 ↓
Pending Approval
 ↓
Approved
```

Alternative outcomes:

```text
Pending Review
 ↓
Rejected
```

```text
Pending Approval
 ↓
Rejected
```

```text
Pending Review
 ↓
Revision Requested
```

```text
Pending Approval
 ↓
Revision Requested
```

---

# State Definitions

## Draft

Description:

Request created.

Characteristics:

```text
Editable
Not Submitted
Owner Controlled
```

---

## Pending Review

Description:

Initial review in progress.

Characteristics:

```text
Review Active
Comments Allowed
Awaiting Recommendation
```

---

## Pending Approval

Description:

Formal approval required.

Characteristics:

```text
Read Only
Awaiting Decision
```

---

## Approved

Description:

Request approved.

Characteristics:

```text
Finalized
Executable
Auditable
```

---

## Rejected

Description:

Request denied.

Characteristics:

```text
Closed
Historical
Read Only
```

---

## Revision Requested

Description:

Changes required before approval.

Characteristics:

```text
Returned To Owner
Editable
Requires Resubmission
```

---

# Allowed Transitions

## Draft → Pending Review

Requirements:

```text
Required Fields Complete
Validation Successful
```

Approval:

```text
Request Owner
```

---

## Pending Review → Pending Approval

Requirements:

```text
Review Completed
Recommendation Recorded
```

Approval:

```text
Reviewer
```

---

## Pending Approval → Approved

Requirements:

```text
Approval Granted
Policy Validation Passed
```

Approval:

```text
Authorized Approver
```

---

## Pending Review → Rejected

Requirements:

```text
Review Decision Recorded
```

---

## Pending Approval → Rejected

Requirements:

```text
Approval Denied
```

---

## Pending Review → Revision Requested

Requirements:

```text
Changes Required
```

---

## Pending Approval → Revision Requested

Requirements:

```text
Changes Required
```

---

## Revision Requested → Draft

Requirements:

```text
Owner Resubmission
```

---

# Forbidden Transitions

```text
Draft → Approved
Draft → Rejected
Approved → Draft
Approved → Pending Approval
Rejected → Approved
Rejected → Draft
```

---

# Approval Authority Rules

Approver determined by workflow type.

Examples:

Forecast:

```text
HR Director
```

---

Position Closure:

```text
HR Director
```

---

Compliance Exception:

```text
Compliance Officer
HR Director
```

---

Policy Change:

```text
Administrator
Compliance Officer
```

---

# Separation Of Duties

Reviewer and approver should be different users whenever possible.

---

# Multi-Level Approval Support

Supported:

```text
Single Approval
Multi-Step Approval
Parallel Approval
```

---

# Entry Events

Generated:

```text
Request Submitted
Review Started
Approval Requested
Request Approved
Request Rejected
Revision Requested
```

---

# Exit Events

Generated:

```text
Approval State Changed
```

---

# Notification Requirements

Generate notifications for:

```text
Review Assigned
Approval Requested
Request Approved
Request Rejected
Revision Requested
```

---

# Audit Requirements

Every transition generates:

```text
Audit Event
Timestamp
Actor
Decision
Reason
```

---

# Failure Rules

If workflow validation fails:

```text
Block Transition
Generate Audit Event
Notify User
```

---

# State Integrity Rules

Workflow instance must exist in exactly one state.

Multiple simultaneous states prohibited.

---

# Acceptance Criteria

Workflow is valid when:

1. Approval authority enforced.
2. Separation of duties supported.
3. Notifications generated.
4. Audit logging active.
5. Forbidden transitions blocked.

---

# Next State Model

state/06_compliance_review_states.md