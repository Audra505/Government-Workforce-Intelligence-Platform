# Scheduling Tests

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative Scheduling Validation Test Specification

References:

- directives/04_scheduling_rules.md
- directives/09_notification_rules.md
- directives/10_role_based_access_rules.md
- state/03_schedule_lifecycle.md

---

# Purpose

This document defines all validation requirements for workforce scheduling.

The objective is to ensure schedules are:

- Accurate
- Conflict Free
- Compliant
- Auditable
- Operationally Effective

---

# Testing Principles

Scheduling validation must verify:

```text
Assignment Integrity
Coverage Integrity
Conflict Detection
Publication Governance
Notification Delivery
```

---

# Schedule Creation Tests

## ST-001

Schedule Creation

Given:

```text
Authorized Scheduler
```

When:

```text
Schedule Created
```

Then:

```text
State = Draft
Audit Event Generated
```

---

## ST-002

Schedule Metadata

Schedule must contain:

```text
Department
Date Range
Status
Created By
```

---

# Assignment Tests

## ST-010

Employee Assignment

Given:

```text
Qualified Employee
```

When:

```text
Assignment Created
```

Then:

```text
Assignment Saved
Coverage Updated
```

---

## ST-011

Assignment Qualification Validation

Given:

```text
Employee Missing Certification
```

When:

```text
Assignment Attempted
```

Then:

```text
Assignment Blocked
```

---

## ST-012

Inactive Employee Assignment

Given:

```text
Employee Not Active
```

When:

```text
Assignment Attempted
```

Then:

```text
Assignment Blocked
```

---

# Conflict Detection Tests

## ST-020

Overlapping Assignments

Given:

```text
Existing Assignment
```

When:

```text
Conflicting Assignment Created
```

Then:

```text
Conflict Detected
Assignment Blocked
```

---

## ST-021

Double Booking Detection

Given:

```text
Employee Scheduled Elsewhere
```

When:

```text
Second Assignment Created
```

Then:

```text
Validation Failure
```

---

## ST-022

Coverage Gap Detection

Given:

```text
Required Position Unfilled
```

When:

```text
Coverage Analysis Executed
```

Then:

```text
Coverage Gap Identified
```

---

# Coverage Tests

## ST-030

Minimum Coverage Validation

Given:

```text
Schedule Under Review
```

When:

```text
Coverage Validation Executed
```

Then:

```text
Minimum Coverage Requirements Met
```

---

## ST-031

Coverage Failure

Given:

```text
Coverage Below Threshold
```

When:

```text
Publication Requested
```

Then:

```text
Publication Blocked
```

---

# Lifecycle Tests

## ST-040

Draft Submission

Given:

```text
Valid Draft Schedule
```

When:

```text
Submit For Review
```

Then:

```text
State = Under Review
```

---

## ST-041

Schedule Publication

Given:

```text
Approved Schedule
```

When:

```text
Publish Schedule
```

Then:

```text
State = Published
```

---

## ST-042

Schedule Archival

Given:

```text
Published Schedule
```

When:

```text
End Date Reached
```

Then:

```text
State = Archived
```

---

# Revision Tests

## ST-050

Schedule Revision

Given:

```text
Published Schedule
```

When:

```text
Revision Requested
```

Then:

```text
New Draft Revision Created
```

---

## ST-051

Published Schedule Protection

Given:

```text
Published Schedule
```

When:

```text
Direct Modification Attempted
```

Then:

```text
Modification Blocked
```

---

# Notification Tests

## ST-060

Publication Notification

Given:

```text
Schedule Published
```

When:

```text
Employees Impacted
```

Then:

```text
Notifications Sent
```

---

## ST-061

Revision Notification

Given:

```text
Schedule Revision Published
```

Then:

```text
Affected Employees Notified
```

---

# Audit Tests

## ST-070

Audit Trail Generation

Required Events:

```text
Schedule Created
Schedule Submitted
Schedule Approved
Schedule Published
Schedule Archived
```

---

## ST-071

Audit Completeness

Each event must contain:

```text
Timestamp
Actor
Schedule ID
Action
```

---

# RBAC Tests

## ST-080

Unauthorized Schedule Creation

Given:

```text
Unauthorized User
```

When:

```text
Schedule Created
```

Then:

```text
Access Denied
```

---

## ST-081

Unauthorized Publication

Given:

```text
Insufficient Permissions
```

When:

```text
Publish Requested
```

Then:

```text
Access Denied
```

---

# Tenant Isolation Tests

## ST-090

Cross-Tenant Access

Given:

```text
Tenant A User
```

When:

```text
Tenant B Schedule Accessed
```

Then:

```text
Access Denied
```

---

# Performance Tests

## ST-100

Schedule Load

Target:

```text
< 2 Seconds
```

---

## ST-101

Coverage Validation

Target:

```text
< 5 Seconds
```

---

## ST-102

Schedule Publication

Target:

```text
< 10 Seconds
```

---

# Exit Criteria

Scheduling validation passes when:

1. Assignment validation passes.
2. Conflict detection passes.
3. Coverage validation passes.
4. Lifecycle validation passes.
5. Notifications validated.
6. Audit validation passes.
7. Security validation passes.

---

# Next Test Specification

tests/04_security_tests.md