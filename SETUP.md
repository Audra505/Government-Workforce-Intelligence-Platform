# Developer Setup Guide

Government Workforce Intelligence Platform

This guide covers local development setup on Windows, macOS, and Linux.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20.x LTS | Runtime (pin with `.nvmrc`) |
| npm | 10.x+ | Package manager |
| Docker Desktop | Latest | Local PostgreSQL database |
| Git | Latest | Version control |

Install Node.js via [nvm](https://github.com/nvm-sh/nvm) (macOS/Linux) or [nvm-windows](https://github.com/coreybutler/nvm-windows) (Windows):

```bash
nvm install 20
nvm use 20
```

---

## Quick Start (all platforms)

All onboarding commands use npm scripts — no shell scripts required.

```bash
# 1. Clone and enter the repository
git clone <repository-url>
cd Government-Workforce-Intelligence-Platform

# 2. Install all workspace dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env and fill in any required values (see comments in .env.example)

# 4. Start the development database
npm run db:up

# 5. Verify setup
npm run build    # All workspaces must build cleanly
npm run lint     # All workspaces must lint cleanly
npm run test     # All workspaces must pass
```

---

## Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Variables are documented in `.env.example` with comments indicating which milestone populates each value. For Milestone 1, all database defaults work without modification.

**Security rules:**
- Never commit `.env` to version control
- Never store real secrets in `.env.example`
- Rotate all secrets before production deployment
- See: `environment/03_secrets_management.md`

---

## Database

The development database runs in Docker:

```bash
npm run db:up      # Start PostgreSQL
npm run db:down    # Stop PostgreSQL
npm run db:logs    # View database logs
```

Database connection details (from `.env`):
- Host: `localhost`
- Port: `5432`
- User: `govplatform`
- Password: `devpassword`
- Database: `gov_workforce_dev`

Prisma migrations and schema are added in Milestone 2.

---

## Running Applications

Available from Milestone 3 (Backend Foundation) and Milestone 4 (Frontend Foundation):

```bash
# API (NestJS) — available from Milestone 3
npm run start:dev --workspace=apps/api

# Web (Next.js) — available from Milestone 4
npm run dev --workspace=apps/web
```

---

## Workspace Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install all workspace dependencies |
| `npm run build` | Build all workspaces |
| `npm run lint` | Lint all workspaces |
| `npm run format` | Format all files with Prettier |
| `npm run test` | Run all workspace tests |
| `npm run db:up` | Start the development database |
| `npm run db:down` | Stop the development database |
| `npm run setup` | Full setup: install + database start |

---

## Blueprint Documentation

The blueprint lives alongside application code in the repository root:

```
spec/          Specifications and architecture
directives/    Business rules and behavioral guidance
execution/     Implementation plans (phase-by-phase)
state/         State models and lifecycle documents
tests/         Test specification documents (not executable tests)
```

**Executable tests** live inside each application:
- `apps/api/test/` — NestJS E2E tests
- `apps/api/src/**/*.spec.ts` — NestJS unit tests
- `apps/web/tests/` — Playwright E2E tests (added Milestone 5+)

---

## CI/CD

GitHub Actions runs on every pull request and push to main:
- Install → Lint → Build → Test

See: `.github/workflows/ci.yml`

---

## Troubleshooting

**`npm install` fails with peer dependency errors:**
```bash
npm install --legacy-peer-deps
```

**Database won't start:**
```bash
npm run db:logs      # Check postgres logs
docker ps            # Verify container is running
```

**Port 5432 already in use:**
Set `POSTGRES_PORT=5433` in your `.env` file.

**Node.js version mismatch:**
```bash
nvm use 20           # Use the correct Node.js version
```
