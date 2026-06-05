# Backend Architecture Specification

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative Backend Architecture Specification

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
- spec/06_api_contracts.md
- spec/07_security_architecture.md
- spec/08_deployment_architecture.md
- spec/09_frontend_architecture.md

---

# Purpose

This document defines the backend architecture for the platform.

It establishes:

- NestJS module organization
- Service boundaries
- Controller structure
- DTO standards
- Validation architecture
- Event architecture
- Background jobs
- Integration patterns
- Persistence strategy

This document is authoritative for backend implementation.

---

# Backend Technology Stack

Framework:

```text
NestJS
```

Language:

```text
TypeScript
```

ORM:

```text
Prisma
```

Validation:

```text
class-validator
class-transformer
```

Authentication:

```text
JWT
Passport
```

Documentation:

```text
Swagger OpenAPI
```

Background Processing:

```text
NestJS Scheduled Tasks (Phase 1–2)
PostgreSQL-based job tracking
```

Note: BullMQ with Redis may be introduced in a later phase if processing volume requires a dedicated queue. This decision is deferred until Phase 2+ requirements are confirmed.

Database:

```text
PostgreSQL
```

---

# Backend Structure

```text
apps/api/

src/

├── modules/
├── common/
├── database/
├── config/
├── auth/
├── jobs/
├── events/
├── integrations/
├── audit/
└── main.ts
```

---

# Module Organization

```text
modules/

├── identity/
├── organization/
├── workforce/
├── scheduling/
├── recruiting/
├── intelligence/
├── compliance/
└── integration/
```

Each module owns:

```text
controllers
services
dtos
entities
repositories
validators
```

---

# Identity Module

Domain:

```text
D-001
```

Responsibilities:

```text
Authentication
Authorization
RBAC
Users
Roles
Permissions
```

Structure:

```text
identity/

├── controllers/
├── services/
├── dtos/
├── repositories/
└── guards/
```

---

# Organization Module

Domain:

```text
D-002
```

Responsibilities:

```text
Agencies
Departments
Tenant Metadata
```

---

# Workforce Module

Domain:

```text
D-003
```

Responsibilities:

```text
Positions
Vacancies
Employees
Skills
Certifications
```

Requirements:

```text
FR-100 → FR-107
```

---

# Scheduling Module

Domain:

```text
D-004
```

Responsibilities:

```text
Schedules
Shifts
Assignments
Coverage Analysis
```

Requirements:

```text
FR-200 → FR-205
```

---

# Recruiting Module

Domain:

```text
D-005
```

Responsibilities:

```text
Candidates
Applications
Interviews
Resume Processing
```

Requirements:

```text
FR-300 → FR-306
```

---

# Intelligence Module

Domain:

```text
D-006
```

Responsibilities:

```text
Forecasting
Attrition
Vacancy Risk
Recommendations
```

Requirements:

```text
FR-400 → FR-405
```

---

# Compliance Module

Domain:

```text
D-007
```

Responsibilities:

```text
Audit Events
Policies
Compliance Reports
```

Requirements:

```text
FR-500 → FR-504
```

---

# Integration Module

Domain:

```text
D-008
```

Responsibilities:

```text
External Systems
Future Connectors
Synchronization
```

---

# Controller Architecture

Responsibilities:

```text
Request Handling
Authorization
Validation
Response Mapping
```

Controllers may not:

```text
Contain Business Logic
Contain Database Logic
```

---

## Example Structure

```text
positions.controller.ts
positions.service.ts
positions.repository.ts
```

Flow:

```text
Controller
 ↓
Service
 ↓
Repository
 ↓
Database
```

---

# Service Architecture

Services contain:

```text
Business Logic
Validation Rules
Workflow Orchestration
```

Services may call:

```text
Repositories
Events
Jobs (scheduled tasks)
Intelligence Module (OpenAI API via NestJS Intelligence Module)
```

Services may not call:

```text
Other Module Databases Directly
```

---

# Repository Architecture

Responsibilities:

```text
Database Access
Persistence
Queries
```

Implementation:

```text
Prisma
```

Repositories return:

```text
Domain Models
```

Never HTTP responses.

---

# DTO Strategy

Every endpoint must define:

```text
Request DTO
Response DTO
```

Example:

