// Governance authority: governance/GD-M38-1.md (Decisions 4, 6, 10, 12, 14).
//
// Pure unit tests — no database, no HTTP. PrismaService and AuditService are
// replaced with jest.fn() mocks, following elevation-session.service.spec.ts's
// own $transaction-mocking pattern exactly: mockPrisma.$transaction invokes
// the callback with a mockTx object whose delegates are independently
// stubbed.
/* eslint-disable */

import { Test, type TestingModule } from '@nestjs/testing';
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
import { DecisionCaseService } from './decision-case.service';

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const INITIATOR_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PREPARER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OTHER_USER_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const CASE_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const OFFER_ID = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-09-05T12:00:00.000Z');

function makeCaseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CASE_ID,
    tenantId: TENANT_ID,
    subjectType: DecisionCaseSubjectType.GENERAL,
    subjectId: null,
    initiatedByUserId: INITIATOR_ID,
    preparedByUserId: PREPARER_ID,
    purpose: 'Test decision case',
    status: DecisionCaseStatus.OPEN,
    idempotencyKey: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('DecisionCaseService', () => {
  let service: DecisionCaseService;
  let mockPrisma: { decisionCase: { findFirst: jest.Mock }; $transaction: jest.Mock };
  let mockTx: {
    user: { findFirst: jest.Mock };
    offer: { findFirst: jest.Mock };
    application: { findFirst: jest.Mock };
    employee: { findFirst: jest.Mock };
    elevationSession: { findFirst: jest.Mock };
    decisionCase: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    evidenceItem: { create: jest.Mock };
    decisionCaseRiskTrigger: { create: jest.Mock };
    approvalRequest: { updateMany: jest.Mock };
  };
  let mockAuditService: { logEvent: jest.Mock; logEventStrict: jest.Mock };

  beforeEach(async () => {
    mockTx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'some-actor-id', status: 'ACTIVE' }) },
      offer: { findFirst: jest.fn().mockResolvedValue({ id: OFFER_ID }) },
      application: { findFirst: jest.fn().mockResolvedValue({ id: 'app-1' }) },
      employee: { findFirst: jest.fn().mockResolvedValue({ id: 'emp-1' }) },
      elevationSession: { findFirst: jest.fn().mockResolvedValue({ id: 'session-1' }) },
      decisionCase: {
        findFirst: jest.fn().mockResolvedValue(makeCaseRow()),
        create: jest.fn().mockResolvedValue(makeCaseRow()),
        update: jest.fn().mockResolvedValue(makeCaseRow({ status: DecisionCaseStatus.CANCELLED, version: 2 })),
      },
      evidenceItem: { create: jest.fn().mockResolvedValue({ id: 'evidence-1' }) },
      decisionCaseRiskTrigger: { create: jest.fn().mockResolvedValue({ id: 'trigger-1' }) },
      approvalRequest: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };

    mockPrisma = {
      decisionCase: { findFirst: jest.fn().mockResolvedValue(makeCaseRow()) },
      $transaction: jest.fn().mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
    };

    mockAuditService = {
      logEvent: jest.fn().mockResolvedValue(undefined),
      logEventStrict: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DecisionCaseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<DecisionCaseService>(DecisionCaseService);
  });

  afterEach(() => jest.clearAllMocks());

  // --------------------------------------------------------------------------
  // createDecisionCase()
  // --------------------------------------------------------------------------

  describe('createDecisionCase()', () => {
    const baseInput = {
      tenantId: TENANT_ID,
      subjectType: DecisionCaseSubjectType.GENERAL,
      subjectId: null,
      initiatedByUserId: INITIATOR_ID,
      preparedByUserId: PREPARER_ID,
      purpose: 'Review a workforce decision',
    };

    it('SUCCESS: returns { outcome: "SUCCESS", decisionCase }', async () => {
      const result = await service.createDecisionCase(baseInput);
      expect(result.outcome).toBe('SUCCESS');
    });

    it('SUCCESS: DECISION_CASE_CREATED audit event emitted via logEventStrict inside the transaction', async () => {
      await service.createDecisionCase(baseInput);
      expect(mockAuditService.logEventStrict).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: AuditEventType.DECISION_CASE_CREATED, tenantId: TENANT_ID }),
      );
    });

    it('SUCCESS: logEvent() (non-strict) is never called by this service', async () => {
      await service.createDecisionCase(baseInput);
      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('INVALID_PURPOSE: empty purpose returns INVALID_PURPOSE and never opens a transaction', async () => {
      const result = await service.createDecisionCase({ ...baseInput, purpose: '   ' });
      expect(result.outcome).toBe('INVALID_PURPOSE');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('ACTOR_NOT_FOUND_OR_INACTIVE: initiator does not exist in this tenant', async () => {
      mockTx.user.findFirst.mockResolvedValueOnce(null);
      const result = await service.createDecisionCase(baseInput);
      expect(result.outcome).toBe('ACTOR_NOT_FOUND_OR_INACTIVE');
      expect((result as any).actorRole).toBe('INITIATOR');
    });

    it('ACTOR_NOT_FOUND_OR_INACTIVE: preparer exists but is not ACTIVE', async () => {
      mockTx.user.findFirst
        .mockResolvedValueOnce({ id: INITIATOR_ID, status: 'ACTIVE' })
        .mockResolvedValueOnce({ id: PREPARER_ID, status: 'SUSPENDED' });
      const result = await service.createDecisionCase(baseInput);
      expect(result.outcome).toBe('ACTOR_NOT_FOUND_OR_INACTIVE');
      expect((result as any).actorRole).toBe('PREPARER');
    });

    it('INVALID_SUBJECT_REFERENCE: GENERAL subjectType with a non-null subjectId is rejected', async () => {
      const result = await service.createDecisionCase({
        ...baseInput,
        subjectType: DecisionCaseSubjectType.GENERAL,
        subjectId: OFFER_ID,
      });
      expect(result.outcome).toBe('INVALID_SUBJECT_REFERENCE');
    });

    it('INVALID_SUBJECT_REFERENCE: OFFER subjectType with a null subjectId is rejected', async () => {
      const result = await service.createDecisionCase({
        ...baseInput,
        subjectType: DecisionCaseSubjectType.OFFER,
        subjectId: null,
      });
      expect(result.outcome).toBe('INVALID_SUBJECT_REFERENCE');
    });

    it('SUBJECT_NOT_FOUND: OFFER subject does not exist in this tenant', async () => {
      mockTx.offer.findFirst.mockResolvedValue(null);
      const result = await service.createDecisionCase({
        ...baseInput,
        subjectType: DecisionCaseSubjectType.OFFER,
        subjectId: OFFER_ID,
      });
      expect(result.outcome).toBe('SUBJECT_NOT_FOUND');
    });

    it('SUCCESS: OFFER subject that exists in this tenant is accepted', async () => {
      const result = await service.createDecisionCase({
        ...baseInput,
        subjectType: DecisionCaseSubjectType.OFFER,
        subjectId: OFFER_ID,
      });
      expect(result.outcome).toBe('SUCCESS');
      expect(mockTx.offer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: OFFER_ID, tenantId: TENANT_ID } }),
      );
    });

    it('DUPLICATE_IDEMPOTENCY_KEY: P2002 on the tenant+idempotencyKey index maps to DUPLICATE_IDEMPOTENCY_KEY', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError('unique constraint', {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: { target: ['tenantId', 'idempotencyKey'] },
      });
      mockTx.decisionCase.create.mockRejectedValue(p2002);
      const result = await service.createDecisionCase({ ...baseInput, idempotencyKey: 'dup-key' });
      expect(result.outcome).toBe('DUPLICATE_IDEMPOTENCY_KEY');
    });

    it('INTERNAL_ERROR: a non-P2002 transaction error returns INTERNAL_ERROR', async () => {
      mockTx.decisionCase.create.mockRejectedValue(new Error('connection lost'));
      const result = await service.createDecisionCase(baseInput);
      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // attachEvidence()
  // --------------------------------------------------------------------------

  describe('attachEvidence()', () => {
    const baseInput = {
      tenantId: TENANT_ID,
      decisionCaseId: CASE_ID,
      evidenceType: EvidenceType.HUMAN_NOTE,
      sensitivityClassification: EvidenceSensitivityClassification.AGGREGATE_EXECUTIVE,
      sourceType: DecisionCaseSubjectType.GENERAL,
      sourceId: null,
      provenanceType: ProvenanceType.HUMAN,
      producedByUserId: PREPARER_ID,
      capturedAt: NOW,
    };

    it('SUCCESS: returns { outcome: "SUCCESS", evidenceItemId }', async () => {
      const result = await service.attachEvidence(baseInput);
      expect(result.outcome).toBe('SUCCESS');
    });

    it('SUCCESS: DECISION_CASE_EVIDENCE_ATTACHED audit event emitted', async () => {
      await service.attachEvidence(baseInput);
      expect(mockAuditService.logEventStrict).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: AuditEventType.DECISION_CASE_EVIDENCE_ATTACHED }),
      );
    });

    it('HUMAN_PROVENANCE_REQUIRES_PRODUCER: HUMAN provenance without producedByUserId is rejected before any transaction opens', async () => {
      const result = await service.attachEvidence({ ...baseInput, producedByUserId: null });
      expect(result.outcome).toBe('HUMAN_PROVENANCE_REQUIRES_PRODUCER');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('DETERMINISTIC_PROVENANCE_MUST_NOT_NAME_A_PRODUCER: DETERMINISTIC_SYSTEM provenance with a producedByUserId is rejected', async () => {
      const result = await service.attachEvidence({
        ...baseInput,
        provenanceType: ProvenanceType.DETERMINISTIC_SYSTEM,
        producedByUserId: PREPARER_ID,
      });
      expect(result.outcome).toBe('DETERMINISTIC_PROVENANCE_MUST_NOT_NAME_A_PRODUCER');
    });

    it('SUCCESS: DETERMINISTIC_SYSTEM provenance with null producedByUserId is permitted, never labeled AI', async () => {
      const result = await service.attachEvidence({
        ...baseInput,
        provenanceType: ProvenanceType.DETERMINISTIC_SYSTEM,
        producedByUserId: null,
      });
      expect(result.outcome).toBe('SUCCESS');
    });

    it('CASE_NOT_FOUND: case absent or wrong tenant', async () => {
      mockTx.decisionCase.findFirst.mockResolvedValue(null);
      const result = await service.attachEvidence(baseInput);
      expect(result.outcome).toBe('CASE_NOT_FOUND');
    });

    it.each([DecisionCaseStatus.APPROVED, DecisionCaseStatus.REJECTED, DecisionCaseStatus.CANCELLED])(
      'INVALID_LIFECYCLE_STATE: evidence cannot be attached once the case has reached terminal status %s',
      async (status) => {
        mockTx.decisionCase.findFirst.mockResolvedValue(makeCaseRow({ status }));
        const result = await service.attachEvidence(baseInput);
        expect(result.outcome).toBe('INVALID_LIFECYCLE_STATE');
      },
    );

    it('SOURCE_NOT_FOUND: sourceType/sourceId does not resolve to a real tenant-owned record', async () => {
      mockTx.offer.findFirst.mockResolvedValue(null);
      const result = await service.attachEvidence({
        ...baseInput,
        sourceType: DecisionCaseSubjectType.OFFER,
        sourceId: OFFER_ID,
      });
      expect(result.outcome).toBe('SOURCE_NOT_FOUND');
    });

    it('ACTOR_NOT_FOUND_OR_INACTIVE: producedByUserId is not a real, active, tenant-owned actor', async () => {
      mockTx.user.findFirst.mockResolvedValue(null);
      const result = await service.attachEvidence(baseInput);
      expect(result.outcome).toBe('ACTOR_NOT_FOUND_OR_INACTIVE');
    });
  });

  // --------------------------------------------------------------------------
  // recordRiskTrigger()
  // --------------------------------------------------------------------------

  describe('recordRiskTrigger()', () => {
    const baseInput = {
      tenantId: TENANT_ID,
      decisionCaseId: CASE_ID,
      triggerType: DecisionCaseRiskTriggerType.SENSITIVE_BULK_ACTION,
      reason: 'Explicit test classification',
      sourceOrProvenance: ProvenanceType.HUMAN,
      createdByUserId: PREPARER_ID,
    };

    it('SUCCESS: returns { outcome: "SUCCESS", riskTriggerId }', async () => {
      const result = await service.recordRiskTrigger(baseInput);
      expect(result.outcome).toBe('SUCCESS');
    });

    it('SUCCESS: DECISION_CASE_RISK_TRIGGER_CREATED audit event emitted', async () => {
      await service.recordRiskTrigger(baseInput);
      expect(mockAuditService.logEventStrict).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: AuditEventType.DECISION_CASE_RISK_TRIGGER_CREATED }),
      );
    });

    it('INVALID_REASON: empty reason is rejected before any transaction opens', async () => {
      const result = await service.recordRiskTrigger({ ...baseInput, reason: '   ' });
      expect(result.outcome).toBe('INVALID_REASON');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('HUMAN_PROVENANCE_REQUIRES_CREATOR: HUMAN provenance without createdByUserId is rejected', async () => {
      const result = await service.recordRiskTrigger({ ...baseInput, createdByUserId: null });
      expect(result.outcome).toBe('HUMAN_PROVENANCE_REQUIRES_CREATOR');
    });

    it('DETERMINISTIC_PROVENANCE_MUST_NOT_NAME_A_CREATOR: DETERMINISTIC_SYSTEM provenance with a createdByUserId is rejected', async () => {
      const result = await service.recordRiskTrigger({
        ...baseInput,
        sourceOrProvenance: ProvenanceType.DETERMINISTIC_SYSTEM,
      });
      expect(result.outcome).toBe('DETERMINISTIC_PROVENANCE_MUST_NOT_NAME_A_CREATOR');
    });

    it('SUCCESS: DETERMINISTIC_SYSTEM provenance with null createdByUserId is permitted (modeling/test-only path — no automatic detection exists)', async () => {
      const result = await service.recordRiskTrigger({
        ...baseInput,
        sourceOrProvenance: ProvenanceType.DETERMINISTIC_SYSTEM,
        createdByUserId: null,
      });
      expect(result.outcome).toBe('SUCCESS');
    });

    it('CASE_NOT_FOUND: case absent or wrong tenant', async () => {
      mockTx.decisionCase.findFirst.mockResolvedValue(null);
      const result = await service.recordRiskTrigger(baseInput);
      expect(result.outcome).toBe('CASE_NOT_FOUND');
    });

    it('the created row snapshots the case version at creation time and starts excluded from any approval plan', async () => {
      mockTx.decisionCase.findFirst.mockResolvedValue(makeCaseRow({ version: 3 }));
      await service.recordRiskTrigger(baseInput);
      expect(mockTx.decisionCaseRiskTrigger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ caseVersion: 3, includedInApprovalPlan: false }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // cancelDecisionCase()
  // --------------------------------------------------------------------------

  describe('cancelDecisionCase()', () => {
    const baseInput = {
      tenantId: TENANT_ID,
      decisionCaseId: CASE_ID,
      expectedVersion: 1,
      cancelledByUserId: INITIATOR_ID,
    };

    it('SUCCESS: initiator cancels an OPEN case', async () => {
      const result = await service.cancelDecisionCase(baseInput);
      expect(result.outcome).toBe('SUCCESS');
    });

    it('SUCCESS: preparer may also cancel', async () => {
      const result = await service.cancelDecisionCase({ ...baseInput, cancelledByUserId: PREPARER_ID });
      expect(result.outcome).toBe('SUCCESS');
    });

    it('SUCCESS: cascades to CANCEL any still-PENDING ApprovalRequest for this case', async () => {
      await service.cancelDecisionCase(baseInput);
      expect(mockTx.approvalRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { decisionCaseId: CASE_ID, status: 'PENDING' },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
    });

    it('SUCCESS: DECISION_CASE_CANCELLED audit event emitted', async () => {
      await service.cancelDecisionCase(baseInput);
      expect(mockAuditService.logEventStrict).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: AuditEventType.DECISION_CASE_CANCELLED }),
      );
    });

    it('CASE_NOT_FOUND: case absent or wrong tenant', async () => {
      mockTx.decisionCase.findFirst.mockResolvedValue(null);
      const result = await service.cancelDecisionCase(baseInput);
      expect(result.outcome).toBe('CASE_NOT_FOUND');
    });

    it.each([DecisionCaseStatus.APPROVED, DecisionCaseStatus.REJECTED, DecisionCaseStatus.CANCELLED])(
      'INVALID_LIFECYCLE_STATE: a case already in terminal status %s cannot be cancelled again (terminal-state immutability)',
      async (status) => {
        mockTx.decisionCase.findFirst.mockResolvedValue(makeCaseRow({ status }));
        const result = await service.cancelDecisionCase(baseInput);
        expect(result.outcome).toBe('INVALID_LIFECYCLE_STATE');
      },
    );

    it('STALE_VERSION: expectedVersion does not match the current row version', async () => {
      mockTx.decisionCase.findFirst.mockResolvedValue(makeCaseRow({ version: 5 }));
      const result = await service.cancelDecisionCase(baseInput);
      expect(result.outcome).toBe('STALE_VERSION');
      expect((result as any).actualVersion).toBe(5);
    });

    it('CANCELLER_MUST_BE_INITIATOR_OR_PREPARER: an unrelated actor cannot cancel', async () => {
      const result = await service.cancelDecisionCase({ ...baseInput, cancelledByUserId: OTHER_USER_ID });
      expect(result.outcome).toBe('CANCELLER_MUST_BE_INITIATOR_OR_PREPARER');
    });
  });

  // --------------------------------------------------------------------------
  // getDecisionCaseById()
  // --------------------------------------------------------------------------

  describe('getDecisionCaseById()', () => {
    it('returns the record when found within the given tenant', async () => {
      const result = await service.getDecisionCaseById(CASE_ID, TENANT_ID);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(CASE_ID);
    });

    it('returns null when absent (tenantId included in the Prisma where clause — no cross-tenant lookup)', async () => {
      mockPrisma.decisionCase.findFirst.mockResolvedValue(null);
      const result = await service.getDecisionCaseById(CASE_ID, TENANT_ID);
      expect(result).toBeNull();
      expect(mockPrisma.decisionCase.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: CASE_ID, tenantId: TENANT_ID } }),
      );
    });
  });
});
