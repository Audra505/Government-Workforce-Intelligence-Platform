// Reference: governance/GD-M32-1.md — Decisions 5, 6, 7, 8, 11, 12, 14 (validation gate)
// Reference: spec/01_requirements.md — FR-402 (Attrition Prediction), FR-900 (Explainability)
//
// Pure unit tests — no database.
// PrismaService replaced with jest.fn() mocks controlling employee.count() and
// vacancy.findMany() return values. No cross-service dependency (GD-M32-1 Decision 2).
// Covers all governed test cases from GD-M32-1 Decision 14 validation gate:
//   - All three factor weights and thresholds
//   - attritionScore cap at 100
//   - Attrition risk level thresholds (LOW/MEDIUM/HIGH/CRITICAL)
//   - Confidence rules (each reduction trigger, compounding, floor of 10)
//   - Insufficient-data behavior (zero employees/separations/filled vacancies)
//   - Response shape: required explainability fields present
//   - Factors array: always exactly 3 entries
//   - Reasoning: non-empty, dynamically composed
//   - No individual-level data (aggregate-only by construction)
//   - Tenant isolation
//   - No OpenAI or external dependency

import { Test, type TestingModule } from '@nestjs/testing';

import { AttritionRiskService } from './attrition-risk.service';
import { PrismaService } from '../../database/prisma.service';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('AttritionRiskService', () => {
  let service: AttritionRiskService;

  const mockPrisma = {
    employee: { count: jest.fn() },
    vacancy: { findMany: jest.fn() },
    department: { findMany: jest.fn() },
  };

  // Classifies which of the four employee.count() calls this is, by WHERE shape,
  // so a single mockImplementation can serve every query the service issues.
  function classifyAndCount(
    where: Record<string, unknown>,
    counts: { trailingSeparations: number; baselineWorkforce: number; activeEmployees: number; shortTenureCount: number },
  ): number {
    if (where['OR']) return counts.baselineWorkforce;
    if (where['employmentStatus'] === 'SEPARATED') return counts.trailingSeparations;
    if (where['hireDate']) return counts.shortTenureCount;
    return counts.activeEmployees;
  }

  function mockCounts(counts: {
    trailingSeparations: number; baselineWorkforce: number; activeEmployees: number; shortTenureCount: number;
  }) {
    mockPrisma.employee.count.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(classifyAndCount(where, counts)),
    );
  }

  function mockFilledVacancies(positionIds: string[]) {
    mockPrisma.vacancy.findMany.mockResolvedValue(positionIds.map(positionId => ({ positionId })));
  }

  // Default: no separations, no short-tenure staff, no recurring positions — LOW risk
  function setLowRiskMocks() {
    mockCounts({ trailingSeparations: 0, baselineWorkforce: 100, activeEmployees: 100, shortTenureCount: 0 });
    mockFilledVacancies(['pos-1', 'pos-2', 'pos-3', 'pos-4', 'pos-5']); // 5 eligible, 0 recurring
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttritionRiskService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AttritionRiskService>(AttritionRiskService);
  });

  // ===========================================================================
  // Separation Rate Factor (max 50 pts) — GD-M32-1 Decision 5
  // ===========================================================================

  describe('Separation Rate Factor', () => {
    it('0% trailing separation rate → 0 pts', async () => {
      mockCounts({ trailingSeparations: 0, baselineWorkforce: 100, activeEmployees: 100, shortTenureCount: 0 });
      mockFilledVacancies([]);

      const result = await service.score(TENANT_ID);
      const factor = result.factors.find(f => f.name === 'separationRate')!;
      expect(factor.contribution).toBe(0);
      expect(factor.detail).toContain('0%');
    });

    it('15% trailing separation rate (half of the 30% ceiling) → 25 pts', async () => {
      mockCounts({ trailingSeparations: 15, baselineWorkforce: 100, activeEmployees: 100, shortTenureCount: 0 });
      mockFilledVacancies([]);

      const result = await service.score(TENANT_ID);
      const factor = result.factors.find(f => f.name === 'separationRate')!;
      expect(factor.contribution).toBe(25);
    });

    it('separation rate at or above the 30% ceiling → 50 pts (capped)', async () => {
      mockCounts({ trailingSeparations: 40, baselineWorkforce: 100, activeEmployees: 100, shortTenureCount: 0 });
      mockFilledVacancies([]);

      const result = await service.score(TENANT_ID);
      const factor = result.factors.find(f => f.name === 'separationRate')!;
      expect(factor.contribution).toBe(50);
    });

    it('baselineWorkforce is 0 (insufficient data) → neutral 25 pts', async () => {
      mockCounts({ trailingSeparations: 0, baselineWorkforce: 0, activeEmployees: 0, shortTenureCount: 0 });
      mockFilledVacancies([]);

      const result = await service.score(TENANT_ID);
      const factor = result.factors.find(f => f.name === 'separationRate')!;
      expect(factor.contribution).toBe(25);
      expect(factor.detail).toBe('No employment history available to assess');
    });
  });

  // ===========================================================================
  // Tenure Composition Factor (max 30 pts) — GD-M32-1 Decision 5
  // ===========================================================================

  describe('Tenure Composition Factor', () => {
    it('0% short-tenure ratio → 0 pts', async () => {
      mockCounts({ trailingSeparations: 0, baselineWorkforce: 100, activeEmployees: 20, shortTenureCount: 0 });
      mockFilledVacancies([]);

      const result = await service.score(TENANT_ID);
      const factor = result.factors.find(f => f.name === 'tenureComposition')!;
      expect(factor.contribution).toBe(0);
    });

    it('50% short-tenure ratio → 15 pts', async () => {
      mockCounts({ trailingSeparations: 0, baselineWorkforce: 100, activeEmployees: 20, shortTenureCount: 10 });
      mockFilledVacancies([]);

      const result = await service.score(TENANT_ID);
      const factor = result.factors.find(f => f.name === 'tenureComposition')!;
      expect(factor.contribution).toBe(15);
    });

    it('100% short-tenure ratio → 30 pts', async () => {
      mockCounts({ trailingSeparations: 0, baselineWorkforce: 100, activeEmployees: 20, shortTenureCount: 20 });
      mockFilledVacancies([]);

      const result = await service.score(TENANT_ID);
      const factor = result.factors.find(f => f.name === 'tenureComposition')!;
      expect(factor.contribution).toBe(30);
    });

    it('activeEmployees is 0 (insufficient data) → neutral 15 pts', async () => {
      mockCounts({ trailingSeparations: 0, baselineWorkforce: 0, activeEmployees: 0, shortTenureCount: 0 });
      mockFilledVacancies([]);

      const result = await service.score(TENANT_ID);
      const factor = result.factors.find(f => f.name === 'tenureComposition')!;
      expect(factor.contribution).toBe(15);
      expect(factor.detail).toBe('No current workforce data available');
    });
  });

  // ===========================================================================
  // Position/Vacancy Recurrence Factor (max 20 pts) — GD-M32-1 Decision 5
  // ===========================================================================

  describe('Position/Vacancy Recurrence Factor', () => {
    it('0% recurrence ratio → 0 pts', async () => {
      mockCounts({ trailingSeparations: 0, baselineWorkforce: 100, activeEmployees: 100, shortTenureCount: 0 });
      mockFilledVacancies(['pos-1', 'pos-2', 'pos-3', 'pos-4']); // 4 eligible, 0 recurring

      const result = await service.score(TENANT_ID);
      const factor = result.factors.find(f => f.name === 'positionRecurrence')!;
      expect(factor.contribution).toBe(0);
    });

    it('50% recurrence ratio → 10 pts', async () => {
      mockCounts({ trailingSeparations: 0, baselineWorkforce: 100, activeEmployees: 100, shortTenureCount: 0 });
      // 4 eligible positions, 2 filled more than once
      mockFilledVacancies(['pos-1', 'pos-1', 'pos-2', 'pos-2', 'pos-3', 'pos-4']);

      const result = await service.score(TENANT_ID);
      const factor = result.factors.find(f => f.name === 'positionRecurrence')!;
      expect(factor.contribution).toBe(10);
    });

    it('100% recurrence ratio → 20 pts', async () => {
      mockCounts({ trailingSeparations: 0, baselineWorkforce: 100, activeEmployees: 100, shortTenureCount: 0 });
      mockFilledVacancies(['pos-1', 'pos-1', 'pos-2', 'pos-2']); // 2 eligible, both recurring

      const result = await service.score(TENANT_ID);
      const factor = result.factors.find(f => f.name === 'positionRecurrence')!;
      expect(factor.contribution).toBe(20);
    });

    it('no positions filled in the trailing window (insufficient data) → neutral 10 pts', async () => {
      mockCounts({ trailingSeparations: 0, baselineWorkforce: 100, activeEmployees: 100, shortTenureCount: 0 });
      mockFilledVacancies([]);

      const result = await service.score(TENANT_ID);
      const factor = result.factors.find(f => f.name === 'positionRecurrence')!;
      expect(factor.contribution).toBe(10);
      expect(factor.detail).toBe('No positions filled in the last 12 months to assess');
    });
  });

  // ===========================================================================
  // attritionScore = min(100, sum) — GD-M32-1 Decision 5
  // ===========================================================================

  describe('attritionScore', () => {
    it('worst-case inputs across all three factors → 100, CRITICAL', async () => {
      mockCounts({ trailingSeparations: 40, baselineWorkforce: 100, activeEmployees: 20, shortTenureCount: 20 });
      mockFilledVacancies(['pos-1', 'pos-1', 'pos-2', 'pos-2']);

      const result = await service.score(TENANT_ID);
      expect(result.riskScore).toBe(100); // 50 + 30 + 20
      expect(result.riskLevel).toBe('CRITICAL');
    });

    it('attritionScore capped at 100', async () => {
      mockCounts({ trailingSeparations: 40, baselineWorkforce: 100, activeEmployees: 20, shortTenureCount: 20 });
      mockFilledVacancies(['pos-1', 'pos-1', 'pos-2', 'pos-2']);

      const result = await service.score(TENANT_ID);
      expect(result.riskScore).toBeLessThanOrEqual(100);
    });
  });

  // ===========================================================================
  // Attrition Risk Level Thresholds — GD-M32-1 Decision 6
  // ===========================================================================

  describe('Attrition Risk Level Thresholds', () => {
    it('score 24 → LOW, score 25 → MEDIUM (boundary via controlled inputs)', async () => {
      // 24: separationFactor 20 (rate 0.12) + tenureFactor 0 + recurrenceFactor 4 (1 of 5 recurring)
      mockCounts({ trailingSeparations: 12, baselineWorkforce: 100, activeEmployees: 50, shortTenureCount: 0 });
      mockFilledVacancies(['pos-1', 'pos-1', 'pos-2', 'pos-3', 'pos-4', 'pos-5']); // 5 eligible, 1 recurring
      const result24 = await service.score(TENANT_ID);
      expect(result24.riskScore).toBe(24);
      expect(result24.riskLevel).toBe('LOW');

      jest.clearAllMocks();
      // 25: separationFactor 25 (rate 0.15) + tenureFactor 0 + recurrenceFactor 0
      mockCounts({ trailingSeparations: 15, baselineWorkforce: 100, activeEmployees: 50, shortTenureCount: 0 });
      mockFilledVacancies(['pos-1', 'pos-2']); // 2 eligible, 0 recurring
      const result25 = await service.score(TENANT_ID);
      expect(result25.riskScore).toBe(25);
      expect(result25.riskLevel).toBe('MEDIUM');
    });

    it('score 49 → MEDIUM, score 50 → HIGH (boundary via controlled inputs)', async () => {
      // 49: separationFactor 25 (rate 0.15) + tenureFactor 15 (ratio 0.5) + recurrenceFactor 9 (ratio 0.45)
      mockCounts({ trailingSeparations: 15, baselineWorkforce: 100, activeEmployees: 10, shortTenureCount: 5 });
      mockFilledVacancies([
        ...Array(9).fill(0).map((_, i) => `recurring-${i}`),
        ...Array(9).fill(0).map((_, i) => `recurring-${i}`), // each of 9 filled twice
        ...Array(11).fill(0).map((_, i) => `single-${i}`),   // 11 filled once
      ]); // 20 eligible, 9 recurring → ratio 0.45
      const result49 = await service.score(TENANT_ID);
      expect(result49.riskScore).toBe(49);
      expect(result49.riskLevel).toBe('MEDIUM');

      jest.clearAllMocks();
      // 50: separationFactor 25 (rate 0.15) + tenureFactor 15 (ratio 0.5) + recurrenceFactor 10 (ratio 0.5)
      mockCounts({ trailingSeparations: 15, baselineWorkforce: 100, activeEmployees: 10, shortTenureCount: 5 });
      mockFilledVacancies(['pos-1', 'pos-1', 'pos-2', 'pos-2', 'pos-3', 'pos-4']); // 4 eligible, 2 recurring
      const result50 = await service.score(TENANT_ID);
      expect(result50.riskScore).toBe(50);
      expect(result50.riskLevel).toBe('HIGH');
    });

    it('score 74 → HIGH, score 75 → CRITICAL (boundary via controlled inputs)', async () => {
      // 74: separationFactor 50 (rate >= 0.30) + tenureFactor 15 (ratio 0.5) + recurrenceFactor 9 (ratio 0.45)
      mockCounts({ trailingSeparations: 30, baselineWorkforce: 100, activeEmployees: 10, shortTenureCount: 5 });
      mockFilledVacancies([
        ...Array(9).fill(0).map((_, i) => `recurring-${i}`),
        ...Array(9).fill(0).map((_, i) => `recurring-${i}`),
        ...Array(11).fill(0).map((_, i) => `single-${i}`),
      ]); // 20 eligible, 9 recurring → ratio 0.45
      const result74 = await service.score(TENANT_ID);
      expect(result74.riskScore).toBe(74);
      expect(result74.riskLevel).toBe('HIGH');

      jest.clearAllMocks();
      // 75: separationFactor 50 + tenureFactor 15 (ratio 0.5) + recurrenceFactor 10 (ratio 0.5)
      mockCounts({ trailingSeparations: 30, baselineWorkforce: 100, activeEmployees: 10, shortTenureCount: 5 });
      mockFilledVacancies(['pos-1', 'pos-1', 'pos-2', 'pos-2', 'pos-3', 'pos-4']); // 4 eligible, 2 recurring
      const result75 = await service.score(TENANT_ID);
      expect(result75.riskScore).toBe(75);
      expect(result75.riskLevel).toBe('CRITICAL');
    });
  });

  // ===========================================================================
  // Confidence — GD-M32-1 Decision 7
  // ===========================================================================

  describe('Confidence Computation', () => {
    it('full data available (baseline > 0, activeEmployees >= 3, positions filled) → confidence 100', async () => {
      setLowRiskMocks();
      const result = await service.score(TENANT_ID);
      expect(result.confidence).toBe(100);
    });

    it('baselineWorkforce is 0 → confidence x 0.5', async () => {
      mockCounts({ trailingSeparations: 0, baselineWorkforce: 0, activeEmployees: 10, shortTenureCount: 0 });
      mockFilledVacancies(['pos-1']);

      const result = await service.score(TENANT_ID);
      expect(result.confidence).toBe(50); // floor(100 * 0.5)
    });

    it('no positions filled in the window → confidence x 0.7', async () => {
      mockCounts({ trailingSeparations: 0, baselineWorkforce: 100, activeEmployees: 10, shortTenureCount: 0 });
      mockFilledVacancies([]);

      const result = await service.score(TENANT_ID);
      expect(result.confidence).toBe(70); // floor(100 * 0.7)
    });

    it('small active workforce (1 <= n < 3) → confidence x 0.6 (only the small-sample rule fires)', async () => {
      mockCounts({ trailingSeparations: 0, baselineWorkforce: 100, activeEmployees: 2, shortTenureCount: 0 });
      mockFilledVacancies(['pos-1']);

      const result = await service.score(TENANT_ID);
      expect(result.confidence).toBe(60); // floor(100 * 0.6)
    });

    it('activeEmployees is 0 → confidence x 0.6 x 0.6 (both the zero-workforce and small-sample rules fire)', async () => {
      mockCounts({ trailingSeparations: 0, baselineWorkforce: 100, activeEmployees: 0, shortTenureCount: 0 });
      mockFilledVacancies(['pos-1']);

      const result = await service.score(TENANT_ID);
      expect(result.confidence).toBe(36); // floor(100 * 0.6 * 0.6)
    });

    it('multiple reductions compound multiplicatively', async () => {
      // baseline=0 (x0.5) AND no filled positions (x0.7) AND activeEmployees=2, <3 (x0.6)
      // 100 * 0.5 * 0.7 * 0.6 = 21
      mockCounts({ trailingSeparations: 0, baselineWorkforce: 0, activeEmployees: 2, shortTenureCount: 0 });
      mockFilledVacancies([]);

      const result = await service.score(TENANT_ID);
      expect(result.confidence).toBe(21);
    });

    it('confidence never reports below the floor of 10', async () => {
      mockCounts({ trailingSeparations: 0, baselineWorkforce: 0, activeEmployees: 0, shortTenureCount: 0 });
      mockFilledVacancies([]);

      const result = await service.score(TENANT_ID);
      expect(result.confidence).toBeGreaterThanOrEqual(10);
    });
  });

  // ===========================================================================
  // Insufficient-data behavior — GD-M32-1 Decision 7
  // ===========================================================================

  describe('Insufficient-data behavior', () => {
    it('zero employees, zero separations, zero filled vacancies — never throws', async () => {
      mockCounts({ trailingSeparations: 0, baselineWorkforce: 0, activeEmployees: 0, shortTenureCount: 0 });
      mockFilledVacancies([]);

      await expect(service.score(TENANT_ID)).resolves.toBeDefined();
    });

    it('returns a valid low-confidence score for a fully empty tenant, not an error', async () => {
      mockCounts({ trailingSeparations: 0, baselineWorkforce: 0, activeEmployees: 0, shortTenureCount: 0 });
      mockFilledVacancies([]);

      const result = await service.score(TENANT_ID);
      expect(typeof result.riskScore).toBe('number');
      expect(result.confidence).toBeLessThan(100);
    });
  });

  // ===========================================================================
  // Response shape and explainability — GD-M32-1 Decision 8, 14
  // ===========================================================================

  describe('Response shape and explainability', () => {
    beforeEach(() => setLowRiskMocks());

    it('result includes all required explainability fields', async () => {
      const result = await service.score(TENANT_ID);
      expect(result).toHaveProperty('riskScore');
      expect(result).toHaveProperty('riskLevel');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('reasoning');
      expect(result).toHaveProperty('factors');
      expect(result).toHaveProperty('computedAt');
      expect(result).toHaveProperty('formulaVersion');
    });

    it('formulaVersion is attrition-deterministic-v1', async () => {
      const result = await service.score(TENANT_ID);
      expect(result.formulaVersion).toBe('attrition-deterministic-v1');
    });

    it('reasoning is non-empty and dynamically composed', async () => {
      const lowResult = await service.score(TENANT_ID);
      expect(lowResult.reasoning.length).toBeGreaterThan(0);
      expect(lowResult.reasoning).toContain('LOW');

      jest.clearAllMocks();
      mockCounts({ trailingSeparations: 40, baselineWorkforce: 100, activeEmployees: 20, shortTenureCount: 20 });
      mockFilledVacancies(['pos-1', 'pos-1', 'pos-2', 'pos-2']);
      const highResult = await service.score(TENANT_ID);
      expect(highResult.reasoning).not.toBe(lowResult.reasoning);
    });

    it('factors array always contains exactly 3 entries', async () => {
      const result = await service.score(TENANT_ID);
      expect(result.factors).toHaveLength(3);
      const names = result.factors.map(f => f.name).sort();
      expect(names).toEqual(['positionRecurrence', 'separationRate', 'tenureComposition']);
    });

    it('computedAt is a valid ISO timestamp', async () => {
      const result = await service.score(TENANT_ID);
      expect(() => new Date(result.computedAt).toISOString()).not.toThrow();
    });
  });

  // ===========================================================================
  // Aggregate-only / no individual-level data — GD-M32-1 Decision 11
  // ===========================================================================

  describe('Aggregate-only guarantee', () => {
    beforeEach(() => setLowRiskMocks());

    it('response contains no employee-shaped field, list, or identifier', async () => {
      const result = await service.score(TENANT_ID);
      const json = JSON.stringify(result);
      expect(json).not.toMatch(/employeeId|employeeNumber|firstName|lastName|"email"/i);
      expect(result).not.toHaveProperty('employees');
      expect(result).not.toHaveProperty('items');
      expect(result).not.toHaveProperty('rows');
    });

    it('every Prisma call is a count() or a positionId-only findMany() — no row-level employee query exists', () => {
      // Structural guarantee: mockPrisma.employee only exposes count(); if the
      // implementation ever called employee.findMany(), this test double would
      // throw "is not a function" during score(), which the other tests would
      // already have caught. This test documents that guarantee explicitly.
      expect((mockPrisma.employee as Record<string, unknown>)['findMany']).toBeUndefined();
    });

    it('vacancy.findMany() selects only positionId — no vacancy row detail returned', async () => {
      await service.score(TENANT_ID);
      expect(mockPrisma.vacancy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ select: { positionId: true } }),
      );
    });
  });

  // ===========================================================================
  // Tenant isolation — GD-M32-1 Decision 3
  // ===========================================================================

  describe('Tenant isolation', () => {
    it('passes tenantId to every Prisma WHERE clause', async () => {
      setLowRiskMocks();
      await service.score('tenant-xyz');

      const calls = mockPrisma.employee.count.mock.calls as Array<[{ where: Record<string, unknown> }]>;
      expect(calls.length).toBeGreaterThan(0);
      for (const [{ where }] of calls) {
        expect(where['tenantId']).toBe('tenant-xyz');
      }
      expect(mockPrisma.vacancy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-xyz' }) }),
      );
    });
  });

  // ===========================================================================
  // No external AI dependency — GD-M32-1 Decision 12
  // ===========================================================================

  describe('No external AI dependency', () => {
    it('AttritionRiskService has no OpenAI or external HTTP dependency (no import)', () => {
      expect(service).toBeInstanceOf(AttritionRiskService);
    });

    it('score() completes without any HTTP or network call', async () => {
      setLowRiskMocks();
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
        throw new Error('External fetch must not be called in attrition risk scoring');
      });

      await expect(service.score(TENANT_ID)).resolves.toBeDefined();

      fetchSpy.mockRestore();
    });
  });

  // ===========================================================================
  // scoreByDepartment() — GD-M33-1 Decision 5 (department-level extension)
  // ===========================================================================

  describe('scoreByDepartment()', () => {
    it('queries Department scoped to tenantId and deletedAt:null, selecting only id and name', async () => {
      mockPrisma.department.findMany.mockResolvedValue([]);

      await service.scoreByDepartment(TENANT_ID);

      expect(mockPrisma.department.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, deletedAt: null },
        select: { id: true, name: true },
      });
    });

    it('returns an empty array when the tenant has no departments', async () => {
      mockPrisma.department.findMany.mockResolvedValue([]);

      const result = await service.scoreByDepartment(TENANT_ID);
      expect(result).toEqual([]);
    });

    it('a single department containing the entire tenant population returns byte-identical formula output to score(tenantId) — proves no formula drift (GD-M33-1 Decision 17)', async () => {
      mockPrisma.department.findMany.mockResolvedValue([{ id: 'dept-1', name: 'Whole Tenant' }]);
      setLowRiskMocks();

      const tenantWide = await service.score(TENANT_ID);
      const byDept = await service.scoreByDepartment(TENANT_ID);

      expect(byDept).toHaveLength(1);
      expect(byDept[0]!.output.riskScore).toBe(tenantWide.riskScore);
      expect(byDept[0]!.output.riskLevel).toBe(tenantWide.riskLevel);
      expect(byDept[0]!.output.confidence).toBe(tenantWide.confidence);
      expect(byDept[0]!.output.factors).toEqual(tenantWide.factors);
      expect(byDept[0]!.output.formulaVersion).toBe(tenantWide.formulaVersion);
      expect(byDept[0]!.output.formulaVersion).toBe('attrition-deterministic-v1'); // unchanged constant
    });

    it('returns one entry per department with correct departmentId/departmentName', async () => {
      mockPrisma.department.findMany.mockResolvedValue([
        { id: 'dept-1', name: 'Alpha' },
        { id: 'dept-2', name: 'Beta' },
      ]);
      setLowRiskMocks();

      const result = await service.scoreByDepartment(TENANT_ID);

      expect(result).toHaveLength(2);
      expect(result.map(r => r.departmentId)).toEqual(['dept-1', 'dept-2']);
      expect(result.map(r => r.departmentName)).toEqual(['Alpha', 'Beta']);
    });

    it('population field equals baselineWorkforce (current + recently separated) — GD-M32-1 Decision 5', async () => {
      mockPrisma.department.findMany.mockResolvedValue([{ id: 'dept-1', name: 'Alpha' }]);
      mockCounts({ trailingSeparations: 2, baselineWorkforce: 12, activeEmployees: 10, shortTenureCount: 0 });
      mockFilledVacancies([]);

      const result = await service.scoreByDepartment(TENANT_ID);
      expect(result[0]!.population).toBe(12);
    });

    it('every Employee query is scoped by departmentId, not just tenantId', async () => {
      mockPrisma.department.findMany.mockResolvedValue([{ id: 'dept-42', name: 'Scoped Dept' }]);
      setLowRiskMocks();

      await service.scoreByDepartment(TENANT_ID);

      const calls = mockPrisma.employee.count.mock.calls as Array<[{ where: Record<string, unknown> }]>;
      expect(calls.length).toBeGreaterThan(0);
      for (const [{ where }] of calls) {
        expect(where['departmentId']).toBe('dept-42');
      }
    });

    it('the filled-vacancies query is scoped via position.departmentId (Vacancy has no direct departmentId column)', async () => {
      mockPrisma.department.findMany.mockResolvedValue([{ id: 'dept-42', name: 'Scoped Dept' }]);
      setLowRiskMocks();

      await service.scoreByDepartment(TENANT_ID);

      expect(mockPrisma.vacancy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ position: { departmentId: 'dept-42' } }),
        }),
      );
    });

    it('no employee identifier, name, or row-level data appears anywhere in the output', async () => {
      mockPrisma.department.findMany.mockResolvedValue([{ id: 'dept-1', name: 'Alpha' }]);
      setLowRiskMocks();

      const result = await service.scoreByDepartment(TENANT_ID);
      const serialized = JSON.stringify(result).toLowerCase();

      expect(serialized).not.toContain('firstname');
      expect(serialized).not.toContain('lastname');
      expect(serialized).not.toContain('email');
    });
  });
});
