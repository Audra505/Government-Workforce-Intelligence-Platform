// Reference: governance/GD-M32-1.md — Decisions 2, 3, 5, 6, 7, 8, 11, 12
// Reference: governance/GD-M33-1.md — Decisions 2, 5, 6, 7 (scoreByDepartment addition;
//   Decision 7 formally narrows GD-M32-1 Decision 11's department-level prohibition to
//   permit this method's output ONLY through DepartmentGapService's suppression rule)
// Reference: spec/01_requirements.md — FR-402 (Attrition Prediction), FR-900 (Explainability)
// Reference: directives/06_attrition_scoring_rules.md — Reporting Rules ("Department Risk")
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
//
// AttritionRiskService implements the governed attrition-deterministic-v1 formula.
// No external AI, LLM, or HTTP calls of any kind (GD-M32-1 Decision 12).
// tenantId is never derived from caller input — always from JWT context via the controller.
//
// Aggregate-only by construction (GD-M32-1 Decision 11): every Prisma call in this service
// is a count() or a findMany() selecting only positionId — no employee row, name, or
// identifier is ever fetched into memory in individually-identifiable form. There is no
// per-employee data for any caller to redact because none is ever queried. This holds for
// scoreByDepartment() too — it is the same count()-only, no-row-level-employee-data query
// pattern, applied per department.
//
// No cross-service dependency is needed (GD-M32-1 Decision 2) — none of the three governed
// factors depend on VacancyRiskService or WorkforceReadinessService output.
//
// Any change to factor weights, thresholds, the trailing window, or formula structure
// requires a new governance decision.
//
// scoreByDepartment() (GD-M33-1 Decision 5) computes the IDENTICAL formula per department
// instead of per tenant — it calls the same private computeRiskLevel(), computeConfidence(),
// buildFactors(), and composeReasoning() pure-function helpers score() already uses. Only
// the Prisma query population filter differs. score() itself is unmodified by this addition.
// GD-M32-1 Decision 11 originally prohibited any department-level attrition breakdown
// outright; GD-M33-1 Decision 7 formally narrows that prohibition — this method's output
// must only ever reach a caller through DepartmentGapService's minimum-headcount
// suppression rule (GD-M33-1 Decision 6), never returned directly to an HTTP response.

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import type { RiskFactor, IntelligenceExplainabilityOutput } from '../interfaces/intelligence-explainability.interface';

// ---------------------------------------------------------------------------
// Governed constants — GD-M32-1 Decision 5
// ---------------------------------------------------------------------------

const TRAILING_WINDOW_MS = 365 * 86_400_000;
const CURRENT_WORKFORCE_STATUSES = ['ACTIVE', 'ON_LEAVE', 'PENDING_ONBOARDING', 'SUSPENDED'];
const SEPARATION_RATE_CEILING = 0.30;

// ---------------------------------------------------------------------------
// Public API types — GD-M33-1 Decision 5
// ---------------------------------------------------------------------------

export interface DepartmentAttritionResult {
  departmentId: string;
  departmentName: string;
  // baselineWorkforce this department's attrition score was computed from (GD-M32-1
  // Decision 5's separation-rate denominator) — used ONLY by DepartmentGapService's
  // minimum-headcount suppression check (GD-M33-1 Decision 6); callers must never
  // expose this number in an API response.
  population: number;
  output: IntelligenceExplainabilityOutput;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AttritionRiskService {
  private readonly logger = new Logger(AttritionRiskService.name);

  static readonly FORMULA_VERSION = 'attrition-deterministic-v1';

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Public API — score()
  // -------------------------------------------------------------------------

  async score(tenantId: string): Promise<IntelligenceExplainabilityOutput> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - TRAILING_WINDOW_MS);

    const [
      trailingSeparations,
      baselineWorkforce,
      activeEmployees,
      shortTenureCount,
      filledVacancies,
    ] = await Promise.all([
      this.prisma.employee.count({
        where: {
          tenantId,
          deletedAt: null,
          employmentStatus: 'SEPARATED',
          terminationDate: { gte: windowStart },
        },
      }),
      this.prisma.employee.count({
        where: {
          tenantId,
          deletedAt: null,
          OR: [
            { employmentStatus: { not: 'SEPARATED' } },
            { employmentStatus: 'SEPARATED', terminationDate: { gte: windowStart } },
          ],
        },
      }),
      this.prisma.employee.count({
        where: {
          tenantId,
          deletedAt: null,
          employmentStatus: { in: CURRENT_WORKFORCE_STATUSES },
        },
      }),
      this.prisma.employee.count({
        where: {
          tenantId,
          deletedAt: null,
          employmentStatus: { in: CURRENT_WORKFORCE_STATUSES },
          hireDate: { gte: windowStart },
        },
      }),
      this.prisma.vacancy.findMany({
        where: {
          tenantId,
          deletedAt: null,
          filledAt: { gte: windowStart },
        },
        select: { positionId: true },
      }),
    ]);

