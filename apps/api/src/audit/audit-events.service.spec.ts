// Reference: governance/GD-M39-1.md — Decision 16 (five endpoints), Decision
// 17 (list/detail design), Decision 20 (viewer)

import { Test, type TestingModule } from '@nestjs/testing';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from './audit.service';
import { AuditChainVerificationService } from './audit-chain-verification.service';
import { AuditEventsService } from './audit-events.service';
import { AuditEventType } from './enums/audit-event-type.enum';

const TENANT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ACTOR_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OTHER_TENANT_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

function makeEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    tenantId: TENANT_ID,
    userId: ACTOR_ID,
    action: AuditEventType.AUTH_LOGIN_SUCCESS,
    result: 'SUCCESS',
    entityType: null,
    entityId: null,
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.050Z'),
    metadata: null,
    ...overrides,
  };
}

describe('AuditEventsService', () => {
  let service: AuditEventsService;
  let mockPrisma: {
    auditEvent: { findMany: jest.Mock; findFirst: jest.Mock };
    approvalRequest: { findMany: jest.Mock };
    auditWriteFailure: { count: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
    auditChainState: { findUnique: jest.Mock };
    user: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let mockAuditService: { logEvent: jest.Mock; logEventStrict: jest.Mock };
  let mockChainVerificationService: { scheduleImmediateVerification: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      auditEvent: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      approvalRequest: { findMany: jest.fn().mockResolvedValue([]) },
      auditWriteFailure: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      auditChainState: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(mockPrisma)),
    };
    mockAuditService = { logEvent: jest.fn().mockResolvedValue(undefined), logEventStrict: jest.fn().mockResolvedValue(undefined) };
    mockChainVerificationService = { scheduleImmediateVerification: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditEventsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
        { provide: AuditChainVerificationService, useValue: mockChainVerificationService },
      ],
    }).compile();

    service = module.get(AuditEventsService);
  });

  describe('listAuditEvents()', () => {
    it('scopes the query to the caller tenant', async () => {
      await service.listAuditEvents(TENANT_ID, ACTOR_ID, { pageSize: 20 });
      const [{ where }] = mockPrisma.auditEvent.findMany.mock.calls[0];
      expect(where.AND[0]).toEqual({ tenantId: TENANT_ID });
    });

    it('emits AUDIT_LOG_QUERIED via logEvent() (best-effort)', async () => {
      await service.listAuditEvents(TENANT_ID, ACTOR_ID, { pageSize: 20 });
      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.AUDIT_LOG_QUERIED, tenantId: TENANT_ID }),
      );
    });

    it('never includes filter values in the AUDIT_LOG_QUERIED metadata', async () => {
      await service.listAuditEvents(TENANT_ID, ACTOR_ID, { pageSize: 20, search: 'super-secret-filter' });
      const [call] = mockAuditService.logEvent.mock.calls;
      expect(call[0]).not.toHaveProperty('metadata');
    });

    it('returns INVALID_CURSOR for a malformed cursor', async () => {
      const result = await service.listAuditEvents(TENANT_ID, ACTOR_ID, {
        pageSize: 20,
        cursor: 'not-valid-base64url-json',
      });
      expect(result.outcome).toBe('INVALID_CURSOR');
    });

    it('returns nextCursor null when fewer rows than pageSize are returned', async () => {
      mockPrisma.auditEvent.findMany.mockResolvedValue([makeEventRow()]);
      const result = await service.listAuditEvents(TENANT_ID, ACTOR_ID, { pageSize: 20 });
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.nextCursor).toBeNull();
      }
    });

    it('returns a non-null nextCursor when more rows exist than pageSize (take = pageSize + 1)', async () => {
      mockPrisma.auditEvent.findMany.mockResolvedValue([
        makeEventRow({ id: 'a' }),
        makeEventRow({ id: 'b' }),
      ]);
      const result = await service.listAuditEvents(TENANT_ID, ACTOR_ID, { pageSize: 1 });
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.events).toHaveLength(1);
        expect(result.nextCursor).not.toBeNull();
      }
    });

    it('expands caseId into a tenant-scoped ApprovalRequest traversal', async () => {
      mockPrisma.approvalRequest.findMany.mockResolvedValue([{ id: 'req-1' }]);
      await service.listAuditEvents(TENANT_ID, ACTOR_ID, {
        pageSize: 20,
        caseId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      });

      expect(mockPrisma.approvalRequest.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, decisionCaseId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' },
        select: { id: true },
      });

      const [{ where }] = mockPrisma.auditEvent.findMany.mock.calls[0];
      const orClause = where.AND.find((c: Record<string, unknown>) => 'OR' in c);
      expect(orClause.OR).toEqual([
        { entityType: 'DECISION_CASE', entityId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' },
        { entityType: 'APPROVAL_REQUEST', entityId: { in: ['req-1'] } },
      ]);
    });

    it('fails closed on actor resolution — an actor not found in-tenant yields a null display name', async () => {
      mockPrisma.auditEvent.findMany.mockResolvedValue([makeEventRow()]);
      mockPrisma.user.findMany.mockResolvedValue([]); // actor not found in-tenant

      const result = await service.listAuditEvents(TENANT_ID, ACTOR_ID, { pageSize: 20 });
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.events[0]!.actorDisplayName).toBeNull();
        expect(result.events[0]!.actorUserId).toBe(ACTOR_ID);
      }
    });

    it('applies the response metadata allowlist (never a raw passthrough)', async () => {
      mockPrisma.auditEvent.findMany.mockResolvedValue([
        makeEventRow({
          action: AuditEventType.WORKFORCE_EMPLOYEE_UPDATED,
          metadata: { updatedFields: ['a'], secretKey: 'should not appear' },
        }),
      ]);
      const result = await service.listAuditEvents(TENANT_ID, ACTOR_ID, { pageSize: 20 });
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.events[0]!.metadata).toEqual({ updatedFields: ['a'] });
      }
    });

    it('sets recordedLate=true when createdAt materially differs from occurredAt', async () => {
      mockPrisma.auditEvent.findMany.mockResolvedValue([
        makeEventRow({
          occurredAt: new Date('2026-01-01T00:00:00.000Z'),
          createdAt: new Date('2026-01-01T00:10:00.000Z'), // 10 minutes later
        }),
      ]);
      const result = await service.listAuditEvents(TENANT_ID, ACTOR_ID, { pageSize: 20 });
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.events[0]!.recordedLate).toBe(true);
      }
    });
  });

  describe('getAuditEventById()', () => {
    it('returns NOT_FOUND for a cross-tenant id (fails closed, tenant-scoped findFirst)', async () => {
      mockPrisma.auditEvent.findFirst.mockResolvedValue(null);
      const result = await service.getAuditEventById(TENANT_ID, ACTOR_ID, 'some-id');
      expect(result.outcome).toBe('NOT_FOUND');
      expect(mockPrisma.auditEvent.findFirst).toHaveBeenCalledWith({
        where: { id: 'some-id', tenantId: TENANT_ID },
      });
    });

    it('returns SUCCESS with the sanitized shape for an in-tenant row', async () => {
      mockPrisma.auditEvent.findFirst.mockResolvedValue(makeEventRow());
      const result = await service.getAuditEventById(TENANT_ID, ACTOR_ID, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
      expect(result.outcome).toBe('SUCCESS');
    });
  });

  describe('getRecoveryStatus()', () => {
    it('never includes the raw metadata field of abandoned failures', async () => {
      mockPrisma.auditWriteFailure.findMany.mockResolvedValue([
        {
          id: 'x',
          action: 'AUTH_LOGIN_SUCCESS',
          entityType: null,
          entityId: null,
          occurredAt: new Date(),
          attemptCount: 3,
          failureReason: 'DATABASE_ERROR',
          metadata: { sensitiveField: 'never returned' },
        },
      ]);

      const summary = await service.getRecoveryStatus(TENANT_ID, ACTOR_ID);
      expect(summary.abandonedFailures[0]).not.toHaveProperty('metadata');
    });

    it('reports UNVERIFIED chain status when no AuditChainState row exists yet', async () => {
      mockPrisma.auditChainState.findUnique.mockResolvedValue(null);
      const summary = await service.getRecoveryStatus(TENANT_ID, ACTOR_ID);
      expect(summary.chain.status).toBe('UNVERIFIED');
    });
  });

  describe('requeueFailedWrite()', () => {
    it('returns NOT_FOUND for a cross-tenant failure id', async () => {
      mockPrisma.auditWriteFailure.findFirst.mockResolvedValue(null);
      const result = await service.requeueFailedWrite(TENANT_ID, 'some-id', ACTOR_ID);
      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('returns NOT_ABANDONED for a non-ABANDONED row', async () => {
      mockPrisma.auditWriteFailure.findFirst.mockResolvedValue({ id: 'x', status: 'PENDING', tenantId: TENANT_ID });
      const result = await service.requeueFailedWrite(TENANT_ID, 'x', ACTOR_ID);
      expect(result.outcome).toBe('NOT_ABANDONED');
    });

    it('resets an ABANDONED row to PENDING and writes AUDIT_WRITE_RECOVERY_REQUEUED via logEventStrict, atomically', async () => {
      mockPrisma.auditWriteFailure.findFirst.mockResolvedValue({ id: 'x', status: 'ABANDONED', tenantId: TENANT_ID });
      const result = await service.requeueFailedWrite(TENANT_ID, 'x', ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      expect(mockPrisma.auditWriteFailure.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) }),
      );
      // attemptCount is never touched by requeue (Decision 12/14).
      const [{ data }] = mockPrisma.auditWriteFailure.update.mock.calls[0];
      expect(data).not.toHaveProperty('attemptCount');
      expect(mockAuditService.logEventStrict).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({ action: AuditEventType.AUDIT_WRITE_RECOVERY_REQUEUED, tenantId: TENANT_ID }),
      );
    });

    it('does not accept a replacement event payload — the signature has no payload parameter', () => {
      expect(service.requeueFailedWrite.length).toBe(3); // (tenantId, failureId, actorUserId) only
    });
  });

  describe('requestReverification()', () => {
    it('schedules immediate verification and writes AUDIT_CHAIN_REVERIFICATION_REQUESTED atomically, tenant-scoped only', async () => {
      const result = await service.requestReverification(TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      expect(mockChainVerificationService.scheduleImmediateVerification).toHaveBeenCalledWith(mockPrisma, TENANT_ID);
      expect(mockAuditService.logEventStrict).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          action: AuditEventType.AUDIT_CHAIN_REVERIFICATION_REQUESTED,
          tenantId: TENANT_ID,
        }),
      );
    });

    it('accepts no tenant payload — the signature has no tenant-selecting parameter beyond the caller tenant', () => {
      expect(service.requestReverification.length).toBe(2); // (tenantId, actorUserId) only
    });
  });

  it('cross-tenant reads never leak another tenant\'s row (tenant is always part of the where clause)', async () => {
    mockPrisma.auditEvent.findFirst.mockResolvedValue(null);
    await service.getAuditEventById(OTHER_TENANT_ID, ACTOR_ID, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
    expect(mockPrisma.auditEvent.findFirst).toHaveBeenCalledWith({
      where: { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', tenantId: OTHER_TENANT_ID },
    });
  });
});
