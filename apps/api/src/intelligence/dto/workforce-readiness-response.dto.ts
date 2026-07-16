// Reference: governance/GD-M31-1.md — Decision 8 (Explainability Response Contract)
// Reference: spec/01_requirements.md — FR-410, FR-900
//
// No class-validator decorators — response DTOs are not validated by the pipe
// (same convention as vacancy-risk-response.dto.ts).
//
// Field names are readiness-specific (readinessScore/readinessLevel) even though
// WorkforceReadinessService returns the shared IntelligenceExplainabilityOutput shape
// (riskScore/riskLevel) — the controller maps between them at the response boundary
// (GD-M31-1 Decision 8 naming note). This keeps the shared interface untouched.
//
// This response is byte-identical for every allowed role, including Executive User
// (GD-M31-1 Decision 11 — aggregation guarantee). No per-role field stripping exists
// or is needed: the service never queries row-level records for any role.
//
// factors reuses RiskFactor from intelligence-explainability.interface.ts —
// no duplicate factor shape defined here.

import { ApiProperty } from '@nestjs/swagger';

import type { RiskFactor } from '../interfaces/intelligence-explainability.interface';

export class WorkforceReadinessDataDto {
  @ApiProperty({ example: 76, minimum: 0, maximum: 100 })
  readinessScore!: number;

  @ApiProperty({ example: 'READY', enum: ['CRITICAL', 'AT_RISK', 'DEVELOPING', 'READY'] })
  readinessLevel!: string;

  @ApiProperty({
    example: 90,
    minimum: 0,
    maximum: 100,
    description: 'Data sufficiency indicator for readinessScore (GD-M31-1 Decision 7)',
  })
  confidence!: number;

  @ApiProperty({
    example: 'Workforce readiness is READY, driven primarily by strong staffing coverage, offset by certification compliance below target.',
  })
  reasoning!: string;

  @ApiProperty({
    description: 'Always exactly 4 entries — staffingCoverage, positionCapacity, vacancyPressure, certificationCompliance (GD-M31-1 Decision 5)',
    example: [{ name: 'staffingCoverage', contribution: 27, detail: '90% of current workforce active' }],
  })
  factors!: RiskFactor[];

  @ApiProperty({ example: '2026-07-16T14:23:00.000Z' })
  computedAt!: string;

  @ApiProperty({ example: 'readiness-deterministic-v1' })
  formulaVersion!: string;
}

export class WorkforceReadinessResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: WorkforceReadinessDataDto })
  data!: WorkforceReadinessDataDto;
}
