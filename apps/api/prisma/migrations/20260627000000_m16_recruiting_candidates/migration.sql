-- M16: Candidate Management Foundation — recruiting.candidates table
-- Governance authority: GD-M16-1 (2026-06-27)
-- Depends on: GD-PRE-PHASE3-001, GD-PRE-PHASE3-002 D3, GD-PRE-PHASE3-003 D4

-- -------------------------------------------------------------------------
-- Step 1: Create recruiting schema
-- -------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS "recruiting";

-- -------------------------------------------------------------------------
-- Step 2: Create recruiting.candidates table
-- Column set per GD-PRE-PHASE3-002 Decision 3 (canonical schema authority).
-- updated_at has no DB DEFAULT — set by Prisma client on every create/update
-- (consistent with M13 pattern for skills and certifications).
-- -------------------------------------------------------------------------
-- CreateTable
CREATE TABLE "recruiting"."candidates" (
    "id"         UUID           NOT NULL,
    "tenant_id"  UUID           NOT NULL,
    "first_name" VARCHAR(100)   NOT NULL,
    "last_name"  VARCHAR(100)   NOT NULL,
    "email"      VARCHAR(255)   NOT NULL,
    "phone"      VARCHAR(50),
    "status"     VARCHAR(50)    NOT NULL DEFAULT 'ACTIVE',
    "source"     VARCHAR(100),
    "notes"      TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- -------------------------------------------------------------------------
-- Step 3: Standard tenant lookup index
-- Supports all tenant-scoped queries (SEC-003 baseline requirement).
-- -------------------------------------------------------------------------
-- CreateIndex
CREATE INDEX "idx_candidates_tenant"
    ON "recruiting"."candidates"("tenant_id");

-- -------------------------------------------------------------------------
-- Step 4: Partial status index — excludes archived/deleted records
-- Hand-edited: Prisma schema carries @@index([tenantId, status]) without a
-- WHERE predicate; this SQL adds the partial filter that Prisma cannot represent.
-- Supports GET /api/v1/candidates?status=ACTIVE list queries (GD-M16-1 D8).
-- -------------------------------------------------------------------------
-- CreateIndex
CREATE INDEX "idx_candidates_tenant_status"
    ON "recruiting"."candidates"("tenant_id", "status")
    WHERE "deleted_at" IS NULL;

-- -------------------------------------------------------------------------
-- Step 5: Partial unique index — email uniqueness per tenant, non-deleted only
--
-- GD-M16-1 Decision 5; GD-PRE-PHASE3-002 Decision 3.
--
-- HAND-EDITED: Prisma cannot represent a partial unique index (WHERE predicate)
-- in schema.prisma. schema.prisma carries @@index([tenantId, email], ...) — a
-- plain non-unique @@index — so Prisma does not generate or manage this constraint.
--
-- DO NOT replace this with @@unique([tenantId, email]) in schema.prisma.
-- Doing so would cause Prisma to generate a full non-partial unique constraint
-- on the next prisma migrate dev run, breaking the re-applicant scenario:
--   A candidate archived (deleted_at IS NOT NULL) must not block a new record
--   with the same email address in the same tenant.
--
-- Precedent (GD-M16-1 D5):
--   M13 raw-SQL unique index  — idx_skills_tenant_name (no WHERE)
--   M15 partial WHERE clause  — idx_employees_position (WHERE position_id IS NOT NULL)
--   M16 combines both         — partial + unique
-- -------------------------------------------------------------------------
-- CreateIndex
CREATE UNIQUE INDEX "idx_candidates_tenant_email"
    ON "recruiting"."candidates"("tenant_id", "email")
    WHERE "deleted_at" IS NULL;
