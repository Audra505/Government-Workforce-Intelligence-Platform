// Reference: governance/GD-M33-1.md — Decisions 1, 2, 5, 6, 9, 11
// Reference: spec/01_requirements.md — FR-411 (Operational Readiness Dashboard —
//   "Agency Readiness, Department Readiness, Workforce Readiness")
// Reference: directives/06_attrition_scoring_rules.md — Reporting Rules ("Department Risk")
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
//
// DepartmentGapService is an orchestrator ONLY — it contains no scoring formula of its
// own. It calls WorkforceReadinessService.scoreByDepartment() and
// AttritionRiskService.scoreByDepartment() (both reuse their respective governed
// formulas verbatim, GD-M31-1/GD-M32-1 Decision 5), reads vacancy context from
// VacancyRiskService's existing score() output, and applies the minimum-headcount
// suppression rule (GD-M33-1 Decision 6) before returning.
//
// No external AI, LLM, or HTTP calls of any kind (GD-M33-1 Decision 12).
// tenantId is never derived from caller input — always from JWT context via the controller.
// No caller-supplied department filter exists anywhere in this service (GD-M33-1 Decision 3).

import { Injectable } from '@nestjs/common';

import type { RiskFactor } from '../interfaces/intelligence-explainability.interface';
import { WorkforceReadinessService } from './workforce-readiness.service';
import { AttritionRiskService } from './attrition-risk.service';
import { VacancyRiskService } from './vacancy-risk.service';

// ---------------------------------------------------------------------------
// Governed constant — GD-M33-1 Decision 6
// ---------------------------------------------------------------------------

const MINIMUM_DEPARTMENT_HEADCOUNT = 5;

// ---------------------------------------------------------------------------
// Public output types — GD-M33-1 Decision 9
// ---------------------------------------------------------------------------

export interface DepartmentGapSignal {
  score: number;
  level: string;
  confidence: number;
  reasoning: string;
  factors: RiskFactor[];
  formulaVersion: string;
}

export interface DepartmentVacancyContext {
  openCount: number;
  criticalCount: number;
  avgDaysOpen: number | null;
}

export interface DepartmentGapEntry {
  departmentId: string;
  departmentName: string;
  suppressed: boolean;
  suppressionReason: string | null;
  readiness: DepartmentGapSignal | null;
  attrition: DepartmentGapSignal | null;
  vacancyContext: DepartmentVacancyContext;
}

export interface DepartmentGapResult {
  departments: DepartmentGapEntry[];
  minimumHeadcountThreshold: number;
  computedAt: string;
  formulaVersion: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class DepartmentGapService {
  static readonly FORMULA_VERSION = 'department-gap-deterministic-v1';

  constructor(
    private readonly workforceReadinessService: WorkforceReadinessService,
    private readonly attritionRiskService: AttritionRiskService,
    private readonly vacancyRiskService: VacancyRiskService,
  ) {}

  // -------------------------------------------------------------------------
  // Public API — getByTenant()
  // -------------------------------------------------------------------------

  async getByTenant(tenantId: string): Promise<DepartmentGapResult> {
    const now = new Date();

    const [readinessResults, attritionResults, vacancyResult] = await Promise.all([
      this.workforceReadinessService.scoreByDepartment(tenantId),
      this.attritionRiskService.scoreByDepartment(tenantId),
      // pageSize:50 is the existing DTO's governed maximum — reused, not a new query path.
      this.vacancyRiskService.score(tenantId, { pageSize: 50 }),
    ]);

    const attritionByDeptId = new Map(attritionResults.map(r => [r.departmentId, r]));

    // Vacancy context grouped by departmentName — VacancyRiskItem does not expose
    // departmentId, only departmentName (GD-M33-1 Decision 5 vacancy-context note).
    const vacancyByDeptName = new Map<
      string,
      { open: number; critical: number; daysSum: number; daysCount: number }
    >();
    for (const item of vacancyResult.items) {
      if (item.departmentName === null) continue;
      const bucket = vacancyByDeptName.get(item.departmentName) ?? { open: 0, critical: 0, daysSum: 0, daysCount: 0 };
      bucket.open += 1;
      if (item.riskLevel === 'CRITICAL' || item.riskLevel === 'HIGH') bucket.critical += 1;
      bucket.daysSum += item.daysOpen;
      bucket.daysCount += 1;
      vacancyByDeptName.set(item.departmentName, bucket);
    }

    const entries: DepartmentGapEntry[] = readinessResults.map((readiness) => {
      const attrition = attritionByDeptId.get(readiness.departmentId);
      const vacancyBucket = vacancyByDeptName.get(readiness.departmentName);

      const vacancyContext: DepartmentVacancyContext = {
        openCount: vacancyBucket?.open ?? 0,
        criticalCount: vacancyBucket?.critical ?? 0,
        avgDaysOpen: vacancyBucket && vacancyBucket.daysCount > 0
          ? Math.round(vacancyBucket.daysSum / vacancyBucket.daysCount)
          : null,
      };

      // GD-M33-1 Decision 6: each signal is checked against its own governed population
      // definition, but BOTH signals are suppressed together if either is below
      // threshold — a partial suppression (e.g. attrition shown, readiness hidden)
      // would itself leak a narrowed headcount range for the withheld signal.
      const suppressed =
        readiness.population < MINIMUM_DEPARTMENT_HEADCOUNT ||
        (attrition?.population ?? 0) < MINIMUM_DEPARTMENT_HEADCOUNT;

      if (suppressed) {
        return {
          departmentId: readiness.departmentId,
          departmentName: readiness.departmentName,
          suppressed: true,
          suppressionReason: `Department population below minimum reporting threshold (${MINIMUM_DEPARTMENT_HEADCOUNT}).`,
          readiness: null,
          attrition: null,
          vacancyContext,
        };
      }

      return {
        departmentId: readiness.departmentId,
        departmentName: readiness.departmentName,
        suppressed: false,
        suppressionReason: null,
        readiness: {
          score: readiness.output.riskScore,
          level: readiness.output.riskLevel,
          confidence: readiness.output.confidence,
          reasoning: readiness.output.reasoning,
          factors: readiness.output.factors,
          formulaVersion: readiness.output.formulaVersion,
        },
        attrition: attrition ? {
          score: attrition.output.riskScore,
          level: attrition.output.riskLevel,
          confidence: attrition.output.confidence,
          reasoning: attrition.output.reasoning,
          factors: attrition.output.factors,
          formulaVersion: attrition.output.formulaVersion,
        } : null,
        vacancyContext,
      };
    });

    // GD-M33-1 Decisions 9 & 13: alphabetical by department name — never sorted or
    // ranked by score, which would functionally create a department leaderboard.
    entries.sort((a, b) => a.departmentName.localeCompare(b.departmentName));

    return {
      departments: entries,
      minimumHeadcountThreshold: MINIMUM_DEPARTMENT_HEADCOUNT,
      computedAt: now.toISOString(),
      formulaVersion: DepartmentGapService.FORMULA_VERSION,
    };
  }
}
