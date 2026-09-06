// Governance authority: governance/GD-M38-1.md (M38 — Decision Case and
// Approval Foundation). Implements Decisions 7-9 (ApprovalRequest/
// ApprovalRequirement/ApprovalDecision separation and versioning),
// 11 (three-tier approval plans, including bidirectional Tier 3
// independence), and 12 (risk-trigger-driven escalation/supersession).
//
// Internal-service-only. No HTTP controller, route, DTO, or Swagger surface
// exists or may be added for this service (GD-M38-1 Decision 18). No
// existing controller or business workflow may call this service (GD-M38-1
// Decision 19). An APPROVED ApprovalRequest/DecisionCase is a modeled
// record only — it never executes or authorizes any business action
// (GD-M38-1 Decision 4).
//
// Every lifecycle-mutating method emits its audit event via
// AuditService.logEventStrict() from inside the same $transaction as the
// state mutation, reusing the exact GD-M37-1 Decision 14 write path
// unmodified. If the audit write fails, the whole transaction rolls back.

import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  DecisionCaseStatus,
  ApprovalRequestStatus,
  ApprovalDecisionValue,
  ApprovalTier,
  AuthorityCategory,
} from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import { resolveGovernedSubjectBeneficiaryUserId } from './decision-case-subject-resolver';
import {
  assertHumanActorQualifiesForCategory,
  ServiceActorNotPermittedViolation,
  ActorNotFoundViolation,
  ActorNotActiveViolation,
  ActorNotQualifiedViolation,
  RequiredCapabilityNotFoundViolation,
} from './authority-category-mapping';

// Case statuses from which a new ApprovalRequest version may be submitted:
//   OPEN               -> first-ever submission for this case
//   NEEDS_INFORMATION   -> resubmission after a NEEDS_INFORMATION decision
//   AWAITING_APPROVAL   -> pre-resolution escalation only (a new, explicit
//                          risk trigger arrived while the current PENDING
//                          request has not yet reached a terminal outcome;
//                          GD-M38-1 Decision 12). The existing PENDING
//                          request is superseded; any partial decisions
//                          recorded against it remain immutable history but
//                          no longer apply — the new version requires fresh
//                          decisions against its own requirement rows.
const SUBMITTABLE_CASE_STATUSES: DecisionCaseStatus[] = [
  DecisionCaseStatus.OPEN,
  DecisionCaseStatus.NEEDS_INFORMATION,
  DecisionCaseStatus.AWAITING_APPROVAL,
];

// ---------------------------------------------------------------------------
// Sentinel exceptions
// ---------------------------------------------------------------------------

class CaseNotFoundViolation extends Error {
  constructor() {
    super('CASE_NOT_FOUND');
  }
}

class InvalidCaseLifecycleStateViolation extends Error {
  constructor(public readonly actualStatus: DecisionCaseStatus) {
    super('INVALID_CASE_LIFECYCLE_STATE');
  }
}

class StaleCaseVersionViolation extends Error {
  constructor(
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super('STALE_CASE_VERSION');
  }
}

class ActiveRequestInconsistencyViolation extends Error {
  constructor() {
    super('ACTIVE_REQUEST_INCONSISTENCY');
  }
}

class InvalidActionAuthorityCapabilityViolation extends Error {
  constructor() {
    super('INVALID_ACTION_AUTHORITY_CAPABILITY');
  }
}

class DuplicatePendingRequestViolation extends Error {
  constructor() {
    super('DUPLICATE_PENDING_REQUEST');
  }
}

class RequestNotFoundViolation extends Error {
  constructor() {
    super('REQUEST_NOT_FOUND');
  }
}

class InvalidRequestLifecycleStateViolation extends Error {
  constructor(public readonly actualStatus: ApprovalRequestStatus) {
    super('INVALID_REQUEST_LIFECYCLE_STATE');
  }
}

class RequirementNotFoundViolation extends Error {
  constructor() {
    super('REQUIREMENT_NOT_FOUND');
  }
}

class RequirementAlreadyDecidedViolation extends Error {
  constructor() {
    super('REQUIREMENT_ALREADY_DECIDED');
  }
}

