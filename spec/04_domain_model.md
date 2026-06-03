# Domain Model Specification

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative Domain Model Specification

References:

- meta/00_project_classification.md
- meta/01_assumptions_and_decisions.md
- meta/02_glossary.md
- meta/03_traceability_matrix.md
- spec/01_requirements.md
- spec/02_non_functional_requirements.md
- spec/03_system_architecture.md

---

# Purpose

This document defines the core business entities, aggregate roots, relationships, ownership boundaries, and lifecycle rules for the platform.

This is the authoritative business model for:

- Database design
- API design
- Service boundaries
- Validation rules
- Workflow implementation

---

# Domain Overview

The platform consists of eight bounded contexts:

```text
Identity & Access
Organization Management
Workforce Planning
Scheduling
Talent Acquisition
Workforce Intelligence
Compliance & Governance
Integration Hub
```

Each bounded context owns its data.

Cross-domain communication occurs through APIs or events.

---

# Identity & Access Domain

Domain ID: D-001

Aggregate Root:

```text
User
```

---

## User

Description:

Represents an authenticated platform user.

Attributes:

```text
id
tenant_id
email
password_hash
first_name
last_name
status
last_login_at
created_at
updated_at
```

Relationships:

```text
User
 ├── Roles
 ├── Sessions
 └── Audit Events
```

Lifecycle:

```text
Invited
 → Active
 → Suspended
 → Deactivated
```

---

## Role

Description:

Defines permission groups.

Attributes:

```text
id
name
description
created_at
```

Examples:

```text
HR Director
Recruiter
Hiring Manager
Compliance Officer
Administrator
```

---

## Permission

Description:

Represents an authorized action.

Examples:

```text
position.create
position.update
candidate.view
candidate.edit
audit.export
```

---

# Organization Domain

Domain ID: D-002

Aggregate Root:

```text
Agency
```

---

## Agency

Description:

Represents a customer tenant.

Attributes:

```text
id
name
status
tenant_code
created_at
```

Relationships:

```text
Agency
 ├── Departments
 ├── Users
 ├── Positions
 └── Candidates
```

---

## Department

Description:

Organizational subdivision.

Attributes:

```text
id
agency_id
name
description
status
```

Relationships:

```text
Department
 ├── Positions
 ├── Employees
 └── Schedules
```

---

# Workforce Planning Domain

Domain ID: D-003

Aggregate Roots:

```text
Position
Employee
```

---

## Position

Description:

Approved workforce role.

Attributes:

```text
id
tenant_id
department_id
title
classification
salary_band
status
created_at
```

Relationships:

```text
Position
 ├── Skills
 ├── Certifications
 ├── Vacancies
 └── Candidates
```

Lifecycle:

```text
Draft
 → Approved
 → Published
 → Filled
 → Closed
```

---

## Vacancy

Description:

Open staffing need.

Attributes:

```text
id
position_id
priority
reason
status
expected_fill_date
created_at
```

Relationships:

```text
Vacancy
 ├── Candidates
 ├── Forecasts
 └── Hiring Workflows
```

Lifecycle:

```text
Open
 → In Progress
 → Offer Pending
 → Filled
 → Cancelled
```

---

## Skill

Description:

Capability requirement or capability possessed.

Attributes:

```text
id
name
category
description
```

---

## Certification

Description:

Formal qualification.

Attributes:

```text
id
name
issuer
expiration_required
```

---

## Employee

Description:

Represents an active workforce member.

Attributes:

```text
id
tenant_id
department_id
employee_number
first_name
last_name
email
employment_status
hire_date
termination_date
created_at
updated_at
```

Relationships:

```text
Employee
 ├── Skills
 ├── Certifications
 ├── Assignments
 ├── Attrition Predictions
 └── Department
```

Lifecycle:

```text
Hired
 → Active
 → Leave
 → Terminated
```

---

## Employee Skill

Description:

Associates employees with skills.

Attributes:

```text
employee_id
skill_id
proficiency_level
verified_at
```

---

## Employee Certification

Description:

Associates employees with certifications.

Attributes:

```text
employee_id
certification_id
issue_date
expiration_date
status
```

---

# Scheduling Domain

Domain ID: D-004

Aggregate Root:

```text
Schedule
```

---

## Schedule

Description:

Planning period containing assignments.

Attributes:

```text
id
department_id
start_date
end_date
status
created_at
```

Relationships:

```text
Schedule
 ├── Shifts
 ├── Assignments
 └── Coverage Reports
```

Lifecycle:

```text
Draft
 → Review
 → Published
 → Archived
```

---

## Shift

Description:

Work period.

Attributes:

```text
id
schedule_id
start_time
end_time
required_headcount
```

---

## Assignment

Description:

Employee assignment to shift.

Attributes:

```text
id
shift_id
employee_id
status
assigned_at
```

Lifecycle:

```text
Proposed
 → Assigned
 → Confirmed
 → Completed
```

---

# Talent Acquisition Domain

Domain ID: D-005

