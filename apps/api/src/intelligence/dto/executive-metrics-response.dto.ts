// Reference: governance/GD-M34-1.md — Decision 10 (Explainability Response Contract)
// Reference: governance/GD-M34-2.md — Decision 8 (Response Contract extension)
// Reference: spec/01_requirements.md — FR-404, FR-900
//
// No class-validator decorators — response DTOs are not validated by the pipe
// (same convention as vacancy-risk-response.dto.ts, workforce-readiness-
// response.dto.ts, attrition-risk-response.dto.ts, and department-gap-
// response.dto.ts).
//
// Each metric reports its own value/unit/confidence/detail/windowDays shape
// rather than the shared RiskFactor/IntelligenceExplainabilityOutput shape —
// these are plain rates/counts, not classified risk scores.
//
// ExecutiveWorkforceSnapshotDto / ExecutiveLast30DaysActivityDto (GD-M34-2
// Decision 2) are plain non-negative-integer counts — never null (no
// undefined-denominator case) and no confidence field (no formula
// uncertainty to express).

import { ApiProperty } from '@nestjs/swagger';

export class ExecutiveMetricValueDto {
  @ApiProperty({ example: 12.0, nullable: true, description: 'null when the metric is undefined for this tenant (e.g. zero active positions) — never fabricated as 0' })
  value!: number | null;

  @ApiProperty({ example: 'PERCENT', enum: ['PERCENT', 'DAYS', 'COUNT'] })
  unit!: 'PERCENT' | 'DAYS' | 'COUNT';

  @ApiProperty({ example: 100, minimum: 0, maximum: 100 })
  confidence!: number;

  @ApiProperty({ example: '6 of 50 active positions are currently vacant.' })
  detail!: string;

  @ApiProperty({ example: null, nullable: true, description: 'Trailing window length in days; null for point-in-time ratios' })
  windowDays!: number | null;
}

export class ExecutiveWorkforceSnapshotDto {
  @ApiProperty({ example: 1248, description: 'Tenant-wide count of employees with employmentStatus = ACTIVE' })
  activeWorkforce!: number;

  @ApiProperty({ example: 892, description: 'Tenant-wide count of positions with status = ACTIVE' })
  activePositions!: number;

  @ApiProperty({ example: 388, description: 'Tenant-wide count of vacancies with status OPEN or IN_RECRUITMENT' })
  unfilledVacancies!: number;

  @ApiProperty({ example: 87, description: 'Tenant-wide count of vacancies with priority = CRITICAL' })
  criticalVacancies!: number;
}

export class ExecutiveLast30DaysActivityDto {
  @ApiProperty({ example: 48, description: 'Employees with hireDate in the trailing windowDays' })
  hires!: number;

  @ApiProperty({ example: 32, description: 'Employees with employmentStatus = SEPARATED and terminationDate in the trailing windowDays' })
  separations!: number;

  @ApiProperty({ example: 76, description: 'Vacancies with createdAt in the trailing windowDays' })
  vacanciesOpened!: number;

  @ApiProperty({ example: 54, description: 'Vacancies with filledAt in the trailing windowDays' })
  vacanciesFilled!: number;

  @ApiProperty({ example: 30 })
  windowDays!: number;
}

export class ExecutiveMetricsDataDto {
  @ApiProperty({ type: ExecutiveMetricValueDto })
  vacancyRate!: ExecutiveMetricValueDto;

  @ApiProperty({ type: ExecutiveMetricValueDto })
  coverageRate!: ExecutiveMetricValueDto;

  @ApiProperty({ type: ExecutiveMetricValueDto })
  timeToFill!: ExecutiveMetricValueDto;

  @ApiProperty({ type: ExecutiveMetricValueDto })
  hiringVelocity!: ExecutiveMetricValueDto;

  @ApiProperty({ type: ExecutiveWorkforceSnapshotDto })
  workforceSnapshot!: ExecutiveWorkforceSnapshotDto;

  @ApiProperty({ type: ExecutiveLast30DaysActivityDto })
  last30DaysActivity!: ExecutiveLast30DaysActivityDto;

  @ApiProperty({ example: '2026-07-19T14:23:00.000Z' })
  computedAt!: string;

  @ApiProperty({ example: 'executive-metrics-deterministic-v1' })
  formulaVersion!: string;
}

export class ExecutiveMetricsResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: ExecutiveMetricsDataDto })
  data!: ExecutiveMetricsDataDto;
}
