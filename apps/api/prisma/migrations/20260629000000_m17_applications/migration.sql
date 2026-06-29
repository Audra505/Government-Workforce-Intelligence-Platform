-- M17: Application Management Foundation — recruiting.applications table
-- Governance authority: GD-M17-1 (2026-06-29)
-- Depends on: GD-PRE-PHASE3-001 D6, GD-PRE-PHASE3-002 D4-D8, GD-PRE-PHASE3-003 D3/D6
-- Prerequisite: recruiting schema created in 20260627000000_m16_recruiting_candidates

-- -------------------------------------------------------------------------
-- Step 1: Create recruiting.applications table
-- Column set per GD-PRE-PHASE3-002 Decision 4 (canonical schema authority).
-- updated_at has no DB DEFAULT — set by Prisma client on every create/update
-- (consistent with M16 pattern for recruiting.candidates).
-- -------------------------------------------------------------------------
-- CreateTable
CREATE TABLE "recruiting"."applications" (
    "id"            UUID           NOT NULL,
    "tenant_id"     UUID           NOT NULL,
    "candidate_id"  UUID           NOT NULL,
    "vacancy_id"    UUID           NOT NULL,
    "status"        VARCHAR(50)    NOT NULL DEFAULT 'APPLIED',
    "submitted_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_stage" VARCHAR(100),
    "notes"         TEXT,
    "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMPTZ(6) NOT NULL,
    "deleted_at"    TIMESTAMPTZ(6),

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- -------------------------------------------------------------------------
-- Step 2: FK constraint — application.candidate_id → recruiting.candidates.id
-- Both tables reside in the recruiting schema.
-- No ON DELETE clause — orphan prevention handled at service layer.
-- -------------------------------------------------------------------------
-- AddForeignKey
ALTER TABLE "recruiting"."applications"
    ADD CONSTRAINT "fk_application_candidate"
    FOREIGN KEY ("candidate_id")
    REFERENCES "recruiting"."candidates"("id");

-- -------------------------------------------------------------------------
-- Step 3: FK constraint — application.vacancy_id → workforce.vacancies.id
-- Cross-schema FK: recruiting → workforce.
-- No ON DELETE clause — orphan prevention handled at service layer.
-- -------------------------------------------------------------------------
-- AddForeignKey
ALTER TABLE "recruiting"."applications"
    ADD CONSTRAINT "fk_application_vacancy"
    FOREIGN KEY ("vacancy_id")
    REFERENCES "workforce"."vacancies"("id");

-- -------------------------------------------------------------------------
-- Step 4: Standard tenant lookup index
-- Supports all tenant-scoped queries (SEC-003 baseline requirement).
-- -------------------------------------------------------------------------
-- CreateIndex
CREATE INDEX "idx_applications_tenant"
    ON "recruiting"."applications"("tenant_id");

-- -------------------------------------------------------------------------
-- Step 5: Tenant + candidate composite index
-- Supports list-by-candidate queries and the CANDIDATE_HAS_ACTIVE_APPLICATIONS
-- guard in CandidateService.archiveCandidate() (GD-M17-1 Decision 9).
-- -------------------------------------------------------------------------
-- CreateIndex
CREATE INDEX "idx_applications_candidate"
    ON "recruiting"."applications"("tenant_id", "candidate_id");

-- -------------------------------------------------------------------------
-- Step 6: Tenant + vacancy composite index
-- Supports list-by-vacancy queries and VAC-301 vacancy status check
-- (GD-M17-1 Decision 8).
-- -------------------------------------------------------------------------
-- CreateIndex
CREATE INDEX "idx_applications_vacancy"
    ON "recruiting"."applications"("tenant_id", "vacancy_id");

-- -------------------------------------------------------------------------
-- Step 7: Partial status index — active applications only
-- Hand-edited: Prisma schema carries @@index([tenantId, status]) without a
-- WHERE predicate; this SQL adds the partial filter Prisma cannot represent.
-- Supports list queries filtered by status (GD-M17-1 Decision 11).
-- -------------------------------------------------------------------------
-- CreateIndex
CREATE INDEX "idx_applications_status"
    ON "recruiting"."applications"("tenant_id", "status")
    WHERE "deleted_at" IS NULL;

-- -------------------------------------------------------------------------
-- Step 8: Partial unique index — one active application per candidate per vacancy
--
-- GD-M17-1 Decision 5; GD-M17-1 Decision 7; GD-PRE-PHASE3-002 Decision 4.
--
-- HAND-EDITED: Prisma cannot represent a partial unique index (WHERE predicate
-- with status filter) in schema.prisma. schema.prisma does NOT carry a @@unique
-- for (tenantId, candidateId, vacancyId) — doing so would generate a full
-- non-partial unique constraint on the next prisma migrate dev run, blocking
-- terminal re-application.
--
-- Semantics:
--   A candidate may have only one active (non-terminal) application for the
--   same vacancy in the same tenant at any point in time. Terminal states
--   REJECTED and WITHDRAWN are excluded from the unique constraint, allowing
--   re-application after either terminal state (GD-M17-1 Decision 7).
--
-- DO NOT replace this with @@unique([tenantId, candidateId, vacancyId]) in
-- schema.prisma. Doing so would block legitimate re-application.
--
-- Precedent (GD-M16-1 D5 / GD-M17-1 D5):
--   M13 raw-SQL unique index       — idx_skills_tenant_name (no WHERE)
--   M15 partial WHERE clause       — idx_employees_position (WHERE position_id IS NOT NULL)
--   M16 partial + unique           — idx_candidates_tenant_email (WHERE deleted_at IS NULL)
--   M17 partial + unique + 3-col   — this index (WHERE deleted_at IS NULL
--                                      AND status NOT IN ('REJECTED', 'WITHDRAWN'))
-- -------------------------------------------------------------------------
-- CreateIndex (HAND-EDITED — partial unique; WHERE clause added manually)
CREATE UNIQUE INDEX "idx_applications_candidate_vacancy_active"
    ON "recruiting"."applications"("tenant_id", "candidate_id", "vacancy_id")
    WHERE "deleted_at" IS NULL
      AND "status" NOT IN ('REJECTED', 'WITHDRAWN');
