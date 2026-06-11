# =============================================================================
# Stage 1 — Builder
# Installs all dependencies, generates Prisma client, compiles TypeScript
# =============================================================================
FROM node:20-alpine AS builder
WORKDIR /app

# OpenSSL — required by the Prisma schema engine (used during prisma generate and migrate).
# node:20-alpine does not include OpenSSL by default; Prisma native binaries require it.
RUN apk add --no-cache openssl

# Workspace manifests — copied before source to maximise Docker layer cache hits.
# ALL workspaces defined in root package.json ("apps/*", "packages/*") must have
# their package.json present here so npm ci can resolve the full workspace graph.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY packages/config/package.json ./packages/config/

# Root TypeScript config — must exist before npm ci and before compilation.
# apps/api/tsconfig.json contains: "extends": "../../tsconfig.base.json"
# If this file is absent, tsc errors immediately on any type-check step.
COPY tsconfig.base.json ./

RUN npm ci

# Prisma schema — required for prisma generate, which runs as the apps/api prebuild.
# Must be present before the build step.
COPY apps/api/prisma ./apps/api/prisma

# API TypeScript config and source
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src

# Workspace package source — @gov-platform/shared is listed in apps/api dependencies.
# The TypeScript compiler resolves workspace imports from source at compile time
# (packages have no pre-built dist/ — their build script is tsc --noEmit only).
# Copying all packages is safe even if not all are imported.
COPY packages ./packages

# Compile: prebuild (prisma generate) then nest build (webpack -> dist/main.js)
RUN npm run build --workspace=apps/api

# =============================================================================
# Stage 2 — Runner
# Minimal production image: compiled output + production dependencies only
# =============================================================================
FROM node:20-alpine AS runner
WORKDIR /app

# OpenSSL — required by the Prisma schema engine at container startup (prisma migrate deploy).
# Must be present in the runner stage even though the application itself does not use it directly.
RUN apk add --no-cache openssl

ENV NODE_ENV=production

# Workspace manifests — same set as builder stage.
# npm ci uses these to set up workspace symlinks (e.g. node_modules/@gov-platform/shared
# -> packages/shared/) even though only the package.json is present, not the source.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY packages/config/package.json ./packages/config/

# Install production dependencies only — excludes prisma CLI and all devDependencies.
RUN npm ci --omit=dev

# All @prisma/* scoped packages from builder — includes:
#   @prisma/engines   (schema engine binary for prisma migrate deploy)
#   @prisma/debug     (logging utility, transitive dep of engines)
#   @prisma/fetch-engine (transitive dep of engines)
#   @prisma/get-platform (platform detection, transitive dep of engines)
#   @prisma/engines-version (version file, transitive dep of engines)
#   @prisma/client    (overwrites the npm-installed version with builder's generated copy)
# Builder stage uses node:20-alpine — engine binaries are Alpine/musl-compatible.
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Prisma generated client binary — produced by prisma generate in the builder.
# @prisma/client installs the JS interface via npm ci above, but the engine
# binary lives in node_modules/.prisma/client/ and must be copied separately
# because it is generated, not installed, by npm.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Prisma CLI — listed as a devDependency in apps/api/package.json, so it is
# excluded by --omit=dev. Required at container startup for migrate deploy.
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

# Compiled application output from builder
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Prisma schema — required by prisma migrate deploy at runtime.
# The migrate command reads migration files from prisma/migrations/ at this path.
COPY apps/api/prisma ./apps/api/prisma

# Run as non-root — node user ships with node:20-alpine (UID 1000).
# chown is required because Prisma checks write permission on the engines directory
# at startup even when binaries are already present (Risk 5 — materialized during validation).
RUN chown -R node:node /app
USER node

EXPOSE 3001

# Startup sequence:
# 1. prisma migrate deploy — applies any pending migrations idempotently.
#    DATABASE_URL is injected at runtime via docker-compose environment block.
#    --schema path is relative to WORKDIR /app.
# 2. node apps/api/dist/main.js — starts the NestJS application.
#    Port is read from the PORT environment variable (default 3001 via ConfigService).
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy --schema=apps/api/prisma/schema.prisma && node apps/api/dist/main.js"]
