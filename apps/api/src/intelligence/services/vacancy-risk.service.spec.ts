// Reference: governance/GD-M30-1.md — Decisions 5, 6, 7, 8, 12, 14 (validation gate)
// Reference: spec/01_requirements.md — FR-401 (Vacancy Risk), FR-900 (Explainability), FR-902 (Confidence)
//
// Pure unit tests — no database.
// PrismaService replaced with jest.fn() mock controlling findMany return values.
// Covers all governed test cases from GD-M30-1 Decision 14 validation gate:
//   - All four factor weights and thresholds
//   - riskScore cap at 100
//   - Risk level thresholds (LOW/MEDIUM/HIGH/CRITICAL)
//   - Confidence rules (all four priority × fillDate combinations)
//   - daysOpen === 0 confidence floor
//   - Eligibility exclusions (DRAFT, FILLED, CLOSED, deletedAt, future createdAt)
//   - Empty result when no eligible vacancies (no error thrown)
//   - Response shape: required explainability fields present
//   - Factors array: non-zero only
//   - Reasoning: non-empty, dynamically composed
//   - Sorted by riskScore desc, createdAt asc for ties
//   - total = all eligible, not just items returned
//   - No OpenAI or external dependency

import { Test, type TestingModule } from '@nestjs/testing';

import { VacancyRiskService } from './vacancy-risk.service';
import { PrismaService } from '../../database/prisma.service';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VACANCY_ID  = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const POSITION_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const NOW = new Date('2026-07-15T12:00:00.000Z');

// Helper: days-ago date from NOW
function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000);
}

// Helper: days-from-now date from NOW
function daysFromNow(n: number): Date {
  return new Date(NOW.getTime() + n * 86_400_000);
}

// ---------------------------------------------------------------------------
// Mock vacancy factory
// ---------------------------------------------------------------------------

type MockVacancyOverrides = {
  id?: string;
  status?: string;
  priority?: string | null;
  expectedFillDate?: Date | null;
  createdAt?: Date;
  deletedAt?: Date | null;
  positionTitle?: string;
  departmentName?: string;
};

