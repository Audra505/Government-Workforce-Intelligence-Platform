# API Contracts Specification

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative API Contract Specification

References:

- meta/00_project_classification.md
- meta/01_assumptions_and_decisions.md
- meta/02_glossary.md
- meta/03_traceability_matrix.md
- spec/01_requirements.md
- spec/02_non_functional_requirements.md
- spec/03_system_architecture.md
- spec/04_domain_model.md
- spec/05_database_schema.md

---

# Purpose

This document defines the authoritative REST API contracts for the platform.

It establishes:

- API versioning
- Endpoint standards
- Request contracts
- Response contracts
- Error contracts
- Authentication requirements
- Authorization requirements
- Tenant enforcement rules

This document serves as the source of truth for:

- NestJS Controllers
- DTOs
- OpenAPI/Swagger Documentation
- Integration Development

---

# API Standards

---

## Base URL

```text
/api/v1
```

---

## Content Type

Request:

```http
Content-Type: application/json
```

Response:

```http
Content-Type: application/json
```

---

## Authentication

Required unless explicitly documented.

Method:

```http
Authorization: Bearer <jwt_token>
```

---

## Tenant Enforcement

Every authenticated request must resolve:

```text
tenant_id
user_id
role
```

from JWT claims.

Clients may never specify tenant_id manually.

---

# Standard Response Format

Successful Response

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

---

# Standard Error Format

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": []
  }
}
```

---

# Error Codes

```text
VALIDATION_ERROR
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
CONFLICT
TENANT_VIOLATION
POLICY_VIOLATION
RATE_LIMITED
INTERNAL_ERROR
```

---

# Authentication API

Domain:

D-001

Requirements:

FR-001
FR-002
FR-003

---

## Login

```http
POST /api/v1/auth/login
```

Request

```json
{
  "email": "user@example.gov",
  "password": "********"
}
```

Response

```json
{
  "success": true,
  "data": {
    "accessToken": "jwt",
    "expiresIn": 3600
  }
}
```

---

## Logout

```http
POST /api/v1/auth/logout
```

Authorization:

Required

Response

```json
{
  "success": true
}
```

---

## Current User

```http
GET /api/v1/auth/me
```

Response

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.gov",
    "roles": []
  }
}
```

---

# User API

Domain:

D-001

---

## List Users

```http
GET /api/v1/users
```

Roles:

```text
Administrator
HR Director
```

Query Parameters

```text
page
pageSize
search
status
```

---

## Create User

```http
POST /api/v1/users
```

Request

```json
{
  "firstName": "John",
  "lastName": "Smith",
  "email": "john@gov.org",
  "roleIds": []
}
```

---

## Get User

```http
GET /api/v1/users/{id}
```

---

## Update User

```http
PUT /api/v1/users/{id}
```

---

## Deactivate User

```http
DELETE /api/v1/users/{id}
```

Soft delete only.

---

# Position API

Domain:

D-003

Requirements:

FR-100
FR-101
FR-102

---

## List Positions

```http
GET /api/v1/positions
```

Filters

```text
departmentId
status
classification
```

---

## Create Position

```http
POST /api/v1/positions
```

Request

```json
{
  "title": "HR Specialist",
  "departmentId": "uuid",
  "classification": "Professional",
  "salaryBand": "P4"
}
```

---

## Get Position

```http
GET /api/v1/positions/{id}
```

---

## Update Position

```http
PUT /api/v1/positions/{id}
```

---

## Close Position

```http
POST /api/v1/positions/{id}/close
```

---

# Vacancy API

Requirements:

FR-103
FR-104

---

## List Vacancies

```http
GET /api/v1/vacancies
```

---

## Create Vacancy

```http
POST /api/v1/vacancies
```

Request

```json
{
  "positionId": "uuid",
  "priority": "HIGH",
  "reason": "RETIREMENT",
  "expectedFillDate": "2027-06-01"
}
```

---

## Get Vacancy

```http
GET /api/v1/vacancies/{id}
```

---

## Update Vacancy

```http
PUT /api/v1/vacancies/{id}
```

---

## Close Vacancy

```http
POST /api/v1/vacancies/{id}/close
```

---

# Employee API

Requirements:

Workforce Domain

---

## List Employees

```http
GET /api/v1/employees
```

Filters

```text
departmentId
employmentStatus
```

---

## Create Employee

```http
POST /api/v1/employees
```

Request

```json
{
  "employeeNumber": "EMP001",
  "firstName": "John",
  "lastName": "Smith",
  "departmentId": "uuid"
}
```

---

## Get Employee

```http
GET /api/v1/employees/{id}
```

---

## Update Employee

```http
PUT /api/v1/employees/{id}
```

---

