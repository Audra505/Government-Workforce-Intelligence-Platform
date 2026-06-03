# Deployment Architecture Specification

Project: AI-Driven Staffing Optimization Platform for Government HR

Version: 1.0

Status: Authoritative Deployment Architecture Specification

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

---

# Purpose

This document defines the deployment architecture for all environments.

It establishes:

- Infrastructure topology
- Docker architecture
- Networking
- Service discovery
- Backup strategy
- Disaster recovery implementation
- Environment strategy
- Production deployment standards

This document is the authoritative deployment reference.

---

# Deployment Philosophy

Principles:

- Simplicity first
- Low operational overhead
- Containerized services
- Infrastructure reproducibility
- Security by default
- Future Kubernetes migration path

---

# Hosting Strategy

Current Provider:

```text
Hetzner Cloud
```

Deployment Model:

```text
Single Server
Docker Compose
```

Future:

```text
Multi-Server
High Availability
Kubernetes
```

---

# Environment Strategy

Environments:

```text
Local
Development
Staging
Production
```

---

## Local

Purpose:

Developer workstation

Deployment:

```text
Docker Compose
```

Characteristics:

- Local PostgreSQL
- Local Redis
- Local MinIO
- Local AI Service

---

## Development

Purpose:

Shared team environment

Characteristics:

- Shared infrastructure
- Non-production data
- Frequent deployments

---

## Staging

Purpose:

Production simulation

Characteristics:

- Production-like configuration
- Release validation
- Security validation

---

## Production

Purpose:

Live customer workloads

Characteristics:

- Controlled access
- Monitored
- Backed up
- Audited

---

# Initial Production Topology

Server:

```text
Hetzner CPX41
```

Recommended Initial Specs:

```text
8 vCPU
16 GB RAM
240 GB SSD
```

---

# Service Topology

```text
┌─────────────────────────┐
│        Internet         │
└────────────┬────────────┘
             │
             ▼

┌─────────────────────────┐
│        Traefik          │
└────────────┬────────────┘
             │

 ┌───────────┼─────────────┐
 ▼           ▼             ▼

Frontend     API      AI Service

             │
             ▼

   ┌─────────┼──────────┐
   ▼         ▼          ▼

PostgreSQL  Redis     MinIO
```

---

# Docker Services

Mandatory Services:

```text
traefik
frontend
api
ai-service
postgres
redis
minio
```

---

# Container Responsibilities

---

## traefik

Purpose:

```text
Reverse Proxy
SSL Termination
Routing
```

Ports:

```text
80
443
```

---

## frontend

Purpose:

```text
React Application
```

Internal Port:

```text
3000
```

---

## api

Purpose:

```text
NestJS Backend
```

Internal Port:

```text
3001
```

---

## ai-service

Purpose:

```text
Forecasting
Matching
Attrition Analysis
```

Internal Port:

```text
8000
```

---

## postgres

Purpose:

```text
Primary Database
```

Internal Port:

```text
5432
```

---

## redis

Purpose:

```text
Cache
Queue
Session Storage
```

Internal Port:

```text
6379
```

---

## minio

Purpose:

```text
Object Storage
```

Internal Port:

```text
9000
```

---

# Docker Network Architecture

Public Network:

```text
frontend
traefik
```

Private Network:

```text
api
ai-service
postgres
redis
minio
```

Rules:

- Database never exposed publicly.
- Redis never exposed publicly.
- MinIO never exposed publicly.

---

# Domain Strategy

Production:

```text
app.company.com
api.company.com
```

Future Tenant Routing:

```text
tenant-a.company.com
tenant-b.company.com
```

---

# SSL Strategy

Provider:

```text
Let's Encrypt
```

Managed By:

```text
Traefik
```

Requirements:

- Automatic renewal
- HTTPS only

---

# Environment Variables

Every service shall use:

```text
.env
```

Files:

```text
.env.local
.env.dev
.env.staging
.env.production
```

---

# Secret Management

Current:

```text
Environment Variables
```

Future:

```text
Docker Secrets
Vault
```

Prohibited:

```text
Secrets in Git
Secrets in Source Code
```

---

# Storage Architecture

---

## PostgreSQL

Persistent Volume:

```text
postgres_data
```

Retention:

```text
Permanent
```

---

## MinIO

Persistent Volume:

```text
minio_data
```

Retention:

```text
Permanent
```

---

## Redis

Persistent Volume:

Optional

Used for cache and transient state.

---

# Backup Strategy

---

## PostgreSQL

Frequency:

```text
Daily
```

Retention:

```text
30 Days
```

---

## MinIO

Frequency:

```text
Daily
```

Retention:

```text
30 Days
```

---

## Configuration

Backed Up:

```text
docker-compose.yml
.env.production
traefik configuration
```

Stored:

```text
Encrypted
```

---

# Disaster Recovery

Requirements:

- NFR-012

---

## Recovery Point Objective

RPO:

```text
24 Hours
```

---

## Recovery Time Objective

RTO:

```text
8 Hours
```

---

## Recovery Process

1. Provision server
2. Restore Docker volumes
3. Restore PostgreSQL
4. Restore MinIO
5. Restore configuration
6. Validate services

---

# Logging Architecture

Application Logs:

```text
Docker Logs
```

Future:

```text
Centralized Logging
```

Retention:

```text
30 Days
```

---

# Monitoring Architecture

Phase 1:

```text
Health Endpoints
Docker Health Checks
```

Future:

```text
Prometheus
Grafana
```

Metrics:

```text
CPU
Memory
Disk
API Latency
Database Health
Queue Health
AI Health
```

---

# Health Check Requirements

Frontend:

```text
/health
```

API:

```text
/health
```

AI Service:

```text
/health
```

Database:

```text
connection validation
```

---

# Deployment Pipeline

Source Control:

```text
GitHub
```

Deployment Flow:

```text
Developer
 → Pull Request
 → Review
 → Merge
 → Deploy
```

---

# Production Deployment Checklist

Before Deployment:

- Tests pass
- Security review complete
- Migrations reviewed
- Backups verified

After Deployment:

- Health checks pass
- Logs reviewed
- Metrics verified

---

# Infrastructure Constraints

Mandatory:

- Docker Compose
- Hetzner Hosting
- Traefik
- PostgreSQL
- Redis
- MinIO

Prohibited:

- Public database access
- Public Redis access
- Public MinIO access

---

# Scalability Roadmap

Phase 1

```text
Single Server
```

Phase 2

```text
Dedicated Database Server
```

Phase 3

```text
Dedicated AI Workers
```

Phase 4

```text
Multi-Server Deployment
```

Phase 5

```text
Kubernetes
```

---

# Deployment Acceptance Criteria

Deployment architecture is approved when:

1. Services containerized.
2. SSL enabled.
3. Database protected.
4. Backups operational.
5. Recovery procedures documented.
6. Health checks operational.
7. Environment separation enforced.
8. Monitoring available.

---

# Next Blueprint Dependency

Next file:

spec/09_frontend_architecture.md

This document will define:

- React architecture
- Feature organization
- State management
- Routing
- Authentication flows
- Component standards
- UI composition
- Dashboard architecture