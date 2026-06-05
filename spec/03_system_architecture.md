# System Architecture Specification

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative System Architecture Specification

References:

- meta/00_project_classification.md
- meta/01_assumptions_and_decisions.md
- meta/02_glossary.md
- meta/03_traceability_matrix.md
- spec/01_requirements.md
- spec/02_non_functional_requirements.md

---

# Purpose

This document defines the authoritative architecture for:

- Frontend
- Backend
- AI Services
- Data Layer
- Infrastructure
- Security
- Runtime Communication
- Deployment

This architecture serves as the foundation for all implementation activities.

---

# Architectural Principles

## AP-001

Security before optimization.

---

## AP-002

Human authority overrides AI authority.

---

## AP-003

Tenant isolation is mandatory.

---

## AP-004

Every critical action is auditable.

---

## AP-005

Services must remain independently deployable.

---

## AP-006

Architecture must support future compliance expansion.

---

# High-Level Architecture

```text
┌────────────────────────────┐
│     Next.js Frontend       │
└─────────────┬──────────────┘
              │
              ▼
┌────────────────────────────┐
│   Docker Compose Network   │
└─────────────┬──────────────┘
              │
      ┌───────┼────────┐
      ▼                ▼

┌─────────────────┐  ┌─────────────┐
│    NestJS API   │  │ Integration │
│ (incl. AI Intel │  │ Services    │
│    Module)      │  │ (future)    │
└────────┬────────┘  └─────────────┘
         │
         ▼

┌─────────┐
│Postgres │
└─────────┘
```

---

# Architectural Layers

## Presentation Layer

Responsibilities:

- User interface
- Dashboards
- Forms
- Reporting
- Authentication screens

Technology:

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui

---

## Application Layer

Responsibilities:

- Business logic
- Validation
- Authorization
- Workflow orchestration

Technology:

- NestJS

---

## Intelligence Layer

Responsibilities:

- Forecasting
- Candidate matching
- Vacancy prediction
- Attrition prediction

Technology:

- TypeScript
- NestJS Intelligence Module
- OpenAI API

Note: AI capabilities are implemented as a dedicated module within the NestJS API application. No separate AI service is deployed. All OpenAI API calls originate from the NestJS Intelligence Module.

---

## Data Layer

Responsibilities:

- Persistent storage
- Audit storage
- Reporting data

Technology:

- PostgreSQL (primary)
- Prisma ORM

Note: File and document storage (resumes, report exports, attachments) is deferred to Phase 3 planning. PostgreSQL handles all persistence in Phases 1 and 2.

---

## Infrastructure Layer

Responsibilities:

- Networking
- Routing
- Containers
- Deployment

Technology:

- Docker Compose
- CI/CD Pipelines
- Hetzner Cloud

---

# Frontend Architecture

Directory Structure

```text
apps/web/

src/
├── app/
├── pages/
├── features/
├── components/
├── layouts/
├── hooks/
├── services/
├── store/
├── utils/
├── types/
└── assets/
```

---

# Frontend Modules

## Authentication

Features:

- Login
- Password reset
- Session management

Requirements:

- FR-001
- FR-002
- FR-003

---

## Workforce Planning

Features:

- Position management
- Vacancy management
- Forecasting dashboards

Requirements:

- FR-100 → FR-107

---

## Scheduling

Features:

- Schedule creation
- Assignment management
- Optimization recommendations

Requirements:

- FR-200 → FR-205

---

## Recruiting

Features:

- Candidate intake
- Candidate review
- Hiring workflows

Requirements:

- FR-300 → FR-306

---

## Compliance

Features:

- Audit review
- Compliance reporting

Requirements:

- FR-500 → FR-504

---

# Backend Architecture

Directory Structure

```text
apps/api/

src/
├── modules/
├── common/
├── auth/
├── database/
├── events/
├── jobs/
├── integrations/
├── audit/
└── config/
```

---

# Backend Domains

## Identity Module

Responsibilities:

- Authentication
- Authorization
- RBAC

Requirements:

- FR-001 → FR-006

---

## Organization Module

Responsibilities:

- Agency management
- Department management

Requirements:

- D-002

---

## Workforce Module

Responsibilities:

- Positions
- Vacancies
- Forecasts

Requirements:

- FR-100 → FR-107

---

## Scheduling Module

Responsibilities:

- Shifts
- Assignments
- Coverage

Requirements:

- FR-200 → FR-205

---

## Recruiting Module

Responsibilities:

- Candidates
- Applications
- Hiring workflows

Requirements:

- FR-300 → FR-306

---

## Compliance Module

Responsibilities:

- Audit logs
- Reports
- Policies

Requirements:

- FR-500 → FR-504

---

# AI Architecture

AI capabilities are implemented as a dedicated module within the NestJS API. No separate service is deployed.

Directory Structure

```text
apps/api/src/modules/intelligence/

├── services/
│   ├── forecasting.service.ts
│   ├── matching.service.ts
│   ├── attrition.service.ts
│   └── vacancy-risk.service.ts
├── prompts/
├── explainability/
└── intelligence.module.ts
```

