// Reference: governance/GD-M33-1.md — Decisions 5, 6, 9, 11, 13, 17 (validation gate)
// Reference: spec/01_requirements.md — FR-411 (Department Readiness)
//
// Pure unit tests — no database. WorkforceReadinessService, AttritionRiskService, and
// VacancyRiskService are all replaced with jest.fn() mocks controlling
// scoreByDepartment()/score() return values — DepartmentGapService is an orchestrator
// only and contains no formula logic to test directly (formula equivalence is covered
// in workforce-readiness.service.spec.ts and attrition-risk.service.spec.ts).
//
// Covers all governed test cases from GD-M33-1 Decision 17 validation gate that are
// scoped to DepartmentGapService itself:
//   - Minimum headcount suppression rule (boundary at exactly 5, independent per signal)
//   - Suppressed department never exposes its actual headcount/population
//   - Suppressed department still returns vacancy context (not suppressed)
//   - Department ordering is alphabetical, never by score (no leaderboard)
//   - formulaVersion reported correctly at top level and per signal
//   - No individual employee data anywhere in the response shape
//   - Audit-safe aggregate counts computable from the result (departmentCount, suppressedDepartmentCount)

import { Test, type TestingModule } from '@nestjs/testing';

import { DepartmentGapService } from './department-gap.service';
import { WorkforceReadinessService } from './workforce-readiness.service';
import type { DepartmentReadinessResult } from './workforce-readiness.service';
import { AttritionRiskService } from './attrition-risk.service';
import type { DepartmentAttritionResult } from './attrition-risk.service';
import { VacancyRiskService } from './vacancy-risk.service';
import type { VacancyRiskItem } from './vacancy-risk.service';

// ---------------------------------------------------------------------------
// Test constants / helpers
// ---------------------------------------------------------------------------

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeReadinessResult(
  departmentId: string,
  departmentName: string,
  population: number,
  score = 70,
): DepartmentReadinessResult {
  return {
    departmentId,
    departmentName,
    population,
    output: {
      riskScore: score,
      riskLevel: 'DEVELOPING',
      confidence: 90,
      reasoning: 'Workforce readiness is DEVELOPING, driven primarily by strong staffing coverage.',
      factors: [{ name: 'staffingCoverage', contribution: 27, detail: '90% of current workforce active' }],
      computedAt: '2026-07-18T12:00:00.000Z',
      formulaVersion: 'readiness-deterministic-v1',
    },
  };
}

function makeAttritionResult(
  departmentId: string,
  departmentName: string,
  population: number,
  score = 30,
): DepartmentAttritionResult {
  return {
    departmentId,
    departmentName,
    population,
    output: {
      riskScore: score,
      riskLevel: 'MEDIUM',
      confidence: 85,
      reasoning: 'Attrition risk is MEDIUM, driven primarily by a large share of recently hired staff.',
      factors: [{ name: 'separationRate', contribution: 12, detail: '7% trailing 12-month separation rate' }],
      computedAt: '2026-07-18T12:00:00.000Z',
      formulaVersion: 'attrition-deterministic-v1',
    },
  };
}

