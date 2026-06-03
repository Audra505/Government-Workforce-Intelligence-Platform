# Database Schema Specification

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative Database Schema Specification

References:

- meta/00_project_classification.md
- meta/01_assumptions_and_decisions.md
- meta/02_glossary.md
- meta/03_traceability_matrix.md
- spec/01_requirements.md
- spec/02_non_functional_requirements.md
- spec/03_system_architecture.md
- spec/04_domain_model.md

---

# Purpose

This document defines the authoritative PostgreSQL schema architecture for the platform.

It establishes:

- Schemas
- Tables
- Relationships
- Constraints
- Indexing strategy
- Tenant isolation strategy
- Audit strategy
- Soft delete strategy

This document is the authoritative source for future database migrations.

---

# Database Overview

Database Engine:

```text
PostgreSQL
```

Deployment:

```text
Docker Container
```

Primary Design Principles:

- Tenant isolation
- Referential integrity
- Auditability
- Scalability
- Compliance support

---

# PostgreSQL Schemas

```text
identity
organization
workforce
scheduling
recruiting
intelligence
compliance
integration
audit
```

---

# Tenant Strategy

All tenant-owned tables shall include:

```sql
tenant_id UUID NOT NULL
```

Mandatory.

---

# Shared Columns

Most tables shall contain:

```sql
id UUID PRIMARY KEY

created_at TIMESTAMPTZ NOT NULL

updated_at TIMESTAMPTZ NOT NULL

deleted_at TIMESTAMPTZ NULL
```

---

# Soft Delete Strategy

Records shall not be physically removed.

Instead:

```sql
deleted_at TIMESTAMPTZ NULL
```

Rules:

```text
NULL      = Active
NOT NULL  = Deleted
```

---

# Schema: identity

---

## users

```sql
CREATE TABLE identity.users (

    id UUID PRIMARY KEY,

    tenant_id UUID NOT NULL,

    email VARCHAR(255) NOT NULL,

    password_hash TEXT NOT NULL,

    first_name VARCHAR(100) NOT NULL,

    last_name VARCHAR(100) NOT NULL,

    status VARCHAR(50) NOT NULL,

    last_login_at TIMESTAMPTZ NULL,

    created_at TIMESTAMPTZ NOT NULL,

    updated_at TIMESTAMPTZ NOT NULL,

    deleted_at TIMESTAMPTZ NULL
);
```

Indexes:

```sql
CREATE UNIQUE INDEX idx_users_tenant_email
ON identity.users(tenant_id, email);

CREATE INDEX idx_users_tenant
ON identity.users(tenant_id);
```

---

## roles

```sql
CREATE TABLE identity.roles (

    id UUID PRIMARY KEY,

    name VARCHAR(100) NOT NULL,

    description TEXT,

    created_at TIMESTAMPTZ NOT NULL
);
```

---

## user_roles

```sql
CREATE TABLE identity.user_roles (

    user_id UUID NOT NULL,

    role_id UUID NOT NULL,

    PRIMARY KEY(user_id, role_id)
);
```

---

# Schema: organization

---

## agencies

```sql
CREATE TABLE organization.agencies (

    id UUID PRIMARY KEY,

    tenant_code VARCHAR(100) UNIQUE,

    name VARCHAR(255) NOT NULL,

    status VARCHAR(50) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL,

    updated_at TIMESTAMPTZ NOT NULL
);
```

---

## departments

```sql
CREATE TABLE organization.departments (

    id UUID PRIMARY KEY,

    tenant_id UUID NOT NULL,

    agency_id UUID NOT NULL,

    name VARCHAR(255) NOT NULL,

    description TEXT,

    status VARCHAR(50),

    created_at TIMESTAMPTZ NOT NULL,

    updated_at TIMESTAMPTZ NOT NULL
);
```

Indexes:

```sql
CREATE INDEX idx_departments_tenant
ON organization.departments(tenant_id);
```

---