// GD-M38-1 Decision 11 — Tier 1: the decider must differ from the case's
// substantive preparer. Tier 3: the reviewer must differ from the
// preparer, the beneficiary (if any), and every existing Tier 1/2 decider.
class PreparerSeparationViolation extends Error {
  constructor() {
    super('PREPARER_SEPARATION_VIOLATION');
  }
}

class BeneficiarySeparationViolation extends Error {
  constructor() {
    super('BENEFICIARY_SEPARATION_VIOLATION');
  }
}

// Bidirectional Tier 3 independence (GD-M38-1 Decision 11): a Tier 3
// decision cannot be made by an existing Tier 1/2 decider on this request,
// and — symmetrically — a later Tier 1/2 decision cannot be submitted by
// the request's existing Tier 3 reviewer.
class TierIndependenceViolation extends Error {
  constructor() {
    super('TIER_INDEPENDENCE_VIOLATION');
  }
}

class DuplicateDeciderOnRequestViolation extends Error {
  constructor() {
    super('DUPLICATE_DECIDER_ON_REQUEST');
  }
}

// ---------------------------------------------------------------------------
// submitApprovalRequest()
// ---------------------------------------------------------------------------

export interface SubmitApprovalRequestInput {
  tenantId: string;
  decisionCaseId: string;
  expectedCaseVersion: number;
  submittedByUserId: string; // audit actor only — no distinctness rule enforced against it here
  basePlanType: 'TIER_1' | 'TIER_2';
  actionAuthorityCapabilityId?: string; // required and used only when basePlanType === 'TIER_1'
}

export interface ApprovalRequirementSummary {
  id: string;
  requiredAuthorityCategory: AuthorityCategory;
  requiredCapabilityId: string | null;
  tier: ApprovalTier;
}

export interface ApprovalRequestSummary {
  id: string;
  tenantId: string;
  decisionCaseId: string;
  version: number;
  supersedesRequestId: string | null;
  status: ApprovalRequestStatus;
  requirements: ApprovalRequirementSummary[];
}

