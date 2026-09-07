-- M39: Audit Read, Recovery, and Integrity Foundation — additive columns and
-- tables in the existing "audit" schema, plus a bounded append-only trigger
-- and a retention-derivation trigger on audit.audit_events.
-- Governance authority: governance/GD-M39-1.md
--
-- No table is dropped, renamed, or altered destructively. No existing
-- audit_events row is deleted. No database role, grant, or revoke is issued
-- here (GD-M39-1 Decision 7 — database-role separation is explicitly
-- excluded from M39's scope).

-- -------------------------------------------------------------------------
-- Step 1: Create governed enums (GD-M39-1 Decision 9) — native Postgres
-- enums, following the identity/decisions-schema precedent GD-M37-1/
-- GD-M38-1 established for every lifecycle-shaped field in this codebase.
-- -------------------------------------------------------------------------

CREATE TYPE "audit"."AuditWriteFailureStatus" AS ENUM (
    'PENDING',
    'IN_PROGRESS',
    'RETRIED',
    'ABANDONED'
);

CREATE TYPE "audit"."AuditWriteFailureAttemptStatus" AS ENUM (
    'IN_PROGRESS',
    'SUCCEEDED',
    'FAILED'
);

CREATE TYPE "audit"."AuditChainVerificationResult" AS ENUM (
    'OK',
    'BROKEN'
);

-- -------------------------------------------------------------------------
-- Step 2: Add occurredAt and retentionUntil as NULLABLE columns
-- (GD-M39-1 Decision 6, migration step 1). Every existing row is backfilled
-- in Step 3 before either column is ever made NOT NULL.
-- -------------------------------------------------------------------------

ALTER TABLE "audit"."audit_events"
    ADD COLUMN "occurred_at"     TIMESTAMPTZ(6),
    ADD COLUMN "retention_until" TIMESTAMPTZ(6);

-- -------------------------------------------------------------------------
-- Step 3: Backfill existing rows (GD-M39-1 Decision 6, migration step 2).
-- occurredAt = createdAt (never fabricated to any other value);
-- retentionUntil = occurredAt + 7 years, matching the trigger's own
-- derivation rule exactly, so backfilled rows and trigger-derived rows are
-- indistinguishable going forward.
-- -------------------------------------------------------------------------

UPDATE "audit"."audit_events"
SET "occurred_at" = "created_at"
WHERE "occurred_at" IS NULL;

UPDATE "audit"."audit_events"
SET "retention_until" = "occurred_at" + INTERVAL '7 years'
WHERE "retention_until" IS NULL;

-- -------------------------------------------------------------------------
-- Step 4: Verify zero rows remain with either field null (GD-M39-1
-- Decision 6, migration step 3) — fails the migration loudly rather than
-- silently installing a NOT NULL constraint that could not actually hold.
-- -------------------------------------------------------------------------

DO $$
DECLARE
    remaining_nulls INTEGER;
BEGIN
    SELECT COUNT(*) INTO remaining_nulls
    FROM "audit"."audit_events"
    WHERE "occurred_at" IS NULL OR "retention_until" IS NULL;

    IF remaining_nulls > 0 THEN
        RAISE EXCEPTION 'M39 migration invariant violated: % audit_events rows still have a null occurred_at or retention_until after backfill', remaining_nulls;
    END IF;
END $$;

-- -------------------------------------------------------------------------
-- Step 5: Set both fields NOT NULL (GD-M39-1 Decision 6, migration step 4).
-- -------------------------------------------------------------------------

ALTER TABLE "audit"."audit_events"
    ALTER COLUMN "occurred_at" SET NOT NULL,
    ALTER COLUMN "retention_until" SET NOT NULL;

-- -------------------------------------------------------------------------
-- Step 6: Add the hash-chain columns (GD-M39-1 Decision 8/9) — additive,
-- permanently nullable. Every pre-M39 row keeps all four NULL (legacy
-- pre-chain row, per Decision 8) — never fabricated, never treated as a
-- break by verification.
-- -------------------------------------------------------------------------

ALTER TABLE "audit"."audit_events"
    ADD COLUMN "sequence_no"   BIGINT,
    ADD COLUMN "record_hash"   VARCHAR(64),
    ADD COLUMN "previous_hash" VARCHAR(64),
    ADD COLUMN "hash_version"  VARCHAR(20);

-- -------------------------------------------------------------------------
-- Step 7: Create audit.audit_write_failures (GD-M39-1 Decision 9).
-- id is the eventual AuditEvent.id, client-generated at first failure —
-- never a separate synthetic key (see AuditService.logEvent()).
-- -------------------------------------------------------------------------

CREATE TABLE "audit"."audit_write_failures" (
    "id"              UUID                                 NOT NULL,
    "tenant_id"       UUID                                 NOT NULL,
    "user_id"         UUID                                 NOT NULL,
    "action"          VARCHAR(100)                         NOT NULL,
    "entity_type"     VARCHAR(100),
    "entity_id"       UUID,
    "result"          VARCHAR(50)                          NOT NULL,
    "metadata"        JSONB,
    "occurred_at"     TIMESTAMPTZ(6)                       NOT NULL,
    "failure_reason"  VARCHAR(100)                         NOT NULL,
    "status"          "audit"."AuditWriteFailureStatus"    NOT NULL DEFAULT 'PENDING',
    "attempt_count"   INTEGER                              NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6)                       NOT NULL,
    "claimed_at"      TIMESTAMPTZ(6),
    "claimed_by"      VARCHAR(100),
    "attempted_at"    TIMESTAMPTZ(6),
    "created_at"      TIMESTAMPTZ(6)                       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6)                       NOT NULL,

    CONSTRAINT "audit_write_failures_pkey" PRIMARY KEY ("id")
);

