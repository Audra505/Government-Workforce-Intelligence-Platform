# Vacancy Management Rules

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative Vacancy Management Directive

References:

- spec/01_requirements.md
- spec/04_domain_model.md
- spec/05_database_schema.md
- spec/06_api_contracts.md
- directives/02_position_management_rules.md

---

# Governance Decisions Incorporated

This directive incorporates the following approved governance decisions:

- GD-PRE-M13-001: VAC-401 Hiring Workflow — Dual-Path Authority Classification and Appointment Authority Design (2026-06-19)
  — Classifies the competitive hire path (VAC-401) as the standard path for career civil service positions.
  — Implementation deferred to Phase 3 Talent Acquisition.
  — See governance/GD-PRE-M13-001.md for full decision text.

---

# Purpose

This directive defines the business rules governing vacancy management.

These rules control:

- Vacancy creation
- Vacancy lifecycle
- Vacancy prioritization
- Vacancy closure
- Vacancy fulfillment
- Vacancy reporting

These rules are mandatory for all implementations.

---

# Vacancy Principles

## VAC-001

Every vacancy must belong to exactly one position.

---

## VAC-002

Every vacancy must belong to exactly one tenant.

---

## VAC-003

Vacancies represent authorized staffing demand.

---

## VAC-004

Vacancies must be auditable.

---

# Vacancy Lifecycle

States:

```text
Draft
Open
In Recruitment
Filled
Cancelled
Closed
```

---

## Draft

Vacancy created.

Not visible to recruiters.

---

## Open

Vacancy approved.

Available for recruitment.

---

## In Recruitment

At least one active application exists.

---

## Filled

Candidate hired.

Position staffed.

---

## Cancelled

Vacancy withdrawn.

No further recruitment allowed.

---

## Closed

Vacancy completed.

Read-only state.

---

# Vacancy Creation Rules

## VAC-100

Required fields:

```text
Position
Priority
Reason
Expected Fill Date
```

---

## VAC-101

Position must exist.

---

## VAC-102

Position must be:

```text
Active
```

---

## VAC-103

Frozen positions may not create vacancies.

---

## VAC-104

Closed positions may not create vacancies.

---

# Vacancy Reasons

Supported:

```text
New Position
Retirement
Resignation
Transfer
Termination
Expansion
Temporary Coverage
```

---

# Vacancy Priority Rules

## VAC-200

Priority values:

```text
Low
Medium
High
Critical
```

---

## VAC-201

Critical vacancies require review within:

```text
24 Hours
```

---

## VAC-202

High priority vacancies require review within:

```text
3 Business Days
```

---

# Recruitment Rules

## VAC-300

Recruitment may begin only when vacancy state is:

```text
Open
```

---

## VAC-301

First application received transitions state to:

```text
In Recruitment
```

---

## VAC-302

Cancelled vacancies may not receive applications.

---

## VAC-303

Closed vacancies may not receive applications.

---

# Hiring Rules

## VAC-400

A vacancy may only be filled by:

```text
Approved Hire
```

---

## VAC-401

Hiring a candidate automatically:

```text
Creates Employee Record
Closes Applications
Updates Vacancy Status
```

---

## VAC-402

Filled vacancies transition to:

```text
Filled
```

---

# Closure Rules

## VAC-500

Vacancies may close when:

```text
Position Removed
Recruitment Cancelled
Candidate Hired
```

---

## VAC-501

Closed vacancies become read-only.

---

## VAC-502

Closure must generate audit event.

---

# Approval Rules

## VAC-600

Vacancy creation approval:

```text
Optional
```

---

## VAC-601

Critical vacancies require:

```text
HR Director Review
```

---

## VAC-602

Vacancy cancellation requires:

```text
Manager Approval
```

---

# Vacancy Aging Rules

## VAC-700

Monitor vacancy age.

---

## VAC-701

Warning threshold:

```text
30 Days
```

---

## VAC-702

High Risk threshold:

```text
90 Days
```

---

## VAC-703

Aged vacancies must appear in:

```text
Vacancy Risk Reports
Executive Dashboards
```

---

# AI Rules

Requirements:

- spec/11_ai_architecture.md

---

## VAC-800

Vacancies may receive:

```text
Risk Score
Fill Probability
Recruitment Recommendation
```

---

## VAC-801

AI recommendations are advisory only.

---

## VAC-802

AI may not automatically modify vacancy records.

---

# Reporting Rules

Vacancies must support reporting on:

```text
Open Vacancies
Filled Vacancies
Time To Fill
Priority Distribution
Department Distribution
Vacancy Aging
```

---

# Audit Rules

Required audit events:

```text
Vacancy Created
Vacancy Updated
Vacancy Opened
Vacancy Cancelled
Vacancy Filled
Vacancy Closed
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

Vacancy creation:

```text
< 2 Seconds
```

---

Vacancy search:

```text
< 2 Seconds
```

---

# Failure Rules

If vacancy creation fails:

```text
Rollback Transaction
Log Failure
Generate Audit Event
```

---

# Acceptance Criteria

Directive satisfied when:

1. Vacancy lifecycle enforced.
2. Position validation enforced.
3. Priority rules enforced.
4. Hiring workflow integrated.
5. Audit logging active.
6. Reporting supported.
7. AI recommendations controlled.

---

# Next Directive

Next file:

directives/04_scheduling_rules.md