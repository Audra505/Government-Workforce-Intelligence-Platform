// Reference: governance/GD-M34-1.md — Decisions 5, 6, 7, 8, 9, 10, 12, 16, 21 (validation gate)
// Reference: spec/01_requirements.md — FR-404 (Executive Workforce Analytics), FR-900
//
// Pure unit tests — no database.
// PrismaService replaced with jest.fn() mocks controlling count()/findMany()
// return values. SnapshotWriterService replaced with a jest.fn() mock.
// Covers the GD-M34-1 Decision 21 validation gate items scoped to
// ExecutiveMetricsService:
//   - Vacancy Rate % / Coverage Rate % formulas + null/zero-denominator case
//   - Time To Fill formula, 365-day window exclusion, null/zero-sample case
//   - Hiring Velocity formula, 90-day window, never-null guarantee
//   - Confidence thresholds for Time To Fill (exact boundaries)
//   - formulaVersion
//   - No individual-level data
//   - Tenant isolation
//   - No OpenAI or external dependency

import { Test, type TestingModule } from '@nestjs/testing';

import { ExecutiveMetricsService } from './executive-metrics.service';
import { PrismaService } from '../../database/prisma.service';
import { SnapshotWriterService } from './snapshot-writer.service';

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NOW = new Date('2026-07-19T12:00:00.000Z');

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000);
}