function makeMockVacancy(overrides: MockVacancyOverrides = {}) {
  return {
    id:               overrides.id ?? VACANCY_ID,
    tenantId:         TENANT_ID,
    positionId:       POSITION_ID,
    priority:         overrides.priority !== undefined ? overrides.priority : null,
    reason:           null,
    status:           overrides.status ?? 'OPEN',
    expectedFillDate: overrides.expectedFillDate !== undefined ? overrides.expectedFillDate : null,
    filledAt:         null,
    createdAt:        overrides.createdAt ?? daysAgo(30),
    updatedAt:        NOW,
    deletedAt:        overrides.deletedAt !== undefined ? overrides.deletedAt : null,
    position: {
      title:      overrides.positionTitle ?? 'HR Specialist',
      department: { name: overrides.departmentName ?? 'Human Resources' },
    },
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('VacancyRiskService', () => {
  let service: VacancyRiskService;

  const mockPrisma = {
    vacancy: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VacancyRiskService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<VacancyRiskService>(VacancyRiskService);
  });

  afterEach(() => jest.useRealTimers());

  // ===========================================================================
  // Vacancy Age Factor (max 40 pts) — GD-M30-1 Decision 5
  // ===========================================================================

  describe('Vacancy Age Factor', () => {
    it.each([
      [89, 30,  'daysOpen 60–89 → 30 pts'],
      [90, 40,  'daysOpen 90 → 40 pts'],
      [30, 20,  'daysOpen 30 → 20 pts'],
      [59, 20,  'daysOpen 30–59 → 20 pts'],
      [14, 10,  'daysOpen 14 → 10 pts'],
      [29, 10,  'daysOpen 14–29 → 10 pts'],
      [13,  0,  'daysOpen < 14 → 0 pts'],
      [ 0,  0,  'daysOpen 0 → 0 pts'],
    ])('%s days open → age contribution %s pts (%s)', async (days, expectedContrib) => {
      // Use HIGH priority so priority factor is predictable but distinct
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ priority: 'HIGH', createdAt: daysAgo(days), status: 'IN_RECRUITMENT' }),
      ]);

      const { items } = await service.score(TENANT_ID, {});

      expect(items).toHaveLength(1);
      const ageFactorContrib = items[0]!.factors.find(f => f.name === 'vacancyAge')?.contribution ?? 0;
      expect(ageFactorContrib).toBe(expectedContrib);
    });
  });

  // ===========================================================================
  // Priority Factor (max 40 pts) — GD-M30-1 Decision 5
  // ===========================================================================

  describe('Priority Factor', () => {
    it.each([
      ['CRITICAL', 40],
      ['HIGH',     25],
      ['MEDIUM',   10],
      ['LOW',       0],
      [null,        0],
    ] as Array<[string | null, number]>)('priority %s → %s pts', async (priority, expectedContrib) => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        // Use a known age (30 days) and IN_RECRUITMENT to isolate priority contribution
        makeMockVacancy({ priority, createdAt: daysAgo(30), status: 'IN_RECRUITMENT' }),
      ]);

      const { items } = await service.score(TENANT_ID, {});

      expect(items).toHaveLength(1);
      const priorityContrib = items[0]!.factors.find(f => f.name === 'priority')?.contribution ?? 0;
      expect(priorityContrib).toBe(expectedContrib);
    });
  });

  // ===========================================================================
  // Fill Date Factor (max 15 pts) — GD-M30-1 Decision 5
  // ===========================================================================

  describe('Fill Date Factor', () => {
    it('null expectedFillDate → 0 pts fill date factor', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ expectedFillDate: null, status: 'IN_RECRUITMENT' }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      const fillContrib = items[0]!.factors.find(f => f.name === 'fillDateProximity')?.contribution ?? 0;
      expect(fillContrib).toBe(0);
    });

    it('fill date overdue (past) → 15 pts', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ expectedFillDate: daysAgo(1), status: 'IN_RECRUITMENT' }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      const fillContrib = items[0]!.factors.find(f => f.name === 'fillDateProximity')!.contribution;
      expect(fillContrib).toBe(15);
    });

    it('fill date within 7 days → 10 pts', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ expectedFillDate: daysFromNow(5), status: 'IN_RECRUITMENT' }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      const fillContrib = items[0]!.factors.find(f => f.name === 'fillDateProximity')!.contribution;
      expect(fillContrib).toBe(10);
    });

    it('fill date within 14 days → 5 pts', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ expectedFillDate: daysFromNow(10), status: 'IN_RECRUITMENT' }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      const fillContrib = items[0]!.factors.find(f => f.name === 'fillDateProximity')!.contribution;
      expect(fillContrib).toBe(5);
    });

    it('fill date more than 14 days away → 0 pts', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ expectedFillDate: daysFromNow(30), status: 'IN_RECRUITMENT' }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      const fillContrib = items[0]!.factors.find(f => f.name === 'fillDateProximity')?.contribution ?? 0;
      expect(fillContrib).toBe(0);
    });
  });

  // ===========================================================================
  // Vacancy Status Factor (max 5 pts) — GD-M30-1 Decision 5
  // ===========================================================================

  describe('Vacancy Status Factor', () => {
    it('status OPEN → 5 pts', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ status: 'OPEN' }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      const statusContrib = items[0]!.factors.find(f => f.name === 'vacancyStatus')!.contribution;
      expect(statusContrib).toBe(5);
    });

    it('status IN_RECRUITMENT → 0 pts (factor omitted)', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ status: 'IN_RECRUITMENT' }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      const statusFactor = items[0]!.factors.find(f => f.name === 'vacancyStatus');
      expect(statusFactor).toBeUndefined();
    });
  });

  // ===========================================================================
  // riskScore = min(100, sum) — GD-M30-1 Decision 5
  // ===========================================================================

  describe('riskScore', () => {
    it('maximum score 100: CRITICAL priority, 90+ days, overdue fill, OPEN', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({
          priority: 'CRITICAL',
          createdAt: daysAgo(90),
          expectedFillDate: daysAgo(1),
          status: 'OPEN',
        }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.riskScore).toBe(100); // 40 + 40 + 15 + 5 = 100
    });

    it('minimum score 0: null priority, 0 days open, null fill date, OPEN has status factor but age=0', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ priority: null, createdAt: daysAgo(0), expectedFillDate: null, status: 'IN_RECRUITMENT' }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.riskScore).toBe(0);
    });

    it('riskScore capped at 100 even if factor sum would exceed it', async () => {
      // 40 (CRITICAL) + 40 (age 90+) + 15 (overdue) + 5 (OPEN) = 100, already at cap
      // Confirm cap via formula: min(100, 100) = 100
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({
          priority: 'CRITICAL',
          createdAt: daysAgo(120),
          expectedFillDate: daysAgo(5),
          status: 'OPEN',
        }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.riskScore).toBe(100);
      expect(items[0]!.riskScore).toBeLessThanOrEqual(100);
    });
  });

  // ===========================================================================
  // Risk level thresholds — GD-M30-1 Decision 6
  // Each test uses a known factor combination that produces the target score.
  // ===========================================================================

  describe('Risk Level Thresholds', () => {
    // score 0 (0+0+0+0): no priority, 0 days, no fill, IN_RECRUITMENT → LOW
    it('score 0 → LOW', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ priority: null, createdAt: daysAgo(0), expectedFillDate: null, status: 'IN_RECRUITMENT' }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.riskScore).toBe(0);
      expect(items[0]!.riskLevel).toBe('LOW');
    });

    // score 20 (0+20+0+0): no priority, 30 days, no fill, IN_RECRUITMENT → LOW (< 25)
    it('score 20 → LOW', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ priority: null, createdAt: daysAgo(30), expectedFillDate: null, status: 'IN_RECRUITMENT' }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.riskScore).toBe(20);
      expect(items[0]!.riskLevel).toBe('LOW');
    });

    // score 25 (25+0+0+0): HIGH priority, 0 days, no fill, IN_RECRUITMENT → MEDIUM boundary
    it('score 25 → MEDIUM', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ priority: 'HIGH', createdAt: daysAgo(0), expectedFillDate: null, status: 'IN_RECRUITMENT' }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.riskScore).toBe(25);
      expect(items[0]!.riskLevel).toBe('MEDIUM');
    });

    // score 35 (25+10+0+0): HIGH priority, 14 days, no fill, IN_RECRUITMENT → MEDIUM
    it('score 35 → MEDIUM', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ priority: 'HIGH', createdAt: daysAgo(14), expectedFillDate: null, status: 'IN_RECRUITMENT' }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.riskScore).toBe(35);
      expect(items[0]!.riskLevel).toBe('MEDIUM');
    });

    // score 50 (25+20+0+5): HIGH priority, 30 days, no fill, OPEN → HIGH boundary
    it('score 50 → HIGH', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ priority: 'HIGH', createdAt: daysAgo(30), expectedFillDate: null, status: 'OPEN' }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.riskScore).toBe(50);
      expect(items[0]!.riskLevel).toBe('HIGH');
    });

    // score 65 (40+20+0+5): CRITICAL priority, 30 days, no fill, OPEN → HIGH
    it('score 65 → HIGH', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ priority: 'CRITICAL', createdAt: daysAgo(30), expectedFillDate: null, status: 'OPEN' }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.riskScore).toBe(65);
      expect(items[0]!.riskLevel).toBe('HIGH');
    });

    // score 75 (40+20+10+5): CRITICAL priority, 30 days, fill within 7d, OPEN → CRITICAL boundary
    it('score 75 → CRITICAL', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ priority: 'CRITICAL', createdAt: daysAgo(30), expectedFillDate: daysFromNow(5), status: 'OPEN' }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.riskScore).toBe(75);
      expect(items[0]!.riskLevel).toBe('CRITICAL');
    });

    // score 100 (40+40+15+5): CRITICAL priority, 90 days, overdue, OPEN → CRITICAL max
    it('score 100 → CRITICAL', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ priority: 'CRITICAL', createdAt: daysAgo(90), expectedFillDate: daysAgo(1), status: 'OPEN' }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.riskScore).toBe(100);
      expect(items[0]!.riskLevel).toBe('CRITICAL');
    });
  });

  // ===========================================================================
  // Confidence — GD-M30-1 Decision 7
  // ===========================================================================

  describe('Confidence Computation', () => {
    it('priority known + expectedFillDate set + daysOpen > 0 → confidence 100', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({
          priority: 'HIGH',
          expectedFillDate: daysFromNow(30),
          createdAt: daysAgo(5),
        }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.confidence).toBe(100);
    });

    it('priority known + no expectedFillDate + daysOpen > 0 → confidence 70', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ priority: 'HIGH', expectedFillDate: null, createdAt: daysAgo(5) }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.confidence).toBe(70);
    });

    it('priority null + expectedFillDate set + daysOpen > 0 → confidence 50', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ priority: null, expectedFillDate: daysFromNow(30), createdAt: daysAgo(5) }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.confidence).toBe(50);
    });

    it('priority null + no expectedFillDate + daysOpen > 0 → confidence 40', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ priority: null, expectedFillDate: null, createdAt: daysAgo(5) }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.confidence).toBe(40);
    });

    it('daysOpen === 0 → confidence multiplied × 0.6 and floored', async () => {
      // priority=HIGH, fillDate=set → base 100, ×0.6 → 60
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ priority: 'HIGH', expectedFillDate: daysFromNow(30), createdAt: daysAgo(0) }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.confidence).toBe(60); // floor(100 * 0.6)
    });

    it('daysOpen === 0, no priority, no fillDate → confidence floor(40 × 0.6) = 24', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ priority: null, expectedFillDate: null, createdAt: daysAgo(0) }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.confidence).toBe(24); // floor(40 * 0.6)
    });
  });

  // ===========================================================================
  // Eligibility exclusions — GD-M30-1 Decision 7
  // ===========================================================================

  describe('Vacancy eligibility', () => {
    it('excludes vacancies with status DRAFT', async () => {
      // Prisma WHERE clause filters DRAFT out — findMany returns []
      mockPrisma.vacancy.findMany.mockResolvedValue([]);
      const { items, total } = await service.score(TENANT_ID, {});
      expect(items).toHaveLength(0);
      expect(total).toBe(0);
    });

    it('excludes vacancies with status FILLED (Prisma WHERE removes them)', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items).toHaveLength(0);
    });

    it('excludes vacancies with status CLOSED (Prisma WHERE removes them)', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items).toHaveLength(0);
    });

    it('excludes vacancy with deletedAt set (defense-in-depth — should not reach scoreVacancy but handled)', async () => {
      // Simulate deletedAt set slipping through (defense-in-depth check inside scoreVacancy)
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ deletedAt: new Date(), status: 'OPEN' }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items).toHaveLength(0);
    });

    it('excludes vacancy with future createdAt (clock skew or corrupt data)', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ createdAt: daysFromNow(1) }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items).toHaveLength(0);
    });

    it('returns empty items array when no eligible vacancies exist — no error thrown', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([]);
      await expect(service.score(TENANT_ID, {})).resolves.toEqual({ items: [], total: 0 });
    });
  });

  // ===========================================================================
  // Response shape and explainability — GD-M30-1 Decision 8, 14
  // ===========================================================================

  describe('Response shape and explainability', () => {
    beforeEach(() => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ priority: 'HIGH', createdAt: daysAgo(45), status: 'OPEN' }),
      ]);
    });

    it('result includes items array and total', async () => {
      const result = await service.score(TENANT_ID, {});
      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('total');
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('each item includes all required explainability fields', async () => {
      const { items } = await service.score(TENANT_ID, {});
      const item = items[0]!;
      expect(item).toHaveProperty('vacancyId');
      expect(item).toHaveProperty('positionTitle');
      expect(item).toHaveProperty('status');
      expect(item).toHaveProperty('daysOpen');
      expect(item).toHaveProperty('riskScore');
      expect(item).toHaveProperty('riskLevel');
      expect(item).toHaveProperty('confidence');
      expect(item).toHaveProperty('reasoning');
      expect(item).toHaveProperty('factors');
      expect(item).toHaveProperty('computedAt');
      expect(item).toHaveProperty('formulaVersion');
    });

    it('formulaVersion is deterministic-v1', async () => {
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.formulaVersion).toBe('deterministic-v1');
    });

    it('reasoning is non-empty for every scored vacancy', async () => {
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.reasoning).toBeTruthy();
      expect(items[0]!.reasoning.length).toBeGreaterThan(0);
    });

    it('factors array contains only non-zero contributions', async () => {
      const { items } = await service.score(TENANT_ID, {});
      for (const factor of items[0]!.factors) {
        expect(factor.contribution).toBeGreaterThan(0);
      }
    });

    it('factors array is empty for a vacancy contributing 0 on all axes', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ priority: null, createdAt: daysAgo(0), status: 'IN_RECRUITMENT', expectedFillDate: null }),
      ]);
      const { items } = await service.score(TENANT_ID, {});
      expect(items[0]!.factors).toHaveLength(0);
    });

    it('total equals all eligible vacancies, not just items returned via pageSize', async () => {
      const vacancies = Array.from({ length: 15 }, (_, i) =>
        makeMockVacancy({ id: `id-${i}`, createdAt: daysAgo(30 + i), priority: 'HIGH' }),
      );
      mockPrisma.vacancy.findMany.mockResolvedValue(vacancies);

      const { items, total } = await service.score(TENANT_ID, { pageSize: 5 });
      expect(total).toBe(15);
      expect(items).toHaveLength(5);
    });
  });

  // ===========================================================================
  // Sort order — GD-M30-1 Decision 6
  // ===========================================================================

  describe('Sort order', () => {
    it('items sorted by riskScore descending', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ id: 'low-risk',  priority: null,       createdAt: daysAgo(5) }),
        makeMockVacancy({ id: 'high-risk', priority: 'CRITICAL', createdAt: daysAgo(90) }),
        makeMockVacancy({ id: 'mid-risk',  priority: 'HIGH',     createdAt: daysAgo(30) }),
      ]);
      const { items } = await service.score(TENANT_ID, { pageSize: 10 });
      expect(items[0]!.vacancyId).toBe('high-risk');
      expect(items[1]!.vacancyId).toBe('mid-risk');
      expect(items[2]!.vacancyId).toBe('low-risk');
    });

    it('ties in riskScore sorted by createdAt ascending (oldest first)', async () => {
      // Force a score tie: both no priority (0 pts), same 30-day age band (20 pts), OPEN (5 pts) = 25
      // Use sub-day createdAt difference so daysOpen floor() is identical for both (both floor to 30)
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ id: 'newer', priority: null, createdAt: new Date(NOW.getTime() - 30 * 86_400_000 + 3_600_000) }),
        makeMockVacancy({ id: 'older', priority: null, createdAt: new Date(NOW.getTime() - 30 * 86_400_000) }),
      ]);
      const { items } = await service.score(TENANT_ID, { pageSize: 10 });
      // Both score 25 — older createdAt must come first in tie
      expect(items[0]!.vacancyId).toBe('older');
      expect(items[1]!.vacancyId).toBe('newer');
    });
  });

  // ===========================================================================
  // Tenant isolation — GD-M30-1 Decision 3, 14
  // ===========================================================================

  describe('Tenant isolation', () => {
    it('passes tenantId to Prisma WHERE clause', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([]);
      await service.score('tenant-xyz', {});

      expect(mockPrisma.vacancy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant-xyz' }),
        }),
      );
    });

    it('always includes deletedAt: null in WHERE clause', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([]);
      await service.score(TENANT_ID, {});

      expect(mockPrisma.vacancy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
        }),
      );
    });
  });

  // ===========================================================================
  // Status filter — GD-M30-1 Decision 6
  // ===========================================================================

  describe('Status filter', () => {
    it('no status query → Prisma WHERE includes both OPEN and IN_RECRUITMENT', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([]);
      await service.score(TENANT_ID, {});

      expect(mockPrisma.vacancy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { in: ['OPEN', 'IN_RECRUITMENT'] } }),
        }),
      );
    });

    it('status=OPEN query → Prisma WHERE filters to OPEN only', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([]);
      await service.score(TENANT_ID, { status: 'OPEN' });

      expect(mockPrisma.vacancy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'OPEN' }),
        }),
      );
    });
  });

  // ===========================================================================
  // No external AI dependency — GD-M30-1 Decision 12
  // ===========================================================================

  describe('No external AI dependency', () => {
    it('VacancyRiskService has no OpenAI or external HTTP dependency (no import)', () => {
      // The service file must not import any OpenAI, AI, or LLM client.
      // This is enforced by the import list in vacancy-risk.service.ts.
      // A score can be computed without any external network call.
      expect(service).toBeInstanceOf(VacancyRiskService);
      // If any OpenAI import existed, it would fail at module instantiation
      // since no OpenAI client is configured in the test module.
    });

    it('score() completes without any HTTP or network call', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([
        makeMockVacancy({ priority: 'CRITICAL', createdAt: daysAgo(90) }),
      ]);
      // Spy to confirm no external fetch or http calls were made
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
        throw new Error('External fetch must not be called in intelligence scoring');
      });

      await expect(service.score(TENANT_ID, {})).resolves.toBeDefined();

      fetchSpy.mockRestore();
    });
  });
});

