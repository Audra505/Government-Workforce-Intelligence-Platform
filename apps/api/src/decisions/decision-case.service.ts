// Governance authority: governance/GD-M38-1.md (M38 — Decision Case and
// Approval Foundation). Implements Decisions 6 (Decision Case lifecycle),
// 10 (initiator/preparer/actor validation), 12 (risk triggers), and 14
// (evidence) for the DecisionCase entity itself.
//
// Internal-service-only. No HTTP controller, route, DTO, or Swagger surface
// exists or may be added for this service (GD-M38-1 Decision 18). No
// existing controller or business workflow may call this service (GD-M38-1
// Decision 19). An APPROVED DecisionCase is a modeled record only — it
// never executes or authorizes any business action (GD-M38-1 Decision 4).
//
// Every lifecycle-mutating method emits its audit event via
// AuditService.logEventStrict() from inside the same $transaction as the
// state mutation (reusing the exact GD-M37-1 Decision 14 write path
// unmodified). If the audit write fails, the whole transaction rolls back.

import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  DecisionCaseStatus,
  DecisionCaseSubjectType,
  DecisionCaseRiskTriggerType,
  ProvenanceType,
  EvidenceType,
  EvidenceSensitivityClassification,
} from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import {
  assertGovernedSubjectExists,
  SubjectNotFoundViolation,
  InvalidSubjectReferenceViolation,
} from './decision-case-subject-resolver';

// ---------------------------------------------------------------------------
// Record types
// ---------------------------------------------------------------------------

