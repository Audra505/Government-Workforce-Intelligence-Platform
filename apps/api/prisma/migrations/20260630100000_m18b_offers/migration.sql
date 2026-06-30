-- M18B: Offer Management Foundation — recruiting.offers table
-- Governance authority: GD-M18-1 (2026-06-30)
-- Depends on: GD-PRE-PHASE3-002 D6 (canonical schema), GD-M18-1 D6 (schema scope)
-- Prerequisite: recruiting schema created in 20260627000000_m16_recruiting_candidates
--               recruiting.applications created in 20260629000000_m17_applications

-- -------------------------------------------------------------------------
-- Step 1: Create recruiting.offers table
-- Column set per GD-M18-1 Decision 6 / GD-PRE-PHASE3-002 Decision 6.
-- 11 columns total: id, tenant_id, application_id, status, offer_date,
--   accepted_at, declined_at, notes, created_at, updated_at, deleted_at.
-- updated_at has no DB DEFAULT — set by Prisma client on every create/update
-- (consistent with M16/M17/M18A pattern for recruiting schema tables).
-- accepted_at: set by OfferService when status transitions to ACCEPTED.
-- declined_at: set by OfferService when status transitions to DECLINED.
-- No withdrawn_at column per GD-M18-1 D7 (updated_at reflects withdrawal time).
-- Offer acceptance does NOT create an employee record and does NOT set
--   application.status to HIRED — hire-to-employee conversion is M19 scope
--   (GD-M18-1 D3, D9). OfferService must not call prisma.application.update
--   or prisma.employee.create when transitioning offer to ACCEPTED.
-- -------------------------------------------------------------------------
CREATE TABLE "recruiting"."offers" (
    "id"             UUID           NOT NULL,
    "tenant_id"      UUID           NOT NULL,
    "application_id" UUID           NOT NULL,
    "status"         VARCHAR(50)    NOT NULL DEFAULT 'DRAFT',
    "offer_date"     TIMESTAMPTZ(6),
    "accepted_at"    TIMESTAMPTZ(6),
    "declined_at"    TIMESTAMPTZ(6),
    "notes"          TEXT,
    "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMPTZ(6) NOT NULL,
    "deleted_at"     TIMESTAMPTZ(6),

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- -------------------------------------------------------------------------
-- Step 2: FK constraint — offers.application_id → recruiting.applications.id
-- Both tables reside in the recruiting schema.
-- No ON DELETE clause — orphan prevention handled at service layer
-- (consistent with M16/M17/M18A pattern).
-- -------------------------------------------------------------------------
ALTER TABLE "recruiting"."offers"
    ADD CONSTRAINT "fk_offer_application"
    FOREIGN KEY ("application_id")
    REFERENCES "recruiting"."applications"("id");

-- -------------------------------------------------------------------------
-- Step 3: Standard tenant lookup index
-- Supports all tenant-scoped queries (SEC-003 baseline requirement).
-- -------------------------------------------------------------------------
CREATE INDEX "idx_offers_tenant"
    ON "recruiting"."offers"("tenant_id");

-- -------------------------------------------------------------------------
-- Step 4: Tenant + application composite index
-- Supports list-by-application queries: GET /offers?applicationId=...
-- (GD-M18-1 D12 — offer list filtering).
-- -------------------------------------------------------------------------
CREATE INDEX "idx_offers_application"
    ON "recruiting"."offers"("tenant_id", "application_id");

-- -------------------------------------------------------------------------
-- Step 5: Partial unique index — one active offer per application
-- Active is defined as: deleted_at IS NULL AND status NOT IN ('DECLINED', 'WITHDRAWN').
-- Re-offer is permitted only after DECLINED or WITHDRAWN terminal states
-- (GD-M18-1 D6, D10). ACCEPTED is intentionally NOT in the exclusion list —
-- an ACCEPTED offer blocks a new offer (re-offer requires prior terminal state of
-- DECLINED or WITHDRAWN per Decision 10). The partial constraint does not apply
-- to soft-deleted records (deleted_at IS NOT NULL).
-- Cannot be expressed as Prisma @@unique — would generate a non-partial constraint
-- blocking legitimate re-offer after terminal states. Lives in migration SQL only.
-- Service layer pre-check (ACTIVE_OFFER_EXISTS) runs before DB write; this index
-- is the safety net for P2002 race conditions.
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX "idx_offers_application_active"
    ON "recruiting"."offers"("application_id")
    WHERE "deleted_at" IS NULL
      AND "status" NOT IN ('DECLINED', 'WITHDRAWN');
