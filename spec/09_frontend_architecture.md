# Frontend Architecture Specification

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative Frontend Architecture Specification

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

---

# Purpose

This document defines the frontend architecture.

It establishes:

- Next.js application structure
- Routing architecture
- Authentication flow
- State management
- Feature boundaries
- UI composition
- Dashboard architecture
- API integration strategy
- Accessibility requirements

This document is authoritative for frontend implementation.

---

# Frontend Technology Stack

Framework:

```text
Next.js
```

Language:

```text
TypeScript
```

Build Tool:

```text
Next.js built-in (Turbopack / Webpack)
```

Routing:

```text
Next.js App Router
```

Forms:

```text
React Hook Form
Zod
```

Data Fetching:

```text
TanStack Query
```

Tables:

```text
TanStack Table
```

Charts:

```text
Recharts
```

UI Components:

```text
ShadCN UI
```

Styling:

```text
Tailwind CSS
```

Icons:

```text
Lucide React
```

---

# Application Structure

```text
apps/web/

src/
├── app/                   # Next.js App Router — route segments
│   ├── (auth)/            # Public auth route group
│   │   └── login/
│   ├── (dashboard)/       # Protected route group
│   │   ├── layout.tsx     # Auth guard, sidebar, nav
│   │   ├── dashboard/
│   │   ├── workforce/
│   │   ├── scheduling/
│   │   ├── recruiting/
│   │   ├── intelligence/
│   │   ├── compliance/
│   │   └── admin/
│   ├── unauthorized/
│   └── not-found.tsx
├── components/            # Shared domain-independent components
├── features/              # Feature-scoped modules
├── hooks/                 # Custom React hooks
├── lib/                   # API client, auth utilities
├── store/                 # Zustand global state
├── types/                 # Frontend-specific TypeScript types
└── utils/                 # Pure utility functions
```

---

# Architecture Principles

## FE-001

Feature-first organization.

---

## FE-002

Business domains drive UI structure.

---

## FE-003

Shared components remain generic.

---

## FE-004

API contracts drive UI behavior.

---

## FE-005

Tenant context never managed manually.

---

# Routing Architecture

---

## Public Routes

```text
/login
/forgot-password
/reset-password
```

Authentication not required.

---

## Protected Routes

```text
/dashboard
/workforce
/scheduling
/recruiting
/intelligence
/compliance
/admin
```

Authentication required.

---

## Route Structure

```text
/dashboard

/workforce
/workforce/positions
/workforce/vacancies
/workforce/employees

/scheduling
/scheduling/calendars
/scheduling/shifts

/recruiting
/recruiting/candidates
/recruiting/applications

/intelligence
/intelligence/forecasts
/intelligence/attrition
/intelligence/recommendations

/compliance
/compliance/audit
/compliance/reports

/admin
/admin/users
/admin/roles
```

---

# Layout Architecture

---

## Public Layout

Used for:

```text
Login
Password Reset
```

Features:

```text
Minimal Navigation
Centered Forms
```

---

## Application Layout

Features:

```text
Sidebar Navigation
Top Navigation
Notifications
User Menu
```

---

# Authentication Flow

Requirements:

- FR-002
- FR-003

---

## Login Flow

```text
User Login
 ↓
API Login
 ↓
JWT Received
 ↓
Store Session
 ↓
Load User Context
 ↓
Redirect Dashboard
```

---

## Session Storage

Current:

```text
Memory + Secure Cookie Strategy
```

Prohibited:

```text
LocalStorage JWT Storage
```

---

## Session Validation

Performed:

```text
Application Startup
Route Change
Token Refresh
```

---

# State Management

---

## Global State

Contains:

```text
Authenticated User
Permissions
UI Preferences
Theme
Notifications
```

Recommended:

```text
Zustand
```

---

## Server State

Managed by:

```text
TanStack Query
```

Examples:

```text
Positions
Vacancies
Employees
Candidates
Forecasts
```

---

# Feature Organization

---

## Identity

Directory:

```text
features/auth
```

Responsibilities:

```text
Login
Logout
User Context
Permissions
```

---

## Workforce

Directory:

```text
features/workforce
```

Pages:

```text
Positions
Vacancies
Employees
```

Requirements:

```text
FR-100 → FR-107
```