    // Position/Vacancy Recurrence input — distinct positions filled in the window,
    // and how many of them were filled more than once (GD-M32-1 Decision 5).
    const positionFillCounts = new Map<string, number>();
    for (const v of filledVacancies as { positionId: string }[]) {
      positionFillCounts.set(v.positionId, (positionFillCounts.get(v.positionId) ?? 0) + 1);
    }
    const eligiblePositionsCount = positionFillCounts.size;
    const recurringPositionsCount = [...positionFillCounts.values()].filter(c => c >= 2).length;

    // -- Separation Rate Factor (max 50 pts) --
    const separationRate = baselineWorkforce > 0 ? trailingSeparations / baselineWorkforce : null;
    const separationFactor = separationRate !== null
      ? Math.round(Math.min(1, separationRate / SEPARATION_RATE_CEILING) * 50)
      : 25;

    // -- Tenure Composition Factor (max 30 pts) --
    const shortTenureRatio = activeEmployees > 0 ? shortTenureCount / activeEmployees : null;
    const tenureFactor = shortTenureRatio !== null ? Math.round(shortTenureRatio * 30) : 15;

    // -- Position/Vacancy Recurrence Factor (max 20 pts) --
    const recurrenceRatio = eligiblePositionsCount > 0 ? recurringPositionsCount / eligiblePositionsCount : null;
    const recurrenceFactor = recurrenceRatio !== null ? Math.round(recurrenceRatio * 20) : 10;

    const attritionScore = Math.min(100, separationFactor + tenureFactor + recurrenceFactor);
    const attritionRiskLevel = this.computeRiskLevel(attritionScore);
    const confidence = this.computeConfidence(baselineWorkforce, activeEmployees, eligiblePositionsCount);

    const factors = this.buildFactors(
      separationFactor, separationRate,
      tenureFactor, shortTenureRatio,
      recurrenceFactor, recurringPositionsCount, eligiblePositionsCount,
    );

    const reasoning = this.composeReasoning(attritionRiskLevel, factors);

