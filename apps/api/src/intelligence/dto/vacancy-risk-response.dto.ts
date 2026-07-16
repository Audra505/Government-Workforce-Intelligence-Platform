// Reference: governance/GD-M30-1.md — Decision 8 (Explainability Response Contract), Scope item 4
// Reference: spec/01_requirements.md — FR-401, FR-900
//
// No class-validator decorators — response DTOs are not validated by the pipe
// (same convention as apps/api/src/workforce/dto/vacancy-response.dto.ts).
// This DTO documents and types the GET /api/v1/intelligence/vacancy-risk response
// shape for Swagger and the controller return type. It does not alter runtime
// serialization — the controller continues to return a plain object matching
// this shape; no class-transformer / ClassSerializerInterceptor is involved.
//
// factors reuses RiskFactor from intelligence-explainability.interface.ts —
// no duplicate factor shape defined here.

import { ApiProperty } from '@nestjs/swagger';

import type { RiskFactor } from '../interfaces/intelligence-explainability.interface';

export class VacancyRiskItemDto {
  @ApiProperty({ example: 'vvvvvvvv-vvvv-vvvv-vvvv-vvvvvvvvvvvv' })
  vacancyId!: string;

  @ApiProperty({ example: 'HR Specialist' })
  positionTitle!: string;

  @ApiProperty({ nullable: true, example: 'Human Resources' })
  departmentName!: string | null;

  @ApiProperty({ example: 'OPEN', description: 'OPEN | IN_RECRUITMENT' })
  status!: string;

  @ApiProperty({ example: 45, description: 'Integer days open: floor((now - createdAt) / 86_400_000)' })
  daysOpen!: number;

  @ApiProperty({ nullable: true, example: 'HIGH', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] })
  priority!: string | null;

  @ApiProperty({ example: 60, minimum: 0, maximum: 100 })
  riskScore!: number;

  @ApiProperty({ example: 'HIGH', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  riskLevel!: string;

  @ApiProperty({
    example: 70,
    minimum: 0,
    maximum: 100,
    description: 'Data sufficiency indicator for riskScore (GD-M30-1 Decision 7)',
  })
  confidence!: number;

  @ApiProperty({ example: 'HIGH priority vacancy open 30–59 days with no expected fill date set.' })
  reasoning!: string;

  @ApiProperty({
    description: 'Itemized non-zero contributing factors only (GD-M30-1 Decisions 5, 8)',
    example: [{ name: 'vacancyAge', contribution: 20, detail: 'Open 30–59 days' }],
  })
  factors!: RiskFactor[];

  @ApiProperty({ example: '2026-07-14T14:23:00.000Z' })
  computedAt!: string;

  @ApiProperty({ example: 'deterministic-v1' })
  formulaVersion!: string;
}

export class VacancyRiskDataDto {
  @ApiProperty({ type: [VacancyRiskItemDto] })
  items!: VacancyRiskItemDto[];

  @ApiProperty({
    example: 7,
    description: 'Total eligible vacancies scored — not just the items returned per pageSize (GD-M30-1 Decision 6)',
  })
  total!: number;

  @ApiProperty({ example: '2026-07-14T14:23:00.000Z' })
  scoredAt!: string;

  @ApiProperty({ example: 'deterministic-v1' })
  formulaVersion!: string;
}

export class VacancyRiskResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: VacancyRiskDataDto })
  data!: VacancyRiskDataDto;
}