export type SubmitApprovalRequestResult =
  | { outcome: 'SUCCESS'; request: ApprovalRequestSummary }
  | { outcome: 'CASE_NOT_FOUND' }
  | { outcome: 'INVALID_CASE_LIFECYCLE_STATE'; actualStatus: DecisionCaseStatus }
  | { outcome: 'STALE_CASE_VERSION'; expectedVersion: number; actualVersion: number }
  | { outcome: 'INVALID_ACTION_AUTHORITY_CAPABILITY' }
  | { outcome: 'DUPLICATE_PENDING_REQUEST' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// recordApprovalDecision()
// ---------------------------------------------------------------------------

export interface RecordApprovalDecisionInput {
  tenantId: string;
  approvalRequestId: string;
  approvalRequirementId: string;
  decidedByUserId: string;
  decision: 'GRANTED' | 'REJECTED' | 'NEEDS_INFORMATION';
  reason: string;
}

export type RecordApprovalDecisionResult =
  | { outcome: 'SUCCESS_PENDING'; request: ApprovalRequestSummary }
  | { outcome: 'SUCCESS_REQUEST_APPROVED'; request: ApprovalRequestSummary }
  | { outcome: 'SUCCESS_REQUEST_REJECTED'; request: ApprovalRequestSummary }
  | { outcome: 'SUCCESS_REQUEST_NEEDS_INFORMATION'; request: ApprovalRequestSummary }
  | { outcome: 'REQUEST_NOT_FOUND' }
  | { outcome: 'INVALID_REQUEST_LIFECYCLE_STATE'; actualStatus: ApprovalRequestStatus }
  | { outcome: 'REQUIREMENT_NOT_FOUND' }
  | { outcome: 'REQUIREMENT_ALREADY_DECIDED' }
  | { outcome: 'INVALID_REASON' }
  | { outcome: 'ACTOR_NOT_FOUND' }
  | { outcome: 'ACTOR_NOT_ACTIVE' }
  | { outcome: 'ACTOR_NOT_QUALIFIED' }
  | { outcome: 'SERVICE_ACTOR_NOT_PERMITTED' }
  | { outcome: 'PREPARER_SEPARATION_VIOLATION' }
  | { outcome: 'BENEFICIARY_SEPARATION_VIOLATION' }
  | { outcome: 'TIER_INDEPENDENCE_VIOLATION' }
  | { outcome: 'DUPLICATE_DECIDER_ON_REQUEST' }
  | { outcome: 'INTERNAL_ERROR' };

type RequirementWithDecision = Prisma.ApprovalRequirementGetPayload<{ include: { decision: true } }>;

function toRequirementSummary(r: RequirementWithDecision): ApprovalRequirementSummary {
  return {
    id: r.id,
    requiredAuthorityCategory: r.requiredAuthorityCategory,
    requiredCapabilityId: r.requiredCapabilityId,
    tier: r.tier,
  };
}

function toRequestSummary(
  request: { id: string; tenantId: string; decisionCaseId: string; version: number; supersedesRequestId: string | null; status: ApprovalRequestStatus },
  requirements: RequirementWithDecision[],
): ApprovalRequestSummary {
  return {
    id: request.id,
    tenantId: request.tenantId,
    decisionCaseId: request.decisionCaseId,
    version: request.version,
    supersedesRequestId: request.supersedesRequestId,
    status: request.status,
    requirements: requirements.map(toRequirementSummary),
  };
}

// ---------------------------------------------------------------------------
// ApprovalService
// ---------------------------------------------------------------------------

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // GD-M38-1 Decision 7/8/16 — builds and freezes ONE complete requirement
  // set and evidence snapshot per request version, transactionally. Every
  // requirement is created here, at submission time, and is never mutated
  // or extended afterward for this version.
  async submitApprovalRequest(input: SubmitApprovalRequestInput): Promise<SubmitApprovalRequestResult> {
    if (input.basePlanType === 'TIER_1' && !input.actionAuthorityCapabilityId) {
      return { outcome: 'INVALID_ACTION_AUTHORITY_CAPABILITY' };
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const decisionCase = await tx.decisionCase.findFirst({
          where: { id: input.decisionCaseId, tenantId: input.tenantId },
        });
        if (!decisionCase) throw new CaseNotFoundViolation();
        if (!SUBMITTABLE_CASE_STATUSES.includes(decisionCase.status)) {
          throw new InvalidCaseLifecycleStateViolation(decisionCase.status);
        }
        if (decisionCase.version !== input.expectedCaseVersion) {
          throw new StaleCaseVersionViolation(input.expectedCaseVersion, decisionCase.version);
        }

        const existingPending = await tx.approvalRequest.findFirst({
          where: { decisionCaseId: input.decisionCaseId, status: ApprovalRequestStatus.PENDING },
        });

        // A PENDING request must exist iff the case is AWAITING_APPROVAL —
        // any other combination is an internal consistency failure, not a
        // normal rejection outcome.
        if (decisionCase.status === DecisionCaseStatus.AWAITING_APPROVAL && !existingPending) {
          throw new ActiveRequestInconsistencyViolation();
        }
        if (decisionCase.status !== DecisionCaseStatus.AWAITING_APPROVAL && existingPending) {
          throw new DuplicatePendingRequestViolation();
        }

        let previous = existingPending;
        if (!previous && decisionCase.status === DecisionCaseStatus.NEEDS_INFORMATION) {
          previous = await tx.approvalRequest.findFirst({
            where: { decisionCaseId: input.decisionCaseId, status: ApprovalRequestStatus.NEEDS_INFORMATION },
            orderBy: { version: 'desc' },
          });
        }

        const newVersion = (previous?.version ?? 0) + 1;

        // GD-M38-1 Decision 11 — base plan requirements.
        type RequirementCreateInput = {
          requiredAuthorityCategory: AuthorityCategory;
          requiredCapabilityId: string | null;
          tier: ApprovalTier;
        };
        const requirementInputs: RequirementCreateInput[] = [];

        if (input.basePlanType === 'TIER_1') {
          const permission = await tx.permission.findUnique({
            where: { id: input.actionAuthorityCapabilityId! },
          });
          if (!permission) throw new InvalidActionAuthorityCapabilityViolation();
          requirementInputs.push({
            requiredAuthorityCategory: AuthorityCategory.ACTION_AUTHORITY,
            requiredCapabilityId: permission.id,
            tier: ApprovalTier.TIER_1,
          });
        } else {
          requirementInputs.push(
            {
              requiredAuthorityCategory: AuthorityCategory.DEPARTMENT_OR_HIRING_AUTHORITY,
              requiredCapabilityId: null,
              tier: ApprovalTier.TIER_2,
            },
            {
              requiredAuthorityCategory: AuthorityCategory.HR_AUTHORITY,
              requiredCapabilityId: null,
              tier: ApprovalTier.TIER_2,
            },
          );
        }

        // GD-M38-1 Decision 11/12 — any explicit risk trigger not yet
        // included in a prior plan adds ONE Independent Oversight Reviewer
        // requirement to THIS SAME version (never a separate simultaneous
        // request).
        const pendingTriggers = await tx.decisionCaseRiskTrigger.findMany({
          where: { decisionCaseId: input.decisionCaseId, includedInApprovalPlan: false },
          select: { id: true },
        });
        if (pendingTriggers.length > 0) {
          requirementInputs.push({
            requiredAuthorityCategory: AuthorityCategory.INDEPENDENT_OVERSIGHT_REVIEWER,
            requiredCapabilityId: null,
            tier: ApprovalTier.TIER_3,
          });
        }

        if (previous) {
          await tx.approvalRequest.update({
            where: { id: previous.id },
            data: { status: ApprovalRequestStatus.SUPERSEDED, decidedAt: new Date() },
          });

          await this.auditService.logEventStrict(tx, {
            tenantId: input.tenantId,
            userId: input.submittedByUserId,
            action: AuditEventType.APPROVAL_REQUEST_SUPERSEDED,
            result: 'SUCCESS',
            entityType: 'APPROVAL_REQUEST',
            entityId: previous.id,
            metadata: { supersededByVersion: newVersion },
          });
        }

        const createdRequest = await tx.approvalRequest.create({
          data: {
            tenantId: input.tenantId,
            decisionCaseId: input.decisionCaseId,
            version: newVersion,
            supersedesRequestId: previous?.id ?? null,
            status: ApprovalRequestStatus.PENDING,
            requirements: { create: requirementInputs },
          },
          include: { requirements: { include: { decision: true } } },
        });

        // GD-M38-1 Decision 14 — freeze the exact evidence set that exists
        // on the case as of this submission moment.
        const evidenceItems = await tx.evidenceItem.findMany({
          where: { decisionCaseId: input.decisionCaseId, tenantId: input.tenantId },
          select: { id: true },
        });
        if (evidenceItems.length > 0) {
          await tx.approvalRequestEvidence.createMany({
            data: evidenceItems.map((e) => ({ approvalRequestId: createdRequest.id, evidenceItemId: e.id })),
            skipDuplicates: true,
          });
        }

        if (pendingTriggers.length > 0) {
          await tx.decisionCaseRiskTrigger.updateMany({
            where: { id: { in: pendingTriggers.map((t) => t.id) } },
            data: { includedInApprovalPlan: true },
          });
        }

        await tx.decisionCase.update({
          where: { id: input.decisionCaseId },
          data: { status: DecisionCaseStatus.AWAITING_APPROVAL, version: { increment: 1 } },
        });

        await this.auditService.logEventStrict(tx, {
          tenantId: input.tenantId,
          userId: input.submittedByUserId,
          action: AuditEventType.APPROVAL_REQUEST_SUBMITTED,
          result: 'SUCCESS',
          entityType: 'APPROVAL_REQUEST',
          entityId: createdRequest.id,
          metadata: { decisionCaseId: input.decisionCaseId, version: newVersion, requirementCount: requirementInputs.length },
        });

        if (decisionCase.status === DecisionCaseStatus.NEEDS_INFORMATION) {
          await this.auditService.logEventStrict(tx, {
            tenantId: input.tenantId,
            userId: input.submittedByUserId,
            action: AuditEventType.DECISION_CASE_RESUBMITTED,
            result: 'SUCCESS',
            entityType: 'DECISION_CASE',
            entityId: input.decisionCaseId,
            metadata: { newApprovalRequestId: createdRequest.id },
          });
        }

        return createdRequest;
      });

      return { outcome: 'SUCCESS', request: toRequestSummary(created, created.requirements) };
    } catch (error) {
      if (error instanceof CaseNotFoundViolation) return { outcome: 'CASE_NOT_FOUND' };
      if (error instanceof InvalidCaseLifecycleStateViolation) {
        return { outcome: 'INVALID_CASE_LIFECYCLE_STATE', actualStatus: error.actualStatus };
      }
      if (error instanceof StaleCaseVersionViolation) {
        return { outcome: 'STALE_CASE_VERSION', expectedVersion: error.expectedVersion, actualVersion: error.actualVersion };
      }
      if (error instanceof InvalidActionAuthorityCapabilityViolation) {
        return { outcome: 'INVALID_ACTION_AUTHORITY_CAPABILITY' };
      }
      if (error instanceof DuplicatePendingRequestViolation || error instanceof ActiveRequestInconsistencyViolation) {
        return { outcome: 'DUPLICATE_PENDING_REQUEST' };
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Database-layer backstop for the partial unique index
        // (idx_approval_requests_tenant_case_pending) under concurrent
        // submission — fails closed rather than propagating a raw
        // constraint violation.
        return { outcome: 'DUPLICATE_PENDING_REQUEST' };
      }
      this.logger.error(
        `submitApprovalRequest failed: decisionCaseId=${input.decisionCaseId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  // GD-M38-1 Decision 9/11 — creates exactly one append-only, immutable
  // ApprovalDecision row and resolves the parent request/case per Decision
  // 8's fail-fast rules: all GRANTED -> APPROVED; any REJECTED -> REJECTED
  // immediately (no fabricated rows for remaining requirements); any
  // NEEDS_INFORMATION -> NEEDS_INFORMATION immediately.
  async recordApprovalDecision(input: RecordApprovalDecisionInput): Promise<RecordApprovalDecisionResult> {
    const reason = input.reason.trim();
    if (reason.length === 0) {
      return { outcome: 'INVALID_REASON' };
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const request = await tx.approvalRequest.findFirst({
          where: { id: input.approvalRequestId, tenantId: input.tenantId },
          include: {
            requirements: { include: { decision: true } },
            decisionCase: true,
          },
        });
        if (!request) throw new RequestNotFoundViolation();
        if (request.status !== ApprovalRequestStatus.PENDING) {
          throw new InvalidRequestLifecycleStateViolation(request.status);
        }

        const requirement = request.requirements.find((r) => r.id === input.approvalRequirementId);
        if (!requirement) throw new RequirementNotFoundViolation();
        if (requirement.decision) throw new RequirementAlreadyDecidedViolation();

        const qualificationSnapshot = await assertHumanActorQualifiesForCategory(
          tx,
          input.tenantId,
          input.decidedByUserId,
          requirement.requiredAuthorityCategory,
          requirement.requiredCapabilityId,
        );

        const decisionCase = request.decisionCase;

        if (requirement.tier === ApprovalTier.TIER_1) {
          if (input.decidedByUserId === decisionCase.preparedByUserId) {
            throw new PreparerSeparationViolation();
          }
        }

        if (requirement.tier === ApprovalTier.TIER_3) {
          if (input.decidedByUserId === decisionCase.preparedByUserId) {
            throw new PreparerSeparationViolation();
          }
          const beneficiaryUserId = await resolveGovernedSubjectBeneficiaryUserId(
            tx,
            input.tenantId,
            decisionCase.subjectType,
            decisionCase.subjectId,
          );
          if (beneficiaryUserId && input.decidedByUserId === beneficiaryUserId) {
            throw new BeneficiarySeparationViolation();
          }
          const anyBaseTierDeciderMatches = request.requirements.some(
            (r) => r.tier !== ApprovalTier.TIER_3 && r.decision?.decidedByUserId === input.decidedByUserId,
          );
          if (anyBaseTierDeciderMatches) throw new TierIndependenceViolation();
        } else {
          // Tier 1/2 — a later base-tier decision may never be submitted by
          // this request's existing Tier 3 reviewer (bidirectional check).
          const tier3DeciderMatches = request.requirements.some(
            (r) => r.tier === ApprovalTier.TIER_3 && r.decision?.decidedByUserId === input.decidedByUserId,
          );
          if (tier3DeciderMatches) throw new TierIndependenceViolation();
        }

        const decisionValue = input.decision as ApprovalDecisionValue;

        try {
          await tx.approvalDecision.create({
            data: {
              approvalRequirementId: requirement.id,
              approvalRequestId: request.id,
              decidedByUserId: input.decidedByUserId,
              decision: decisionValue,
              reason,
              qualificationSnapshot,
              evidenceSetVersion: request.version,
            },
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const target = String(error.meta?.['target'] ?? '');
            if (target.toLowerCase().includes('requirement')) {
              throw new RequirementAlreadyDecidedViolation();
            }
            throw new DuplicateDeciderOnRequestViolation();
          }
          throw error;
        }

        const auditActionForDecision: Record<ApprovalDecisionValue, AuditEventType> = {
          GRANTED: AuditEventType.APPROVAL_DECISION_GRANTED,
          REJECTED: AuditEventType.APPROVAL_DECISION_REJECTED,
          NEEDS_INFORMATION: AuditEventType.APPROVAL_DECISION_NEEDS_INFORMATION,
        };

        await this.auditService.logEventStrict(tx, {
          tenantId: input.tenantId,
          userId: input.decidedByUserId,
          action: auditActionForDecision[decisionValue],
          result: 'SUCCESS',
          entityType: 'APPROVAL_REQUEST',
          entityId: request.id,
          metadata: { approvalRequirementId: requirement.id, decision: decisionValue },
        });

        // GD-M38-1 Decision 8 — fail-fast resolution.
        if (decisionValue === ApprovalDecisionValue.REJECTED) {
          await tx.approvalRequest.update({
            where: { id: request.id },
            data: { status: ApprovalRequestStatus.REJECTED, decidedAt: new Date() },
          });
          await tx.decisionCase.update({
            where: { id: decisionCase.id },
            data: { status: DecisionCaseStatus.REJECTED, version: { increment: 1 } },
          });
          await this.auditService.logEventStrict(tx, {
            tenantId: input.tenantId,
            userId: input.decidedByUserId,
            action: AuditEventType.DECISION_CASE_REJECTED,
            result: 'SUCCESS',
            entityType: 'DECISION_CASE',
            entityId: decisionCase.id,
          });
          return { kind: 'REQUEST_REJECTED' as const, requestId: request.id };
        }

        if (decisionValue === ApprovalDecisionValue.NEEDS_INFORMATION) {
          await tx.approvalRequest.update({
            where: { id: request.id },
            data: { status: ApprovalRequestStatus.NEEDS_INFORMATION, decidedAt: new Date() },
          });
          await tx.decisionCase.update({
            where: { id: decisionCase.id },
            data: { status: DecisionCaseStatus.NEEDS_INFORMATION, version: { increment: 1 } },
          });
          await this.auditService.logEventStrict(tx, {
            tenantId: input.tenantId,
            userId: input.decidedByUserId,
            action: AuditEventType.DECISION_CASE_NEEDS_INFORMATION,
            result: 'SUCCESS',
            entityType: 'DECISION_CASE',
            entityId: decisionCase.id,
          });
          return { kind: 'REQUEST_NEEDS_INFORMATION' as const, requestId: request.id };
        }

        // GRANTED — only resolves to APPROVED once every requirement has a
        // GRANTED decision (full-set agreement, not a derived partial
        // subset — a deliberate departure from M37's ElevationSession
        // partial-grant model).
        const totalRequirements = request.requirements.length;
        const grantedCount = await tx.approvalDecision.count({
          where: { approvalRequestId: request.id, decision: ApprovalDecisionValue.GRANTED },
        });

        if (grantedCount < totalRequirements) {
          return { kind: 'PENDING' as const, requestId: request.id };
        }

        await tx.approvalRequest.update({
          where: { id: request.id },
          data: { status: ApprovalRequestStatus.APPROVED, decidedAt: new Date() },
        });
        await tx.decisionCase.update({
          where: { id: decisionCase.id },
          data: { status: DecisionCaseStatus.APPROVED, version: { increment: 1 } },
        });
        await this.auditService.logEventStrict(tx, {
          tenantId: input.tenantId,
          userId: input.decidedByUserId,
          action: AuditEventType.DECISION_CASE_APPROVED,
          result: 'SUCCESS',
          entityType: 'DECISION_CASE',
          entityId: decisionCase.id,
        });
        return { kind: 'REQUEST_APPROVED' as const, requestId: request.id };
      });

      const finalRequest = await this.prisma.approvalRequest.findFirstOrThrow({
        where: { id: result.requestId },
        include: { requirements: { include: { decision: true } } },
      });
      const summary = toRequestSummary(finalRequest, finalRequest.requirements);

      switch (result.kind) {
        case 'PENDING':
          return { outcome: 'SUCCESS_PENDING', request: summary };
        case 'REQUEST_APPROVED':
          return { outcome: 'SUCCESS_REQUEST_APPROVED', request: summary };
        case 'REQUEST_REJECTED':
          return { outcome: 'SUCCESS_REQUEST_REJECTED', request: summary };
        case 'REQUEST_NEEDS_INFORMATION':
          return { outcome: 'SUCCESS_REQUEST_NEEDS_INFORMATION', request: summary };
      }
    } catch (error) {
      if (error instanceof RequestNotFoundViolation) return { outcome: 'REQUEST_NOT_FOUND' };
      if (error instanceof InvalidRequestLifecycleStateViolation) {
        return { outcome: 'INVALID_REQUEST_LIFECYCLE_STATE', actualStatus: error.actualStatus };
      }
      if (error instanceof RequirementNotFoundViolation) return { outcome: 'REQUIREMENT_NOT_FOUND' };
      if (error instanceof RequirementAlreadyDecidedViolation) return { outcome: 'REQUIREMENT_ALREADY_DECIDED' };
      if (error instanceof ServiceActorNotPermittedViolation) return { outcome: 'SERVICE_ACTOR_NOT_PERMITTED' };
      if (error instanceof ActorNotFoundViolation) return { outcome: 'ACTOR_NOT_FOUND' };
      if (error instanceof ActorNotActiveViolation) return { outcome: 'ACTOR_NOT_ACTIVE' };
      if (error instanceof ActorNotQualifiedViolation) return { outcome: 'ACTOR_NOT_QUALIFIED' };
      if (error instanceof RequiredCapabilityNotFoundViolation) return { outcome: 'ACTOR_NOT_QUALIFIED' };
      if (error instanceof PreparerSeparationViolation) return { outcome: 'PREPARER_SEPARATION_VIOLATION' };
      if (error instanceof BeneficiarySeparationViolation) return { outcome: 'BENEFICIARY_SEPARATION_VIOLATION' };
      if (error instanceof TierIndependenceViolation) return { outcome: 'TIER_INDEPENDENCE_VIOLATION' };
      if (error instanceof DuplicateDeciderOnRequestViolation) return { outcome: 'DUPLICATE_DECIDER_ON_REQUEST' };
      this.logger.error(
        `recordApprovalDecision failed: approvalRequestId=${input.approvalRequestId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  // Tenant-scoped read helper.
  async getApprovalRequestById(id: string, tenantId: string): Promise<ApprovalRequestSummary | null> {
    const row = await this.prisma.approvalRequest.findFirst({
      where: { id, tenantId },
      include: { requirements: { include: { decision: true } } },
    });
    return row ? toRequestSummary(row, row.requirements) : null;
  }
}
