# Skill Matching Rules

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative Skill Matching Directive

References:

- spec/01_requirements.md
- spec/04_domain_model.md
- spec/05_database_schema.md
- spec/06_api_contracts.md
- spec/11_ai_architecture.md

---

# Purpose

This directive defines the business rules governing skill matching.

These rules control:

- Candidate matching
- Employee matching
- Certification validation
- Skill gap analysis
- Match scoring
- AI-assisted recommendations

These rules are mandatory for all implementations.

---

# Matching Principles

## SKM-001

Matching assists decision-making.

---

## SKM-002

Matching results are advisory.

---

## SKM-003

Human review is required.

---

## SKM-004

Matching must be explainable.

---

## SKM-005

Matching must be auditable.

---

# Matching Types

Supported:

```text
Candidate → Position
Employee → Position
Employee → Shift
Employee → Vacancy
```

---

# Match Inputs

Position Inputs:

```text
Required Skills
Required Certifications
Required Experience
Education Requirements
```

---

Candidate Inputs:

```text
Skills
Certifications
Experience
Education
Resume Data
```

---

Employee Inputs:

```text
Skills
Certifications
Training History
Employment History
```

---

# Matching Rules

## SKM-100

Every match must produce:

```text
Score
Confidence
Explanation
Timestamp
```

---

## SKM-101

Match scores range:

```text
0 - 100
```

---

## SKM-102

Higher score indicates stronger alignment.

---

# Match Categories

## SKM-200

Score Classification:

| Score | Classification |
|---------|---------|
| 0-39 | Poor Match |
| 40-59 | Weak Match |
| 60-79 | Good Match |
| 80-100 | Strong Match |

---

# Certification Rules

## SKM-300

Required certifications receive highest weighting.

---

## SKM-301

Missing mandatory certifications reduce score.

---

## SKM-302

Expired certifications treated as missing.

---

# Skill Rules

## SKM-400

Required skills weighted higher than optional skills.

---

## SKM-401

Skill recency may increase weighting.

---

## SKM-402

Verified skills weighted higher than self-declared skills.

---

# Experience Rules

## SKM-500

Relevant experience contributes positively.

---

## SKM-501

Experience weighting may vary by position type.

---

## SKM-502

Recent experience weighted higher than outdated experience.

---

# Education Rules

## SKM-600

Education contributes to score when specified.

---

## SKM-601

Education may not override missing mandatory certifications.

---

# AI Matching Rules

Requirements:

- spec/11_ai_architecture.md

---

## SKM-700

AI may:

```text
Score Matches
Generate Explanations
Recommend Candidates
Identify Skill Gaps
```

---

## SKM-701

AI may not:

```text
Hire Candidates
Reject Candidates
Create Employees
Approve Recruitment Actions
```

---

## SKM-702

Every AI-generated recommendation must include:

```text
Confidence
Reasoning
Primary Factors
```

---

# Skill Gap Analysis

## SKM-800

Gap analysis identifies:

```text
Missing Skills
Missing Certifications
Missing Experience
Training Opportunities
```

---

## SKM-801

Gap analysis must support workforce planning.

---

## SKM-802

Gap analysis may generate training recommendations.

---

# Review Rules

## SKM-900

Match results require human review.

---

## SKM-901

Recruiters may override recommendations.

---

## SKM-902

Overrides must generate audit events.

---

# Reporting Rules

Matching reports must support:

```text
Average Match Score
Candidate Match Distribution
Skill Gap Trends
Certification Gap Trends
```

---

# Audit Rules

Required audit events:

```text
Match Generated
Recommendation Viewed
Recommendation Overridden
Gap Analysis Generated
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

Match generation:

```text
< 5 Seconds
```

---

Gap analysis:

```text
< 10 Seconds
```

---

# Failure Rules

If matching fails:

```text
Log Failure
Create Audit Event
Notify User
```

No partial recommendation may be published.

---

# Acceptance Criteria

Directive satisfied when:

1. Match scoring implemented.
2. Explainability implemented.
3. Human review enforced.
4. Certification validation enforced.
5. Gap analysis supported.
6. Audit logging active.
7. AI authority restricted.

---

# Next Directive

Next file:

directives/06_attrition_scoring_rules.md