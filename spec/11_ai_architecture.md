# AI Architecture Specification

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative AI Architecture Specification

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
- spec/10_backend_architecture.md

---

# Purpose

This document defines the AI architecture used by the platform.

It establishes:

- AI service architecture
- OpenAI integration
- Prompt management
- Forecasting services
- Candidate matching services
- Attrition prediction services
- Explainability requirements
- Human oversight requirements
- AI governance controls

This document is authoritative for all AI implementations.

---

# AI Principles

## AI-001

AI assists humans.

AI does not replace humans.

---

## AI-002

All AI recommendations must be explainable.

---

## AI-003

AI outputs must be auditable.

---

## AI-004

AI recommendations are advisory only.

---

## AI-005

Human approval is required for all workforce actions.

---

# AI Service Architecture

AI capabilities are implemented as a dedicated module within the NestJS API. No separate AI service is deployed.

Deployment:

```text
apps/api/src/modules/intelligence
```

Technology:

```text
TypeScript
NestJS
OpenAI API
```

---

# Module Structure

```text
apps/api/src/modules/intelligence/

├── services/
│   ├── forecasting.service.ts
│   ├── matching.service.ts
│   ├── attrition.service.ts
│   └── vacancy-risk.service.ts
├── prompts/
│   ├── candidate_matching.md
│   ├── forecast_explanation.md
│   ├── vacancy_risk.md
│   └── attrition_analysis.md
├── explainability/
├── governance/
├── dtos/
└── intelligence.module.ts
```

---

# AI Runtime Architecture

```text
Frontend
    │
    ▼

NestJS API
    │
    ▼

Intelligence Module (NestJS)
    │
    ▼

OpenAI API
```

---

# OpenAI Integration

Provider:

```text
OpenAI
```

Usage:

```text
Candidate Summaries
Position Descriptions
Workforce Insights
Forecast Explanations
Recommendation Explanations
```

---

# OpenAI Restrictions

Prohibited:

```text
Hiring Decisions
Termination Decisions
Policy Overrides
Compliance Decisions
Staffing Approvals
```

---

# Prompt Management

Directory:

```text
apps/api/src/modules/intelligence/prompts/
```

Examples:

```text
candidate_matching.md
forecast_explanation.md
vacancy_risk.md
attrition_analysis.md
```

---

# Prompt Versioning

Every prompt must contain:

```text
Prompt ID
Version
Author
Created Date
Last Updated
```

Example:

```yaml
prompt_id: candidate_matching
version: 1.0
```

---

# Forecasting Engine

Requirements:

```text
FR-400
FR-405
```

---

## Inputs

```text
Position Data
Vacancy Data
Historical Staffing
Coverage Data
Department Trends
```

---

## Outputs

```json
{
  "forecastPeriod": "Q1 2028",
  "recommendedHeadcount": 52,
  "confidence": 88,
  "explanation": "Vacancy growth trend detected"
}
```

---

# Forecast Explainability

Required:

```text
Forecast Factors
Confidence Score
Reasoning Summary
```

Users must understand:

```text
Why recommendation exists
```

---

# Candidate Matching Engine

Requirements:

```text
FR-303
```

---

## Inputs

Candidate:

```text
Skills
Experience
Education
Certifications
```

Position:

```text
Required Skills
Required Certifications
Required Experience
```

---

## Outputs

```json
{
  "score": 92,
  "confidence": 90,
  "explanation": "Strong certification alignment"
}
```

---

# Matching Factors

Weighted:

```text
Skills
Certifications
Experience
Education
Historical Hiring Success
```

---

# Vacancy Risk Engine

Requirements:

```text
FR-401
```

---

## Inputs

```text
Vacancy Age
Position Type
Department Demand
Historical Fill Time
```

---

## Outputs

```json
{
  "riskScore": 85,
  "riskLevel": "HIGH",
  "explanation": "Long vacancy duration"
}
```

---

# Attrition Prediction Engine

