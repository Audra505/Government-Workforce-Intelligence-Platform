#!/usr/bin/env bash
# CI/CD setup script — for GitHub Actions (Linux) use only.
# For local development on any OS, use npm scripts instead:
#   npm install && npm run db:up
# References: SETUP.md — Developer Onboarding Guide
set -euo pipefail

echo "[setup] Installing dependencies..."
npm ci

echo "[setup] Starting database..."
docker compose -f infrastructure/docker/docker-compose.yml up -d postgres

echo "[setup] Waiting for postgres to be healthy..."
for i in {1..30}; do
  if docker compose -f infrastructure/docker/docker-compose.yml exec -T postgres pg_isready -U "${POSTGRES_USER:-govplatform}" > /dev/null 2>&1; then
    echo "[setup] Postgres is ready."
    break
  fi
  echo "[setup] Waiting... ($i/30)"
  sleep 2
done

echo "[setup] Setup complete."
