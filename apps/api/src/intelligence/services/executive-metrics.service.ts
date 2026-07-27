// Reference: governance/GD-M34-1.md — Decisions 2, 5, 6, 7, 8, 9, 10, 12, 16
// Reference: spec/01_requirements.md — FR-404 (Executive Workforce Analytics), FR-900
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
//
// ExecutiveMetricsService implements the four governed executive-safe
// aggregate metrics: Vacancy Rate %, Coverage Rate %, Time To Fill, and
// Hiring Velocity (GD-M34-1 Decisions 5-8). No external AI, LLM, or HTTP
// calls of any kind (GD-M34-1 Decision 12). tenantId is never derived from
// caller input — always from JWT context via the controller.
//
// Each metric reports its own value/unit/confidence/detail/windowDays
// shape (Decision 10) rather than the shared IntelligenceExplainabilityOutput
// used by risk-score signals — these are plain rates/counts, not classified
// risk levels, so forcing a LOW/MEDIUM/HIGH/CRITICAL label onto them would
// invent an ungoverned threshold.
//
// Any change to factor formulas, trailing windows, or confidence rules
// requires a new governance decision.
//
// GD-M34-2 Decisions 2, 3, 5, 8 extend this service with two additional
// aggregate groups — workforceSnapshot and last30DaysActivity — computed
// via dedicated count() queries here, never via the Employee/Position/
// Vacancy list endpoints (GD-M34-2 Decision 3: Executive User gains zero
// new list access). Neither group is written to WorkforceSignalSnapshot
// (GD-M34-2 Decision 5) — these are fixed current-period counts, not
// accumulated history.

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { CURRENT_WORKFORCE_STATUSES } from './attrition-risk.service';
import { SnapshotWriterService } from './snapshot-writer.service';

// ---------------------------------------------------------------------------
// Governed constants — GD-M34-1 Decisions 7, 8
// ---------------------------------------------------------------------------

const TIME_TO_FILL_WINDOW_DAYS = 365;
const HIRING_VELOCITY_WINDOW_DAYS = 90;
// GD-M34-2 Decision 2: a new, independently-governed 30-day window for
// Last 30 Days Activity — deliberately distinct from both windows above,
// same rationale GD-M34-1 Decision 8 gave for Hiring Velocity's 90-day
// window being shorter than Time To Fill's 365-day window: this is a
// "recent activity" window, not a long-run average.
const SNAPSHOT_ACTIVITY_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// Public output types — GD-M34-1 Decision 10
// ---------------------------------------------------------------------------

export type ExecutiveMetricUnit = 'PERCENT' | 'DAYS' | 'COUNT';

export interface ExecutiveMetricValue {
  value: number | null;
  unit: ExecutiveMetricUnit;
  confidence: number;
  detail: string;
  windowDays: number | null;
}

// GD-M34-2 Decision 2 — tenant-wide, point-in-time counts. Never null (no
// undefined-denominator case exists for a plain count), no confidence field
// (no formula uncertainty to express — see GD-M34-2 Decision 2 rationale).
export interface ExecutiveWorkforceSnapshot {
  activeWorkforce: number;
  activePositions: number;
  unfilledVacancies: number;
  criticalVacancies: number;
}

// GD-M34-2 Decision 2 — tenant-wide counts over the fixed
// SNAPSHOT_ACTIVITY_WINDOW_DAYS trailing window.
export interface ExecutiveLast30DaysActivity {
  hires: number;
  separations: number;
  vacanciesOpened: number;
  vacanciesFilled: number;
  windowDays: number;
}

export interface ExecutiveMetricsResult {
  vacancyRate: ExecutiveMetricValue;
  coverageRate: ExecutiveMetricValue;
  timeToFill: ExecutiveMetricValue;
  hiringVelocity: ExecutiveMetricValue;
  workforceSnapshot: ExecutiveWorkforceSnapshot;
  last30DaysActivity: ExecutiveLast30DaysActivity;
  computedAt: string;
  formulaVersion: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ExecutiveMetricsService {
  static readonly FORMULA_VERSION = 'executive-metrics-deterministic-v1';

  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshotWriter: SnapshotWriterService,
  ) {}

  // -------------------------------------------------------------------------
  // Public API — getByTenant()
  // -------------------------------------------------------------------------