Aggregate Root:

```text
Candidate
```

---

## Candidate

Description:

Potential employee.

Attributes:

```text
id
tenant_id
first_name
last_name
email
phone
status
created_at
```

Relationships:

```text
Candidate
 ├── Applications
 ├── Resumes
 ├── Certifications
 ├── Match Scores
 └── Interviews
```

Lifecycle:

```text
Created
 → Applied
 → Screening
 → Interview
 → Offer
 → Hired
```

---

## Resume

Description:

Uploaded candidate resume.

Attributes:

```text
id
candidate_id
file_path
parsed_status
uploaded_at
```

Lifecycle:

```text
Uploaded
 → Parsed
 → Validated
```

---

## Application

Description:

Candidate application to vacancy.

Attributes:

```text
id
candidate_id
vacancy_id
status
applied_at
```

Lifecycle:

```text
Applied
 → Screening
 → Interview
 → Evaluation
 → Offer
 → Hired
 → Rejected
```

---

## Interview

Description:

Candidate interview event.

Attributes:

```text
id
application_id
scheduled_at
interviewer
status
feedback
```

Lifecycle:

```text
Scheduled
 → Completed
 → Cancelled
```

---

# Workforce Intelligence Domain

Domain ID: D-006

Aggregate Root:

```text
Forecast
```

---

## Forecast

Description:

Predicted future staffing demand.

Attributes:

```text
id
tenant_id
forecast_type
forecast_period
confidence_score
generated_at
```

Relationships:

```text
Forecast
 ├── Positions
 ├── Vacancies
 └── Recommendations
```

---

## Vacancy Risk

Description:

Predicted vacancy severity.

Attributes:

```text
id
vacancy_id
risk_score
risk_level
generated_at
```

Risk Levels:

```text
Low
Medium
High
Critical
```

---

## Attrition Prediction

Description:

Predicted employee departure probability.

Attributes:

```text
id
employee_id
risk_score
risk_level
generated_at
```

---

## Recommendation

Description:

AI-generated recommendation.

Attributes:

```text
id
forecast_id
recommendation_type
summary
explanation
created_at
```

Lifecycle:

```text
Generated
 → Reviewed
 → Accepted
 → Rejected
```

---

# Compliance Domain

Domain ID: D-007

Aggregate Root:

```text
Audit Event
```

---

## Audit Event

Description:

Immutable record of critical activity.

Attributes:

```text
id
tenant_id
user_id
entity_type
entity_id
action
metadata
timestamp
```

Requirements:

```text
Immutable
Searchable
Exportable
```

---

## Compliance Report

Description:

Generated compliance evidence.

Attributes:

```text
id
tenant_id
report_type
generated_by
generated_at
```

---

## Policy

Description:

Business governance rule.

Attributes:

```text
id
name
description
status
```

Lifecycle:

```text
Draft
 → Active
 → Retired
```

---

# Integration Domain

Domain ID: D-008

Aggregate Root:

```text
Integration
```

---

## Integration

Description:

External system connection.

Attributes:

```text
id
name
type
status
configuration
```

Examples:

```text
Workday
ADP
Microsoft Entra ID
```

Lifecycle:

```text
Configured
 → Connected
 → Active
 → Suspended
```

---

# Shared Value Objects

## Address

```text
street
city
state
postal_code
country
```

---

## Money

```text
amount
currency
```

---

## Date Range

```text
start_date
end_date
```

---

## Match Score

```text
score
confidence
explanation
```

---

# Entity Ownership Matrix

| Entity | Owner Domain |
|----------|-------------|
| User | Identity |
| Role | Identity |
| Agency | Organization |
| Department | Organization |
| Position | Workforce |
| Vacancy | Workforce |
| Schedule | Scheduling |
| Shift | Scheduling |
| Assignment | Scheduling |
| Candidate | Recruiting |
| Application | Recruiting |
| Resume | Recruiting |
| Forecast | Intelligence |
| Recommendation | Intelligence |
| Audit Event | Compliance |
| Policy | Compliance |
| Integration | Integration |
| Employee | Workforce |
| Employee Skill | Workforce |
| Employee Certification | Workforce |

---

# Cross-Domain Rules

The following are prohibited:

- Direct database access between domains
- Shared aggregate ownership
- Cross-domain table modification

Required:

- Events
- APIs
- Explicit service contracts

---

# Tenant Ownership Rule

All tenant-owned entities must contain:

```text
tenant_id
```

Mandatory entities:

```text
User
Department
Position
Vacancy
Schedule
Candidate
Forecast
Audit Event
```

---

# Domain Integrity Rules

Every aggregate root must:

- Own lifecycle
- Enforce validation
- Maintain consistency
- Generate audit events

No aggregate may bypass domain rules.

---

# Next Blueprint Dependency

Next file:

spec/05_database_schema.md

This document will transform the domain model into:

- PostgreSQL schemas
- Tables
- Columns
- Indexes
- Constraints
- Foreign keys
- Tenant partitioning strategy
- Audit strategy