---

# AI Service Boundaries

## Demand Forecasting Service

Inputs:

- Workforce history
- Vacancy history
- Demand trends

Outputs:

- Staffing forecasts

Requirements:

- FR-400

---

## Vacancy Risk Service

Inputs:

- Vacancy trends
- Workforce changes

Outputs:

- Risk scores

Requirements:

- FR-401

---

## Attrition Service

Inputs:

- Employee history
- Workforce trends

Outputs:

- Attrition probability

Requirements:

- FR-402

---

## Candidate Matching Service

Inputs:

- Candidate profile
- Position profile

Outputs:

- Match score
- Explanation

Requirements:

- FR-303

---

# OpenAI Usage

Permitted:

- Candidate summaries
- Position description generation
- Workforce insights
- Recommendation explanations

Prohibited:

- Hiring decisions
- Staffing approvals
- Compliance overrides

Human approval required.

---

# Data Architecture

Primary Database:

PostgreSQL

---

## Core Schemas

```text
identity
organization
workforce
scheduling
recruiting
compliance
analytics
audit
```

---

# Background Processing

Phase 1–2: Background job processing uses a PostgreSQL-based approach via scheduled NestJS tasks. No external queue infrastructure is required in Phases 1 or 2.

Future: If processing volume requires a dedicated queue, BullMQ with Redis may be introduced in a later phase via an approved architectural decision.

---

# File and Document Storage

Deferred to Phase 3 planning. File storage decisions (resume storage, report export storage, audit export storage) will be scoped when Phase 3 recruiting and reporting capabilities are implemented.

---

# Audit Architecture

Every critical action produces:

```text
Audit Event
├── Event ID
├── Tenant ID
├── User ID
├── Action
├── Entity
├── Timestamp
└── Metadata
```

Requirements:

- FR-500
- NFR-008

---

# Tenant Architecture

Model:

Hybrid Multi-Tenant

---

## Phase 1

Shared database

Tenant partitioning

```text
tenant_id
```

required on all tenant-owned records.

---

## Future

Dedicated database

Dedicated infrastructure

Migration supported.

---

# Integration Architecture

Supported Integrations

## HRIS

Future:

- Workday
- UKG
- Oracle

---

## Payroll

Future:

- ADP
- Government payroll systems

---

## Identity

Future:

- Microsoft Entra ID

---

# Security Architecture

Authentication:

- JWT

Authorization:

- RBAC

Encryption:

- TLS
- Database encryption

Secrets:

- Environment variables
- Docker secrets (future)

Auditability:

- Mandatory

---

# Infrastructure Architecture

Deployment Model:

Hetzner

Containerization:

Docker Compose

---

# Services

Phase 1–2 Services:

```text
frontend
api
postgres
```

Future services (introduced when required by later phases):

```text
worker        (background job processing — if volume requires dedicated worker)
file-storage  (cloud object storage — deferred to Phase 3)
```

---

# Networking

Public:

- Frontend (Next.js)
- API (NestJS — exposed via Docker Compose port mapping)

Private:

- PostgreSQL

---

# Environment Strategy

Environments:

```text
local
development
staging
production
```

Each environment isolated.

---

# Runtime Communication

Frontend → API

```text
HTTPS
REST
JSON
```

---

API → AI Service

```text
Internal REST
JSON
```

---

API → PostgreSQL

```text
ORM Access
```

---

API → OpenAI

```text
HTTPS
REST
JSON
```

---

# Failure Isolation

AI service failures shall not impact:

- Authentication
- Scheduling
- Recruiting workflows

System shall degrade gracefully.

---

# Scalability Strategy

Phase 1

Single-host deployment

---

Phase 2

Horizontal API scaling

---

Phase 3

Dedicated AI workers

---

Phase 4

Dedicated tenant deployments

---

# Architecture Decision Summary

| Area | Decision |
|--------|----------|
| Frontend | Next.js + TypeScript + Tailwind CSS + shadcn/ui |
| Backend | NestJS + TypeScript + Prisma ORM |
| AI | NestJS Intelligence Module + OpenAI API |
| Database | PostgreSQL |
| Cache | Deferred — PostgreSQL-based approach for Phases 1–2 |
| Storage | Deferred to Phase 3 planning |
| Gateway | Docker Compose networking; cloud LB for production |
| Deployment | Docker Compose |
| Hosting | Hetzner Cloud |
| AI Provider | OpenAI API |
| Tenant Model | Hybrid |

---

# Architecture Constraints

The following are mandatory:

- Tenant isolation
- Audit logging
- RBAC
- Human-in-the-loop AI
- Docker deployment
- PostgreSQL persistence

No implementation may violate these constraints.

---

# Next Blueprint Dependency

Next file:

spec/04_domain_model.md

This document will define:

- Business entities
- Aggregate roots
- Relationships
- Ownership boundaries
- Domain-driven design structure
- Entity lifecycle rules