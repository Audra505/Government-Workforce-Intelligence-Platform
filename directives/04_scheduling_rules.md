# Scheduling Rules

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative Scheduling Directive

References:

- spec/01_requirements.md
- spec/04_domain_model.md
- spec/05_database_schema.md
- spec/06_api_contracts.md
- spec/11_ai_architecture.md

---

# Purpose

This directive defines the business rules governing workforce scheduling.

These rules control:

- Schedule creation
- Shift management
- Assignment management
- Coverage validation
- Schedule publication
- Schedule compliance

These rules are mandatory for all implementations.

---

# Scheduling Principles

## SCH-001

Schedules must support operational workforce needs.

---

## SCH-002

Every assignment must be auditable.

---

## SCH-003

Schedules are tenant isolated.

---

## SCH-004

Published schedules are controlled documents.

---

## SCH-005

AI recommendations are advisory only.

---

# Schedule Lifecycle

States:

```text
Draft
Under Review
Published
Archived
```

---

## Draft

Schedule being prepared.

Assignments may be modified.

---

## Under Review

Schedule awaiting approval.

Assignments locked.

---

## Published

Official workforce schedule.

Visible to assigned employees.

---

## Archived

Historical schedule.

Read-only.

---

# Schedule Creation Rules

## SCH-100

Required fields:

```text
Schedule Name
Department
Start Date
End Date
```

---

## SCH-101

Department must exist.

---

## SCH-102

Start date must be before end date.

---

## SCH-103

Schedule period may not exceed:

```text
90 Days
```

---

# Shift Rules

## SCH-200

Every shift must belong to a schedule.

---

## SCH-201

Required fields:

```text
Shift Name
Start Time
End Time
```

---

## SCH-202

Shift duration must be greater than:

```text
0 Hours
```

---

## SCH-203

Shift duration may not exceed:

```text
24 Hours
```

---

# Assignment Rules

## SCH-300

Assignments connect:

```text
Employee
Shift
Schedule
```

---

## SCH-301

Employee must be active.

---

## SCH-302

Employee must belong to same tenant.

---

## SCH-303

Employee certifications must satisfy shift requirements.

---

## SCH-304

Employees may not be assigned to overlapping shifts.

---

## SCH-305

Assignments must validate availability.

---

# Coverage Rules

## SCH-400

Every shift may define:

```text
Minimum Coverage
Target Coverage
Maximum Coverage
```

---

## SCH-401

Coverage gaps must be identified.

---

## SCH-402

Coverage gaps must appear on dashboards.

---

## SCH-403

Coverage gaps generate staffing alerts.

---

# AI Scheduling Rules

Requirements:

- spec/11_ai_architecture.md

---

## SCH-500

AI may recommend:

```text
Assignments
Coverage Improvements
Shift Rebalancing
Schedule Optimization
```

---

## SCH-501

AI recommendations require human approval.

---

## SCH-502

AI may not publish schedules.

---

## SCH-503

AI may not assign employees automatically.

---

# Approval Workflow

## SCH-600

Draft schedules may be submitted for review.

---

## SCH-601

Managers may approve schedules.

---

## SCH-602

Approved schedules transition to:

```text
Published
```

---

## SCH-603

Published schedules require revision workflow for changes.

---

# Schedule Publication Rules

## SCH-700

Published schedules become read-only.

---

## SCH-701

Publication generates audit event.

---

## SCH-702

Affected employees receive notifications.

---

# Compliance Rules

## SCH-800

Assignments must comply with:

```text
Certification Requirements
Workforce Policies
Agency Rules
```

---

## SCH-801

Compliance violations block publication.

---

# Reporting Rules

Schedules must support reporting on:

```text
Coverage Rates
Coverage Gaps
Shift Utilization
Employee Utilization
Overtime Exposure
```

---

# Audit Rules

Required audit events:

```text
Schedule Created
Schedule Updated
Schedule Submitted
Schedule Approved
Schedule Published
Schedule Archived
Assignment Created
Assignment Removed
```

---

# Security Rules

Required:

```text
Authentication
Authorization
Tenant Validation
```

---

# Performance Rules

Schedule creation:

```text
< 2 Seconds
```

---

Schedule publication:

```text
< 10 Seconds
```

---

# Failure Rules

If publication fails:

```text
Rollback Changes
Log Failure
Generate Audit Event
Notify User
```

---

# Acceptance Criteria

Directive satisfied when:

1. Schedule lifecycle enforced.
2. Coverage validation enforced.
3. Assignment validation enforced.
4. AI recommendations controlled.
5. Compliance checks enforced.
6. Audit logging active.
7. Reporting supported.

---

# Next Directive

Next file:

directives/05_skill_matching_rules.md