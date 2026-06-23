-- M15: Position Linkage — appointment_authority and position_id on workforce.employees
-- Governance authority: GD-M15-1 (2026-06-22)
-- Depends on: GD-PRE-M13-001, GD-PRE-M13-002, GD-M15-1

-- -------------------------------------------------------------------------
-- Step 1: appointment_authority — add as nullable to allow backfill
-- -------------------------------------------------------------------------
-- AlterTable
ALTER TABLE "workforce"."employees" ADD COLUMN "appointment_authority" VARCHAR(50);

-- -------------------------------------------------------------------------
-- Step 2: Backfill existing records with ADMINISTRATIVE
-- GD-M15-1 Decision 3 — one-time exception to GD-PRE-M13-001 D4 immutability.
-- All pre-M15 employee records were created via POST /api/v1/employees (Path A).
-- ADMINISTRATIVE is the designated catch-all for non-competitive appointments
-- where no more specific authority code was recorded at creation time.
-- -------------------------------------------------------------------------
UPDATE "workforce"."employees" SET "appointment_authority" = 'ADMINISTRATIVE' WHERE "appointment_authority" IS NULL;

-- -------------------------------------------------------------------------
-- Step 3: Enforce NOT NULL constraint after backfill is complete
-- -------------------------------------------------------------------------
-- AlterTable
ALTER TABLE "workforce"."employees" ALTER COLUMN "appointment_authority" SET NOT NULL;

-- -------------------------------------------------------------------------
-- Step 4: position_id — nullable UUID (GD-M15-1 D2; GD-PRE-M13-002 D1)
-- No UNIQUE constraint — 1:1 FTE Slot Model enforced at service layer only
-- (GD-PRE-M13-002 Decision 1: "No database-level unique constraint is required")
-- -------------------------------------------------------------------------
-- AlterTable
ALTER TABLE "workforce"."employees" ADD COLUMN "position_id" UUID;

-- AddForeignKey
ALTER TABLE "workforce"."employees" ADD CONSTRAINT "fk_employee_position" FOREIGN KEY ("position_id") REFERENCES "workforce"."positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- -------------------------------------------------------------------------
-- Step 5: Partial index — covers assigned employees only (GD-M15-1 D2)
-- Unassigned employees (position_id IS NULL) are excluded from the index.
-- -------------------------------------------------------------------------
-- CreateIndex
CREATE INDEX "idx_employees_position" ON "workforce"."employees"("position_id") WHERE "position_id" IS NOT NULL;
