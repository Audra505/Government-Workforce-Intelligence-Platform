// Shared response types for the Intelligence workspace (GD-M32-1 Amendment 1).
// Mirrors the field names returned by GET /api/v1/intelligence/{vacancy-risk,
// workforce-readiness,attrition-risk} exactly — no field is invented here.
// vacancyRiskItem.factors was already returned by the API since M30 but was
// never declared in the dashboard's local type because the dashboard never
// rendered it (GD-M30-1 Decision 10's dashboard prohibition). It is declared
// here because the Intelligence workspace is authorized to render it
// (GD-M32-1 Decision 19).

export type RiskFactor = { name: string; contribution: number; detail: string };

export type VacancyRiskItem = {
  vacancyId: string;
  positionTitle: string;
  departmentName: string | null;
  status: string;
  daysOpen: number;
  priority: string | null;
  riskScore: number;
  riskLevel: string;
  confidence: number;
  reasoning: string;
  factors: RiskFactor[];
  computedAt: string;
  formulaVersion: string;
};

export type VacancyRiskRes = {
  success: boolean;
  data: {
    items: VacancyRiskItem[];
    total: number;
    scoredAt: string;
    formulaVersion: string;
  };
};

export type WorkforceReadinessRes = {
  success: boolean;
  data: {
    readinessScore: number;
    readinessLevel: string;
    confidence: number;
    reasoning: string;
    factors: RiskFactor[];
    computedAt: string;
    formulaVersion: string;
  };
};

export type AttritionRiskRes = {
  success: boolean;
  data: {
    attritionScore: number;
    attritionRiskLevel: string;
    confidence: number;
    reasoning: string;
    factors: RiskFactor[];
    computedAt: string;
    formulaVersion: string;
  };
};

// GD-M33-1 Decision 9 — mirrors GET /api/v1/intelligence/department-gap exactly.
// readiness/attrition are null for a suppressed department (GD-M33-1 Decision 6) —
// the API never includes a suppressed department's actual headcount anywhere in
// this shape, so there is no field here to accidentally render.
export type DepartmentGapSignal = {
  score: number;
  level: string;
  confidence: number;
  reasoning: string;
  factors: RiskFactor[];
  formulaVersion: string;
};

export type DepartmentVacancyContext = {
  openCount: number;
  criticalCount: number;
  avgDaysOpen: number | null;
};

export type DepartmentGapEntry = {
  departmentId: string;
  departmentName: string;
  suppressed: boolean;
  suppressionReason: string | null;
  readiness: DepartmentGapSignal | null;
  attrition: DepartmentGapSignal | null;
  vacancyContext: DepartmentVacancyContext;
};

export type DepartmentGapRes = {
  success: boolean;
  data: {
    departments: DepartmentGapEntry[];
    minimumHeadcountThreshold: number;
    computedAt: string;
    formulaVersion: string;
  };
};

// GD-M34-1 Decision 10 — mirrors GET /api/v1/intelligence/executive-metrics
// exactly. Each metric is a plain rate/count, not a classified risk score —
// value may be null (undefined-denominator or zero-sample case per Decisions
// 5-7) and must never be rendered as a fabricated 0.
export type ExecutiveMetricUnit = 'PERCENT' | 'DAYS' | 'COUNT';

export type ExecutiveMetricValue = {
  value: number | null;
  unit: ExecutiveMetricUnit;
  confidence: number;
  detail: string;
  windowDays: number | null;
};

export type ExecutiveMetricsRes = {
  success: boolean;
  data: {
    vacancyRate: ExecutiveMetricValue;
    coverageRate: ExecutiveMetricValue;
    timeToFill: ExecutiveMetricValue;
    hiringVelocity: ExecutiveMetricValue;
    computedAt: string;
    formulaVersion: string;
  };
};

// GD-M31-1 Decision 5 / GD-M32-1 Decision 5 / GD-M30-1 Decision 5 governed
// factor maximums. Mirrored here for display only (proportion bar + "x / max"
// label) — the contribution numerator always comes from the API response;
// only the denominator is a governed constant from existing decisions, never
// computed or invented on the frontend.
export const FACTOR_MAX: Record<string, number> = {
  staffingCoverage: 30,
  positionCapacity: 20,
  vacancyPressure: 30,
  certificationCompliance: 20,
  separationRate: 50,
  tenureComposition: 30,
  positionRecurrence: 20,
  vacancyAge: 40,
  priority: 40,
  fillDateProximity: 15,
  vacancyStatus: 5,
};

export const FACTOR_LABEL: Record<string, string> = {
  staffingCoverage: 'Staffing Coverage',
  positionCapacity: 'Position Capacity',
  vacancyPressure: 'Vacancy Pressure',
  certificationCompliance: 'Certification Compliance',
  separationRate: 'Separation Rate',
  tenureComposition: 'Tenure Composition',
  positionRecurrence: 'Position Recurrence',
  vacancyAge: 'Vacancy Age',
  priority: 'Priority',
  fillDateProximity: 'Fill Date Proximity',
  vacancyStatus: 'Vacancy Status',
};

export function confidenceLabel(c: number): string {
  return c >= 70 ? 'High' : c >= 40 ? 'Medium' : 'Low';
}
