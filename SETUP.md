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

## Full-Stack Docker Runtime Verification

The full platform stack (postgres + api + web) runs in Docker. This section covers how to start the stack, verify it is serving current code, and rebuild only what changed.

### Starting the full stack

```bash
npm run stack:up
```

This is the canonical command. It passes `--env-file .env` automatically, which is required because the API reads `JWT_SECRET` from the environment — without it the app starts but all authentication fails silently.

**`db:up` vs `stack:up`:**
- `npm run db:up` starts postgres only. It does not need `--env-file .env` (postgres uses hardcoded defaults).
- `npm run stack:up` starts all three services. It requires `.env` to be present and populated.
- Never omit `--env-file .env` when running raw `docker compose` commands that include the api or web service.

### Service names and ports

| Service | Container name | Host port |
|---------|---------------|-----------|
| Next.js frontend | `gov_workforce_web` | 3000 |
| NestJS API | `gov_workforce_api` | 3001 |
| PostgreSQL | `gov_workforce_postgres` | 5433 |

### Identifying what is serving localhost:3000

Before assuming a source defect, confirm what is actually serving the frontend:

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

If `gov_workforce_web` appears with `0.0.0.0:3000->3000/tcp` and status `(healthy)`, Docker is serving the frontend. If it is absent or unhealthy, something else may own port 3000, or the container has not started.

Always run `docker ps` before debugging visible UI behaviour. A stale container is more likely than a source defect.

### Rebuild decision tree

Identify what changed before deciding whether to rebuild:

```bash
git diff --stat HEAD~1   # or: git diff --stat @{u}..
```

| What changed | Action |
|---|---|
| `apps/web/**` only (React components, Next.js pages, BFF routes under `apps/web/`) | Rebuild web only |
| `apps/api/src/**` only (NestJS controllers, services, modules, guards) | Rebuild API only |
| `apps/api/prisma/**` (schema or migrations) | Rebuild API — migrations run automatically on startup |
| `package.json` or `package-lock.json` | Rebuild both web and API (`npm ci` reruns in both images) |
| `infrastructure/docker/docker-compose.yml` | Stop all, recreate stack with `npm run db:down && npm run stack:up` |
| `docs/`, `governance/`, `directives/`, `PROGRESS.md`, `CLAUDE.md` only | No rebuild — runtime is not affected by documentation changes |
| Unsure or mixed | Check `git diff --stat` by directory prefix; when in doubt, rebuild only the service whose source directory changed |

### Rebuilding the web service only

```bash
docker compose -f infrastructure/docker/docker-compose.yml --env-file .env build web
docker stop gov_workforce_web
docker rm gov_workforce_web
docker compose -f infrastructure/docker/docker-compose.yml --env-file .env up -d web
```

Wait for the container to become healthy (`docker ps` shows `(healthy)`) before loading routes.

### Rebuilding the API service only

```bash
docker compose -f infrastructure/docker/docker-compose.yml --env-file .env build api
docker stop gov_workforce_api
docker rm gov_workforce_api
docker compose -f infrastructure/docker/docker-compose.yml --env-file .env up -d api
```

Prisma migrations run automatically at container startup — no manual migration step is needed after an API rebuild.

### Stale frontend symptoms

If UI changes (new fields, updated navigation, modified layouts) are not visible after editing source files:

1. Run `docker ps` — confirm `gov_workforce_web` is running and healthy.
2. Compare the running image to the latest build:
   ```bash
   docker inspect gov_workforce_web --format '{{.Image}}'
   docker images
   ```
   If the image creation timestamp is older than your last source edit, the container is stale.
3. Rebuild and recreate the web service only (see above). API rebuild is not required for frontend source changes.

### Next.js production cold-start behaviour

The web container runs a Next.js standalone production build — not a dev server. After the container starts or restarts, the first request to each route triggers route compilation and can take 15–25 seconds. Subsequent requests to the same route resolve quickly.

**This is expected behaviour, not a failure.**

After a web rebuild:
1. Confirm the container is healthy (`docker ps`).
2. Load each main route once and wait for it to complete before assuming something is wrong.
3. A second request to the same route should resolve promptly. If it does not, check `docker logs gov_workforce_web`.

Do not rebuild the container in response to a slow first request.

### Slow runtime triage

If the stack appears slow or unresponsive:

1. `docker ps` — confirm all three containers are running and healthy.
2. `docker logs gov_workforce_web` — look for application errors, not cold-start compilation output.
3. `docker logs gov_workforce_api` — look for API errors or migration failures.
4. Reload the page a second time before concluding that the container has a problem.

Only rebuild if logs show errors or the container is unhealthy. Rebuilding repeatedly without evidence makes triage harder.

### Anti-patterns to avoid

- Do not rebuild both services when only one changed.
- Do not debug frontend source code until you have confirmed that the running container is serving a current image.
- Do not treat a slow first page load after a web rebuild as proof of failure — warm the route first.
- Do not run raw `docker compose` commands that include api or web without `--env-file .env`.
- Do not use `npm run db:down` as the default teardown if only the web or API service needs a restart — it stops all containers including postgres.

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
