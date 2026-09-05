-- M37: Elevation Sessions Foundation — identity.elevation_sessions and
-- identity.elevation_session_capabilities
-- Governance authority: governance/GD-M37-1.md
-- Depends on: identity.users (actor references, no FK), identity.permissions
--             (elevation_session_capabilities.permission_id FK)
--
-- Internal-service-only foundation. No HTTP surface, no runtime authorization
-- effect (GD-M37-1 Decision 4, Decision 17). This migration creates data
-- structures only — it grants no access by itself.

-- -------------------------------------------------------------------------
-- Step 1: Create lifecycle/decision enums
-- These are the FIRST native Postgres enums in this schema (every other
-- "status"-like column elsewhere uses VARCHAR(50) governed at the service
-- layer). GD-M37-1 Decision 5 explicitly authorizes this departure for
-- elevation lifecycle/decision states.
-- -------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "identity"."ElevationSessionStatus" AS ENUM (
    'REQUESTED',
    'APPROVED',
    'DENIED',
    'CANCELLED',
    'ACTIVE',
    'EXPIRED',
    'REVOKED',
    'ACTIVATION_FAILED'
);

-- CreateEnum
CREATE TYPE "identity"."ElevationCapabilityDecision" AS ENUM (
    'PENDING',
    'GRANTED',
    'DENIED'
);

