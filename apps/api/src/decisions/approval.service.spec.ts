// Governance authority: governance/GD-M38-1.md (Decisions 7, 8, 9, 11, 12, 16).
//
// Pure unit tests — no database, no HTTP. PrismaService and AuditService are
// replaced with jest.fn() mocks, following elevation-session.service.spec.ts's
// own $transaction-mocking pattern exactly. authority-category-mapping and
// decision-case-subject-resolver are partially mocked (real violation classes
// preserved via jest.requireActual, only the exported functions replaced) so
// qualification/beneficiary-resolution outcomes can be controlled per test
// without a real database.
/* eslint-disable */

import { Test, type TestingModule } from '@nestjs/testing';
import {
  Prisma,
  DecisionCaseStatus,
  ApprovalRequestStatus,
  ApprovalTier,
  AuthorityCategory,
  DecisionCaseSubjectType,
} from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import { ApprovalService } from './approval.service';

jest.mock('./authority-category-mapping', () => {
  const actual = jest.requireActual('./authority-category-mapping');
  return { ...actual, assertHumanActorQualifiesForCategory: jest.fn() };
});
jest.mock('./decision-case-subject-resolver', () => {
  const actual = jest.requireActual('./decision-case-subject-resolver');
  return { ...actual, resolveGovernedSubjectBeneficiaryUserId: jest.fn() };
});

import {
  assertHumanActorQualifiesForCategory,
  ActorNotQualifiedViolation,
  ActorNotFoundViolation,
  ActorNotActiveViolation,
  ServiceActorNotPermittedViolation,
} from './authority-category-mapping';
import { resolveGovernedSubjectBeneficiaryUserId } from './decision-case-subject-resolver';

const mockAssertQualifies = assertHumanActorQualifiesForCategory as jest.Mock;
const mockResolveBeneficiary = resolveGovernedSubjectBeneficiaryUserId as jest.Mock;

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CASE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PREPARER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const APPROVER_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const OTHER_APPROVER_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const REQUEST_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const REQUIREMENT_ID_1 = '11111111-1111-1111-1111-111111111111';
const REQUIREMENT_ID_2 = '22222222-2222-2222-2222-222222222222';
const REQUIREMENT_ID_3 = '33333333-3333-3333-3333-333333333333';
const CAPABILITY_PERMISSION_ID = '44444444-4444-4444-4444-444444444444';
const NOW = new Date('2026-09-05T12:00:00.000Z');

function makeCaseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CASE_ID,
    tenantId: TENANT_ID,
    subjectType: DecisionCaseSubjectType.GENERAL,
    subjectId: null,
    initiatedByUserId: PREPARER_ID,
    preparedByUserId: PREPARER_ID,
    purpose: 'Test case',
    status: DecisionCaseStatus.OPEN,
    idempotencyKey: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeRequirement(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUIREMENT_ID_1,
    approvalRequestId: REQUEST_ID,
    requiredAuthorityCategory: AuthorityCategory.ACTION_AUTHORITY,
    requiredCapabilityId: CAPABILITY_PERMISSION_ID,
    sequenceOrder: null,
    tier: ApprovalTier.TIER_1,
    createdAt: NOW,
    decision: null,
    ...overrides,
  };
}

function makeRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    tenantId: TENANT_ID,
    decisionCaseId: CASE_ID,
    version: 1,
    supersedesRequestId: null,
    status: ApprovalRequestStatus.PENDING,
    createdAt: NOW,
    decidedAt: null,
    requirements: [makeRequirement()],
    decisionCase: makeCaseRow(),
    ...overrides,
  };
}