-- -------------------------------------------------------------------------
-- Step 8: Create audit.audit_write_failure_attempts (GD-M39-1 Decision
-- 9/12). Terminal rows (SUCCEEDED/FAILED) are immutable by service-layer
-- convention only — no CHECK constraint blocks a future update, matching
-- this codebase's existing convention of enforcing immutability at the
-- service layer rather than via a trigger, except for audit_events itself
-- (Decision 7).
-- -------------------------------------------------------------------------

CREATE TABLE "audit"."audit_write_failure_attempts" (
    "id"                    UUID                                     NOT NULL,
    "tenant_id"             UUID                                     NOT NULL,
    "audit_write_failure_id" UUID                                    NOT NULL,
    "attempt_number"        INTEGER                                  NOT NULL,
    "claimed_by"            VARCHAR(100)                             NOT NULL,
    "started_at"            TIMESTAMPTZ(6)                           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at"          TIMESTAMPTZ(6),
    "failure_category"      VARCHAR(100),
    "status"                "audit"."AuditWriteFailureAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',

    CONSTRAINT "audit_write_failure_attempts_pkey" PRIMARY KEY ("id")
);

-- -------------------------------------------------------------------------
-- Step 9: Create audit.audit_chain_state (GD-M39-1 Decision 8/9/13) — one
-- row per tenant. lastVerificationResult is nullable before the first
-- verification ever runs.
-- -------------------------------------------------------------------------

CREATE TABLE "audit"."audit_chain_state" (
    "tenant_id"                UUID                                    NOT NULL,
    "last_sequence"            BIGINT                                  NOT NULL DEFAULT 0,
    "last_hash"                VARCHAR(64),
    "next_verification_at"     TIMESTAMPTZ(6)                          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verification_claimed_at"  TIMESTAMPTZ(6),
    "last_verified_at"         TIMESTAMPTZ(6),
    "last_verification_result" "audit"."AuditChainVerificationResult",
    "updated_at"               TIMESTAMPTZ(6)                          NOT NULL,

    CONSTRAINT "audit_chain_state_pkey" PRIMARY KEY ("tenant_id")
);

-- -------------------------------------------------------------------------
-- Step 10: Foreign-key constraint. No ON DELETE clause (Postgres default
-- NO ACTION), matching the existing migration pattern — a terminal
-- AuditWriteFailureAttempt row is historical evidence and must never be
-- silently cascaded away.
-- -------------------------------------------------------------------------