# Schema: workforce

---

## positions

```sql
CREATE TABLE workforce.positions (

    id UUID PRIMARY KEY,

    tenant_id UUID NOT NULL,

    department_id UUID NOT NULL,

    title VARCHAR(255) NOT NULL,

    classification VARCHAR(100),

    salary_band VARCHAR(100),

    status VARCHAR(50),

    created_at TIMESTAMPTZ NOT NULL,

    updated_at TIMESTAMPTZ NOT NULL,

    deleted_at TIMESTAMPTZ NULL
);
```

Indexes:

```sql
CREATE INDEX idx_positions_tenant
ON workforce.positions(tenant_id);

CREATE INDEX idx_positions_department
ON workforce.positions(department_id);
```

---

## vacancies

```sql
CREATE TABLE workforce.vacancies (

    id UUID PRIMARY KEY,

    tenant_id UUID NOT NULL,

    position_id UUID NOT NULL,

    priority VARCHAR(50),

    reason VARCHAR(100),

    status VARCHAR(50),

    expected_fill_date DATE,

    created_at TIMESTAMPTZ NOT NULL,

    updated_at TIMESTAMPTZ NOT NULL
);
```

Indexes:

```sql
CREATE INDEX idx_vacancies_position
ON workforce.vacancies(position_id);

CREATE INDEX idx_vacancies_status
ON workforce.vacancies(status);
```

---

## skills

```sql
CREATE TABLE workforce.skills (

    id UUID PRIMARY KEY,

    name VARCHAR(255) NOT NULL,

    category VARCHAR(100),

    description TEXT
);
```

---

## certifications

```sql
CREATE TABLE workforce.certifications (

    id UUID PRIMARY KEY,

    name VARCHAR(255) NOT NULL,

    issuer VARCHAR(255),

    expiration_required BOOLEAN DEFAULT FALSE
);
```

---

## employees

```sql
CREATE TABLE workforce.employees (

    id UUID PRIMARY KEY,

    tenant_id UUID NOT NULL,

    department_id UUID NOT NULL,

    employee_number VARCHAR(100),

    first_name VARCHAR(100) NOT NULL,

    last_name VARCHAR(100) NOT NULL,

    email VARCHAR(255),

    employment_status VARCHAR(50),

    hire_date DATE,

    termination_date DATE,

    created_at TIMESTAMPTZ NOT NULL,

    updated_at TIMESTAMPTZ NOT NULL,

    deleted_at TIMESTAMPTZ NULL
);
```

Indexes:

```sql
CREATE UNIQUE INDEX idx_employee_number_tenant
ON workforce.employees(tenant_id, employee_number);

CREATE INDEX idx_employees_tenant
ON workforce.employees(tenant_id);

CREATE INDEX idx_employees_department
ON workforce.employees(department_id);

CREATE INDEX idx_employees_status
ON workforce.employees(employment_status);
```

---

## employee_skills

```sql
CREATE TABLE workforce.employee_skills (

    employee_id UUID NOT NULL,

    skill_id UUID NOT NULL,

    proficiency_level VARCHAR(50),

    verified_at TIMESTAMPTZ,

    PRIMARY KEY(employee_id, skill_id)
);
```

---

## employee_certifications

```sql
CREATE TABLE workforce.employee_certifications (

    employee_id UUID NOT NULL,

    certification_id UUID NOT NULL,

    issue_date DATE,

    expiration_date DATE,

    status VARCHAR(50),

    PRIMARY KEY(employee_id, certification_id)
);
```

---

# Schema: scheduling

---

## schedules

```sql
CREATE TABLE scheduling.schedules (

    id UUID PRIMARY KEY,

    tenant_id UUID NOT NULL,

    department_id UUID NOT NULL,

    start_date DATE NOT NULL,

    end_date DATE NOT NULL,

    status VARCHAR(50),

    created_at TIMESTAMPTZ NOT NULL,

    updated_at TIMESTAMPTZ NOT NULL
);
```