describe('ApprovalService', () => {
  let service: ApprovalService;
  let mockPrisma: { approvalRequest: { findFirstOrThrow: jest.Mock }; $transaction: jest.Mock };
  let mockTx: {
    decisionCase: { findFirst: jest.Mock; update: jest.Mock };
    approvalRequest: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    permission: { findUnique: jest.Mock };
    decisionCaseRiskTrigger: { findMany: jest.Mock; updateMany: jest.Mock };
    evidenceItem: { findMany: jest.Mock };
    approvalRequestEvidence: { createMany: jest.Mock };
    approvalDecision: { create: jest.Mock; count: jest.Mock };
  };
  let mockAuditService: { logEvent: jest.Mock; logEventStrict: jest.Mock };

  beforeEach(async () => {
    mockAssertQualifies.mockReset().mockResolvedValue('QUALIFICATION_SNAPSHOT');
    mockResolveBeneficiary.mockReset().mockResolvedValue(null);

    mockTx = {
      decisionCase: {
        findFirst: jest.fn().mockResolvedValue(makeCaseRow()),
        update: jest.fn().mockResolvedValue(makeCaseRow()),
      },
      approvalRequest: {
        findFirst: jest.fn().mockResolvedValue(null), // no existing PENDING by default
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: REQUEST_ID,
          tenantId: TENANT_ID,
          decisionCaseId: data.decisionCaseId,
          version: data.version,
          supersedesRequestId: data.supersedesRequestId,
          status: data.status,
          requirements: data.requirements.create.map((r: any, i: number) => ({
            id: `generated-requirement-${i}`,
            approvalRequestId: REQUEST_ID,
            ...r,
            decision: null,
          })),
        })),
        update: jest.fn().mockResolvedValue(undefined),
      },
      permission: {
        findUnique: jest.fn().mockResolvedValue({ id: CAPABILITY_PERMISSION_ID, resource: 'users', action: 'create' }),
      },
      decisionCaseRiskTrigger: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      evidenceItem: { findMany: jest.fn().mockResolvedValue([]) },
      approvalRequestEvidence: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      approvalDecision: {
        create: jest.fn().mockResolvedValue({ id: 'decision-1' }),
        count: jest.fn().mockResolvedValue(1),
      },
    };

    mockPrisma = {
      approvalRequest: { findFirstOrThrow: jest.fn().mockResolvedValue(makeRequestRow()) },
      $transaction: jest.fn().mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
    };

    mockAuditService = {
      logEvent: jest.fn().mockResolvedValue(undefined),
      logEventStrict: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<ApprovalService>(ApprovalService);
  });

  afterEach(() => jest.clearAllMocks());

  // --------------------------------------------------------------------------
  // submitApprovalRequest()
  // --------------------------------------------------------------------------

  describe('submitApprovalRequest()', () => {
    const tier1Input = {
      tenantId: TENANT_ID,
      decisionCaseId: CASE_ID,
      expectedCaseVersion: 1,
      submittedByUserId: PREPARER_ID,
      basePlanType: 'TIER_1' as const,
      actionAuthorityCapabilityId: CAPABILITY_PERMISSION_ID,
    };

    it('SUCCESS: TIER_1 plan creates exactly one ACTION_AUTHORITY requirement', async () => {
      const result = await service.submitApprovalRequest(tier1Input);
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.request.requirements).toHaveLength(1);
        expect(result.request.requirements[0]!.requiredAuthorityCategory).toBe(AuthorityCategory.ACTION_AUTHORITY);
        expect(result.request.requirements[0]!.requiredCapabilityId).toBe(CAPABILITY_PERMISSION_ID);
      }
    });

    it('SUCCESS: TIER_2 plan creates exactly two requirements (DEPARTMENT_OR_HIRING_AUTHORITY, HR_AUTHORITY)', async () => {
      const result = await service.submitApprovalRequest({
        ...tier1Input,
        basePlanType: 'TIER_2',
        actionAuthorityCapabilityId: undefined,
      });
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.request.requirements).toHaveLength(2);
        const categories = result.request.requirements.map((r) => r.requiredAuthorityCategory).sort();
        expect(categories).toEqual(
          [AuthorityCategory.DEPARTMENT_OR_HIRING_AUTHORITY, AuthorityCategory.HR_AUTHORITY].sort(),
        );
      }
    });

    it('INVALID_ACTION_AUTHORITY_CAPABILITY: TIER_1 without actionAuthorityCapabilityId is rejected before any transaction opens', async () => {
      const result = await service.submitApprovalRequest({ ...tier1Input, actionAuthorityCapabilityId: undefined });
      expect(result.outcome).toBe('INVALID_ACTION_AUTHORITY_CAPABILITY');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('INVALID_ACTION_AUTHORITY_CAPABILITY: actionAuthorityCapabilityId does not resolve to a real Permission', async () => {
      mockTx.permission.findUnique.mockResolvedValue(null);
      const result = await service.submitApprovalRequest(tier1Input);
      expect(result.outcome).toBe('INVALID_ACTION_AUTHORITY_CAPABILITY');
    });

    it('CASE_NOT_FOUND: case absent or wrong tenant', async () => {
      mockTx.decisionCase.findFirst.mockResolvedValue(null);
      const result = await service.submitApprovalRequest(tier1Input);
      expect(result.outcome).toBe('CASE_NOT_FOUND');
    });

    it.each([DecisionCaseStatus.APPROVED, DecisionCaseStatus.REJECTED, DecisionCaseStatus.CANCELLED])(
      'INVALID_CASE_LIFECYCLE_STATE: a case in terminal status %s cannot accept a new submission',
      async (status) => {
        mockTx.decisionCase.findFirst.mockResolvedValue(makeCaseRow({ status }));
        const result = await service.submitApprovalRequest(tier1Input);
        expect(result.outcome).toBe('INVALID_CASE_LIFECYCLE_STATE');
      },
    );

    it('STALE_CASE_VERSION: expectedCaseVersion does not match the current row version', async () => {
      mockTx.decisionCase.findFirst.mockResolvedValue(makeCaseRow({ version: 9 }));
      const result = await service.submitApprovalRequest(tier1Input);
      expect(result.outcome).toBe('STALE_CASE_VERSION');
      expect((result as any).actualVersion).toBe(9);
    });

    it('DUPLICATE_PENDING_REQUEST: case is OPEN but a PENDING request already exists (internal consistency guard)', async () => {
      mockTx.approvalRequest.findFirst.mockResolvedValue(makeRequestRow());
      const result = await service.submitApprovalRequest(tier1Input);
      expect(result.outcome).toBe('DUPLICATE_PENDING_REQUEST');
    });

    it('DUPLICATE_PENDING_REQUEST: database P2002 backstop on the partial unique index is mapped, not propagated', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError('unique constraint', {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: { target: 'idx_approval_requests_tenant_case_pending' },
      });
      mockTx.approvalRequest.create.mockRejectedValue(p2002);
      const result = await service.submitApprovalRequest(tier1Input);
      expect(result.outcome).toBe('DUPLICATE_PENDING_REQUEST');
    });

    it('GD-M38-1 Decision 11/12: an explicit, not-yet-included risk trigger adds ONE Independent Oversight Reviewer requirement to the SAME version', async () => {
      mockTx.decisionCaseRiskTrigger.findMany.mockResolvedValue([{ id: 'trigger-1' }]);
      const result = await service.submitApprovalRequest(tier1Input);
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.request.requirements).toHaveLength(2);
        const tier3 = result.request.requirements.find((r) => r.tier === ApprovalTier.TIER_3);
        expect(tier3?.requiredAuthorityCategory).toBe(AuthorityCategory.INDEPENDENT_OVERSIGHT_REVIEWER);
      }
      expect(mockTx.decisionCaseRiskTrigger.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { includedInApprovalPlan: true } }),
      );
    });

    it('GD-M38-1 Decision 14: freezes every EvidenceItem currently on the case into ApprovalRequestEvidence', async () => {
      mockTx.evidenceItem.findMany.mockResolvedValue([{ id: 'ev-1' }, { id: 'ev-2' }]);
      await service.submitApprovalRequest(tier1Input);
      expect(mockTx.approvalRequestEvidence.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            { approvalRequestId: REQUEST_ID, evidenceItemId: 'ev-1' },
            { approvalRequestId: REQUEST_ID, evidenceItemId: 'ev-2' },
          ],
        }),
      );
    });

    it('GD-M38-1 Decision 8/16: resubmission after NEEDS_INFORMATION supersedes the prior request and bumps the version', async () => {
      mockTx.decisionCase.findFirst.mockResolvedValue(
        makeCaseRow({ status: DecisionCaseStatus.NEEDS_INFORMATION, version: 2 }),
      );
      // First call = existingPending lookup (filtered to PENDING) -> none.
      // Second call = the NEEDS_INFORMATION fallback lookup for `previous`.
      mockTx.approvalRequest.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeRequestRow({ status: ApprovalRequestStatus.NEEDS_INFORMATION, version: 1 }));
      const result = await service.submitApprovalRequest({ ...tier1Input, expectedCaseVersion: 2 });
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.request.version).toBe(2);
        expect(result.request.supersedesRequestId).toBe(REQUEST_ID);
      }
      expect(mockTx.approvalRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: REQUEST_ID },
          data: expect.objectContaining({ status: ApprovalRequestStatus.SUPERSEDED }),
        }),
      );
      expect(mockAuditService.logEventStrict).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: AuditEventType.APPROVAL_REQUEST_SUPERSEDED }),
      );
      expect(mockAuditService.logEventStrict).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: AuditEventType.DECISION_CASE_RESUBMITTED }),
      );
    });

    it('GD-M38-1 Decision 12: a risk trigger arriving while AWAITING_APPROVAL escalates via supersession without waiting for resolution', async () => {
      mockTx.decisionCase.findFirst.mockResolvedValue(
        makeCaseRow({ status: DecisionCaseStatus.AWAITING_APPROVAL, version: 2 }),
      );
      mockTx.approvalRequest.findFirst.mockResolvedValue(makeRequestRow({ version: 1 }));
      mockTx.decisionCaseRiskTrigger.findMany.mockResolvedValue([{ id: 'late-trigger' }]);
      const result = await service.submitApprovalRequest({ ...tier1Input, expectedCaseVersion: 2 });
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.request.version).toBe(2);
        expect(result.request.requirements.some((r) => r.tier === ApprovalTier.TIER_3)).toBe(true);
      }
    });

    it('SUCCESS: DECISION_CASE moves to AWAITING_APPROVAL and its version is incremented', async () => {
      await service.submitApprovalRequest(tier1Input);
      expect(mockTx.decisionCase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CASE_ID },
          data: expect.objectContaining({ status: DecisionCaseStatus.AWAITING_APPROVAL, version: { increment: 1 } }),
        }),
      );
    });

    it('SUCCESS: APPROVAL_REQUEST_SUBMITTED audit event emitted', async () => {
      await service.submitApprovalRequest(tier1Input);
      expect(mockAuditService.logEventStrict).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: AuditEventType.APPROVAL_REQUEST_SUBMITTED }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // recordApprovalDecision()
  // --------------------------------------------------------------------------

  describe('recordApprovalDecision()', () => {
    const baseInput = {
      tenantId: TENANT_ID,
      approvalRequestId: REQUEST_ID,
      approvalRequirementId: REQUIREMENT_ID_1,
      decidedByUserId: APPROVER_ID,
      decision: 'GRANTED' as const,
      reason: 'Verified qualification',
    };

    beforeEach(() => {
      // Default for this block: a real, decidable PENDING request exists.
      // Individual tests override with a more specific row/error as needed.
      mockTx.approvalRequest.findFirst.mockResolvedValue(makeRequestRow());
    });

    it('SUCCESS_REQUEST_APPROVED: the only requirement receives GRANTED — full-set agreement resolves the request and the case', async () => {
      mockTx.approvalRequest.findFirst.mockResolvedValue(makeRequestRow());
      mockTx.approvalDecision.count.mockResolvedValue(1); // 1 GRANTED / 1 total
      const result = await service.recordApprovalDecision(baseInput);
      expect(result.outcome).toBe('SUCCESS_REQUEST_APPROVED');
      expect(mockTx.approvalRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: ApprovalRequestStatus.APPROVED }) }),
      );
      expect(mockTx.decisionCase.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: DecisionCaseStatus.APPROVED }) }),
      );
      expect(mockAuditService.logEventStrict).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: AuditEventType.DECISION_CASE_APPROVED }),
      );
    });

    it('SUCCESS_PENDING: one of two requirements GRANTED — request stays PENDING, no case transition', async () => {
      mockTx.approvalRequest.findFirst.mockResolvedValue(
        makeRequestRow({
          requirements: [
            makeRequirement({ id: REQUIREMENT_ID_1, tier: ApprovalTier.TIER_2, requiredAuthorityCategory: AuthorityCategory.DEPARTMENT_OR_HIRING_AUTHORITY }),
            makeRequirement({ id: REQUIREMENT_ID_2, tier: ApprovalTier.TIER_2, requiredAuthorityCategory: AuthorityCategory.HR_AUTHORITY }),
          ],
        }),
      );
      mockTx.approvalDecision.count.mockResolvedValue(1); // 1 GRANTED / 2 total
      const result = await service.recordApprovalDecision(baseInput);
      expect(result.outcome).toBe('SUCCESS_PENDING');
      expect(mockTx.approvalRequest.update).not.toHaveBeenCalled();
      expect(mockTx.decisionCase.update).not.toHaveBeenCalled();
    });

    it('SUCCESS_REQUEST_REJECTED: a REJECTED decision resolves immediately (fail-fast), even with other requirements still undecided', async () => {
      mockTx.approvalRequest.findFirst.mockResolvedValue(
        makeRequestRow({
          requirements: [
            makeRequirement({ id: REQUIREMENT_ID_1 }),
            makeRequirement({ id: REQUIREMENT_ID_2, requiredAuthorityCategory: AuthorityCategory.HR_AUTHORITY }),
          ],
        }),
      );
      const result = await service.recordApprovalDecision({ ...baseInput, decision: 'REJECTED' });
      expect(result.outcome).toBe('SUCCESS_REQUEST_REJECTED');
      expect(mockTx.approvalRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: ApprovalRequestStatus.REJECTED }) }),
      );
      expect(mockTx.decisionCase.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: DecisionCaseStatus.REJECTED }) }),
      );
      // Fail-fast: no fabricated decision row is created for the remaining requirement.
      expect(mockTx.approvalDecision.create).toHaveBeenCalledTimes(1);
    });

    it('SUCCESS_REQUEST_NEEDS_INFORMATION: a NEEDS_INFORMATION decision resolves immediately (fail-fast)', async () => {
      const result = await service.recordApprovalDecision({ ...baseInput, decision: 'NEEDS_INFORMATION' });
      expect(result.outcome).toBe('SUCCESS_REQUEST_NEEDS_INFORMATION');
      expect(mockTx.decisionCase.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: DecisionCaseStatus.NEEDS_INFORMATION }) }),
      );
    });

    it('REQUEST_NOT_FOUND: request absent or wrong tenant', async () => {
      mockTx.approvalRequest.findFirst.mockResolvedValue(null);
      const result = await service.recordApprovalDecision(baseInput);
      expect(result.outcome).toBe('REQUEST_NOT_FOUND');
    });

    it.each([ApprovalRequestStatus.APPROVED, ApprovalRequestStatus.REJECTED, ApprovalRequestStatus.SUPERSEDED, ApprovalRequestStatus.CANCELLED])(
      'INVALID_REQUEST_LIFECYCLE_STATE: no decision is ever accepted after a request reaches terminal status %s',
      async (status) => {
        mockTx.approvalRequest.findFirst.mockResolvedValue(makeRequestRow({ status }));
        const result = await service.recordApprovalDecision(baseInput);
        expect(result.outcome).toBe('INVALID_REQUEST_LIFECYCLE_STATE');
        expect(mockTx.approvalDecision.create).not.toHaveBeenCalled();
      },
    );

    it('REQUIREMENT_NOT_FOUND: approvalRequirementId does not belong to this request', async () => {
      const result = await service.recordApprovalDecision({ ...baseInput, approvalRequirementId: 'not-a-real-id' });
      expect(result.outcome).toBe('REQUIREMENT_NOT_FOUND');
    });

    it('REQUIREMENT_ALREADY_DECIDED: the requirement already has a decision (immutability — never re-decided)', async () => {
      mockTx.approvalRequest.findFirst.mockResolvedValue(
        makeRequestRow({ requirements: [makeRequirement({ decision: { decidedByUserId: OTHER_APPROVER_ID } })] }),
      );
      const result = await service.recordApprovalDecision(baseInput);
      expect(result.outcome).toBe('REQUIREMENT_ALREADY_DECIDED');
    });

    it('INVALID_REASON: empty reason is rejected before any transaction opens', async () => {
      const result = await service.recordApprovalDecision({ ...baseInput, reason: '   ' });
      expect(result.outcome).toBe('INVALID_REASON');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('SERVICE_ACTOR_NOT_PERMITTED: the qualification resolver rejects a service/system identity', async () => {
      mockAssertQualifies.mockRejectedValue(new ServiceActorNotPermittedViolation(APPROVER_ID));
      const result = await service.recordApprovalDecision(baseInput);
      expect(result.outcome).toBe('SERVICE_ACTOR_NOT_PERMITTED');
    });

    it('ACTOR_NOT_FOUND: the decider does not exist in this tenant', async () => {
      mockAssertQualifies.mockRejectedValue(new ActorNotFoundViolation(APPROVER_ID));
      const result = await service.recordApprovalDecision(baseInput);
      expect(result.outcome).toBe('ACTOR_NOT_FOUND');
    });

    it('ACTOR_NOT_ACTIVE: the decider exists but is not ACTIVE at decision time', async () => {
      mockAssertQualifies.mockRejectedValue(new ActorNotActiveViolation(APPROVER_ID));
      const result = await service.recordApprovalDecision(baseInput);
      expect(result.outcome).toBe('ACTOR_NOT_ACTIVE');
    });

    it('ACTOR_NOT_QUALIFIED: the decider does not qualify for the requirement\'s authority category (e.g. SA does not auto-qualify for a role-based category)', async () => {
      mockAssertQualifies.mockRejectedValue(new ActorNotQualifiedViolation(APPROVER_ID, AuthorityCategory.HR_AUTHORITY));
      const result = await service.recordApprovalDecision(baseInput);
      expect(result.outcome).toBe('ACTOR_NOT_QUALIFIED');
    });

    it('PREPARER_SEPARATION_VIOLATION: a TIER_1 decider cannot be the case\'s substantive preparer', async () => {
      const result = await service.recordApprovalDecision({ ...baseInput, decidedByUserId: PREPARER_ID });
      expect(result.outcome).toBe('PREPARER_SEPARATION_VIOLATION');
      expect(mockTx.approvalDecision.create).not.toHaveBeenCalled();
    });

    it('PREPARER_SEPARATION_VIOLATION: a TIER_3 decider also cannot be the case\'s substantive preparer', async () => {
      mockTx.approvalRequest.findFirst.mockResolvedValue(
        makeRequestRow({
          requirements: [makeRequirement({ tier: ApprovalTier.TIER_3, requiredAuthorityCategory: AuthorityCategory.INDEPENDENT_OVERSIGHT_REVIEWER })],
        }),
      );
      const result = await service.recordApprovalDecision({ ...baseInput, decidedByUserId: PREPARER_ID });
      expect(result.outcome).toBe('PREPARER_SEPARATION_VIOLATION');
    });

    it('BENEFICIARY_SEPARATION_VIOLATION: a TIER_3 reviewer cannot be the ElevationSession subject\'s beneficiary (grantee)', async () => {
      mockResolveBeneficiary.mockResolvedValue(APPROVER_ID);
      mockTx.approvalRequest.findFirst.mockResolvedValue(
        makeRequestRow({
          decisionCase: makeCaseRow({ subjectType: DecisionCaseSubjectType.ELEVATION_SESSION, subjectId: 'session-1' }),
          requirements: [makeRequirement({ tier: ApprovalTier.TIER_3, requiredAuthorityCategory: AuthorityCategory.INDEPENDENT_OVERSIGHT_REVIEWER })],
        }),
      );
      const result = await service.recordApprovalDecision(baseInput);
      expect(result.outcome).toBe('BENEFICIARY_SEPARATION_VIOLATION');
    });

    it('TIER_INDEPENDENCE_VIOLATION: a TIER_3 decision cannot be made by an existing TIER_1/2 decider on the same request', async () => {
      mockTx.approvalRequest.findFirst.mockResolvedValue(
        makeRequestRow({
          requirements: [
            makeRequirement({
              id: REQUIREMENT_ID_2,
              tier: ApprovalTier.TIER_1,
              decision: { decidedByUserId: APPROVER_ID },
            }),
            makeRequirement({
              id: REQUIREMENT_ID_3,
              tier: ApprovalTier.TIER_3,
              requiredAuthorityCategory: AuthorityCategory.INDEPENDENT_OVERSIGHT_REVIEWER,
            }),
          ],
        }),
      );
      const result = await service.recordApprovalDecision({ ...baseInput, approvalRequirementId: REQUIREMENT_ID_3 });
      expect(result.outcome).toBe('TIER_INDEPENDENCE_VIOLATION');
    });

    it('TIER_INDEPENDENCE_VIOLATION (bidirectional): a later TIER_1/2 decision cannot be submitted by the request\'s existing TIER_3 reviewer', async () => {
      mockTx.approvalRequest.findFirst.mockResolvedValue(
        makeRequestRow({
          requirements: [
            makeRequirement({ id: REQUIREMENT_ID_1, tier: ApprovalTier.TIER_1 }),
            makeRequirement({
              id: REQUIREMENT_ID_3,
              tier: ApprovalTier.TIER_3,
              requiredAuthorityCategory: AuthorityCategory.INDEPENDENT_OVERSIGHT_REVIEWER,
              decision: { decidedByUserId: APPROVER_ID },
            }),
          ],
        }),
      );
      const result = await service.recordApprovalDecision({ ...baseInput, approvalRequirementId: REQUIREMENT_ID_1 });
      expect(result.outcome).toBe('TIER_INDEPENDENCE_VIOLATION');
    });

    it('DUPLICATE_DECIDER_ON_REQUEST: P2002 on the (approvalRequestId, decidedByUserId) unique index is mapped, not propagated (one person, one requirement per request)', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError('unique constraint', {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: { target: 'idx_approval_decisions_request_decider' },
      });
      mockTx.approvalDecision.create.mockRejectedValue(p2002);
      const result = await service.recordApprovalDecision(baseInput);
      expect(result.outcome).toBe('DUPLICATE_DECIDER_ON_REQUEST');
    });

    it('the decision snapshots the request\'s current version as evidenceSetVersion (not a live join)', async () => {
      mockTx.approvalRequest.findFirst.mockResolvedValue(makeRequestRow({ version: 3 }));
      await service.recordApprovalDecision(baseInput);
      expect(mockTx.approvalDecision.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ evidenceSetVersion: 3 }) }),
      );
    });

    it('the appropriate audit action is emitted for each decision value', async () => {
      await service.recordApprovalDecision({ ...baseInput, decision: 'GRANTED' });
      expect(mockAuditService.logEventStrict).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: AuditEventType.APPROVAL_DECISION_GRANTED }),
      );
    });
  });
});
