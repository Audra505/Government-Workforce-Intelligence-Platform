-- M18A: Interview Management Foundation — recruiting.interviews table
-- Governance authority: GD-M18-1 (2026-06-30)
-- Depends on: GD-PRE-PHASE3-002 D5 (canonical schema), GD-M18-1 D4 (schema scope)
-- Prerequisite: recruiting schema created in 20260627000000_m16_recruiting_candidates
--               recruiting.applications created in 20260629000000_m17_applications

-- -------------------------------------------------------------------------
-- Step 1: Create recruiting.interviews table
-- Column set per GD-M18-1 Decision 4 / GD-PRE-PHASE3-002 Decision 5.
-- updated_at has no DB DEFAULT — set by Prisma client on every create/update
-- (consistent with M16/M17 pattern for recruiting.candidates and .applications).
-- interviewer_user_id is nullable with no FK constraint (GD-PRE-PHASE3-002 D5;
--   GD-M18-1 D4) — service validates user existence and tenant membership at runtime.
-- -------------------------------------------------------------------------
CREATE TABLE "recruiting"."interviews" (
    "id"                   UUID           NOT NULL,
    "tenant_id"            UUID           NOT NULL,
    "application_id"       UUID           NOT NULL,
    "interview_type"       VARCHAR(50)    NOT NULL,
    "scheduled_at"         TIMESTAMPTZ(6),
    "status"               VARCHAR(50)    NOT NULL DEFAULT 'SCHEDULED',
    "interviewer_name"     VARCHAR(255),
    "interviewer_user_id"  UUID,
    "feedback"             TEXT,
    "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMPTZ(6) NOT NULL,
    "deleted_at"           TIMESTAMPTZ(6),

    CONSTRAINT "interviews_pkey" PRIMARY KEY ("id")
);

-- -------------------------------------------------------------------------
-- Step 2: FK constraint — interviews.application_id → recruiting.applications.id
-- Both tables reside in the recruiting schema.
-- No ON DELETE clause — orphan prevention handled at service layer
-- (consistent with M16 fk_application_candidate and M17 fk_application_vacancy pattern).
-- -------------------------------------------------------------------------
ALTER TABLE "recruiting"."interviews"
    ADD CONSTRAINT "fk_interview_application"
    FOREIGN KEY ("application_id")
    REFERENCES "recruiting"."applications"("id");

-- -------------------------------------------------------------------------
-- Step 3: Standard tenant lookup index
-- Supports all tenant-scoped queries (SEC-003 baseline requirement).
-- -------------------------------------------------------------------------
CREATE INDEX "idx_interviews_tenant"
    ON "recruiting"."interviews"("tenant_id");

-- -------------------------------------------------------------------------
-- Step 4: Tenant + application composite index
-- Supports list-by-application queries: GET /interviews?applicationId=...
-- (GD-M18-1 D8 — interview list filtering).
-- -------------------------------------------------------------------------
CREATE INDEX "idx_interviews_application"
    ON "recruiting"."interviews"("tenant_id", "application_id");
