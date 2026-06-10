# Position Management Rules

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative Position Management Directive

References:

- spec/01_requirements.md
- spec/04_domain_model.md
- spec/05_database_schema.md
- spec/06_api_contracts.md
- spec/10_backend_architecture.md

---

# Purpose

This directive defines the business rules governing position management.

These rules control:

- Position creation
- Position updates
- Position lifecycle
- Position classification
- Position closure
- Position auditability

These rules are mandatory for all implementations.

---

# Position Principles

## POS-001

Every position belongs to exactly one department.

---

## POS-002

Every position belongs to exactly one tenant.

---

## POS-003

Positions are workforce planning assets.

They may exist without an employee.

---

## POS-004

Position changes must be auditable.

---

# Position Lifecycle

States:

```text
Draft
Active
Frozen
Closed
```

---

## Draft

Position created.

Not yet available for staffing.

---

## Active

Position available for staffing.

May have vacancies.

May have employees assigned.

---

## Frozen

Position temporarily unavailable.

No new vacancies may be created.

No staffing changes permitted.

---

## Closed

Position retired.

May not be reused.

---

# Position Creation Rules

## POS-100

Required fields:

```text
Title
Department
Classification
Salary Band
```

---

## POS-101

Position title required.

Maximum:

```text
200 Characters
```

---

## POS-102

Department must exist.

---

## POS-103

Classification required.

---

## POS-104

Salary band required.

---

# Position Modification Rules

## POS-200

Editable fields:

```text
Title
Description
Classification
Salary Band
```

---

## POS-201

Department changes require approval.

---

## POS-202

Closed positions may not be edited.

---

# Vacancy Relationship Rules

## POS-300

Vacancies may only exist for:

```text
Active Positions
```

---

## POS-301

Closed positions automatically close open vacancies.

---

## POS-302

Frozen positions may not create new vacancies.

---

# Employee Relationship Rules

## POS-400

Employees may be assigned only to:

```text
Active Positions
```

---

## POS-401

Closed positions may not receive employees.

---

## POS-402

Position closure requires employee reassignment validation.

---

# Position Closure Rules

## POS-500

Position closure requires:

```text
No Active Employees
No Active Recruitment
```

---

## POS-501

Closure must create audit event.

---

## POS-502

Closed positions become read-only.

---

# Approval Rules

## POS-600

Position creation approval:

```text
Optional
```

---

## POS-601

Position closure approval:

```text
Required
```

Approver:

```text
HR Director
Administrator
```

---

# Audit Rules

Required audit events:

```text
Position Created
Position Updated
Position Activated
Position Frozen
Position Closed
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

# Authorization Rules

## POS-AUTH-001

Position creation restricted to:

```text
System Administrator
HR Director
```

Endpoint: POST /api/v1/positions

---

## POS-AUTH-002

Position list access restricted to:

```text
System Administrator
HR Director
Workforce Planner
```

Endpoint: GET /api/v1/positions

---

## POS-AUTH-003

Position detail access restricted to:

```text
System Administrator
HR Director
Workforce Planner
```

Endpoint: GET /api/v1/positions/:id

---

## POS-AUTH-004

Position update restricted to:

```text
System Administrator
HR Director
```

Endpoint: PUT /api/v1/positions/:id

---

## POS-AUTH-005

Position closure restricted to:

```text
System Administrator
HR Director
```

Endpoint: POST /api/v1/positions/:id/close

Rationale: Closure is irreversible. HR Director and Administrator authority required (POS-601).

---

# Reporting Rules

Position metrics must support:

```text
Open Positions
Filled Positions
Vacant Positions
Closed Positions
```

---

# Performance Rules

Position creation:

```text
< 2 Seconds
```

Position search:

```text
< 2 Seconds
```

---

# Failure Rules

If creation fails:

```text
Rollback Transaction
Log Failure
Generate Audit Event
```

---

# Acceptance Criteria

Directive satisfied when:

1. Lifecycle enforced.
2. Department ownership enforced.
3. Tenant ownership enforced.
4. Closure validation enforced.
5. Audit logging active.
6. Reporting supported.

---

# Next Directive

Next file:

directives/03_vacancy_management_rules.md