## Employee Skills

```http
GET /api/v1/employees/{id}/skills
```

---

```http
POST /api/v1/employees/{id}/skills
```

---

## Employee Certifications

```http
GET /api/v1/employees/{id}/certifications
```

---

```http
POST /api/v1/employees/{id}/certifications
```

---

# Scheduling API

Requirements:

FR-200
FR-205

---

## List Schedules

```http
GET /api/v1/schedules
```

---

## Create Schedule

```http
POST /api/v1/schedules
```

---

## Publish Schedule

```http
POST /api/v1/schedules/{id}/publish
```

---

## List Shifts

```http
GET /api/v1/shifts
```

---

## Assign Employee

```http
POST /api/v1/assignments
```

Request

```json
{
  "shiftId": "uuid",
  "employeeId": "uuid"
}
```

---

## Optimize Schedule

```http
POST /api/v1/schedules/{id}/optimize
```

Returns:

AI recommendations

Human approval required.

---

# Candidate API

Requirements:

FR-300
FR-306

---

## List Candidates

```http
GET /api/v1/candidates
```

---

## Create Candidate

```http
POST /api/v1/candidates
```

---

## Get Candidate

```http
GET /api/v1/candidates/{id}
```

---

## Update Candidate

```http
PUT /api/v1/candidates/{id}
```

---

## Upload Resume

```http
POST /api/v1/candidates/{id}/resume
```

Content Type:

```http
multipart/form-data
```

Storage:

MinIO

---

## Parse Resume

```http
POST /api/v1/candidates/{id}/resume/parse
```

---

## Match Candidate

```http
POST /api/v1/candidates/{id}/match
```

Response

```json
{
  "success": true,
  "data": {
    "score": 89,
    "confidence": 92,
    "explanation": "Strong certification alignment"
  }
}
```

---

# Hiring Workflow API

---

## Create Application

```http
POST /api/v1/applications
```

---

## Advance Application

```http
POST /api/v1/applications/{id}/advance
```

---

## Schedule Interview

```http
POST /api/v1/interviews
```

---

## Create Offer

```http
POST /api/v1/applications/{id}/offer
```

---

## Hire Candidate

```http
POST /api/v1/applications/{id}/hire
```

Behavior:

Creates Employee record.

---

# Workforce Intelligence API

Requirements:

FR-400
FR-405

---

## Generate Forecast

```http
POST /api/v1/intelligence/forecasts
```

---

## List Forecasts

```http
GET /api/v1/intelligence/forecasts
```

---

## Vacancy Risk Analysis

```http
GET /api/v1/intelligence/vacancy-risks
```

---

## Attrition Analysis

```http
GET /api/v1/intelligence/attrition
```

---

## Recommendations

```http
GET /api/v1/intelligence/recommendations
```

---

# Compliance API

Requirements:

FR-500
FR-504

---

## Audit Events

```http
GET /api/v1/compliance/audit-events
```

Roles:

```text
Compliance Officer
Administrator
```

---

## Compliance Reports

```http
GET /api/v1/compliance/reports
```

---

```http
POST /api/v1/compliance/reports
```

---

## Policies

```http
GET /api/v1/compliance/policies
```

---

```http
POST /api/v1/compliance/policies
```

---

# RBAC Matrix

| Endpoint Group | Admin | HR Director | Planner | Recruiter | Compliance |
|---------------|--------|-------------|----------|------------|-------------|
| Users | Yes | Yes | No | No | No |
| Positions | Yes | Yes | Yes | No | No |
| Vacancies | Yes | Yes | Yes | No | No |
| Employees | Yes | Yes | Yes | No | No |
| Scheduling | Yes | No | Yes | No | No |
| Candidates | Yes | No | No | Yes | No |
| Intelligence | Yes | Yes | Yes | No | No |
| Compliance | Yes | No | No | No | Yes |

---

# Audit Requirements

The following actions must create audit events:

```text
Login
Logout
Create User
Update User
Create Position
Close Position
Create Vacancy
Hire Candidate
Generate Forecast
Modify Schedule
Export Report
```

---

# API Versioning Strategy

Current:

```text
/api/v1
```

Future:

```text
/api/v2
```

Breaking changes require new versions.

---

# Security Requirements

Mandatory:

- JWT Authentication
- RBAC Enforcement
- Tenant Validation
- Request Validation
- Audit Logging

Prohibited:

- Tenant ID from client input
- Cross-tenant access
- Anonymous access to protected resources

---

# Next Blueprint Dependency

Next file:

spec/07_security_architecture.md

This document will define:

- Authentication architecture
- JWT architecture
- RBAC model
- Tenant isolation controls
- Encryption strategy
- Audit controls
- Security monitoring
- Threat model