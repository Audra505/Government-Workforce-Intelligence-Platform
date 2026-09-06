-- M38: Decision Case and Approval Foundation — new "decisions" schema plus
-- an additive scope extension of identity.elevation_sessions (M37)
-- Governance authority: governance/GD-M38-1.md
-- Depends on: identity.permissions (ApprovalRequirement.required_capability_id
--             FK), identity.elevation_sessions (M37, additive extension),
--             organization.departments (ElevationSession scope FK)
--
-- Internal-service-only foundation. No HTTP surface, no runtime
-- authorization or business-execution effect (GD-M38-1 Decision 4). This
-- migration creates data structures only — it grants no access, executes
-- no action, and activates no approval workflow by itself.

-- -------------------------------------------------------------------------
-- Step 1: Create the "decisions" schema
-- -------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS "decisions";

-- -------------------------------------------------------------------------
-- Step 2: Create governed enums in the "decisions" schema
-- GD-M38-1 Decision 7/8/9/11/12/13/14 — every M38 lifecycle/classification
-- value is a real Postgres enum, never a free-form VARCHAR, matching the
-- precedent GD-M37-1 Decision 5 established as this schema's first native
-- enums.
-- -------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "decisions"."DecisionCaseStatus" AS ENUM (
    'OPEN',
    'AWAITING_APPROVAL',
    'NEEDS_INFORMATION',
    'APPROVED',
    'REJECTED',
    'CANCELLED'
);

-- CreateEnum
CREATE TYPE "decisions"."ApprovalRequestStatus" AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'NEEDS_INFORMATION',
    'SUPERSEDED',
    'CANCELLED'
);

-- CreateEnum
CREATE TYPE "decisions"."ApprovalDecisionValue" AS ENUM (
    'GRANTED',
    'REJECTED',
    'NEEDS_INFORMATION'
);

-- CreateEnum
CREATE TYPE "decisions"."ApprovalTier" AS ENUM (
    'TIER_1',
    'TIER_2',
    'TIER_3'
);

-- CreateEnum
CREATE TYPE "decisions"."AuthorityCategory" AS ENUM (
    'ACTION_AUTHORITY',
    'DEPARTMENT_OR_HIRING_AUTHORITY',
    'HR_AUTHORITY',
    'INDEPENDENT_OVERSIGHT_REVIEWER'
);

-- CreateEnum
CREATE TYPE "decisions"."DecisionCaseSubjectType" AS ENUM (
    'OFFER',
    'APPLICATION',
    'EMPLOYEE',
    'ELEVATION_SESSION',
    'GENERAL'
);

-- CreateEnum
CREATE TYPE "decisions"."DecisionCaseRiskTriggerType" AS ENUM (
    'COMPLIANCE_OR_POLICY_EXCEPTION',
    'FAILED_CONTROL_OVERRIDE',
    'PRIVILEGED_OR_EMERGENCY_ACCESS',
    'AUTHORIZATION_POLICY_OR_SECURITY_CONFIGURATION_CHANGE',
    'SELF_PREPARED_WORKFORCE_PLAN_OR_FORECAST_ACTIVATION',
    'SENSITIVE_BULK_ACTION',
    'OTHER_EXPLICITLY_CLASSIFIED'
);

-- CreateEnum
CREATE TYPE "decisions"."EvidenceType" AS ENUM (
    'SOURCE_RECORD_REFERENCE',
    'HUMAN_NOTE',
    'SYSTEM_DERIVED_SUMMARY'
);

-- CreateEnum
CREATE TYPE "decisions"."EvidenceSensitivityClassification" AS ENUM (
    'USER_ACCOUNT_IDENTITY',
    'EMPLOYEE_CANDIDATE_PII',
    'AGGREGATE_EXECUTIVE',
    'COMPLIANCE_SENSITIVE',
    'PRIVILEGED_ACCESS_EVIDENCE'
);

-- CreateEnum
CREATE TYPE "decisions"."ProvenanceType" AS ENUM (
    'HUMAN',
    'DETERMINISTIC_SYSTEM'
);

-- CreateEnum (identity schema — GD-M38-1 Decision 15, M37 scope extension)
CREATE TYPE "identity"."ElevationSessionScopeType" AS ENUM (
    'TENANT',
    'DEPARTMENT',
    'DECISION_CASE'
);