```text
CreatePositionDto
UpdatePositionDto
PositionResponseDto
```

---

# Validation Strategy

All external inputs validated.

Mechanisms:

```text
ValidationPipe
class-validator
```

Examples:

```typescript
@IsString()
@IsUUID()
@IsEmail()
@IsOptional()
```

---

# Event Architecture

Purpose:

```text
Loose Coupling
Auditability
Workflow Triggers
```

---

## Internal Events

Examples:

```text
UserCreated
PositionCreated
VacancyCreated
CandidateHired
ForecastGenerated
```

---

## Event Flow

```text
Service
 ↓
Event Published
 ↓
Subscribers Execute
```

---

# Background Jobs

Phase 1–2 Approach:

```text
NestJS @Cron Scheduled Tasks
PostgreSQL-based job state tracking
```

Future (if required by Phase 2+ volume):

```text
BullMQ with Redis — introduced via approved architectural decision
```

---

## Job Types

Resume Parsing

Forecast Generation

Compliance Report Generation

Bulk Imports

Notification Processing

---

## Job Rules

Jobs must:

```text
Be Idempotent
Be Retryable
Be Observable
```

---

# AI Integration Architecture

External Service:

```text
apps/ai-service
```

Communication:

```text
REST
Internal Network
```

---

## AI Client Layer

Directory:

```text
common/clients
```

Examples:

```text
forecasting.client.ts
matching.client.ts
attrition.client.ts
```

---

## Failure Handling

If AI fails:

```text
Return Graceful Error
Log Failure
Continue Core Operations
```

AI failure may not:

```text
Break Authentication
Break Scheduling
Break Recruiting
```

---

# Tenant Architecture

Tenant Context Source:

```text
JWT Claims
```

Every request must contain:

```text
tenant_id
```

resolved internally.

---

## Tenant Guard

Responsibilities:

```text
Tenant Validation
Tenant Ownership Verification
```

---

# Authorization Architecture

Implementation:

```text
Guards
Decorators
RBAC
```

Examples:

```typescript
@Roles('Administrator')
@Roles('Recruiter')
```

---

# Audit Architecture

Every critical action creates:

```text
Audit Event
```

Examples:

```text
Create User
Update Position
Hire Candidate
Generate Forecast
```

---

# Error Handling

Global Exception Filter

Standardized Responses

Examples:

```text
400
401
403
404
409
500
```

---

# Logging Strategy

Framework:

```text
NestJS Logger
```

Future:

```text
Structured Logging
```

Log:

```text
Errors
Warnings
Security Events
Job Failures
```

Never Log:

```text
Passwords
Tokens
Secrets
```

---

# API Documentation

Generated By:

```text
Swagger
```

Endpoint:

```text
/api/docs
```

Requirements:

Every endpoint documented.

Every DTO documented.

---

# Configuration Architecture

Directory:

```text
config/
```

Examples:

```text
database.config.ts
jwt.config.ts
redis.config.ts
ai.config.ts
```

---

# Health Checks

Framework:

```text
@nestjs/terminus
```

Endpoint:

```http
GET /health
```

Checks:

```text
Database
OpenAI API connectivity (Intelligence Module)
```

---

# Backend Testing Strategy

Unit Tests:

```text
Jest
```

Integration Tests:

```text
Nest Testing Module
```

API Tests:

```text
Supertest
```

Coverage Target:

```text
80%
```

Minimum.

---

# Backend Security Requirements

Mandatory:

```text
DTO Validation
RBAC
JWT Authentication
Tenant Validation
Audit Logging
```

Prohibited:

```text
Raw SQL in Controllers
Business Logic in Controllers
Tenant ID From Client Input
```

---

# Backend Acceptance Criteria

Architecture is approved when:

1. Modules isolated.
2. Controllers thin.
3. Services own business logic.
4. Repositories own persistence.
5. DTO validation enforced.
6. Events implemented.
7. Background jobs operational.
8. AI integration isolated.
9. Audit logging enforced.
10. Swagger documentation generated.

---

# Next Blueprint Dependency

Next file:

spec/11_ai_architecture.md

This document will define:

- NestJS Intelligence Module architecture
- OpenAI integration
- Prompt management
- Forecasting engine
- Candidate matching engine
- Attrition prediction engine
- Explainability requirements
- AI governance implementation