-- M34 — Executive Intelligence Expansion & Workforce Snapshot Foundation
-- Reference: governance/GD-M34-1.md — Decisions 15, 17
--
-- Hand-authored (not `prisma migrate dev` auto-generated) because this dev
-- database has pre-existing, unrelated schema drift against the recruiting/
-- workforce migration history (`idx_applications_status` and other indexes/
-- constraints already exist but are not reflected identically in Prisma's
-- diff baseline). Prisma's auto-diff bundled unrelated DROP/ADD CONSTRAINT
-- and CREATE INDEX statements for `recruiting.applications`,
-- `recruiting.interviews`, `recruiting.offers`, `recruiting.candidates`, and
-- `workforce.employees` into the generated migration, which is out of scope
-- for M34 (GD-M34-1 requires an additive-only migration — no ALTER on any
-- existing table). This file contains only the intelligence schema and the
-- single new table GD-M34-1 Decision 15 authorizes.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "intelligence";

-- CreateTable
CREATE TABLE "intelligence"."workforce_signal_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "signal_type" VARCHAR(50) NOT NULL,
    "scope_type" VARCHAR(20) NOT NULL,
    "scope_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    "snapshot_date" DATE NOT NULL,
    "score" DECIMAL(6,2),
    "level" VARCHAR(50),
    "confidence" SMALLINT NOT NULL,
    "formula_version" VARCHAR(100) NOT NULL,
    "computed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workforce_signal_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_workforce_signal_snapshots_tenant_signal" ON "intelligence"."workforce_signal_snapshots"("tenant_id", "signal_type");

-- CreateIndex
CREATE UNIQUE INDEX "idx_workforce_signal_snapshots_dedup" ON "intelligence"."workforce_signal_snapshots"("tenant_id", "signal_type", "scope_type", "scope_id", "snapshot_date");