---

## shifts

```sql
CREATE TABLE scheduling.shifts (

    id UUID PRIMARY KEY,

    schedule_id UUID NOT NULL,

    start_time TIMESTAMPTZ NOT NULL,

    end_time TIMESTAMPTZ NOT NULL,

    required_headcount INTEGER NOT NULL
);
```

---

## assignments

```sql
CREATE TABLE scheduling.assignments (

    id UUID PRIMARY KEY,

    shift_id UUID NOT NULL,

    employee_id UUID NOT NULL,

    status VARCHAR(50),

    assigned_at TIMESTAMPTZ
);
```

---

# Schema: recruiting

---

## candidates

```sql
CREATE TABLE recruiting.candidates (

    id UUID PRIMARY KEY,

    tenant_id UUID NOT NULL,

    first_name VARCHAR(100),

    last_name VARCHAR(100),

    email VARCHAR(255),

    phone VARCHAR(100),

    status VARCHAR(50),

    created_at TIMESTAMPTZ NOT NULL,

    updated_at TIMESTAMPTZ NOT NULL
);
```

Indexes:

```sql
CREATE INDEX idx_candidates_tenant
ON recruiting.candidates(tenant_id);
```

---

## resumes

```sql
CREATE TABLE recruiting.resumes (

    id UUID PRIMARY KEY,

    candidate_id UUID NOT NULL,

    object_key VARCHAR(500) NOT NULL,

    parsed_status VARCHAR(50),

    uploaded_at TIMESTAMPTZ NOT NULL
);
```

---

## applications

```sql
CREATE TABLE recruiting.applications (

    id UUID PRIMARY KEY,

    candidate_id UUID NOT NULL,

    vacancy_id UUID NOT NULL,

    status VARCHAR(50),

    applied_at TIMESTAMPTZ NOT NULL
);
```

---

## interviews

```sql
CREATE TABLE recruiting.interviews (

    id UUID PRIMARY KEY,

    application_id UUID NOT NULL,

    scheduled_at TIMESTAMPTZ,

    interviewer VARCHAR(255),

    status VARCHAR(50),

    feedback TEXT
);
```

---

# Schema: intelligence

---

## forecasts

```sql
CREATE TABLE intelligence.forecasts (

    id UUID PRIMARY KEY,

    tenant_id UUID NOT NULL,

    forecast_type VARCHAR(100),

    forecast_period VARCHAR(100),

    confidence_score NUMERIC(5,2),

    generated_at TIMESTAMPTZ NOT NULL
);
```

---

## vacancy_risks

```sql
CREATE TABLE intelligence.vacancy_risks (

    id UUID PRIMARY KEY,

    vacancy_id UUID NOT NULL,

    risk_score NUMERIC(5,2),

    risk_level VARCHAR(50),

    generated_at TIMESTAMPTZ NOT NULL
);
```

---

## attrition_predictions

```sql
CREATE TABLE intelligence.attrition_predictions (

    id UUID PRIMARY KEY,

    employee_id UUID NOT NULL,

    risk_score NUMERIC(5,2),

    risk_level VARCHAR(50),

    generated_at TIMESTAMPTZ NOT NULL
);
```

---

## recommendations

```sql
CREATE TABLE intelligence.recommendations (

    id UUID PRIMARY KEY,

    forecast_id UUID,

    recommendation_type VARCHAR(100),

    summary TEXT,

    explanation TEXT,

    created_at TIMESTAMPTZ NOT NULL
);
```

---

# Schema: compliance

---

## policies

```sql
CREATE TABLE compliance.policies (

    id UUID PRIMARY KEY,

    name VARCHAR(255),

    description TEXT,

    status VARCHAR(50),

    created_at TIMESTAMPTZ NOT NULL
);
```

---

## compliance_reports

