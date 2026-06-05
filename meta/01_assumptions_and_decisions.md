# Assumptions and Decisions Register

**Project:** AI-Driven Staffing Optimization Platform for Government HR

**Version:** 1.0

**Status:** Active

**Purpose:** This document records all architectural assumptions, accepted constraints, implementation decisions, deferred decisions, and future decision points. All blueprint artifacts must reference this register when introducing new requirements, specifications, or architectural changes.

---

# 1. Document Governance

## Objective

Prevent architectural drift by maintaining a single source of truth for assumptions and major decisions.

## Rule

No specification, directive, implementation plan, or architecture document may contradict an approved decision contained within this register.

## Change Process

Any future modification must:

* Identify impacted domains
* Document rationale
* Identify migration requirements
* Identify risks
* Update affected blueprint files

---

# 2. Project Assumptions

## ASSUMPTION A-001

### Assumption

Government agencies require workforce planning, staffing optimization, scheduling, recruiting, compliance, and workforce intelligence within a single platform.

### Alternative

Separate products for workforce planning and recruiting.

### Decision

**Rejected**

A unified workforce intelligence platform will be built.

---

## ASSUMPTION A-002

### Assumption

Initial customers will accept cloud-hosted deployment.

### Alternative

On-premise deployment only.

### Decision

**Deferred**

Initial blueprint targets cloud-hosted deployment.

Future on-premise deployment may be supported.

---

## ASSUMPTION A-003

### Assumption

Government organizations will require auditability for workforce-related decisions.

### Alternative

Minimal activity logging.

### Decision

**Rejected**

Comprehensive audit logging required.

---

## ASSUMPTION A-004

### Assumption

Organizations will expect future enterprise identity integration.

### Alternative

Permanent local account model.

### Decision

**Rejected**

Future Microsoft identity integration anticipated.

---

## ASSUMPTION A-005

### Assumption

AI recommendations will require human review.

### Alternative

Autonomous AI decision making.

### Decision

**Rejected**

Human approval remains mandatory.

---

# 3. Approved Architectural Decisions

## DECISION D-001

### Title

Platform Classification

### Decision

Government Workforce Intelligence & Staffing Optimization Platform

### Status

Approved

### Impact

Affects:

* Requirements
* Architecture
* UX
* AI
* Compliance

---

## DECISION D-002

### Title

Scope Mode

### Decision

Production Scope

### Status

Approved

### Impact

Requires:

* Full governance
* Security controls
* Auditability
* Data lifecycle management

---

## DECISION D-003

### Title

Deployment Platform

### Decision

Hetzner Cloud

### Status

Approved

### Impact

Affects:

* Infrastructure design
* CI/CD
* Networking
* Operations

---

## DECISION D-004

### Title

Container Strategy

### Decision

Docker Compose

### Status

Approved

### Impact

Phase 1–5 infrastructure design must avoid Kubernetes dependency.

---

## DECISION D-005

### Title

Primary Database

### Decision

PostgreSQL

### Status

Approved

### Impact

All schemas, data models, and reporting structures assume PostgreSQL.

---

## DECISION D-006

### Title

Background Processing and Caching Strategy

### Decision

PostgreSQL-based scheduled tasks for Phases 1–2. Redis deferred.

### Status

Superseded — see D-023

### Impact

Background jobs use NestJS @Cron with PostgreSQL job state tracking.

BullMQ with Redis may be introduced in a later phase if processing volume requires it, via a new approved architectural decision at that time.

---

## DECISION D-007

### Title

File and Document Storage

### Decision

Deferred to Phase 3 planning.

### Status

Deferred — see D-024

### Impact

Resume storage, report exports, attachments, and audit exports will use a cloud-compatible object storage solution scoped during Phase 3. PostgreSQL handles all persistence in Phases 1 and 2.

---

# 4. Multi-Tenant Strategy Decisions

## DECISION D-008

### Title

Tenant Model

### Decision

Hybrid Multi-Tenant

### Status

Approved

### Phase 1

* Shared infrastructure
* Shared database
* Tenant isolation enforced logically

### Future

Dedicated tenant environments supported.

### Rationale

Balances:

* Simplicity
* Cost
* Future enterprise requirements

---

## DECISION D-009

### Title

Tenant Upgrade Path

### Decision

Tenant migration path must exist from shared to dedicated deployment.

### Status

Approved

---

# 5. Authentication Decisions

## DECISION D-010

### Title

Authentication Model

### Decision

JWT + Local Accounts

### Status

Approved

### Scope

Initial release only.

---

## DECISION D-011

### Title

Enterprise Authentication

### Decision

Microsoft Entra ID support planned.

### Status

Planned

### Priority

Medium

---

## DECISION D-012

### Title

Authentication Architecture

### Decision

Authentication provider abstraction required.

### Status

Approved

### Rationale

Prevents future redesign.

---

# 6. AI Strategy Decisions

## DECISION D-013

### Title