Requirements:

```text
FR-402
```

---

## Inputs

```text
Tenure
Position History
Department Trends
Historical Attrition
```

---

## Outputs

```json
{
  "riskScore": 72,
  "riskLevel": "MEDIUM",
  "explanation": "Attrition pattern similarity"
}
```

---

# Explainability Layer

Directory:

```text
explainability/
```

Purpose:

```text
Translate AI outputs
Generate rationale
Produce human-readable explanations
```

---

# Explainability Requirements

Every AI output must include:

```text
Score
Confidence
Reasoning
Factors
Timestamp
```

---

# AI Governance

Requirements:

```text
NFR-016
NFR-017
```

---

## Human Approval Requirement

Required for:

```text
Hiring
Scheduling
Workforce Planning
Policy Actions
```

AI recommendations may not execute actions.

---

## AI Audit Requirements

Every AI request must log:

```text
Tenant ID
User ID
Prompt ID
Model
Timestamp
```

---

Every AI response must log:

```text
Response ID
Confidence
Result
Timestamp
```

---

# AI Security Controls

Requirements:

- spec/07_security_architecture.md

---

## Tenant Isolation

AI requests must contain:

```text
tenant_id
```

Resolved internally.

---

## Data Protection

Never send:

```text
Passwords
Secrets
Access Tokens
```

to AI providers.

---

## Prompt Injection Protection

Validate:

```text
User Inputs
Resume Content
External Data
```

Before prompt execution.

---

# AI Failure Handling

If OpenAI API unavailable or returns an error:

```text
Return Controlled Error
Log Failure
Notify Monitoring System
```

---

Core Platform Must Continue:

```text
Authentication
Scheduling
Recruiting
Compliance
```

---

# AI Monitoring

Metrics:

```text
Request Count
Latency
Error Rate
Token Usage
Cost
```

---

Alert Conditions:

```text
High Error Rate
Slow Responses
Provider Failure
Unexpected Costs
```

---

# AI Performance Targets

Candidate Matching:

```text
< 5 Seconds
```

---

Attrition Prediction:

```text
< 10 Seconds
```

---

Vacancy Risk:

```text
< 10 Seconds
```

---

Forecast Generation:

```text
< 30 Seconds
```

---

# AI Model Strategy

Phase 1

```text
OpenAI API
```

---

Phase 2

```text
Model Abstraction Layer
```

---

Phase 3

```text
Multi-Provider Support
```

Possible Future Providers:

```text
OpenAI
Anthropic
Azure OpenAI
Local Models
```

---

# AI Cost Controls

Every request must track:

```text
Model
Tokens
Estimated Cost
Tenant
```

---

Monthly reporting:

```text
Usage
Cost
Forecast
```

---

# AI Testing Strategy

Unit Tests:

```text
Prompt Validation
Output Validation
```

---

Integration Tests:

```text
Provider Connectivity
Forecast Workflows
Matching Workflows
```

---

Evaluation Tests:

```text
Forecast Accuracy
Matching Accuracy
Explainability Validation
```

---

# AI Acceptance Criteria

Architecture is approved when:

1. AI isolated in dedicated NestJS intelligence module.
2. OpenAI integration abstracted.
3. Explainability implemented.
4. Human approval enforced.
5. AI outputs audited.
6. Tenant isolation enforced.
7. Cost tracking operational.
8. Failure handling implemented.
9. Monitoring configured.
10. Security controls enforced.

---

# AI Constraints

Mandatory:

- Explainability
- Auditability
- Human Oversight
- Tenant Isolation

Prohibited:

- Autonomous Hiring
- Autonomous Scheduling
- Autonomous Policy Decisions
- Autonomous Compliance Actions

---

# Next Blueprint Dependency

Next file:

spec/12_reporting_architecture.md

This document will define:

- Unit testing standards
- Integration testing standards
- API testing
- Frontend testing
- AI testing
- Security testing
- Performance testing
- Acceptance testing
- Release validation