-- -------------------------------------------------------------------------
-- Step 3: Create decisions.decision_cases
-- tenant_id is a bare scalar (dominant convention). initiated_by_user_id/
-- prepared_by_user_id/subject_id carry NO FK — see Decision 6/Decision 15
-- actor-and-subject-reference precedent (GD-M37-1 Decision 15).
-- -------------------------------------------------------------------------
CREATE TABLE "decisions"."decision_cases" (
    "id"                    UUID                                NOT NULL,
    "tenant_id"             UUID                                NOT NULL,
    "subject_type"          "decisions"."DecisionCaseSubjectType" NOT NULL,
    "subject_id"            UUID,
    "initiated_by_user_id"  UUID                                NOT NULL,
    "prepared_by_user_id"   UUID                                NOT NULL,
    "purpose"               TEXT                                NOT NULL,
    "status"                "decisions"."DecisionCaseStatus"   NOT NULL DEFAULT 'OPEN',
    "idempotency_key"       VARCHAR(255),
    "version"               INTEGER                             NOT NULL DEFAULT 1,
    "created_at"            TIMESTAMPTZ(6)                      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMPTZ(6)                      NOT NULL,

    CONSTRAINT "decision_cases_pkey" PRIMARY KEY ("id")
);

-- -------------------------------------------------------------------------
-- Step 4: Create decisions.evidence_items
-- -------------------------------------------------------------------------
CREATE TABLE "decisions"."evidence_items" (
    "id"                          UUID                                          NOT NULL,
    "tenant_id"                   UUID                                          NOT NULL,
    "decision_case_id"            UUID                                          NOT NULL,
    "evidence_type"               "decisions"."EvidenceType"                    NOT NULL,
    "sensitivity_classification"  "decisions"."EvidenceSensitivityClassification" NOT NULL,
    "source_type"                 "decisions"."DecisionCaseSubjectType"         NOT NULL,
    "source_id"                   UUID,
    "provenance_type"             "decisions"."ProvenanceType"                  NOT NULL,
    "produced_by_user_id"         UUID,
    "captured_at"                 TIMESTAMPTZ(6)                                NOT NULL,
    "summary"                     TEXT,
    "integrity_metadata"          TEXT,
    "created_at"                  TIMESTAMPTZ(6)                                NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_items_pkey" PRIMARY KEY ("id")
);

-- -------------------------------------------------------------------------
-- Step 5: Create decisions.decision_case_risk_triggers
-- -------------------------------------------------------------------------
CREATE TABLE "decisions"."decision_case_risk_triggers" (
    "id"                        UUID                                        NOT NULL,
    "tenant_id"                 UUID                                        NOT NULL,
    "decision_case_id"          UUID                                        NOT NULL,
    "trigger_type"              "decisions"."DecisionCaseRiskTriggerType"  NOT NULL,
    "reason"                    TEXT                                        NOT NULL,
    "source_or_provenance"      "decisions"."ProvenanceType"                NOT NULL,
    "created_by_user_id"        UUID,
    "created_at"                TIMESTAMPTZ(6)                              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "case_version"              INTEGER                                     NOT NULL,
    "included_in_approval_plan" BOOLEAN                                     NOT NULL DEFAULT false,

    CONSTRAINT "decision_case_risk_triggers_pkey" PRIMARY KEY ("id")
);

