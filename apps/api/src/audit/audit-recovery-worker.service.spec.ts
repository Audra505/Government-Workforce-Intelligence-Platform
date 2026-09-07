// Reference: governance/GD-M39-1.md — Decision 12 (recovery-attempt history),
// Decision 13 (automatic workers)
//
// Pure unit tests against a mocked PrismaService/AuditService — no database,
// no real scheduler timer (onModuleInit() is never called; tests invoke
// runRecoveryCycle()/the private methods' public entry points directly).

import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from './audit.service';
import { AuditRecoveryWorkerService } from './audit-recovery-worker.service';

const CONFIG = {
  intervalMs: 30000,
  batchSize: 25,
  maxAttempts: 3,
  baseBackoffMs: 1000,
  maxBackoffMs: 60000,
  claimTimeoutMs: 120000,
};

function makeTx() {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    auditWriteFailure: { update: jest.fn().mockResolvedValue(undefined) },
    auditWriteFailureAttempt: {
      create: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    },
  };
}

describe('AuditRecoveryWorkerService', () => {
  let service: AuditRecoveryWorkerService;
  let mockPrisma: { $transaction: jest.Mock };
  let mockAuditService: { replayFailedWrite: jest.Mock; logOperationalEvent: jest.Mock };
  let tx: ReturnType<typeof makeTx>;

  beforeEach(async () => {
    tx = makeTx();
    mockPrisma = { $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)) };
    mockAuditService = {
      replayFailedWrite: jest.fn().mockResolvedValue({ inserted: true }),
      logOperationalEvent: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditRecoveryWorkerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ConfigService, useValue: { get: () => CONFIG } },
        { provide: SchedulerRegistry, useValue: { addInterval: jest.fn() } },
      ],
    }).compile();

    service = module.get(AuditRecoveryWorkerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('runRecoveryCycle() — claim and successful replay', () => {
    it('claims a due PENDING row, replays it, and marks the attempt SUCCEEDED / parent RETRIED', async () => {
      const dueRow = {
        id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        tenant_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        user_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: 'AUTH_LOGIN_SUCCESS',
        entity_type: null,
        entity_id: null,
        result: 'SUCCESS',
        metadata: null,
        occurred_at: new Date(),
        attempt_count: 0,
      };

      // First $transaction (reclaim) finds nothing; second (claim) finds one due row.
      let callIndex = 0;
      mockPrisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => {
        callIndex += 1;
        if (callIndex === 1) {
          tx.$queryRaw.mockResolvedValueOnce([]); // reclaim: no stale rows
        } else if (callIndex === 2) {
          tx.$queryRaw.mockResolvedValueOnce([dueRow]); // claim: one due row
        }
        return cb(tx);
      });

      await service.runRecoveryCycle();

      expect(mockAuditService.replayFailedWrite).toHaveBeenCalledTimes(1);
      expect(tx.auditWriteFailureAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCEEDED' }) }),
      );
      expect(tx.auditWriteFailure.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'RETRIED' }) }),
      );
      expect(mockAuditService.logOperationalEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AUDIT_WRITE_RECOVERY_SUCCEEDED' }),
      );
    });
  });

  describe('runRecoveryCycle() — failed replay, below max attempts', () => {
    it('marks the attempt FAILED and reschedules the parent PENDING with a future nextAttemptAt', async () => {
      mockAuditService.replayFailedWrite.mockRejectedValue(new Error('transient DB error'));

      const dueRow = {
        id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        tenant_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        user_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: 'AUTH_LOGIN_SUCCESS',
        entity_type: null,
        entity_id: null,
        result: 'SUCCESS',
        metadata: null,
        occurred_at: new Date(),
        attempt_count: 0, // will become 1 after claim — below maxAttempts (3)
      };

      let callIndex = 0;
      mockPrisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => {
        callIndex += 1;
        if (callIndex === 1) tx.$queryRaw.mockResolvedValueOnce([]);
        if (callIndex === 2) tx.$queryRaw.mockResolvedValueOnce([dueRow]);
        return cb(tx);
      });

      await service.runRecoveryCycle();

      const failureUpdateCall = tx.auditWriteFailure.update.mock.calls.find(
        ([args]: [{ data: { status: string } }]) => args.data.status === 'PENDING',
      );
      expect(failureUpdateCall).toBeDefined();
      const [{ data }] = failureUpdateCall!;
      expect(data.nextAttemptAt).toBeInstanceOf(Date);
      expect(data.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

      expect(mockAuditService.logOperationalEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AUDIT_WRITE_RECOVERY_ABANDONED' }),
      );
    });
  });

  describe('runRecoveryCycle() — failed replay, at max attempts', () => {
    it('marks the parent ABANDONED and emits the abandonment notification', async () => {
      mockAuditService.replayFailedWrite.mockRejectedValue(new Error('permanent error'));

      const dueRow = {
        id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        tenant_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        user_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: 'AUTH_LOGIN_SUCCESS',
        entity_type: null,
        entity_id: null,
        result: 'SUCCESS',
        metadata: null,
        occurred_at: new Date(),
        attempt_count: CONFIG.maxAttempts - 1, // becomes maxAttempts after claim
      };

      let callIndex = 0;
      mockPrisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => {
        callIndex += 1;
        if (callIndex === 1) tx.$queryRaw.mockResolvedValueOnce([]);
        if (callIndex === 2) tx.$queryRaw.mockResolvedValueOnce([dueRow]);
        return cb(tx);
      });

      await service.runRecoveryCycle();

      expect(tx.auditWriteFailure.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ABANDONED' }) }),
      );
      expect(mockAuditService.logOperationalEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AUDIT_WRITE_RECOVERY_ABANDONED' }),
      );
    });
  });

  describe('runRecoveryCycle() — no due or stale rows', () => {
    it('does nothing when there is no work to claim', async () => {
      await service.runRecoveryCycle();

      expect(mockAuditService.replayFailedWrite).not.toHaveBeenCalled();
      expect(mockAuditService.logOperationalEvent).not.toHaveBeenCalled();
    });
  });
});