-- -------------------------------------------------------------------------
-- Step 2: Create identity.elevation_sessions
-- Column set per GD-M37-1 Decision 8.
-- requested_by_user_id / grantee_user_id / approved_by_user_id /
--   revoked_by_user_id carry NO FK to identity.users (GD-M37-1 Decision 15,
--   mirroring the audit.audit_events precedent: "tenantId/userId are plain
--   UUID columns with no Prisma relations — cascading deletes must never
--   affect audit records"). No ON DELETE CASCADE is possible here because no
--   FK exists at all on these columns.
-- tenant_id carries no FK to organization.tenants (bare-scalar convention —
--   isolation enforced at query level, SEC-003 — matching the dominant
--   pattern used by positions/vacancies/employees/candidates/applications/
--   interviews/offers/skills/certifications).
-- expires_at is nullable at the column level only because it is unset before
--   activation; the service layer enforces it is mandatory once ACTIVE and
--   never indefinite (GD-M37-1 Decision 8 / Decision 11).
-- step_up_auth_method / step_up_verified_at must remain NULL throughout M37
--   (GD-M37-1 Decision 16) — no genuine step-up mechanism exists yet.
-- updated_at has no DB DEFAULT — set by Prisma client (consistent with the
--   existing recruiting-schema table pattern, e.g. M18B offers).
-- -------------------------------------------------------------------------
CREATE TABLE "identity"."elevation_sessions" (
    "id"                     UUID                              NOT NULL,
    "tenant_id"              UUID                              NOT NULL,
    "requested_by_user_id"   UUID                              NOT NULL,
    "grantee_user_id"        UUID                              NOT NULL,
    "approved_by_user_id"    UUID,
    "revoked_by_user_id"     UUID,
    "status"                 "identity"."ElevationSessionStatus" NOT NULL DEFAULT 'REQUESTED',
    "purpose"                TEXT                              NOT NULL,
    "requested_at"           TIMESTAMPTZ(6)                    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at"             TIMESTAMPTZ(6),
    "activated_at"           TIMESTAMPTZ(6),
    "expires_at"             TIMESTAMPTZ(6),
    "revoked_at"             TIMESTAMPTZ(6),
    "revoked_reason"         TEXT,
    "denial_reason"          TEXT,
    "step_up_auth_method"    VARCHAR(50),
    "step_up_verified_at"    TIMESTAMPTZ(6),
    "correlation_id"         UUID,
    "idempotency_key"        VARCHAR(255)                      NOT NULL,
    "created_at"             TIMESTAMPTZ(6)                    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMPTZ(6)                    NOT NULL,

    CONSTRAINT "elevation_sessions_pkey" PRIMARY KEY ("id")
);

-- -------------------------------------------------------------------------
-- Step 3: Create identity.elevation_session_capabilities
-- One row per requested capability item, created only at request-submission
-- time (GD-M37-1 Decision 8). permission_id is a real FK into
-- identity.permissions — referential integrity against the live M36 catalog,
-- never an uncontrolled string.
-- -------------------------------------------------------------------------
CREATE TABLE "identity"."elevation_session_capabilities" (
    "id"                     UUID                                     NOT NULL,
    "elevation_session_id"   UUID                                     NOT NULL,
    "permission_id"          UUID                                     NOT NULL,
    "decision"               "identity"."ElevationCapabilityDecision" NOT NULL DEFAULT 'PENDING',
    "created_at"             TIMESTAMPTZ(6)                           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMPTZ(6)                           NOT NULL,

    CONSTRAINT "elevation_session_capabilities_pkey" PRIMARY KEY ("id")
);

-- -------------------------------------------------------------------------
-- Step 4: FK constraints
-- No ON DELETE clause on either FK — orphan prevention handled at service
-- layer (consistent with the existing migration pattern, e.g. M18B offers).
-- -------------------------------------------------------------------------
ALTER TABLE "identity"."elevation_session_capabilities"
    ADD CONSTRAINT "fk_elevation_session_capability_session"
    FOREIGN KEY ("elevation_session_id")
    REFERENCES "identity"."elevation_sessions"("id");

ALTER TABLE "identity"."elevation_session_capabilities"
    ADD CONSTRAINT "fk_elevation_session_capability_permission"
    FOREIGN KEY ("permission_id")
    REFERENCES "identity"."permissions"("id");

-- -------------------------------------------------------------------------
-- Step 5: Standard tenant/grantee/status lookup indexes
-- -------------------------------------------------------------------------
CREATE INDEX "idx_elevation_sessions_tenant_grantee"
    ON "identity"."elevation_sessions"("tenant_id", "grantee_user_id");

CREATE INDEX "idx_elevation_sessions_tenant_status"
    ON "identity"."elevation_sessions"("tenant_id", "status");

CREATE INDEX "idx_elevation_session_capabilities_session"
    ON "identity"."elevation_session_capabilities"("elevation_session_id");

-- -------------------------------------------------------------------------
-- Step 6: Tenant-scoped idempotency — unique WITHIN tenant_id, never globally
-- (GD-M37-1 Decision 13). Expressible as a full (non-partial) unique index,
-- so it is safe as a standard CREATE UNIQUE INDEX.
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX "idx_elevation_sessions_tenant_idempotency"
    ON "identity"."elevation_sessions"("tenant_id", "idempotency_key");

-- -------------------------------------------------------------------------
-- Step 7: Each Permission may appear at most once per session (GD-M37-1
-- Decision 8).
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX "idx_elevation_session_capabilities_session_permission"
    ON "identity"."elevation_session_capabilities"("elevation_session_id", "permission_id");

-- -------------------------------------------------------------------------
-- Step 8: Partial unique index — at most one non-terminal session per
-- (tenant_id, grantee_user_id) (GD-M37-1 Decision 13).
-- Non-terminal is defined as: status IN ('REQUESTED', 'APPROVED', 'ACTIVE').
-- Cannot be expressed as Prisma @@unique — would generate a non-partial
-- constraint blocking a new request after any terminal outcome. Lives in
-- migration SQL only, following the same idiom as Offer's "one active offer
-- per application" partial index (20260630100000_m18b_offers/migration.sql).
-- A concurrent second request for the same grantee fails deterministically
-- at this database layer (P2002 on this index), not merely at the service
-- layer; ACTIVATION_FAILED covers the case where this guarantee is violated
-- at the moment of APPROVED → ACTIVE activation.
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX "idx_elevation_sessions_tenant_grantee_non_terminal"
    ON "identity"."elevation_sessions"("tenant_id", "grantee_user_id")
    WHERE "status" IN ('REQUESTED', 'APPROVED', 'ACTIVE');

-- -------------------------------------------------------------------------
-- Step 9: Defense-in-depth CHECK constraint — approver separation
-- (GD-M37-1 Decision 9). approved_by_user_id, when set, must differ from
-- both requested_by_user_id and grantee_user_id, with no exception. This is
-- "also recommended" by GD-M37-1 as defense in depth alongside the mandatory
-- service-layer check performed before any APPROVED/DENIED transition
-- persists; the service-layer check is the primary enforcement mechanism.
-- No equivalent constraint applies to revoked_by_user_id (GD-M37-1 Decision
-- 9 / Decision 12 — revoker is not required to be globally distinct).
-- -------------------------------------------------------------------------
ALTER TABLE "identity"."elevation_sessions"
    ADD CONSTRAINT "chk_elevation_sessions_approver_separation"
    CHECK (
        "approved_by_user_id" IS NULL
        OR (
            "approved_by_user_id" <> "requested_by_user_id"
            AND "approved_by_user_id" <> "grantee_user_id"
        )
    );