-- -------------------------------------------------------------------------
-- Step 6: Create decisions.approval_requests
-- -------------------------------------------------------------------------
CREATE TABLE "decisions"."approval_requests" (
    "id"                     UUID                              NOT NULL,
    "tenant_id"              UUID                              NOT NULL,
    "decision_case_id"       UUID                              NOT NULL,
    "version"                INTEGER                           NOT NULL,
    "supersedes_request_id"  UUID,
    "status"                 "decisions"."ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "created_at"             TIMESTAMPTZ(6)                    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at"             TIMESTAMPTZ(6),

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- -------------------------------------------------------------------------
-- Step 7: Create decisions.approval_requirements
-- -------------------------------------------------------------------------
CREATE TABLE "decisions"."approval_requirements" (
    "id"                          UUID                            NOT NULL,
    "approval_request_id"         UUID                            NOT NULL,
    "required_authority_category" "decisions"."AuthorityCategory" NOT NULL,
    "required_capability_id"      UUID,
    "sequence_order"              INTEGER,
    "tier"                        "decisions"."ApprovalTier"      NOT NULL,
    "created_at"                  TIMESTAMPTZ(6)                  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requirements_pkey" PRIMARY KEY ("id")
);

-- -------------------------------------------------------------------------
-- Step 8: Create decisions.approval_decisions
-- No PENDING value exists on ApprovalDecisionValue (Step 2) — a row is
-- created only when a human acts (GD-M38-1 Decision 9).
-- -------------------------------------------------------------------------
CREATE TABLE "decisions"."approval_decisions" (
    "id"                       UUID                             NOT NULL,
    "approval_requirement_id"  UUID                             NOT NULL,
    "approval_request_id"      UUID                             NOT NULL,
    "decided_by_user_id"       UUID                             NOT NULL,
    "decision"                 "decisions"."ApprovalDecisionValue" NOT NULL,
    "reason"                   TEXT                             NOT NULL,
    "qualification_snapshot"   TEXT                             NOT NULL,
    "evidence_set_version"     INTEGER                          NOT NULL,
    "decided_at"               TIMESTAMPTZ(6)                   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

-- -------------------------------------------------------------------------
-- Step 9: Create decisions.approval_request_evidence
-- Composite primary key, no synthetic id — pure many-to-many join table,
-- following the existing identity.role_permissions/user_roles idiom.
-- -------------------------------------------------------------------------
CREATE TABLE "decisions"."approval_request_evidence" (
    "approval_request_id" UUID           NOT NULL,
    "evidence_item_id"    UUID           NOT NULL,
    "included_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_request_evidence_pkey" PRIMARY KEY ("approval_request_id", "evidence_item_id")
);

-- -------------------------------------------------------------------------
-- Step 10: Extend identity.elevation_sessions (M37) additively
-- GD-M38-1 Decision 15. decision_case_id carries NO FK (mirrors every
-- other actor/reference column on this table). scope_type defaults to
-- 'TENANT' — every existing M37 row is backfilled to TENANT scope with
-- both target columns NULL by this ADD COLUMN, remaining fully backward
-- compatible with zero data migration needed.
-- -------------------------------------------------------------------------
ALTER TABLE "identity"."elevation_sessions"
    ADD COLUMN "decision_case_id"      UUID,
    ADD COLUMN "scope_type"            "identity"."ElevationSessionScopeType" NOT NULL DEFAULT 'TENANT',
    ADD COLUMN "scope_department_id"   UUID,
    ADD COLUMN "scope_decision_case_id" UUID;

-- -------------------------------------------------------------------------
-- Step 11: Foreign-key constraints
-- No ON DELETE clause on any FK below — orphan prevention handled at the
-- service layer (consistent with the existing migration pattern, e.g.
-- M18B offers) and, for the two ElevationSession scope FKs, deliberately
-- restrictive-by-default so a Department or DecisionCase can never be
-- deleted out from under elevation security history (GD-M38-1 Decision 15).
-- -------------------------------------------------------------------------
ALTER TABLE "decisions"."evidence_items"
    ADD CONSTRAINT "fk_evidence_item_decision_case"
    FOREIGN KEY ("decision_case_id")
    REFERENCES "decisions"."decision_cases"("id");

ALTER TABLE "decisions"."decision_case_risk_triggers"
    ADD CONSTRAINT "fk_risk_trigger_decision_case"
    FOREIGN KEY ("decision_case_id")
    REFERENCES "decisions"."decision_cases"("id");

ALTER TABLE "decisions"."approval_requests"
    ADD CONSTRAINT "fk_approval_request_decision_case"
    FOREIGN KEY ("decision_case_id")
    REFERENCES "decisions"."decision_cases"("id");

ALTER TABLE "decisions"."approval_requests"
    ADD CONSTRAINT "fk_approval_request_supersedes"
    FOREIGN KEY ("supersedes_request_id")
    REFERENCES "decisions"."approval_requests"("id");

ALTER TABLE "decisions"."approval_requirements"
    ADD CONSTRAINT "fk_approval_requirement_request"
    FOREIGN KEY ("approval_request_id")
    REFERENCES "decisions"."approval_requests"("id");

ALTER TABLE "decisions"."approval_requirements"
    ADD CONSTRAINT "fk_approval_requirement_capability"
    FOREIGN KEY ("required_capability_id")
    REFERENCES "identity"."permissions"("id");

ALTER TABLE "decisions"."approval_decisions"
    ADD CONSTRAINT "fk_approval_decision_requirement"
    FOREIGN KEY ("approval_requirement_id")
    REFERENCES "decisions"."approval_requirements"("id");

ALTER TABLE "decisions"."approval_decisions"
    ADD CONSTRAINT "fk_approval_decision_request"
    FOREIGN KEY ("approval_request_id")
    REFERENCES "decisions"."approval_requests"("id");

ALTER TABLE "decisions"."approval_request_evidence"
    ADD CONSTRAINT "fk_approval_request_evidence_request"
    FOREIGN KEY ("approval_request_id")
    REFERENCES "decisions"."approval_requests"("id");

ALTER TABLE "decisions"."approval_request_evidence"
    ADD CONSTRAINT "fk_approval_request_evidence_item"
    FOREIGN KEY ("evidence_item_id")
    REFERENCES "decisions"."evidence_items"("id");

-- Restrictive (no ON DELETE clause — Postgres default NO ACTION) FKs for
-- the M37 scope extension. Position.department/Employee.department already
-- establish this exact cross-schema, restrictive-by-default idiom.
ALTER TABLE "identity"."elevation_sessions"
    ADD CONSTRAINT "fk_elevation_session_scope_department"
    FOREIGN KEY ("scope_department_id")
    REFERENCES "organization"."departments"("id");

ALTER TABLE "identity"."elevation_sessions"
    ADD CONSTRAINT "fk_elevation_session_scope_decision_case"
    FOREIGN KEY ("scope_decision_case_id")
    REFERENCES "decisions"."decision_cases"("id");

-- -------------------------------------------------------------------------
-- Step 12: Standard tenant/case lookup indexes
-- -------------------------------------------------------------------------
CREATE INDEX "idx_decision_cases_tenant_status"
    ON "decisions"."decision_cases"("tenant_id", "status");

CREATE INDEX "idx_decision_cases_tenant_subject"
    ON "decisions"."decision_cases"("tenant_id", "subject_type", "subject_id");

CREATE INDEX "idx_evidence_items_tenant_case"
    ON "decisions"."evidence_items"("tenant_id", "decision_case_id");

CREATE INDEX "idx_decision_case_risk_triggers_tenant_case"
    ON "decisions"."decision_case_risk_triggers"("tenant_id", "decision_case_id");

CREATE INDEX "idx_approval_requests_tenant_case"
    ON "decisions"."approval_requests"("tenant_id", "decision_case_id");

CREATE INDEX "idx_approval_requirements_request"
    ON "decisions"."approval_requirements"("approval_request_id");

CREATE INDEX "idx_approval_decisions_request"
    ON "decisions"."approval_decisions"("approval_request_id");

CREATE INDEX "idx_elevation_sessions_scope_department"
    ON "identity"."elevation_sessions"("scope_department_id");

CREATE INDEX "idx_elevation_sessions_scope_decision_case"
    ON "identity"."elevation_sessions"("scope_decision_case_id");

-- -------------------------------------------------------------------------
-- Step 13: Tenant-scoped idempotency (GD-M38-1 Decision 16) — mirrors
-- GD-M37-1 Decision 13's identical idiom for ElevationSession.
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX "idx_decision_cases_tenant_idempotency"
    ON "decisions"."decision_cases"("tenant_id", "idempotency_key");

-- -------------------------------------------------------------------------
-- Step 14: Monotonic version uniqueness per case (GD-M38-1 Decision 16).
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX "idx_approval_requests_case_version"
    ON "decisions"."approval_requests"("decision_case_id", "version");

-- -------------------------------------------------------------------------
-- Step 15: A request cannot declare the same authority category twice
-- (GD-M38-1 Decision 16).
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX "idx_approval_requirements_request_category"
    ON "decisions"."approval_requirements"("approval_request_id", "required_authority_category");

-- -------------------------------------------------------------------------
-- Step 16: At most one decision per requirement (GD-M38-1 Decision 9) —
-- expressible as a plain unique constraint since approval_requirement_id
-- is 1:1 with its (immutable, single-version) parent requirement.
-- One human cannot satisfy multiple requirements on the same request
-- (GD-M38-1 Decision 16) — decided_by_user_id is mandatory (never null) on
-- this table, so this is a plain unique index, not a partial one.
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX "idx_approval_decisions_requirement"
    ON "decisions"."approval_decisions"("approval_requirement_id");

CREATE UNIQUE INDEX "idx_approval_decisions_request_decider"
    ON "decisions"."approval_decisions"("approval_request_id", "decided_by_user_id");

-- -------------------------------------------------------------------------
-- Step 17: Evidence may be included in an approval-request version's
-- frozen set at most once (GD-M38-1 Decision 14) — the composite primary
-- key from Step 9 already enforces this; no additional index needed.
-- -------------------------------------------------------------------------

-- -------------------------------------------------------------------------
-- Step 18: Partial unique index — at most one active PENDING
-- ApprovalRequest per DecisionCase (GD-M38-1 Decision 8/16).
-- Cannot be expressed as Prisma @@unique — would generate a non-partial
-- constraint blocking legitimate resubmission/supersession after a
-- terminal outcome. Lives in migration SQL only, following the same idiom
-- as Offer's "one active offer per application" partial index
-- (20260630100000_m18b_offers/migration.sql) and ElevationSession's
-- "one non-terminal session per grantee" partial index
-- (20260801000000_m37_elevation_sessions/migration.sql) — this is the
-- third reuse of this exact idiom. A concurrent second PENDING request for
-- the same case fails deterministically at this database layer (P2002 on
-- this index), not merely at the service layer.
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX "idx_approval_requests_tenant_case_pending"
    ON "decisions"."approval_requests"("tenant_id", "decision_case_id")
    WHERE "status" = 'PENDING';

-- -------------------------------------------------------------------------
-- Step 19: CHECK constraints
-- GD-M38-1 Decision 6 — DecisionCase.subjectType = GENERAL requires a NULL
-- subject_id; every other subjectType requires a NON-NULL subject_id.
-- Reused identically for EvidenceItem.sourceType/sourceId.
-- -------------------------------------------------------------------------
ALTER TABLE "decisions"."decision_cases"
    ADD CONSTRAINT "chk_decision_cases_subject_id_matches_type"
    CHECK (
        ("subject_type" = 'GENERAL' AND "subject_id" IS NULL)
        OR ("subject_type" <> 'GENERAL' AND "subject_id" IS NOT NULL)
    );

ALTER TABLE "decisions"."evidence_items"
    ADD CONSTRAINT "chk_evidence_items_source_id_matches_type"
    CHECK (
        ("source_type" = 'GENERAL' AND "source_id" IS NULL)
        OR ("source_type" <> 'GENERAL' AND "source_id" IS NOT NULL)
    );

-- GD-M38-1 Decision 15 — ElevationSession scope-consistency invariants.
-- TENANT requires both scope target columns NULL; DEPARTMENT requires
-- scope_department_id set and scope_decision_case_id NULL; DECISION_CASE
-- requires scope_decision_case_id set and scope_department_id NULL. When
-- scope_type = DECISION_CASE, the scope case must equal the session's own
-- correlating decision_case_id (no exception is authorized by GD-M38-1).
ALTER TABLE "identity"."elevation_sessions"
    ADD CONSTRAINT "chk_elevation_sessions_scope_consistency"
    CHECK (
        ("scope_type" = 'TENANT' AND "scope_department_id" IS NULL AND "scope_decision_case_id" IS NULL)
        OR ("scope_type" = 'DEPARTMENT' AND "scope_department_id" IS NOT NULL AND "scope_decision_case_id" IS NULL)
        OR ("scope_type" = 'DECISION_CASE' AND "scope_decision_case_id" IS NOT NULL AND "scope_department_id" IS NULL)
    );

ALTER TABLE "identity"."elevation_sessions"
    ADD CONSTRAINT "chk_elevation_sessions_scope_case_matches_correlation"
    CHECK (
        "scope_type" <> 'DECISION_CASE'
        OR "scope_decision_case_id" = "decision_case_id"
    );