  async getByTenant(tenantId: string): Promise<ExecutiveMetricsResult> {
    const now = new Date();
    const timeToFillWindowStart = new Date(now.getTime() - TIME_TO_FILL_WINDOW_DAYS * 86_400_000);
    const hiringVelocityWindowStart = new Date(now.getTime() - HIRING_VELOCITY_WINDOW_DAYS * 86_400_000);
    // GD-M34-2 Decision 2: Last 30 Days Activity window
    const activityWindowStart = new Date(now.getTime() - SNAPSHOT_ACTIVITY_WINDOW_DAYS * 86_400_000);

    const [
      openVacancyCount,
      totalActivePositionCount,
      employeesWithActivePosition,
      filledVacancies,
      hiringVelocityCount,
      // GD-M34-2 Decision 2 — Workforce Snapshot (activePositions and
      // unfilledVacancies reuse totalActivePositionCount/openVacancyCount
      // above verbatim, at zero marginal query cost — not repeated here)
      activeWorkforceCount,
      criticalVacancyCount,
      // GD-M34-2 Decision 2 — Last 30 Days Activity
      hiresCount,
      separationsCount,
      vacanciesOpenedCount,
      vacanciesFilledCount,
    ] = await Promise.all([
      // GD-M34-1 Decision 5: identical status-value convention VacancyRiskService uses
      this.prisma.vacancy.count({
        where: { tenantId, deletedAt: null, status: { in: ['OPEN', 'IN_RECRUITMENT'] } },
      }),
      // GD-M34-1 Decisions 5, 6: identical convention WorkforceReadinessService's
      // Position Capacity factor uses
      this.prisma.position.count({ where: { tenantId, deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.employee.count({
        where: { tenantId, deletedAt: null, employmentStatus: 'ACTIVE', positionId: { not: null } },
      }),
      // GD-M34-1 Decision 7
      this.prisma.vacancy.findMany({
        where: { tenantId, deletedAt: null, filledAt: { gte: timeToFillWindowStart } },
        select: { createdAt: true, filledAt: true },
      }),
      // GD-M34-1 Decision 8
      this.prisma.employee.count({
        where: {
          tenantId,
          deletedAt: null,
          employmentStatus: { in: CURRENT_WORKFORCE_STATUSES },
          hireDate: { gte: hiringVelocityWindowStart },
        },
      }),
      // GD-M34-2 Decision 2: identical filter the dashboard's existing
      // "Active Workforce" KPI card uses for SA/HRD/WP
      this.prisma.employee.count({
        where: { tenantId, deletedAt: null, employmentStatus: 'ACTIVE' },
      }),
      // GD-M34-2 Decision 2: identical filter the dashboard's existing
      // "Critical Vacancies" KPI card uses for SA/HRD/WP
      this.prisma.vacancy.count({
        where: { tenantId, deletedAt: null, priority: 'CRITICAL' },
      }),
      this.prisma.employee.count({
        where: { tenantId, deletedAt: null, hireDate: { gte: activityWindowStart, lte: now } },
      }),
      this.prisma.employee.count({
        where: {
          tenantId, deletedAt: null, employmentStatus: 'SEPARATED',
          terminationDate: { gte: activityWindowStart, lte: now },
        },
      }),
      this.prisma.vacancy.count({
        where: { tenantId, deletedAt: null, createdAt: { gte: activityWindowStart, lte: now } },
      }),
      this.prisma.vacancy.count({
        where: { tenantId, deletedAt: null, filledAt: { gte: activityWindowStart, lte: now } },
      }),
    ]);

    const vacancyRate = this.computeVacancyRate(openVacancyCount, totalActivePositionCount);
    const coverageRate = this.computeCoverageRate(employeesWithActivePosition, totalActivePositionCount);
    const timeToFill = this.computeTimeToFill(filledVacancies as { createdAt: Date; filledAt: Date | null }[]);
    const hiringVelocity = this.computeHiringVelocity(hiringVelocityCount);
    // GD-M34-2 Decision 2 — plain counts, never null, no confidence field.
    const workforceSnapshot: ExecutiveWorkforceSnapshot = {
      activeWorkforce: activeWorkforceCount,
      activePositions: totalActivePositionCount,
      unfilledVacancies: openVacancyCount,
      criticalVacancies: criticalVacancyCount,
    };
    const last30DaysActivity: ExecutiveLast30DaysActivity = {
      hires: hiresCount,
      separations: separationsCount,
      vacanciesOpened: vacanciesOpenedCount,
      vacanciesFilled: vacanciesFilledCount,
      windowDays: SNAPSHOT_ACTIVITY_WINDOW_DAYS,
    };

    // GD-M34-1 Decision 16: write-on-query snapshot, once per metric — four
    // distinct signalType values, not one shared tag (see schema.prisma
    // model comment for why a shared tag would silently overwrite the other
    // three metrics' history under the same dedup key).
    await Promise.all([
      this.snapshotWriter.write({
        tenantId, signalType: 'EXECUTIVE_METRICS_VACANCY_RATE', scopeType: 'TENANT',
        score: vacancyRate.value, level: null, confidence: vacancyRate.confidence,
        formulaVersion: ExecutiveMetricsService.FORMULA_VERSION, computedAt: now,
      }),
      this.snapshotWriter.write({
        tenantId, signalType: 'EXECUTIVE_METRICS_COVERAGE_RATE', scopeType: 'TENANT',
        score: coverageRate.value, level: null, confidence: coverageRate.confidence,
        formulaVersion: ExecutiveMetricsService.FORMULA_VERSION, computedAt: now,
      }),
      this.snapshotWriter.write({
        tenantId, signalType: 'EXECUTIVE_METRICS_TIME_TO_FILL', scopeType: 'TENANT',
        score: timeToFill.value, level: null, confidence: timeToFill.confidence,
        formulaVersion: ExecutiveMetricsService.FORMULA_VERSION, computedAt: now,
      }),
      this.snapshotWriter.write({
        tenantId, signalType: 'EXECUTIVE_METRICS_HIRING_VELOCITY', scopeType: 'TENANT',
        score: hiringVelocity.value, level: null, confidence: hiringVelocity.confidence,
        formulaVersion: ExecutiveMetricsService.FORMULA_VERSION, computedAt: now,
      }),
    ]);
    // GD-M34-2 Decision 5: the eight new counts above are NOT snapshotted —
    // still exactly four snapshot writes, unchanged from GD-M34-1.

    return {
      vacancyRate,
      coverageRate,
      timeToFill,
      hiringVelocity,
      workforceSnapshot,
      last30DaysActivity,
      computedAt: now.toISOString(),
      formulaVersion: ExecutiveMetricsService.FORMULA_VERSION,
    };
  }

  // -------------------------------------------------------------------------
  // Formula: Vacancy Rate % — GD-M34-1 Decision 5
  // -------------------------------------------------------------------------

  private computeVacancyRate(openVacancyCount: number, totalActivePositionCount: number): ExecutiveMetricValue {
    if (totalActivePositionCount === 0) {
      return {
        value: null, unit: 'PERCENT', confidence: 10,
        detail: 'No active positions to assess.', windowDays: null,
      };
    }
    const value = this.round1(( openVacancyCount / totalActivePositionCount) * 100);
    return {
      value, unit: 'PERCENT', confidence: 100,
      detail: `${openVacancyCount} of ${totalActivePositionCount} active positions are currently vacant.`,
      windowDays: null,
    };
  }

  // -------------------------------------------------------------------------
  // Formula: Coverage Rate % — GD-M34-1 Decision 6
  // -------------------------------------------------------------------------

  private computeCoverageRate(
    employeesWithActivePosition: number,
    totalActivePositionCount: number,
  ): ExecutiveMetricValue {
    if (totalActivePositionCount === 0) {
      return {
        value: null, unit: 'PERCENT', confidence: 10,
        detail: 'No active positions to assess.', windowDays: null,
      };
    }
    const value = this.round1((employeesWithActivePosition / totalActivePositionCount) * 100);
    return {
      value, unit: 'PERCENT', confidence: 100,
      detail: `${employeesWithActivePosition} of ${totalActivePositionCount} active positions are filled by an active employee.`,
      windowDays: null,
    };
  }

  // -------------------------------------------------------------------------
  // Formula: Time To Fill — GD-M34-1 Decision 7
  // -------------------------------------------------------------------------

  private computeTimeToFill(filledVacancies: { createdAt: Date; filledAt: Date | null }[]): ExecutiveMetricValue {
    const n = filledVacancies.length;
    const confidence = this.timeToFillConfidence(n);

    if (n === 0) {
      return {
        value: null, unit: 'DAYS', confidence,
        detail: `No vacancies filled in the last ${TIME_TO_FILL_WINDOW_DAYS} days to assess.`,
        windowDays: TIME_TO_FILL_WINDOW_DAYS,
      };
    }

    const totalDays = filledVacancies.reduce((sum, v) => {
      // Defensive clamp at 0 — filledAt is guaranteed non-null by the WHERE
      // clause that selected these rows; a negative diff would indicate a
      // data integrity issue (filledAt before createdAt), not a real
      // duration, so it must never pull the average negative.
      const days = (v.filledAt!.getTime() - v.createdAt.getTime()) / 86_400_000;
      return sum + Math.max(0, days);
    }, 0);
    const value = this.round1(totalDays / n);

    return {
      value, unit: 'DAYS', confidence,
      detail: `Average ${value} days to fill, based on ${n} vacanc${n === 1 ? 'y' : 'ies'} filled in the last ${TIME_TO_FILL_WINDOW_DAYS} days.`,
      windowDays: TIME_TO_FILL_WINDOW_DAYS,
    };
  }

  // -------------------------------------------------------------------------
  // Formula: Hiring Velocity — GD-M34-1 Decision 8
  // -------------------------------------------------------------------------

  private computeHiringVelocity(count: number): ExecutiveMetricValue {
    return {
      value: count, unit: 'COUNT', confidence: 100,
      detail: `${count} employee${count === 1 ? '' : 's'} hired in the last ${HIRING_VELOCITY_WINDOW_DAYS} days.`,
      windowDays: HIRING_VELOCITY_WINDOW_DAYS,
    };
  }

  // -------------------------------------------------------------------------
  // Confidence — GD-M34-1 Decision 9
  // -------------------------------------------------------------------------

  private timeToFillConfidence(filledVacancyCount: number): number {
    if (filledVacancyCount >= 10) return 100;
    if (filledVacancyCount >= 5) return 70;
    if (filledVacancyCount >= 1) return 40;
    return 10;
  }

  private round1(value: number): number {
    return Math.round(value * 10) / 10;
  }
}
