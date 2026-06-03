# Workforce Forecasting Rules

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative Workforce Forecasting Directive

References:

- spec/01_requirements.md
- spec/04_domain_model.md
- spec/06_api_contracts.md
- spec/11_ai_architecture.md
- spec/12_reporting_architecture.md

---

# Purpose

This directive defines the business rules governing workforce forecasting.

These rules control:

- Forecast generation
- Forecast approval
- Forecast confidence scoring
- Forecast review workflows
- Forecast publication
- Forecast retention

These rules are mandatory for all implementations.

---

# Forecasting Principles

## WF-001

Forecasts are advisory.

Forecasts may never automatically change workforce plans.

---

## WF-002

Human approval is mandatory.

---

## WF-003

Every forecast must be explainable.

---

## WF-004

Every forecast must be auditable.

---

## WF-005

Forecasts are tenant isolated.

Cross-tenant forecasting is prohibited.

---

# Forecast Inputs

Forecast generation may use:

```text
Historical Headcount
Position Data
Vacancy Data
Department Data
Coverage Data
Attrition Trends
Hiring Trends
Seasonality Data
```

---

# Prohibited Inputs

Forecast generation may not use:

```text
Passwords
Access Tokens
Secrets
Cross-Tenant Data
```

---

# Forecast Types

Supported:

```text
Department Forecast
Position Forecast
Agency Forecast
Vacancy Forecast
Workforce Capacity Forecast
```

---

# Forecast Generation Rules

## WF-100

A forecast request must specify:

```text
Forecast Type
Forecast Period
Scope
```

---

## WF-101

Forecast period must be:

```text
30 Days
90 Days
180 Days
365 Days
```

---

## WF-102

Forecasts must include:

```text
Recommendation
Confidence Score
Reasoning
Generation Timestamp
```

---

# Confidence Scoring Rules

## WF-200

Confidence range:

```text
0 - 100
```

---

## WF-201

Confidence levels:

| Score | Level |
|---------|---------|
| 0-39 | Low |
| 40-69 | Medium |
| 70-100 | High |

---

## WF-202

Forecasts with confidence below:

```text
40
```

must display:

```text
Low Confidence Forecast
```

warning.

---

# Explainability Rules

## WF-300

Every forecast must provide:

```text
Primary Factors
Confidence
Narrative Explanation
```

---

## WF-301

Explanation must be understandable by HR users.

Technical model details are optional.

---

# Approval Workflow

## WF-400

Generated Forecast

State:

```text
Draft
```

---

## WF-401

A planner may review.

---

## WF-402

A planner may submit for approval.

State:

```text
Pending Approval
```

---

## WF-403

HR Director may:

```text
Approve
Reject
Request Revision
```

---

## WF-404

Approved forecasts become:

```text
Published
```

---

# Published Forecast Rules

## WF-500

Published forecasts are read-only.

---

## WF-501

Changes require:

```text
New Forecast Generation
```

---

# Forecast Retention

## WF-600

Forecasts retained:

```text
7 Years
```

---

## WF-601

Published forecasts may not be deleted.

Only archived.

---

# Audit Rules

Every forecast action must generate audit events.

Required events:

```text
Forecast Generated
Forecast Submitted
Forecast Approved
Forecast Rejected
Forecast Published
Forecast Archived
```

---

# Security Rules

Forecast access requires:

```text
Authentication
Authorization
Tenant Validation
```

---

# Performance Rules

Forecast generation target:

```text
< 30 Seconds
```

---

# Failure Rules

If forecasting fails:

```text
Log Failure
Create Audit Event
Notify User
```

No partial forecast may be published.

---

# Acceptance Criteria

Directive is satisfied when:

1. Forecasts are explainable.
2. Forecasts are auditable.
3. Human approval is enforced.
4. Tenant isolation is enforced.
5. Confidence scoring is implemented.
6. Retention rules are enforced.

---

# Next Directive

Next file:

directives/02_position_management_rules.md