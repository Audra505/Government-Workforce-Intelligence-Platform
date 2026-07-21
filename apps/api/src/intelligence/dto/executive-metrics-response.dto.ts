// Reference: governance/GD-M34-1.md — Decision 10 (Explainability Response Contract)
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

export class ExecutiveMetricsDataDto {
  @ApiProperty({ type: ExecutiveMetricValueDto })
  vacancyRate!: ExecutiveMetricValueDto;

  @ApiProperty({ type: ExecutiveMetricValueDto })
  coverageRate!: ExecutiveMetricValueDto;

  @ApiProperty({ type: ExecutiveMetricValueDto })
  timeToFill!: ExecutiveMetricValueDto;

  @ApiProperty({ type: ExecutiveMetricValueDto })
  hiringVelocity!: ExecutiveMetricValueDto;

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