ALTER TABLE "audit"."audit_write_failure_attempts"
    ADD CONSTRAINT "fk_audit_write_failure_attempt_failure"
    FOREIGN KEY ("audit_write_failure_id")
    REFERENCES "audit"."audit_write_failures"("id");

-- -------------------------------------------------------------------------
-- Step 11: Required indexes (GD-M39-1 Decision 10) — all nine, expressed
-- directly (none requires a partial/WHERE-clause index; every one of the
-- nine is a plain composite or unique btree index, so all nine are created
-- here rather than relying on Prisma's own migrate-diff generation, keeping
-- this migration self-contained and its ordering explicit).
-- -------------------------------------------------------------------------

-- AuditEvent indexes 1-4
CREATE INDEX "idx_audit_events_tenant_entity"
    ON "audit"."audit_events"("tenant_id", "entity_type", "entity_id");

CREATE INDEX "idx_audit_events_tenant_action"
    ON "audit"."audit_events"("tenant_id", "action");

CREATE INDEX "idx_audit_events_tenant_occurred_at"
    ON "audit"."audit_events"("tenant_id", "occurred_at");

-- NULLs are distinct from one another under standard SQL NULL semantics,
-- so this UNIQUE index remains correct for pre-chain (sequence_no IS NULL)
-- rows — it only ever rejects a real, non-null tenant/sequence collision.
CREATE UNIQUE INDEX "idx_audit_events_tenant_sequence"
    ON "audit"."audit_events"("tenant_id", "sequence_no");

-- AuditWriteFailure indexes 5-6
CREATE INDEX "idx_audit_write_failure_claim"
    ON "audit"."audit_write_failures"("status", "next_attempt_at", "claimed_at");

CREATE INDEX "idx_audit_write_failure_tenant_status"
    ON "audit"."audit_write_failures"("tenant_id", "status");

-- AuditWriteFailureAttempt indexes 7-8
CREATE UNIQUE INDEX "idx_audit_write_failure_attempt_number"
    ON "audit"."audit_write_failure_attempts"("audit_write_failure_id", "attempt_number");

CREATE INDEX "idx_audit_write_failure_attempt_tenant_failure"
    ON "audit"."audit_write_failure_attempts"("tenant_id", "audit_write_failure_id");

-- AuditChainState index 9
CREATE INDEX "idx_audit_chain_state_next_verification"
    ON "audit"."audit_chain_state"("next_verification_at");

-- -------------------------------------------------------------------------
-- Step 12: Retention-derivation trigger (GD-M39-1 Decision 6, migration
-- step 5 — installed only now, after every existing row already satisfies
-- the NOT NULL invariant from Step 5 above). Fires BEFORE INSERT and
-- unconditionally overwrites retention_until — no HTTP DTO, service input,
-- or other caller may ever supply a value that survives this trigger.
-- -------------------------------------------------------------------------

CREATE FUNCTION "audit"."derive_audit_event_retention"() RETURNS trigger AS $$
BEGIN
    NEW."retention_until" := NEW."occurred_at" + INTERVAL '7 years';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_events_derive_retention"
    BEFORE INSERT ON "audit"."audit_events"
    FOR EACH ROW EXECUTE FUNCTION "audit"."derive_audit_event_retention"();

-- -------------------------------------------------------------------------
-- Step 13: Bounded append-only trigger (GD-M39-1 Decision 7). This is
-- bounded tamper evidence against ordinary application behavior — it does
-- NOT protect against the database owner, a Postgres superuser, or anyone
-- able to directly disable or drop this trigger. No database role is
-- created, granted, or revoked by this migration (database-role separation
-- is explicitly excluded from M39's scope — see GD-M39-1 Decision 7).
-- -------------------------------------------------------------------------

CREATE FUNCTION "audit"."prevent_audit_mutation"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit.audit_events rows are append-only and immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_events_prevent_mutation"
    BEFORE UPDATE OR DELETE ON "audit"."audit_events"
    FOR EACH ROW EXECUTE FUNCTION "audit"."prevent_audit_mutation"();