```sql
CREATE TABLE compliance.compliance_reports (

    id UUID PRIMARY KEY,

    tenant_id UUID NOT NULL,

    report_type VARCHAR(100),

    generated_by UUID,

    generated_at TIMESTAMPTZ NOT NULL
);
```

---

# Schema: audit

---

## audit_events

```sql
CREATE TABLE audit.audit_events (

    id UUID PRIMARY KEY,

    tenant_id UUID NOT NULL,

    user_id UUID NOT NULL,

    entity_type VARCHAR(100),

    entity_id UUID,

    action VARCHAR(100),

    metadata JSONB,

    created_at TIMESTAMPTZ NOT NULL
);
```

Indexes:

```sql
CREATE INDEX idx_audit_tenant
ON audit.audit_events(tenant_id);

CREATE INDEX idx_audit_user
ON audit.audit_events(user_id);

CREATE INDEX idx_audit_created
ON audit.audit_events(created_at);
```

---

# Foreign Key Strategy

Examples:

```sql
ALTER TABLE workforce.positions
ADD CONSTRAINT fk_positions_department
FOREIGN KEY (department_id)
REFERENCES organization.departments(id);
```

---

```sql
ALTER TABLE workforce.vacancies
ADD CONSTRAINT fk_vacancy_position
FOREIGN KEY (position_id)
REFERENCES workforce.positions(id);
```

---

```sql
ALTER TABLE recruiting.applications
ADD CONSTRAINT fk_application_candidate
FOREIGN KEY (candidate_id)
REFERENCES recruiting.candidates(id);
```

```sql
ALTER TABLE workforce.employees
ADD CONSTRAINT fk_employee_department
FOREIGN KEY (department_id)
REFERENCES organization.departments(id);
```

```sql
ALTER TABLE workforce.employee_skills
ADD CONSTRAINT fk_employee_skill_employee
FOREIGN KEY (employee_id)
REFERENCES workforce.employees(id);
```

```sql
ALTER TABLE workforce.employee_skills
ADD CONSTRAINT fk_employee_skill_skill
FOREIGN KEY (skill_id)
REFERENCES workforce.skills(id);
```

```sql
ALTER TABLE workforce.employee_certifications
ADD CONSTRAINT fk_employee_cert_employee
FOREIGN KEY (employee_id)
REFERENCES workforce.employees(id);
```

```sql
ALTER TABLE workforce.employee_certifications
ADD CONSTRAINT fk_employee_cert_certification
FOREIGN KEY (certification_id)
REFERENCES workforce.certifications(id);
```

```sql
ALTER TABLE scheduling.assignments
ADD CONSTRAINT fk_assignment_employee
FOREIGN KEY (employee_id)
REFERENCES workforce.employees(id);
```

```sql
ALTER TABLE scheduling.assignments
ADD CONSTRAINT fk_assignment_shift
FOREIGN KEY (shift_id)
REFERENCES scheduling.shifts(id);
```

---

# JSONB Usage

Allowed:

```text
Audit metadata
AI explanations
External integration payloads
```

Avoid storing core business entities in JSON.

---

# Indexing Strategy

Mandatory Indexes:

```text
tenant_id
status
created_at
foreign keys
```

Additional indexes added after performance analysis.

---

# Partitioning Strategy

Future:

```text
audit.audit_events
intelligence.forecasts
```

may be partitioned by:

```text
tenant_id
date
```

when scale requires.

---

# Backup Requirements

Daily:

```text
PostgreSQL Backup
```

Retention:

```text
30 Days
```

Monthly snapshots:

```text
12 Months
```

---

# Database Constraints

Mandatory:

- Primary keys
- Foreign keys
- Unique constraints
- Tenant isolation
- Auditability

Prohibited:

- Cross-tenant joins without validation
- Hard deletes of business records

---

# Next Blueprint Dependency

Next file:

spec/06_api_contracts.md

This document will define:

- REST endpoints
- Request contracts
- Response contracts
- Error standards
- Authentication flows
- Authorization boundaries
- API versioning strategy