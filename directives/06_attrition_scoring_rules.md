# Attrition Scoring Rules

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative Attrition Scoring Directive

References:

- spec/01_requirements.md
- spec/04_domain_model.md
- spec/06_api_contracts.md
- spec/11_ai_architecture.md
- spec/12_reporting_architecture.md

---

# Purpose

This directive defines the business rules governing attrition scoring.

These rules control:

- Attrition risk assessment
- Risk classification
- Workforce retention analysis
- AI-assisted attrition predictions
- Retention recommendations
- Attrition reporting

These rules are mandatory for all implementations.

---

# Attrition Principles

## ATR-001

Attrition analysis supports workforce planning.

---

## ATR-002

Attrition predictions are advisory.

---

## ATR-003

Attrition predictions require explainability.

---

## ATR-004

Attrition predictions may not drive automated personnel actions.

---

## ATR-005

Attrition analysis must be auditable.

---

# Attrition Risk Inputs

Approved inputs:

```text
Employee Tenure
Department History
Position History
Historical Attrition
Internal Mobility Trends
Certification Activity
Training Activity
Workforce Trends
```

---

# Prohibited Inputs

The system may not use:

```text
Race
Religion
Political Affiliation
Medical Information
Protected Characteristics
Cross-Tenant Data
```

---

# Attrition Risk Scoring

## ATR-100

Risk score range:

```text
0 - 100
```

---

## ATR-101

Every score must include:

```text
Risk Score
Risk Level
Confidence
Explanation
Timestamp
```

---

# Risk Classification

## ATR-200

Risk levels:

| Score | Level |
|---------|---------|
| 0-39 | Low |
| 40-69 | Medium |
| 70-100 | High |

---

## ATR-201

High-risk employees require workforce review.

---

## ATR-202

High-risk employees may not trigger automatic intervention.

---

# Explainability Rules

## ATR-300

Every prediction must include:

```text
Primary Factors
Confidence
Narrative Explanation
```

---

## ATR-301

Explanations must be understandable by HR users.

---

## ATR-302

Black-box scoring is prohibited.

---

# Workforce Planning Rules

## ATR-400

Attrition scores may support:

```text
Succession Planning
Vacancy Forecasting
Workforce Planning
Training Planning
Retention Programs
```

---

## ATR-401

Attrition scores may not support:

```text
Termination Decisions
Disciplinary Actions
Compensation Decisions
```

---

# AI Attrition Rules

Requirements:

- spec/11_ai_architecture.md

---

## ATR-500

AI may:

```text
Predict Risk
Identify Trends
Generate Explanations
Recommend Retention Strategies
```

---

## ATR-501

AI may not:

```text
Terminate Employees
Issue Warnings
Trigger Personnel Actions
```

---

## ATR-502

Every AI recommendation must include:

```text
Confidence
Reasoning
Primary Factors
```

---

# Retention Recommendation Rules

## ATR-600

Recommendations may include:

```text
Training Programs
Career Development
Succession Planning
Knowledge Transfer
Retention Planning
```

---

## ATR-601

Recommendations are advisory only.

---

# Monitoring Rules

## ATR-700

Attrition models must be monitored for:

```text
Accuracy
Bias
Drift
Confidence Quality
```

---

## ATR-701

Significant model degradation requires review.

---

# Reporting Rules

Attrition reporting must support:

```text
Department Risk
Position Risk
Agency Risk
Attrition Trends
Retention Opportunities
```

---

# Audit Rules

Required audit events:

```text
Attrition Analysis Generated
Risk Score Viewed
Retention Recommendation Viewed
Model Review Completed
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

Attrition analysis:

```text
< 10 Seconds
```

---

# Failure Rules

If attrition analysis fails:

```text
Log Failure
Create Audit Event
Notify User
```

No partial risk assessment may be published.

---

# Acceptance Criteria

Directive satisfied when:

1. Risk scoring implemented.
2. Explainability implemented.
3. Human oversight enforced.
4. Bias controls enforced.
5. Audit logging active.
6. Workforce planning supported.
7. AI authority restricted.

---

# Next Directive

Next file:

directives/07_compliance_rules.md