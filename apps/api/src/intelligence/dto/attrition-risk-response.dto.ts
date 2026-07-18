// Reference: governance/GD-M32-1.md — Decision 8 (Explainability Response Contract)
// Reference: spec/01_requirements.md — FR-402, FR-900
//
// No class-validator decorators — response DTOs are not validated by the pipe
// (same convention as vacancy-risk-response.dto.ts and workforce-readiness-response.dto.ts).
//
// Field names are attrition-specific (attritionScore/attritionRiskLevel) even though
// AttritionRiskService returns the shared IntelligenceExplainabilityOutput shape
// (riskScore/riskLevel) — the controller maps between them at the response boundary
// (GD-M32-1 Decision 8 naming note). This keeps the shared interface untouched.
//
// This response is byte-identical for every allowed role, including Executive User
// (GD-M32-1 Decision 11 — aggregate-only guarantee, all roles). No per-role field
// stripping exists or is needed: the service never queries row-level employee
// records in individually-identifiable form for any role.
//
// factors reuses RiskFactor from intelligence-explainability.interface.ts —
// no duplicate factor shape defined here.

import { ApiProperty } from '@nestjs/swagger';

import type { RiskFactor } from '../interfaces/intelligence-explainability.interface';

export class AttritionRiskDataDto {
  @ApiProperty({ example: 26, minimum: 0, maximum: 100 })
  attritionScore!: number;

  @ApiProperty({ example: 'MEDIUM', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  attritionRiskLevel!: string;

  @ApiProperty({
    example: 85,
    minimum: 0,
    maximum: 100,
    description: 'Data sufficiency indicator for attritionScore (GD-M32-1 Decision 7)',
  })
  confidence!: number;

  @ApiProperty({
    example: 'Attrition risk is MEDIUM, driven primarily by a large share of recently hired staff, offset by low position recurrence.',
  })
  reasoning!: string;

  @ApiProperty({
    description: 'Always exactly 3 entries — separationRate, tenureComposition, positionRecurrence (GD-M32-1 Decision 5)',
    example: [{ name: 'separationRate', contribution: 12, detail: '7% trailing 12-month separation rate' }],
  })
  factors!: RiskFactor[];

  @ApiProperty({ example: '2026-07-17T14:23:00.000Z' })
  computedAt!: string;

  @ApiProperty({ example: 'attrition-deterministic-v1' })
  formulaVersion!: string;
}

export class AttritionRiskResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: AttritionRiskDataDto })
  data!: AttritionRiskDataDto;
}