---

## Scheduling

Directory:

```text
features/scheduling
```

Pages:

```text
Schedules
Shifts
Assignments
```

Requirements:

```text
FR-200 → FR-205
```

---

## Recruiting

Directory:

```text
features/recruiting
```

Pages:

```text
Candidates
Applications
Interviews
```

Requirements:

```text
FR-300 → FR-306
```

---

## Intelligence

Directory:

```text
features/intelligence
```

Pages:

```text
Forecasts
Attrition
Recommendations
```

Requirements:

```text
FR-400 → FR-405
```

---

## Compliance

Directory:

```text
features/compliance
```

Pages:

```text
Audit Events
Reports
Policies
```

Requirements:

```text
FR-500 → FR-504
```

---

# Component Architecture

---

## Shared Components

Directory:

```text
components/
```

Examples:

```text
DataTable
PageHeader
SearchBar
ConfirmDialog
FormField
LoadingState
ErrorState
```

Must remain domain-independent.

---

## Feature Components

Directory:

```text
features/{feature}/components
```

Examples:

```text
PositionForm
VacancyForm
EmployeeTable
CandidateMatcher
```

---

# Form Standards

Validation:

```text
Zod
```

Forms:

```text
React Hook Form
```

Requirements:

```text
Client Validation
Server Validation
```

---

# Data Table Standards

All tables should support:

```text
Pagination
Sorting
Filtering
Search
Column Visibility
Export
```

Examples:

```text
Positions
Employees
Candidates
Vacancies
Audit Events
```

---

# Dashboard Architecture

---

## Executive Dashboard

Metrics:

```text
Vacancy Rate
Coverage Rate
Attrition Risk
Open Positions
Time To Fill
```

Audience:

```text
Executive Users
HR Directors
```

---

## Workforce Dashboard

Metrics:

```text
Open Vacancies
Forecast Demand
Coverage Analysis
```

Audience:

```text
Workforce Planners
```

---

## Recruiting Dashboard

Metrics:

```text
Applications
Interviews
Offers
Hiring Funnel
```

Audience:

```text
Recruiters
```

---

# API Integration Strategy

Directory:

```text
services/api
```

Structure:

```text
auth.service.ts
user.service.ts
position.service.ts
vacancy.service.ts
employee.service.ts
candidate.service.ts
forecast.service.ts
audit.service.ts
```

---

## API Client

Single shared client:

```text
fetch (native) or axios
```

Responsibilities:

```text
JWT Injection
Error Handling
Retry Logic
```

---

# Error Handling

Global Handling:

```text
401
403
404
500
```

Behavior:

```text
Toast Notification
Error Page
Retry Options
```

---

# Accessibility Requirements

Requirements:

- NFR-014

Target:

```text
WCAG 2.1 AA
```

Mandatory:

```text
Keyboard Navigation
Screen Reader Labels
Accessible Forms
Accessible Tables
```

---

# Responsive Design

Supported:

```text
Desktop
Tablet
```

Initial Mobile Support:

```text
Basic
```

Primary Use Case:

```text
Desktop Workforce Operations
```

---

# UI Theme Strategy

Phase 1:

```text
Light Theme
```

Phase 2:

```text
Dark Theme
```

---

# Frontend Security

Requirements:

- spec/07_security_architecture.md

Mandatory:

```text
Route Protection
Permission Validation
Input Validation
Output Encoding
```

Prohibited:

```text
JWT in Local Storage
Tenant ID Manipulation
Client-Side Authorization Decisions
```

---

# Frontend Testing Strategy

Unit Tests:

```text
Vitest
```

Component Tests:

```text
React Testing Library
```

E2E Tests:

```text
Playwright
```

---

# Frontend Acceptance Criteria

Architecture is approved when:

1. Routing implemented.
2. Authentication enforced.
3. Feature boundaries respected.
4. Shared component library established.
5. API integrations standardized.
6. Accessibility requirements met.
7. Responsive design functional.
8. Testing strategy implemented.

---

# Next Blueprint Dependency

Next file:

spec/10_backend_architecture.md

This document will define:

- NestJS module architecture
- Service boundaries
- Controller organization
- DTO strategy
- Validation architecture
- Event architecture
- Background processing strategy
- Integration strategy
- API implementation patterns