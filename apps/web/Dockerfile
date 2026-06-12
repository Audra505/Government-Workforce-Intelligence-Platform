# =============================================================================
# Stage 1 — Builder
# Installs all dependencies and builds the Next.js standalone output
# =============================================================================
FROM node:20-alpine AS builder
WORKDIR /app

# Disable Next.js telemetry at build time — prevents outbound network calls
# during next build inside Docker where network access may be restricted.
ENV NEXT_TELEMETRY_DISABLED=1

# Workspace manifests — copied before source for layer cache efficiency.
# ALL workspaces defined in root package.json ("apps/*", "packages/*") must
# have their package.json present for npm ci to resolve the full workspace graph.
# apps/api/package.json is required even though this image builds only apps/web.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/
COPY packages/config/package.json ./packages/config/

# Root TypeScript config — apps/web/tsconfig.json extends ../../tsconfig.base.json.
# Must be present before npm ci and before compilation.
COPY tsconfig.base.json ./

RUN npm ci

# Next.js config — includes output: 'standalone' added in Step 3.
COPY apps/web/next.config.mjs ./apps/web/

# Web TypeScript config and source
COPY apps/web/tsconfig.json ./apps/web/
COPY apps/web/postcss.config.js  ./apps/web/
COPY apps/web/tailwind.config.ts ./apps/web/
COPY apps/web/src ./apps/web/src

# Workspace package source — packages/shared and packages/ui are listed in
# transpilePackages in next.config.mjs and may be imported by web source.
# The Next.js webpack bundler traces and inlines only what is actually imported.
# Copying all packages is safe even if not all are used.
COPY packages ./packages

# Build: next build → .next/standalone/ + .next/static/
RUN npm run build --workspace=apps/web

# =============================================================================
# Stage 2 — Runner
# Minimal production image: standalone output only — no npm ci required
# =============================================================================
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy the standalone output — self-contained Next.js server bundle.
# The standalone root (apps/web/.next/standalone/) is copied to WORKDIR /app.
# After this COPY the directory layout inside /app is:
#   apps/web/server.js    — Next.js production server entry point
#   node_modules/         — minimal traced runtime dependencies; no npm ci needed
#   package.json
COPY --from=builder /app/apps/web/.next/standalone ./

# Copy static assets — CSS/JS chunks are NOT included in the standalone output.
# The standalone server.js resolves .next/static/ relative to its own location.
# server.js is at /app/apps/web/server.js, so static must be at
# /app/apps/web/.next/static/.
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static

# NOTE: apps/web/public/ is not copied — the directory does not exist in this
# repository (confirmed in Step 3 pre-implementation verification, June 2026).

# node user ships with node:20-alpine (UID 1000).
# chown is not applied: the Next.js standalone server for a static page does not
# write to disk at runtime. Default COPY permissions (644/755, root-owned) provide
# sufficient read access for the node user.
USER node

EXPOSE 3000

# Start the standalone Next.js server.
# Verified standalone path: apps/web/.next/standalone/apps/web/server.js (Step 3).
# After COPY --from=builder /app/apps/web/.next/standalone ./, this file is
# at /app/apps/web/server.js. The monorepo path is mirrored inside the standalone
# root — confirmed empirically during Step 3 build validation.
# PORT defaults to 3000 and can be overridden via environment variable.
CMD ["node", "apps/web/server.js"]