AI Provider

### Decision

OpenAI

### Status

Approved

---

## DECISION D-014

### Title

AI Authority Level

### Decision

Advisory Only

### Status

Approved

### AI May

* Recommend
* Forecast
* Predict
* Classify
* Summarize

### AI May Not

* Hire candidates
* Approve staffing actions
* Override policy
* Override compliance controls

---

## DECISION D-015

### Title

Initial AI Capabilities

### Decision

Phase 1 AI capabilities include:

* Workforce demand forecasting
* Vacancy risk prediction
* Attrition prediction
* Candidate matching
* Position description generation

### Status

Approved

---

# 7. Compliance Decisions

## DECISION D-016

### Title

Compliance Baseline

### Decision

NIST-inspired security controls

### Status

Approved

---

## DECISION D-017

### Title

Mandatory Controls

### Decision

Required:

* RBAC
* Audit logging
* Encryption at rest
* Encryption in transit
* Tenant isolation
* Administrative accountability

### Status

Approved

---

## DECISION D-018

### Title

Certification Scope

### Decision

Formal certification deferred.

### Status

Approved

### Deferred

* FedRAMP
* StateRAMP
* SOC 2

### Requirement

Architecture must remain compatible.

---

# 8. Product Domain Decisions

## DECISION D-019

### Title

Workforce Planning Domain

### Status

Approved

### Includes

* Position management
* Vacancy management
* Workforce forecasting

---

## DECISION D-020

### Title

Scheduling Domain

### Status

Approved

### Includes

* Shift scheduling
* Coverage planning
* Optimization

---

## DECISION D-021

### Title

Talent Acquisition Domain

### Status

Approved

### Includes

* Candidate intake
* Candidate matching
* Hiring workflows

---

## DECISION D-022

### Title

Compliance Domain

### Status

Approved

### Includes

* Auditing
* Reporting
* Governance controls

---

# 9. Deferred Decisions

The following decisions remain intentionally unresolved.

## DD-001

Specific forecasting model selection.

### Options

* XGBoost
* Random Forest
* Time-Series Forecasting
* Hybrid Models

---

## DD-002

Real-time notification provider.

### Potential Options

* Email
* SMS
* Teams
* Slack

---

## DD-003

HRIS integration vendors.

### Potential Options

* Workday
* UKG
* Oracle
* SAP

---

## DD-004

Payroll integration vendors.

### Potential Options

* ADP
* Paychex
* Government payroll systems

---

## DD-005

Government identity provider standards.

Will depend on customer requirements.

---

# 10. Risk-Based Assumptions

## RISK ASSUMPTION R-001

### Assumption

Historical workforce data will be available for forecasting.

### Risk

Low-quality data reduces model accuracy.

### Mitigation

Data quality validation framework required.

---

## RISK ASSUMPTION R-002

### Assumption

Tenant isolation errors create compliance exposure.

### Risk

High

### Mitigation

Tenant boundary validation required throughout architecture.

---

## RISK ASSUMPTION R-003

### Assumption

AI-generated recommendations may contain bias.

### Risk

Medium

### Mitigation

* Human review required
* Audit trail required
* Explainability required

---

## RISK ASSUMPTION R-004

### Assumption

Government procurement timelines may delay integrations.

### Risk

Medium

### Mitigation

Integration hub designed as modular architecture.

---

# 11. Non-Negotiable Constraints

The following constraints are binding.

* **Constraint C-001:** Human authority overrides AI authority.
* **Constraint C-002:** Every critical action must be auditable.
* **Constraint C-003:** Tenant isolation must be enforced.
* **Constraint C-004:** Platform must support future enterprise identity providers.
* **Constraint C-005:** No domain may bypass compliance controls.
* **Constraint C-006:** No module may require Kubernetes.
* **Constraint C-007:** All blueprint documents must remain consistent with `meta/00_project_classification.md`.

---

## DECISION D-023

### Title

Frontend Framework

### Decision

Next.js with TypeScript, Tailwind CSS, and shadcn/ui.

### Status

Approved

### Rationale

Next.js provides App Router, server-side rendering, built-in build tooling, and TypeScript support. Replaces the earlier React + Vite approach recorded in prior blueprint versions.

### Impact

All frontend architecture, routing, and build configuration must conform to Next.js App Router conventions.

---

## DECISION D-024

### Title

AI Integration Architecture

### Decision

AI capabilities are implemented as a dedicated NestJS Intelligence Module within the API application. No separate AI service (Python/FastAPI) is deployed.

### Status

Approved

### Rationale

Eliminates a separate service deployment, simplifies infrastructure, and keeps TypeScript as the sole application language. All OpenAI API calls originate from the NestJS Intelligence Module.

### Impact

spec/11_ai_architecture.md governs AI capability design. All AI features are built as NestJS services within the intelligence module. No Python or FastAPI dependencies.

---

# 12. Next Blueprint Dependency

This document establishes assumptions and decisions.