    return {
      riskScore: attritionScore,
      riskLevel: attritionRiskLevel,
      confidence,
      reasoning,
      factors,
      computedAt: now.toISOString(),
      formulaVersion: AttritionRiskService.FORMULA_VERSION,
    };
  }

  // -------------------------------------------------------------------------
  // Public API — scoreByDepartment() (GD-M33-1 Decision 5)
  //
  // Computes the same attrition-deterministic-v1 formula per department instead of
  // tenant-wide. No new weight, threshold, or trailing-window change — every number
  // below is produced by the exact same private helpers score() calls, applied to
  // department-scoped query results.
  // -------------------------------------------------------------------------

  async scoreByDepartment(tenantId: string): Promise<DepartmentAttritionResult[]> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - TRAILING_WINDOW_MS);

    const departments = await this.prisma.department.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (departments.length === 0) return [];

    return Promise.all(
      departments.map(async (dept): Promise<DepartmentAttritionResult> => {
        const [
          trailingSeparations,
          baselineWorkforce,
          activeEmployees,
          shortTenureCount,
          filledVacancies,
        ] = await Promise.all([
          this.prisma.employee.count({
            where: {
              tenantId, deletedAt: null, departmentId: dept.id,
              employmentStatus: 'SEPARATED',
              terminationDate: { gte: windowStart },
            },
          }),
          this.prisma.employee.count({
            where: {
              tenantId, deletedAt: null, departmentId: dept.id,
              OR: [
                { employmentStatus: { not: 'SEPARATED' } },
                { employmentStatus: 'SEPARATED', terminationDate: { gte: windowStart } },
              ],
            },
          }),
          this.prisma.employee.count({
            where: {
              tenantId, deletedAt: null, departmentId: dept.id,
              employmentStatus: { in: CURRENT_WORKFORCE_STATUSES },
            },
          }),
          this.prisma.employee.count({
            where: {
              tenantId, deletedAt: null, departmentId: dept.id,
              employmentStatus: { in: CURRENT_WORKFORCE_STATUSES },
              hireDate: { gte: windowStart },
            },
          }),
          // Vacancy has no departmentId of its own — scoped via the position relation
          // (Position.departmentId), the same relation VacancyRiskService already joins.
          this.prisma.vacancy.findMany({
            where: {
              tenantId, deletedAt: null,
              filledAt: { gte: windowStart },
              position: { departmentId: dept.id },
            },
            select: { positionId: true },
          }),
        ]);

        const positionFillCounts = new Map<string, number>();
        for (const v of filledVacancies as { positionId: string }[]) {
          positionFillCounts.set(v.positionId, (positionFillCounts.get(v.positionId) ?? 0) + 1);
        }
        const eligiblePositionsCount = positionFillCounts.size;
        const recurringPositionsCount = [...positionFillCounts.values()].filter(c => c >= 2).length;

        // -- Identical formula to score() above — GD-M32-1 Decision 5, reused verbatim --
        const separationRate = baselineWorkforce > 0 ? trailingSeparations / baselineWorkforce : null;
        const separationFactor = separationRate !== null
          ? Math.round(Math.min(1, separationRate / SEPARATION_RATE_CEILING) * 50)
          : 25;

        const shortTenureRatio = activeEmployees > 0 ? shortTenureCount / activeEmployees : null;
        const tenureFactor = shortTenureRatio !== null ? Math.round(shortTenureRatio * 30) : 15;

        const recurrenceRatio = eligiblePositionsCount > 0 ? recurringPositionsCount / eligiblePositionsCount : null;
        const recurrenceFactor = recurrenceRatio !== null ? Math.round(recurrenceRatio * 20) : 10;

        const attritionScore = Math.min(100, separationFactor + tenureFactor + recurrenceFactor);
        const attritionRiskLevel = this.computeRiskLevel(attritionScore);
        const confidence = this.computeConfidence(baselineWorkforce, activeEmployees, eligiblePositionsCount);
        const factors = this.buildFactors(
          separationFactor, separationRate,
          tenureFactor, shortTenureRatio,
          recurrenceFactor, recurringPositionsCount, eligiblePositionsCount,
        );
        const reasoning = this.composeReasoning(attritionRiskLevel, factors);

        return {
          departmentId: dept.id,
          departmentName: dept.name,
          population: baselineWorkforce,
          output: {
            riskScore: attritionScore,
            riskLevel: attritionRiskLevel,
            confidence,
            reasoning,
            factors,
            computedAt: now.toISOString(),
            formulaVersion: AttritionRiskService.FORMULA_VERSION,
          },
        };
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Risk level thresholds — governed in GD-M32-1 Decision 6 (reuses GD-M30-1
  // Decision 6's LOW/MEDIUM/HIGH/CRITICAL scale and thresholds — attrition
  // risk runs the same direction as vacancy risk, unlike readiness).
  // -------------------------------------------------------------------------

  private computeRiskLevel(score: number): string {
    if (score >= 75) return 'CRITICAL';
    if (score >= 50) return 'HIGH';
    if (score >= 25) return 'MEDIUM';
    return 'LOW';
  }

  // -------------------------------------------------------------------------
  // Confidence — governed rules from GD-M32-1 Decision 7
  // -------------------------------------------------------------------------

  private computeConfidence(
    baselineWorkforce: number,
    activeEmployees: number,
    eligiblePositionsCount: number,
  ): number {
    let confidence = 100;
    if (baselineWorkforce === 0) confidence *= 0.5;
    if (activeEmployees === 0) confidence *= 0.6;
    if (eligiblePositionsCount === 0) confidence *= 0.7;
    if (activeEmployees < 3) confidence *= 0.6;
    return Math.max(10, Math.floor(confidence));
  }

  // -------------------------------------------------------------------------
  // Factors array — always exactly 3 entries (GD-M32-1 Decision 5)
  // -------------------------------------------------------------------------

  private buildFactors(
    separationFactor: number, separationRate: number | null,
    tenureFactor: number, shortTenureRatio: number | null,
    recurrenceFactor: number, recurringPositionsCount: number, eligiblePositionsCount: number,
  ): RiskFactor[] {
    const separationPct = separationRate !== null ? Math.round(separationRate * 100) : null;
    const tenurePct = shortTenureRatio !== null ? Math.round(shortTenureRatio * 100) : null;

    return [
      {
        name: 'separationRate',
        contribution: separationFactor,
        detail: separationPct !== null
          ? `${separationPct}% trailing 12-month separation rate`
          : 'No employment history available to assess',
      },
      {
        name: 'tenureComposition',
        contribution: tenureFactor,
        detail: tenurePct !== null
          ? `${tenurePct}% of current workforce hired within the last 12 months`
          : 'No current workforce data available',
      },
      {
        name: 'positionRecurrence',
        contribution: recurrenceFactor,
        detail: eligiblePositionsCount > 0
          ? `${recurringPositionsCount} of ${eligiblePositionsCount} filled positions refilled more than once in the last 12 months`
          : 'No positions filled in the last 12 months to assess',
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Reasoning — dynamically composed from the actual ranked factors (GD-M32-1 D8)
  // -------------------------------------------------------------------------

  private composeReasoning(attritionRiskLevel: string, factors: RiskFactor[]): string {
    const maxByName: Record<string, number> = {
      separationRate: 50,
      tenureComposition: 30,
      positionRecurrence: 20,
    };
    const phraseByName: Record<string, { high: string; low: string }> = {
      separationRate:     { high: 'an elevated separation rate',                     low: 'a low separation rate' },
      tenureComposition:  { high: 'a large share of recently hired staff',           low: 'a tenured, stable workforce' },
      positionRecurrence: { high: 'positions that have been repeatedly refilled',    low: 'low position recurrence' },
    };

    const ranked = [...factors].sort(
      (a, b) => (b.contribution / maxByName[b.name]!) - (a.contribution / maxByName[a.name]!),
    );
    const top = ranked[0]!;
    const bottom = ranked[ranked.length - 1]!;
    const bottomRatio = bottom.contribution / maxByName[bottom.name]!;

    let sentence = `Attrition risk is ${attritionRiskLevel}, driven primarily by ${phraseByName[top.name]!.high}`;
    if (bottom.name !== top.name && bottomRatio < 0.6) {
      sentence += `, offset by ${phraseByName[bottom.name]!.low}`;
    }
    sentence += '.';
    return sentence;
  }
}