function makeVacancyItem(departmentName: string, riskLevel: string, daysOpen: number): VacancyRiskItem {
  return {
    vacancyId: `vac-${departmentName}-${daysOpen}`,
    positionTitle: 'Test Position',
    departmentName,
    status: 'OPEN',
    daysOpen,
    priority: 'MEDIUM',
    riskScore: riskLevel === 'CRITICAL' ? 80 : riskLevel === 'HIGH' ? 60 : 30,
    riskLevel,
    confidence: 100,
    reasoning: 'test',
    factors: [],
    computedAt: '2026-07-18T12:00:00.000Z',
    formulaVersion: 'deterministic-v1',
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('DepartmentGapService', () => {
  let service: DepartmentGapService;

  const mockWorkforceReadinessService = { scoreByDepartment: jest.fn() };
  const mockAttritionRiskService = { scoreByDepartment: jest.fn() };
  const mockVacancyRiskService = { score: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepartmentGapService,
        { provide: WorkforceReadinessService, useValue: mockWorkforceReadinessService },
        { provide: AttritionRiskService, useValue: mockAttritionRiskService },
        { provide: VacancyRiskService, useValue: mockVacancyRiskService },
      ],
    }).compile();

    service = module.get<DepartmentGapService>(DepartmentGapService);
  });

  // ===========================================================================
  // Minimum headcount suppression rule — GD-M33-1 Decision 6
  // ===========================================================================

  describe('minimum headcount suppression', () => {
    it('department with population >= 5 for both signals is NOT suppressed', async () => {
      mockWorkforceReadinessService.scoreByDepartment.mockResolvedValue([
        makeReadinessResult('dept-1', 'Field Operations', 5),
      ]);
      mockAttritionRiskService.scoreByDepartment.mockResolvedValue([
        makeAttritionResult('dept-1', 'Field Operations', 5),
      ]);
      mockVacancyRiskService.score.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getByTenant(TENANT_ID);

      expect(result.departments).toHaveLength(1);
      expect(result.departments[0]!.suppressed).toBe(false);
      expect(result.departments[0]!.readiness).not.toBeNull();
      expect(result.departments[0]!.attrition).not.toBeNull();
    });

    it('department with readiness population below 5 IS suppressed, even if attrition population is sufficient', async () => {
      mockWorkforceReadinessService.scoreByDepartment.mockResolvedValue([
        makeReadinessResult('dept-1', 'Small Unit', 4),
      ]);
      mockAttritionRiskService.scoreByDepartment.mockResolvedValue([
        makeAttritionResult('dept-1', 'Small Unit', 10),
      ]);
      mockVacancyRiskService.score.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getByTenant(TENANT_ID);

      expect(result.departments[0]!.suppressed).toBe(true);
      expect(result.departments[0]!.readiness).toBeNull();
      expect(result.departments[0]!.attrition).toBeNull();
    });

    it('department with attrition population below 5 IS suppressed, even if readiness population is sufficient', async () => {
      mockWorkforceReadinessService.scoreByDepartment.mockResolvedValue([
        makeReadinessResult('dept-1', 'Small Unit', 10),
      ]);
      mockAttritionRiskService.scoreByDepartment.mockResolvedValue([
        makeAttritionResult('dept-1', 'Small Unit', 2),
      ]);
      mockVacancyRiskService.score.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getByTenant(TENANT_ID);

      expect(result.departments[0]!.suppressed).toBe(true);
      expect(result.departments[0]!.readiness).toBeNull();
      expect(result.departments[0]!.attrition).toBeNull();
    });

    it('boundary: population exactly 5 is NOT suppressed (>= 5, not > 5)', async () => {
      mockWorkforceReadinessService.scoreByDepartment.mockResolvedValue([
        makeReadinessResult('dept-1', 'Boundary Dept', 5),
      ]);
      mockAttritionRiskService.scoreByDepartment.mockResolvedValue([
        makeAttritionResult('dept-1', 'Boundary Dept', 5),
      ]);
      mockVacancyRiskService.score.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getByTenant(TENANT_ID);

      expect(result.departments[0]!.suppressed).toBe(false);
    });

    it('boundary: population of 4 IS suppressed', async () => {
      mockWorkforceReadinessService.scoreByDepartment.mockResolvedValue([
        makeReadinessResult('dept-1', 'Boundary Dept', 4),
      ]);
      mockAttritionRiskService.scoreByDepartment.mockResolvedValue([
        makeAttritionResult('dept-1', 'Boundary Dept', 4),
      ]);
      mockVacancyRiskService.score.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getByTenant(TENANT_ID);

      expect(result.departments[0]!.suppressed).toBe(true);
    });

    it('minimumHeadcountThreshold reported as 5 in the response', async () => {
      mockWorkforceReadinessService.scoreByDepartment.mockResolvedValue([]);
      mockAttritionRiskService.scoreByDepartment.mockResolvedValue([]);
      mockVacancyRiskService.score.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getByTenant(TENANT_ID);
      expect(result.minimumHeadcountThreshold).toBe(5);
    });
  });

  // ===========================================================================
  // Suppressed department never exposes headcount — GD-M33-1 Decision 6
  // ===========================================================================

  describe('suppressed department response shape', () => {
    it('suppressed entry has suppressionReason as a fixed non-identifying string, never the actual population', async () => {
      mockWorkforceReadinessService.scoreByDepartment.mockResolvedValue([
        makeReadinessResult('dept-1', 'Tiny Dept', 2),
      ]);
      mockAttritionRiskService.scoreByDepartment.mockResolvedValue([
        makeAttritionResult('dept-1', 'Tiny Dept', 2),
      ]);
      mockVacancyRiskService.score.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getByTenant(TENANT_ID);
      const entry = result.departments[0]!;

      expect(entry.suppressionReason).toBe('Department population below minimum reporting threshold (5).');
      expect(entry.suppressionReason).not.toContain('2'); // never the actual headcount
      expect(JSON.stringify(entry)).not.toContain('"population"'); // field does not exist on the public shape at all
    });

    it('suppressed department still returns vacancy context (not subject to suppression)', async () => {
      mockWorkforceReadinessService.scoreByDepartment.mockResolvedValue([
        makeReadinessResult('dept-1', 'Tiny Dept', 2),
      ]);
      mockAttritionRiskService.scoreByDepartment.mockResolvedValue([
        makeAttritionResult('dept-1', 'Tiny Dept', 2),
      ]);
      mockVacancyRiskService.score.mockResolvedValue({
        items: [makeVacancyItem('Tiny Dept', 'CRITICAL', 40)],
        total: 1,
      });

      const result = await service.getByTenant(TENANT_ID);
      const entry = result.departments[0]!;

      expect(entry.suppressed).toBe(true);
      expect(entry.vacancyContext.openCount).toBe(1);
      expect(entry.vacancyContext.criticalCount).toBe(1);
      expect(entry.vacancyContext.avgDaysOpen).toBe(40);
    });
  });

  // ===========================================================================
  // Vacancy context aggregation
  // ===========================================================================

  describe('vacancy context', () => {
    it('aggregates openCount, criticalCount, and avgDaysOpen per department by departmentName', async () => {
      mockWorkforceReadinessService.scoreByDepartment.mockResolvedValue([
        makeReadinessResult('dept-1', 'Field Operations', 10),
      ]);
      mockAttritionRiskService.scoreByDepartment.mockResolvedValue([
        makeAttritionResult('dept-1', 'Field Operations', 10),
      ]);
      mockVacancyRiskService.score.mockResolvedValue({
        items: [
          makeVacancyItem('Field Operations', 'CRITICAL', 60),
          makeVacancyItem('Field Operations', 'LOW', 20),
          makeVacancyItem('Other Department', 'HIGH', 10),
        ],
        total: 3,
      });

      const result = await service.getByTenant(TENANT_ID);
      const entry = result.departments.find(d => d.departmentName === 'Field Operations')!;

      expect(entry.vacancyContext.openCount).toBe(2);
      expect(entry.vacancyContext.criticalCount).toBe(1);
      expect(entry.vacancyContext.avgDaysOpen).toBe(40); // (60+20)/2
    });

    it('department with no vacancies returns zero counts and null avgDaysOpen', async () => {
      mockWorkforceReadinessService.scoreByDepartment.mockResolvedValue([
        makeReadinessResult('dept-1', 'Quiet Department', 10),
      ]);
      mockAttritionRiskService.scoreByDepartment.mockResolvedValue([
        makeAttritionResult('dept-1', 'Quiet Department', 10),
      ]);
      mockVacancyRiskService.score.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getByTenant(TENANT_ID);
      const entry = result.departments[0]!;

      expect(entry.vacancyContext.openCount).toBe(0);
      expect(entry.vacancyContext.criticalCount).toBe(0);
      expect(entry.vacancyContext.avgDaysOpen).toBeNull();
    });
  });

  // ===========================================================================
  // Ordering — no leaderboard — GD-M33-1 Decisions 9, 13
  // ===========================================================================

  describe('department ordering', () => {
    it('returns departments alphabetically by name, never sorted by score', async () => {
      mockWorkforceReadinessService.scoreByDepartment.mockResolvedValue([
        makeReadinessResult('dept-z', 'Zebra Unit', 10, 20),   // low score, should NOT be last if sorted by score desc
        makeReadinessResult('dept-a', 'Alpha Unit', 10, 90),   // high score, should NOT be first if sorted by score desc
        makeReadinessResult('dept-m', 'Mid Unit', 10, 50),
      ]);
      mockAttritionRiskService.scoreByDepartment.mockResolvedValue([
        makeAttritionResult('dept-z', 'Zebra Unit', 10),
        makeAttritionResult('dept-a', 'Alpha Unit', 10),
        makeAttritionResult('dept-m', 'Mid Unit', 10),
      ]);
      mockVacancyRiskService.score.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getByTenant(TENANT_ID);

      expect(result.departments.map(d => d.departmentName)).toEqual(['Alpha Unit', 'Mid Unit', 'Zebra Unit']);
    });
  });

  // ===========================================================================
  // formulaVersion reporting
  // ===========================================================================

  describe('formulaVersion', () => {
    it('reports department-gap-deterministic-v1 at the top level and the underlying formula versions per signal', async () => {
      mockWorkforceReadinessService.scoreByDepartment.mockResolvedValue([
        makeReadinessResult('dept-1', 'Field Operations', 10),
      ]);
      mockAttritionRiskService.scoreByDepartment.mockResolvedValue([
        makeAttritionResult('dept-1', 'Field Operations', 10),
      ]);
      mockVacancyRiskService.score.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getByTenant(TENANT_ID);

      expect(result.formulaVersion).toBe('department-gap-deterministic-v1');
      expect(result.departments[0]!.readiness!.formulaVersion).toBe('readiness-deterministic-v1');
      expect(result.departments[0]!.attrition!.formulaVersion).toBe('attrition-deterministic-v1');
    });
  });

  // ===========================================================================
  // No individual employee data — GD-M33-1 Decision 11
  // ===========================================================================

  describe('no individual-level data', () => {
    it('response contains no employee-shaped field, list, or identifier anywhere', async () => {
      mockWorkforceReadinessService.scoreByDepartment.mockResolvedValue([
        makeReadinessResult('dept-1', 'Field Operations', 10),
      ]);
      mockAttritionRiskService.scoreByDepartment.mockResolvedValue([
        makeAttritionResult('dept-1', 'Field Operations', 10),
      ]);
      mockVacancyRiskService.score.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getByTenant(TENANT_ID);
      const serialized = JSON.stringify(result).toLowerCase();

      expect(serialized).not.toContain('employee');
      expect(serialized).not.toContain('firstname');
      expect(serialized).not.toContain('lastname');
      expect(serialized).not.toContain('email');
    });

    it('no department-vs-department comparison field exists (no rank, no percentile, no "worst")', async () => {
      mockWorkforceReadinessService.scoreByDepartment.mockResolvedValue([
        makeReadinessResult('dept-1', 'Field Operations', 10),
      ]);
      mockAttritionRiskService.scoreByDepartment.mockResolvedValue([
        makeAttritionResult('dept-1', 'Field Operations', 10),
      ]);
      mockVacancyRiskService.score.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getByTenant(TENANT_ID);
      const serialized = JSON.stringify(result).toLowerCase();

      expect(serialized).not.toContain('rank');
      expect(serialized).not.toContain('percentile');
      expect(serialized).not.toContain('worst');
      expect(serialized).not.toContain('best');
    });
  });

  // ===========================================================================
  // No external AI dependency
  // ===========================================================================

  describe('no external AI dependency', () => {
    it('getByTenant() completes without any HTTP or network call (structural — only injected service calls)', async () => {
      mockWorkforceReadinessService.scoreByDepartment.mockResolvedValue([]);
      mockAttritionRiskService.scoreByDepartment.mockResolvedValue([]);
      mockVacancyRiskService.score.mockResolvedValue({ items: [], total: 0 });

      await service.getByTenant(TENANT_ID);

      expect(mockWorkforceReadinessService.scoreByDepartment).toHaveBeenCalledWith(TENANT_ID);
      expect(mockAttritionRiskService.scoreByDepartment).toHaveBeenCalledWith(TENANT_ID);
      expect(mockVacancyRiskService.score).toHaveBeenCalledWith(TENANT_ID, { pageSize: 50 });
    });
  });

  // ===========================================================================
  // Empty tenant (no departments)
  // ===========================================================================

  describe('tenant with no departments', () => {
    it('returns an empty departments array, not an error', async () => {
      mockWorkforceReadinessService.scoreByDepartment.mockResolvedValue([]);
      mockAttritionRiskService.scoreByDepartment.mockResolvedValue([]);
      mockVacancyRiskService.score.mockResolvedValue({ items: [], total: 0 });

      const result = await service.getByTenant(TENANT_ID);
      expect(result.departments).toEqual([]);
    });
  });
});