export interface DecisionCaseRecord {
  id: string;
  tenantId: string;
  subjectType: DecisionCaseSubjectType;
  subjectId: string | null;
  initiatedByUserId: string;
  preparedByUserId: string;
  purpose: string;
  status: DecisionCaseStatus;
  idempotencyKey: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

function toDecisionCaseRecord(row: {
  id: string;
  tenantId: string;
  subjectType: DecisionCaseSubjectType;
  subjectId: string | null;
  initiatedByUserId: string;
  preparedByUserId: string;
  purpose: string;
  status: DecisionCaseStatus;
  idempotencyKey: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): DecisionCaseRecord {
  return { ...row };
}

// Non-terminal statuses — the only statuses from which evidence/risk
// triggers may be attached and the case may be cancelled (GD-M38-1
// Decision 6 — terminal-state immutability for APPROVED/REJECTED/CANCELLED).
const NON_TERMINAL_STATUSES: DecisionCaseStatus[] = [
  DecisionCaseStatus.OPEN,
  DecisionCaseStatus.AWAITING_APPROVAL,
  DecisionCaseStatus.NEEDS_INFORMATION,
];

// ---------------------------------------------------------------------------
// Sentinel exceptions — thrown inside $transaction callbacks, mirroring
// ElevationSessionService's established pattern (elevation-session.service.ts).
// ---------------------------------------------------------------------------

class CaseNotFoundViolation extends Error {
  constructor() {
    super('CASE_NOT_FOUND');
  }
}

class InvalidLifecycleStateViolation extends Error {
  constructor(public readonly actualStatus: DecisionCaseStatus) {
    super('INVALID_LIFECYCLE_STATE');
  }
}

class StaleVersionViolation extends Error {
  constructor(
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super('STALE_VERSION');
  }
}

// GD-M38-1 Decision 10 — initiator/preparer/every other actor must exist,
// belong to the same tenant, and be active. No service/system identity may
// occupy a human slot (mirrors GD-M37-1 Decision 7/15's actor-reference
// idiom — these columns carry no FK).
class ActorNotFoundOrInactiveViolation extends Error {
  constructor(
    public readonly actorRole: 'INITIATOR' | 'PREPARER' | 'RISK_TRIGGER_CREATOR' | 'EVIDENCE_PRODUCER' | 'CANCELLER',
    public readonly userId: string,
  ) {
    super('ACTOR_NOT_FOUND_OR_INACTIVE');
  }
}

class DuplicateIdempotencyKeyViolation extends Error {
  constructor() {
    super('DUPLICATE_IDEMPOTENCY_KEY');
  }
}

class RequesterMismatchViolation extends Error {
  constructor() {
    super('CANCELLER_MUST_BE_INITIATOR_OR_PREPARER');
  }
}

// ---------------------------------------------------------------------------
// createDecisionCase()
// ---------------------------------------------------------------------------

export interface CreateDecisionCaseInput {
  tenantId: string;
  subjectType: DecisionCaseSubjectType;
  subjectId: string | null;
  initiatedByUserId: string;
  preparedByUserId: string; // may equal initiatedByUserId — not assumed equivalent elsewhere
  purpose: string;
  idempotencyKey?: string;
}

export type CreateDecisionCaseResult =
  | { outcome: 'SUCCESS'; decisionCase: DecisionCaseRecord }
  | { outcome: 'INVALID_PURPOSE' }
  | { outcome: 'INVALID_SUBJECT_REFERENCE'; reason: string }
  | { outcome: 'SUBJECT_NOT_FOUND' }
  | { outcome: 'ACTOR_NOT_FOUND_OR_INACTIVE'; actorRole: 'INITIATOR' | 'PREPARER'; userId: string }
  | { outcome: 'DUPLICATE_IDEMPOTENCY_KEY' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// attachEvidence()
// ---------------------------------------------------------------------------

export interface AttachEvidenceInput {
  tenantId: string;
  decisionCaseId: string;
  evidenceType: EvidenceType;
  sensitivityClassification: EvidenceSensitivityClassification;
  sourceType: DecisionCaseSubjectType;
  sourceId: string | null;
  provenanceType: ProvenanceType;
  producedByUserId?: string | null; // required when provenanceType = HUMAN
  capturedAt: Date;
  summary?: string;
  integrityMetadata?: string;
}

export type AttachEvidenceResult =
  | { outcome: 'SUCCESS'; evidenceItemId: string }
  | { outcome: 'CASE_NOT_FOUND' }
  | { outcome: 'INVALID_LIFECYCLE_STATE'; actualStatus: DecisionCaseStatus }
  | { outcome: 'INVALID_SOURCE_REFERENCE'; reason: string }
  | { outcome: 'SOURCE_NOT_FOUND' }
  | { outcome: 'ACTOR_NOT_FOUND_OR_INACTIVE'; userId: string }
  | { outcome: 'HUMAN_PROVENANCE_REQUIRES_PRODUCER' }
  | { outcome: 'DETERMINISTIC_PROVENANCE_MUST_NOT_NAME_A_PRODUCER' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// recordRiskTrigger()
// ---------------------------------------------------------------------------

export interface RecordRiskTriggerInput {
  tenantId: string;
  decisionCaseId: string;
  triggerType: DecisionCaseRiskTriggerType;
  reason: string;
  sourceOrProvenance: ProvenanceType;
  createdByUserId?: string | null; // required when sourceOrProvenance = HUMAN
}

export type RecordRiskTriggerResult =
  | { outcome: 'SUCCESS'; riskTriggerId: string }
  | { outcome: 'CASE_NOT_FOUND' }
  | { outcome: 'INVALID_LIFECYCLE_STATE'; actualStatus: DecisionCaseStatus }
  | { outcome: 'INVALID_REASON' }
  | { outcome: 'ACTOR_NOT_FOUND_OR_INACTIVE'; userId: string }
  | { outcome: 'HUMAN_PROVENANCE_REQUIRES_CREATOR' }
  | { outcome: 'DETERMINISTIC_PROVENANCE_MUST_NOT_NAME_A_CREATOR' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// cancelDecisionCase()
// ---------------------------------------------------------------------------

export interface CancelDecisionCaseInput {
  tenantId: string;
  decisionCaseId: string;
  expectedVersion: number;
  cancelledByUserId: string; // must be the initiator or preparer (GD-M38-1 Decision 6)
}

export type CancelDecisionCaseResult =
  | { outcome: 'SUCCESS'; decisionCase: DecisionCaseRecord }
  | { outcome: 'CASE_NOT_FOUND' }
  | { outcome: 'INVALID_LIFECYCLE_STATE'; actualStatus: DecisionCaseStatus }
  | { outcome: 'STALE_VERSION'; expectedVersion: number; actualVersion: number }
  | { outcome: 'CANCELLER_MUST_BE_INITIATOR_OR_PREPARER' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// DecisionCaseService
// ---------------------------------------------------------------------------

@Injectable()
export class DecisionCaseService {
  private readonly logger = new Logger(DecisionCaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createDecisionCase(input: CreateDecisionCaseInput): Promise<CreateDecisionCaseResult> {
    const purpose = input.purpose.trim();
    if (purpose.length === 0) {
      return { outcome: 'INVALID_PURPOSE' };
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await this.assertActorActiveInTenant(tx, input.initiatedByUserId, input.tenantId, 'INITIATOR');
        await this.assertActorActiveInTenant(tx, input.preparedByUserId, input.tenantId, 'PREPARER');

        await assertGovernedSubjectExists(tx, input.tenantId, input.subjectType, input.subjectId);

        let row;
        try {
          row = await tx.decisionCase.create({
            data: {
              tenantId: input.tenantId,
              subjectType: input.subjectType,
              subjectId: input.subjectId,
              initiatedByUserId: input.initiatedByUserId,
              preparedByUserId: input.preparedByUserId,
              purpose,
              status: DecisionCaseStatus.OPEN,
              idempotencyKey: input.idempotencyKey?.trim() || null,
            },
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw new DuplicateIdempotencyKeyViolation();
          }
          throw error;
        }

        await this.auditService.logEventStrict(tx, {
          tenantId: input.tenantId,
          userId: input.initiatedByUserId,
          action: AuditEventType.DECISION_CASE_CREATED,
          result: 'SUCCESS',
          entityType: 'DECISION_CASE',
          entityId: row.id,
          metadata: { subjectType: input.subjectType, preparedByUserId: input.preparedByUserId },
        });

        return row;
      });

      return { outcome: 'SUCCESS', decisionCase: toDecisionCaseRecord(created) };
    } catch (error) {
      if (error instanceof ActorNotFoundOrInactiveViolation) {
        return {
          outcome: 'ACTOR_NOT_FOUND_OR_INACTIVE',
          actorRole: error.actorRole as 'INITIATOR' | 'PREPARER',
          userId: error.userId,
        };
      }
      if (error instanceof InvalidSubjectReferenceViolation) {
        return { outcome: 'INVALID_SUBJECT_REFERENCE', reason: error.reason };
      }
      if (error instanceof SubjectNotFoundViolation) {
        return { outcome: 'SUBJECT_NOT_FOUND' };
      }
      if (error instanceof DuplicateIdempotencyKeyViolation) {
        return { outcome: 'DUPLICATE_IDEMPOTENCY_KEY' };
      }
      this.logger.error(
        `createDecisionCase failed: tenantId=${input.tenantId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  // GD-M38-1 Decision 14 — append-only, immutable evidence. Never permitted
  // once the case has reached a terminal state.
  async attachEvidence(input: AttachEvidenceInput): Promise<AttachEvidenceResult> {
    if (input.provenanceType === ProvenanceType.HUMAN && !input.producedByUserId) {
      return { outcome: 'HUMAN_PROVENANCE_REQUIRES_PRODUCER' };
    }
    if (input.provenanceType === ProvenanceType.DETERMINISTIC_SYSTEM && input.producedByUserId) {
      return { outcome: 'DETERMINISTIC_PROVENANCE_MUST_NOT_NAME_A_PRODUCER' };
    }

    try {
      const evidenceItemId = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.decisionCase.findFirst({
          where: { id: input.decisionCaseId, tenantId: input.tenantId },
        });
        if (!existing) throw new CaseNotFoundViolation();
        if (!NON_TERMINAL_STATUSES.includes(existing.status)) {
          throw new InvalidLifecycleStateViolation(existing.status);
        }

        await assertGovernedSubjectExists(tx, input.tenantId, input.sourceType, input.sourceId);

        if (input.producedByUserId) {
          await this.assertActorActiveInTenant(tx, input.producedByUserId, input.tenantId, 'EVIDENCE_PRODUCER');
        }

        const row = await tx.evidenceItem.create({
          data: {
            tenantId: input.tenantId,
            decisionCaseId: input.decisionCaseId,
            evidenceType: input.evidenceType,
            sensitivityClassification: input.sensitivityClassification,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            provenanceType: input.provenanceType,
            producedByUserId: input.producedByUserId ?? null,
            capturedAt: input.capturedAt,
            summary: input.summary,
            integrityMetadata: input.integrityMetadata,
          },
        });

        await this.auditService.logEventStrict(tx, {
          tenantId: input.tenantId,
          userId: input.producedByUserId ?? existing.preparedByUserId,
          action: AuditEventType.DECISION_CASE_EVIDENCE_ATTACHED,
          result: 'SUCCESS',
          entityType: 'DECISION_CASE',
          entityId: input.decisionCaseId,
          metadata: { evidenceItemId: row.id, evidenceType: input.evidenceType },
        });

        return row.id;
      });

      return { outcome: 'SUCCESS', evidenceItemId };
    } catch (error) {
      if (error instanceof CaseNotFoundViolation) return { outcome: 'CASE_NOT_FOUND' };
      if (error instanceof InvalidLifecycleStateViolation) {
        return { outcome: 'INVALID_LIFECYCLE_STATE', actualStatus: error.actualStatus };
      }
      if (error instanceof InvalidSubjectReferenceViolation) {
        return { outcome: 'INVALID_SOURCE_REFERENCE', reason: error.reason };
      }
      if (error instanceof SubjectNotFoundViolation) return { outcome: 'SOURCE_NOT_FOUND' };
      if (error instanceof ActorNotFoundOrInactiveViolation) {
        return { outcome: 'ACTOR_NOT_FOUND_OR_INACTIVE', userId: error.userId };
      }
      this.logger.error(
        `attachEvidence failed: decisionCaseId=${input.decisionCaseId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  // GD-M38-1 Decision 12 — normalized, append-only risk-trigger record. No
  // automatic detection exists here; callers (internal services, tests)
  // supply explicit, already-classified triggers only.
  async recordRiskTrigger(input: RecordRiskTriggerInput): Promise<RecordRiskTriggerResult> {
    const reason = input.reason.trim();
    if (reason.length === 0) {
      return { outcome: 'INVALID_REASON' };
    }
    if (input.sourceOrProvenance === ProvenanceType.HUMAN && !input.createdByUserId) {
      return { outcome: 'HUMAN_PROVENANCE_REQUIRES_CREATOR' };
    }
    if (input.sourceOrProvenance === ProvenanceType.DETERMINISTIC_SYSTEM && input.createdByUserId) {
      return { outcome: 'DETERMINISTIC_PROVENANCE_MUST_NOT_NAME_A_CREATOR' };
    }

    try {
      const riskTriggerId = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.decisionCase.findFirst({
          where: { id: input.decisionCaseId, tenantId: input.tenantId },
        });
        if (!existing) throw new CaseNotFoundViolation();
        if (!NON_TERMINAL_STATUSES.includes(existing.status)) {
          throw new InvalidLifecycleStateViolation(existing.status);
        }

        if (input.createdByUserId) {
          await this.assertActorActiveInTenant(tx, input.createdByUserId, input.tenantId, 'RISK_TRIGGER_CREATOR');
        }

        const row = await tx.decisionCaseRiskTrigger.create({
          data: {
            tenantId: input.tenantId,
            decisionCaseId: input.decisionCaseId,
            triggerType: input.triggerType,
            reason,
            sourceOrProvenance: input.sourceOrProvenance,
            createdByUserId: input.createdByUserId ?? null,
            caseVersion: existing.version,
            includedInApprovalPlan: false,
          },
        });

        await this.auditService.logEventStrict(tx, {
          tenantId: input.tenantId,
          userId: input.createdByUserId ?? existing.preparedByUserId,
          action: AuditEventType.DECISION_CASE_RISK_TRIGGER_CREATED,
          result: 'SUCCESS',
          entityType: 'DECISION_CASE',
          entityId: input.decisionCaseId,
          metadata: { riskTriggerId: row.id, triggerType: input.triggerType },
        });

        return row.id;
      });

      return { outcome: 'SUCCESS', riskTriggerId };
    } catch (error) {
      if (error instanceof CaseNotFoundViolation) return { outcome: 'CASE_NOT_FOUND' };
      if (error instanceof InvalidLifecycleStateViolation) {
        return { outcome: 'INVALID_LIFECYCLE_STATE', actualStatus: error.actualStatus };
      }
      if (error instanceof ActorNotFoundOrInactiveViolation) {
        return { outcome: 'ACTOR_NOT_FOUND_OR_INACTIVE', userId: error.userId };
      }
      this.logger.error(
        `recordRiskTrigger failed: decisionCaseId=${input.decisionCaseId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  // GD-M38-1 Decision 6 — cancellation permitted only from a non-terminal
  // status, only by the initiator or preparer, and cascades to CANCEL any
  // still-PENDING ApprovalRequest for this case (a cancelled case can never
  // be left with a dangling PENDING request).
  async cancelDecisionCase(input: CancelDecisionCaseInput): Promise<CancelDecisionCaseResult> {
    try {
      const cancelled = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.decisionCase.findFirst({
          where: { id: input.decisionCaseId, tenantId: input.tenantId },
        });
        if (!existing) throw new CaseNotFoundViolation();
        if (!NON_TERMINAL_STATUSES.includes(existing.status)) {
          throw new InvalidLifecycleStateViolation(existing.status);
        }
        if (existing.version !== input.expectedVersion) {
          throw new StaleVersionViolation(input.expectedVersion, existing.version);
        }
        if (
          input.cancelledByUserId !== existing.initiatedByUserId &&
          input.cancelledByUserId !== existing.preparedByUserId
        ) {
          throw new RequesterMismatchViolation();
        }

        await tx.approvalRequest.updateMany({
          where: { decisionCaseId: input.decisionCaseId, status: 'PENDING' },
          data: { status: 'CANCELLED', decidedAt: new Date() },
        });

        const row = await tx.decisionCase.update({
          where: { id: input.decisionCaseId },
          data: { status: DecisionCaseStatus.CANCELLED, version: { increment: 1 } },
        });

        await this.auditService.logEventStrict(tx, {
          tenantId: input.tenantId,
          userId: input.cancelledByUserId,
          action: AuditEventType.DECISION_CASE_CANCELLED,
          result: 'SUCCESS',
          entityType: 'DECISION_CASE',
          entityId: input.decisionCaseId,
        });

        return row;
      });

      return { outcome: 'SUCCESS', decisionCase: toDecisionCaseRecord(cancelled) };
    } catch (error) {
      if (error instanceof CaseNotFoundViolation) return { outcome: 'CASE_NOT_FOUND' };
      if (error instanceof InvalidLifecycleStateViolation) {
        return { outcome: 'INVALID_LIFECYCLE_STATE', actualStatus: error.actualStatus };
      }
      if (error instanceof StaleVersionViolation) {
        return { outcome: 'STALE_VERSION', expectedVersion: error.expectedVersion, actualVersion: error.actualVersion };
      }
      if (error instanceof RequesterMismatchViolation) {
        return { outcome: 'CANCELLER_MUST_BE_INITIATOR_OR_PREPARER' };
      }
      this.logger.error(
        `cancelDecisionCase failed: decisionCaseId=${input.decisionCaseId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  // Tenant-scoped read. Returns null rather than throwing, so callers cannot
  // distinguish "wrong tenant" from "does not exist" (mirrors
  // ElevationSessionService.getElevationSessionById()'s pattern).
  async getDecisionCaseById(id: string, tenantId: string): Promise<DecisionCaseRecord | null> {
    const row = await this.prisma.decisionCase.findFirst({ where: { id, tenantId } });
    return row ? toDecisionCaseRecord(row) : null;
  }

  // GD-M38-1 Decision 10 — every actor slot (initiator, preparer, evidence
  // producer, risk-trigger creator, canceller) must exist, belong to the
  // same tenant, and be ACTIVE at the moment of the action. Actor-reference
  // columns carry no FK (mirrors GD-M37-1 Decision 15) — this is the only
  // enforcement mechanism and must never be silently omitted.
  private async assertActorActiveInTenant(
    tx: Prisma.TransactionClient,
    userId: string,
    tenantId: string,
    actorRole: 'INITIATOR' | 'PREPARER' | 'RISK_TRIGGER_CREATOR' | 'EVIDENCE_PRODUCER' | 'CANCELLER',
  ): Promise<void> {
    if (!userId) {
      throw new ActorNotFoundOrInactiveViolation(actorRole, userId);
    }
    const actor = await tx.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true, status: true },
    });
    if (!actor || actor.status !== 'ACTIVE') {
      throw new ActorNotFoundOrInactiveViolation(actorRole, userId);
    }
  }
}
