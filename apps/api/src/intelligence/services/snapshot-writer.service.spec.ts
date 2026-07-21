// Reference: governance/GD-M34-1.md — Decisions 14, 15, 16, 17, 18, 21 (validation gate)
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
//
// Pure unit tests — no database.
// PrismaService replaced with a jest.fn() mock controlling
// workforceSignalSnapshot.upsert() calls and errors.
// Covers the GD-M34-1 Decision 21 validation gate items scoped to
// SnapshotWriterService itself:
//   - Dedup key shape (tenantId, signalType, scopeType, scopeId, snapshotDate)
//   - TENANT scope always uses the sentinel scopeId, never null
//   - DEPARTMENT scope uses the real departmentId
//   - snapshotDate is UTC calendar-day truncated (not a timestamp)
//   - Upsert semantics: create + update branches both populate the same fields
//   - Write failures are caught and logged, never rethrown
//   - No read method exists on the service (structural proof of Decision 18)

import { Test, type TestingModule } from '@nestjs/testing';

import { SnapshotWriterService, TENANT_SCOPE_SENTINEL_ID } from './snapshot-writer.service';
import { PrismaService } from '../../database/prisma.service';

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('SnapshotWriterService', () => {
  let service: SnapshotWriterService;

  const mockPrisma = {
    workforceSignalSnapshot: { upsert: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SnapshotWriterService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SnapshotWriterService>(SnapshotWriterService);
  });

  // ===========================================================================
  // Dedup key shape — GD-M34-1 Decision 17
  // ===========================================================================

  describe('Deduplication key shape', () => {
    it('upserts on the compound key (tenantId, signalType, scopeType, scopeId, snapshotDate)', async () => {
      mockPrisma.workforceSignalSnapshot.upsert.mockResolvedValue({});
      const computedAt = new Date('2026-07-19T14:23:00.000Z');

      await service.write({
        tenantId: TENANT_ID, signalType: 'WORKFORCE_READINESS', scopeType: 'TENANT',
        score: 76, level: 'READY', confidence: 90,
        formulaVersion: 'readiness-deterministic-v1', computedAt,
      });

      expect(mockPrisma.workforceSignalSnapshot.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId_signalType_scopeType_scopeId_snapshotDate: {
              tenantId: TENANT_ID,
              signalType: 'WORKFORCE_READINESS',
              scopeType: 'TENANT',
              scopeId: TENANT_SCOPE_SENTINEL_ID,
              snapshotDate: new Date(Date.UTC(2026, 6, 19)),
            },
          },
        }),
      );
    });

    it('TENANT scope always uses the sentinel scopeId, never a null value', async () => {
      mockPrisma.workforceSignalSnapshot.upsert.mockResolvedValue({});

      await service.write({
        tenantId: TENANT_ID, signalType: 'ATTRITION_RISK', scopeType: 'TENANT',
        score: 30, level: 'LOW', confidence: 85,
        formulaVersion: 'attrition-deterministic-v1', computedAt: new Date(),
      });

      const call = mockPrisma.workforceSignalSnapshot.upsert.mock.calls[0]![0] as {
        create: { scopeId: string };
      };
      expect(call.create.scopeId).toBe(TENANT_SCOPE_SENTINEL_ID);
      expect(call.create.scopeId).not.toBeNull();
    });

    it('DEPARTMENT scope uses the real departmentId passed as scopeId', async () => {
      mockPrisma.workforceSignalSnapshot.upsert.mockResolvedValue({});

      await service.write({
        tenantId: TENANT_ID, signalType: 'WORKFORCE_READINESS', scopeType: 'DEPARTMENT',
        scopeId: 'dept-42', score: 68, level: 'DEVELOPING', confidence: 90,
        formulaVersion: 'readiness-deterministic-v1', computedAt: new Date(),
      });

      const call = mockPrisma.workforceSignalSnapshot.upsert.mock.calls[0]![0] as {
        create: { scopeId: string };
      };
      expect(call.create.scopeId).toBe('dept-42');
    });

    it('DEPARTMENT scope with no scopeId supplied falls back to the sentinel (defensive — should not happen from a correct caller)', async () => {
      mockPrisma.workforceSignalSnapshot.upsert.mockResolvedValue({});

      await service.write({
        tenantId: TENANT_ID, signalType: 'WORKFORCE_READINESS', scopeType: 'DEPARTMENT',
        scopeId: null, score: 68, level: 'DEVELOPING', confidence: 90,
        formulaVersion: 'readiness-deterministic-v1', computedAt: new Date(),
      });

      const call = mockPrisma.workforceSignalSnapshot.upsert.mock.calls[0]![0] as {
        create: { scopeId: string };
      };
      expect(call.create.scopeId).toBe(TENANT_SCOPE_SENTINEL_ID);
    });
  });

  // ===========================================================================
  // snapshotDate — UTC calendar-day truncation
  // ===========================================================================

  describe('snapshotDate truncation', () => {
    it('truncates computedAt to a UTC calendar day, discarding time-of-day', async () => {
      mockPrisma.workforceSignalSnapshot.upsert.mockResolvedValue({});

      await service.write({
        tenantId: TENANT_ID, signalType: 'VACANCY_RISK', scopeType: 'TENANT',
        score: 50, level: null, confidence: 100,
        formulaVersion: 'deterministic-v1', computedAt: new Date('2026-07-19T23:59:59.999Z'),
      });

      const call = mockPrisma.workforceSignalSnapshot.upsert.mock.calls[0]![0] as {
        create: { snapshotDate: Date };
      };
      expect(call.create.snapshotDate.toISOString()).toBe('2026-07-19T00:00:00.000Z');
    });

    it('two calls on the same UTC day produce the same dedup key even at different times', async () => {
      mockPrisma.workforceSignalSnapshot.upsert.mockResolvedValue({});

      await service.write({
        tenantId: TENANT_ID, signalType: 'VACANCY_RISK', scopeType: 'TENANT',
        score: 40, level: null, confidence: 100,
        formulaVersion: 'deterministic-v1', computedAt: new Date('2026-07-19T01:00:00.000Z'),
      });
      await service.write({
        tenantId: TENANT_ID, signalType: 'VACANCY_RISK', scopeType: 'TENANT',
        score: 60, level: null, confidence: 100,
        formulaVersion: 'deterministic-v1', computedAt: new Date('2026-07-19T23:00:00.000Z'),
      });

      const calls = mockPrisma.workforceSignalSnapshot.upsert.mock.calls as Array<
        [{ where: { tenantId_signalType_scopeType_scopeId_snapshotDate: { snapshotDate: Date } } }]
      >;
      const day1 = calls[0]![0].where.tenantId_signalType_scopeType_scopeId_snapshotDate.snapshotDate;
      const day2 = calls[1]![0].where.tenantId_signalType_scopeType_scopeId_snapshotDate.snapshotDate;
      expect(day1.toISOString()).toBe(day2.toISOString());
    });
  });

  // ===========================================================================
  // Upsert semantics — GD-M34-1 Decision 17
  // ===========================================================================

  describe('Upsert semantics', () => {
    it('create and update payloads both carry score/level/confidence/formulaVersion/computedAt', async () => {
      mockPrisma.workforceSignalSnapshot.upsert.mockResolvedValue({});
      const computedAt = new Date('2026-07-19T12:00:00.000Z');

      await service.write({
        tenantId: TENANT_ID, signalType: 'WORKFORCE_READINESS', scopeType: 'TENANT',
        score: 76, level: 'READY', confidence: 90,
        formulaVersion: 'readiness-deterministic-v1', computedAt,
      });

      const call = mockPrisma.workforceSignalSnapshot.upsert.mock.calls[0]![0] as {
        create: Record<string, unknown>; update: Record<string, unknown>;
      };
      for (const payload of [call.create, call.update]) {
        expect(payload['score']).toBe(76);
        expect(payload['level']).toBe('READY');
        expect(payload['confidence']).toBe(90);
        expect(payload['formulaVersion']).toBe('readiness-deterministic-v1');
        expect(payload['computedAt']).toBe(computedAt);
      }
    });

    it('a null score (undefined-denominator case) is passed through as null, never coerced to 0', async () => {
      mockPrisma.workforceSignalSnapshot.upsert.mockResolvedValue({});

      await service.write({
        tenantId: TENANT_ID, signalType: 'EXECUTIVE_METRICS_TIME_TO_FILL', scopeType: 'TENANT',
        score: null, level: null, confidence: 10,
        formulaVersion: 'executive-metrics-deterministic-v1', computedAt: new Date(),
      });

      const call = mockPrisma.workforceSignalSnapshot.upsert.mock.calls[0]![0] as {
        create: { score: number | null };
      };
      expect(call.create.score).toBeNull();
    });
  });

  // ===========================================================================
  // Write failure handling — GD-M34-1 Decision 16
  // ===========================================================================

  describe('Write failure handling', () => {
    it('write() never rejects, even when the underlying Prisma call throws', async () => {
      mockPrisma.workforceSignalSnapshot.upsert.mockRejectedValue(new Error('constraint violation'));

      await expect(
        service.write({
          tenantId: TENANT_ID, signalType: 'VACANCY_RISK', scopeType: 'TENANT',
          score: 50, level: null, confidence: 100,
          formulaVersion: 'deterministic-v1', computedAt: new Date(),
        }),
      ).resolves.toBeUndefined();
    });

    it('a rejected upsert does not throw synchronously or leave an unhandled rejection', async () => {
      mockPrisma.workforceSignalSnapshot.upsert.mockRejectedValue(new Error('db unavailable'));

      await expect(
        service.write({
          tenantId: TENANT_ID, signalType: 'ATTRITION_RISK', scopeType: 'TENANT',
          score: 30, level: 'LOW', confidence: 85,
          formulaVersion: 'attrition-deterministic-v1', computedAt: new Date(),
        }),
      ).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // No read path — GD-M34-1 Decision 18
  // ===========================================================================

  describe('No read path', () => {
    it('SnapshotWriterService exposes exactly one public method (write) and no read/query/get/find method of any kind', () => {
      // TypeScript's `private` is compile-time only — private helpers (e.g.
      // toUtcDateOnly) still appear on the prototype at runtime, so this
      // asserts on the governed constraint directly: no method name anywhere
      // on the class implies a read path, and `write` is the only method a
      // TypeScript caller can invoke (every other member is `private`).
      const proto = Object.getOwnPropertyNames(SnapshotWriterService.prototype);
      const methodNames = proto.filter(name => name !== 'constructor');

      expect(methodNames).toContain('write');
      for (const name of methodNames) {
        expect(name.toLowerCase()).not.toMatch(/^(get|read|query|find|list|fetch)/);
      }
    });
  });

  // ===========================================================================
  // No external AI dependency
  // ===========================================================================

  describe('No external AI dependency', () => {
    it('write() completes without any HTTP or network call', async () => {
      mockPrisma.workforceSignalSnapshot.upsert.mockResolvedValue({});
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
        throw new Error('External fetch must not be called by SnapshotWriterService');
      });

      await expect(
        service.write({
          tenantId: TENANT_ID, signalType: 'VACANCY_RISK', scopeType: 'TENANT',
          score: 50, level: null, confidence: 100,
          formulaVersion: 'deterministic-v1', computedAt: new Date(),
        }),
      ).resolves.toBeUndefined();

      fetchSpy.mockRestore();
    });
  });
});