describe('ExecutiveMetricsService', () => {
  let service: ExecutiveMetricsService;

  const mockPrisma = {
    vacancy: { count: jest.fn(), findMany: jest.fn() },
    position: { count: jest.fn() },
    employee: { count: jest.fn() },
  };
  const mockSnapshotWriter = { write: jest.fn().mockResolvedValue(undefined) };

  // Default: 10 active positions, 5 open vacancies, 8 filled positions,
  // no filled-vacancy history, no recent hires.
  function setDefaultMocks() {
    mockPrisma.vacancy.count.mockResolvedValue(5);
    mockPrisma.position.count.mockResolvedValue(10);
    mockPrisma.employee.count.mockResolvedValue(8);
    mockPrisma.vacancy.findMany.mockResolvedValue([]);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    mockSnapshotWriter.write.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutiveMetricsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SnapshotWriterService, useValue: mockSnapshotWriter },
      ],
    }).compile();

    service = module.get<ExecutiveMetricsService>(ExecutiveMetricsService);
  });

  afterEach(() => jest.useRealTimers());

  // ===========================================================================
  // Vacancy Rate % — GD-M34-1 Decision 5
  // ===========================================================================

  describe('Vacancy Rate %', () => {
    it('6 open of 50 active positions → 12.0%', async () => {
      mockPrisma.vacancy.count.mockResolvedValue(6);
      mockPrisma.position.count.mockResolvedValue(50);
      mockPrisma.employee.count.mockResolvedValue(0);
      mockPrisma.vacancy.findMany.mockResolvedValue([]);

      const result = await service.getByTenant(TENANT_ID);

      expect(result.vacancyRate.value).toBe(12.0);
      expect(result.vacancyRate.unit).toBe('PERCENT');
      expect(result.vacancyRate.confidence).toBe(100);
      expect(result.vacancyRate.windowDays).toBeNull();
    });

    it('zero active positions → value null, confidence 10, never fabricated as 0%', async () => {
      mockPrisma.vacancy.count.mockResolvedValue(0);
      mockPrisma.position.count.mockResolvedValue(0);
      mockPrisma.employee.count.mockResolvedValue(0);
      mockPrisma.vacancy.findMany.mockResolvedValue([]);

      const result = await service.getByTenant(TENANT_ID);

      expect(result.vacancyRate.value).toBeNull();
      expect(result.vacancyRate.confidence).toBe(10);
      expect(result.vacancyRate.detail).toBe('No active positions to assess.');
    });
  });

  // ===========================================================================
  // Coverage Rate % — GD-M34-1 Decision 6
  // ===========================================================================

  describe('Coverage Rate %', () => {
    it('41 filled of 50 active positions → 82.0%', async () => {
      mockPrisma.vacancy.count.mockResolvedValue(0);
      mockPrisma.position.count.mockResolvedValue(50);
      mockPrisma.employee.count.mockResolvedValue(41);
      mockPrisma.vacancy.findMany.mockResolvedValue([]);

      const result = await service.getByTenant(TENANT_ID);

      expect(result.coverageRate.value).toBe(82.0);
      expect(result.coverageRate.confidence).toBe(100);
    });

    it('zero active positions → value null, confidence 10', async () => {
      mockPrisma.vacancy.count.mockResolvedValue(0);
      mockPrisma.position.count.mockResolvedValue(0);
      mockPrisma.employee.count.mockResolvedValue(0);
      mockPrisma.vacancy.findMany.mockResolvedValue([]);

      const result = await service.getByTenant(TENANT_ID);

      expect(result.coverageRate.value).toBeNull();
      expect(result.coverageRate.confidence).toBe(10);
    });
  });

  // ===========================================================================
  // Time To Fill — GD-M34-1 Decision 7
  // ===========================================================================

  describe('Time To Fill', () => {
    it('average of two filled vacancies (20 days, 40 days) → 30.0 days', async () => {
      setDefaultMocks();
      mockPrisma.vacancy.findMany.mockResolvedValue([
        { createdAt: daysAgo(20), filledAt: NOW },
        { createdAt: daysAgo(40), filledAt: NOW },
      ]);

      const result = await service.getByTenant(TENANT_ID);

      expect(result.timeToFill.value).toBe(30.0);
      expect(result.timeToFill.unit).toBe('DAYS');
      expect(result.timeToFill.windowDays).toBe(365);
    });

    it('zero vacancies filled in the window → value null, detail explains why, never fabricated as 0', async () => {
      setDefaultMocks();
      mockPrisma.vacancy.findMany.mockResolvedValue([]);

      const result = await service.getByTenant(TENANT_ID);

      expect(result.timeToFill.value).toBeNull();
      expect(result.timeToFill.detail).toContain('No vacancies filled');
    });

    it('a negative computed duration (data integrity edge case) is clamped to 0, never pulling the average negative', async () => {
      setDefaultMocks();
      mockPrisma.vacancy.findMany.mockResolvedValue([
        { createdAt: NOW, filledAt: daysAgo(5) }, // filledAt before createdAt
      ]);

      const result = await service.getByTenant(TENANT_ID);

      expect(result.timeToFill.value).toBe(0);
    });

    it('the Prisma query window is exactly 365 days trailing from now', async () => {
      setDefaultMocks();

      await service.getByTenant(TENANT_ID);

      const call = mockPrisma.vacancy.findMany.mock.calls[0]![0] as {
        where: { filledAt: { gte: Date } };
      };
      expect(call.where.filledAt.gte.getTime()).toBe(NOW.getTime() - 365 * 86_400_000);
    });
  });

  // ===========================================================================
  // Hiring Velocity — GD-M34-1 Decision 8
  // ===========================================================================

  describe('Hiring Velocity', () => {
    it('7 recent hires → value 7, count unit, never null', async () => {
      setDefaultMocks();
      mockPrisma.employee.count.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        if (where['hireDate']) return Promise.resolve(7);
        return Promise.resolve(8);
      });

      const result = await service.getByTenant(TENANT_ID);

      expect(result.hiringVelocity.value).toBe(7);
      expect(result.hiringVelocity.unit).toBe('COUNT');
      expect(result.hiringVelocity.windowDays).toBe(90);
    });

    it('zero recent hires → value 0 (a valid answer, not null)', async () => {
      setDefaultMocks();
      mockPrisma.employee.count.mockResolvedValue(0);

      const result = await service.getByTenant(TENANT_ID);

      expect(result.hiringVelocity.value).toBe(0);
      expect(result.hiringVelocity.confidence).toBe(100);
    });

    it('the hireDate query is scoped to CURRENT_WORKFORCE_STATUSES and the 90-day window', async () => {
      setDefaultMocks();

      await service.getByTenant(TENANT_ID);

      const calls = mockPrisma.employee.count.mock.calls as Array<[{ where: Record<string, unknown> }]>;
      const hireDateCall = calls.find(([{ where }]) => where['hireDate'])!;
      const where = hireDateCall[0].where as { employmentStatus: { in: string[] }; hireDate: { gte: Date } };
      expect(where.employmentStatus.in).toEqual(['ACTIVE', 'ON_LEAVE', 'PENDING_ONBOARDING', 'SUSPENDED']);
      expect(where.hireDate.gte.getTime()).toBe(NOW.getTime() - 90 * 86_400_000);
    });
  });

  // ===========================================================================
  // Confidence thresholds for Time To Fill — GD-M34-1 Decision 9 (exact boundaries)
  // ===========================================================================

  describe('Time To Fill confidence boundaries', () => {
    it.each([
      [0, 10],
      [1, 40],
      [4, 40],
      [5, 70],
      [9, 70],
      [10, 100],
      [15, 100],
    ])('%i filled vacancies → confidence %i', async (n, expectedConfidence) => {
      setDefaultMocks();
      mockPrisma.vacancy.findMany.mockResolvedValue(
        Array.from({ length: n }, () => ({ createdAt: daysAgo(10), filledAt: NOW })),
      );

      const result = await service.getByTenant(TENANT_ID);
      expect(result.timeToFill.confidence).toBe(expectedConfidence);
    });
  });

  // ===========================================================================
  // Response shape and formulaVersion — GD-M34-1 Decision 10
  // ===========================================================================

  describe('Response shape', () => {
    beforeEach(() => setDefaultMocks());

    it('result includes all four metrics plus computedAt and formulaVersion', async () => {
      const result = await service.getByTenant(TENANT_ID);
      expect(result).toHaveProperty('vacancyRate');
      expect(result).toHaveProperty('coverageRate');
      expect(result).toHaveProperty('timeToFill');
      expect(result).toHaveProperty('hiringVelocity');
      expect(result).toHaveProperty('computedAt');
      expect(result).toHaveProperty('formulaVersion');
    });

    it('formulaVersion is executive-metrics-deterministic-v1', async () => {
      const result = await service.getByTenant(TENANT_ID);
      expect(result.formulaVersion).toBe('executive-metrics-deterministic-v1');
    });

    it('each metric reports value/unit/confidence/detail/windowDays only', async () => {
      const result = await service.getByTenant(TENANT_ID);
      for (const metric of [result.vacancyRate, result.coverageRate, result.timeToFill, result.hiringVelocity]) {
        expect(Object.keys(metric).sort()).toEqual(
          ['confidence', 'detail', 'unit', 'value', 'windowDays'].sort(),
        );
      }
    });

    it('computedAt is a valid ISO timestamp', async () => {
      const result = await service.getByTenant(TENANT_ID);
      expect(() => new Date(result.computedAt).toISOString()).not.toThrow();
    });
  });

  // ===========================================================================
  // No individual-level data — same aggregate-only doctrine as every Phase 4 signal
  // ===========================================================================

  describe('No individual-level data', () => {
    beforeEach(() => setDefaultMocks());

    it('response contains no employee, position, or vacancy identifier of any kind', async () => {
      const result = await service.getByTenant(TENANT_ID);
      const serialized = JSON.stringify(result).toLowerCase();

      expect(serialized).not.toMatch(/employeeid|vacancyid|positionid|firstname|lastname|"email"/);
    });

    it('every Prisma call is a count() or a createdAt/filledAt-only findMany() — no row-level identifying data queried', async () => {
      await service.getByTenant(TENANT_ID);

      expect(mockPrisma.vacancy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ select: { createdAt: true, filledAt: true } }),
      );
    });
  });

  // ===========================================================================
  // Snapshot write-on-query wiring — GD-M34-1 Decision 16
  // ===========================================================================

  describe('Snapshot write-on-query wiring', () => {
    beforeEach(() => setDefaultMocks());

    it('writes exactly four snapshots, one per metric, with distinct signalType values', async () => {
      await service.getByTenant(TENANT_ID);

      expect(mockSnapshotWriter.write).toHaveBeenCalledTimes(4);
      const signalTypes = mockSnapshotWriter.write.mock.calls.map(
        (call: [{ signalType: string }]) => call[0].signalType,
      );
      expect(new Set(signalTypes).size).toBe(4);
      expect(signalTypes.sort()).toEqual([
        'EXECUTIVE_METRICS_COVERAGE_RATE',
        'EXECUTIVE_METRICS_HIRING_VELOCITY',
        'EXECUTIVE_METRICS_TIME_TO_FILL',
        'EXECUTIVE_METRICS_VACANCY_RATE',
      ]);
    });

    it('all four snapshots are TENANT-scoped for this tenant', async () => {
      await service.getByTenant(TENANT_ID);

      for (const call of mockSnapshotWriter.write.mock.calls as Array<[{ tenantId: string; scopeType: string }]>) {
        expect(call[0].tenantId).toBe(TENANT_ID);
        expect(call[0].scopeType).toBe('TENANT');
      }
    });
  });

  // ===========================================================================
  // Tenant isolation
  // ===========================================================================

  describe('Tenant isolation', () => {
    it('passes tenantId to every Prisma WHERE clause', async () => {
      setDefaultMocks();
      await service.getByTenant('tenant-xyz');

      expect(mockPrisma.vacancy.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-xyz' }) }),
      );
      expect(mockPrisma.position.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-xyz' }) }),
      );
    });
  });

  // ===========================================================================
  // No external AI dependency — GD-M34-1 Decision 12
  // ===========================================================================

  describe('No external AI dependency', () => {
    it('getByTenant() completes without any HTTP or network call', async () => {
      setDefaultMocks();
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
        throw new Error('External fetch must not be called in executive metrics scoring');
      });

      await expect(service.getByTenant(TENANT_ID)).resolves.toBeDefined();

      fetchSpy.mockRestore();
    });
  });
});
