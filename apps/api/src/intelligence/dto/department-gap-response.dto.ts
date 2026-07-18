// Reference: governance/GD-M33-1.md — Decision 9 (Explainability Response Contract)
// Reference: spec/01_requirements.md — FR-411, FR-900
//
// No class-validator decorators — response DTOs are not validated by the pipe (same
// convention as vacancy-risk-response.dto.ts, workforce-readiness-response.dto.ts, and
// attrition-risk-response.dto.ts).
//
// readiness/attrition are null for a suppressed department (GD-M33-1 Decision 6) — a
// department's actual headcount is never included anywhere in this response.
//
// factors reuses RiskFactor from intelligence-explainability.interface.ts — no
// duplicate factor shape defined here.

import { ApiProperty } from '@nestjs/swagger';

import type { RiskFactor } from '../interfaces/intelligence-explainability.interface';

export class DepartmentGapSignalDto {
  @ApiProperty({ example: 68, minimum: 0, maximum: 100 })
  score!: number;

  @ApiProperty({ example: 'DEVELOPING' })
  level!: string;

  @ApiProperty({ example: 90, minimum: 0, maximum: 100 })
  confidence!: number;

  @ApiProperty({ example: 'Workforce readiness is DEVELOPING, driven primarily by strong staffing coverage.' })
  reasoning!: string;

  @ApiProperty({
    example: [{ name: 'staffingCoverage', contribution: 27, detail: '90% of current workforce active' }],
  })
  factors!: RiskFactor[];

  @ApiProperty({ example: 'readiness-deterministic-v1' })
  formulaVersion!: string;
}

export class DepartmentVacancyContextDto {
  @ApiProperty({ example: 2, description: 'Open/in-recruitment vacancies in this department' })
  openCount!: number;

  @ApiProperty({ example: 1, description: 'Vacancies at CRITICAL or HIGH risk level in this department' })
  criticalCount!: number;

  @ApiProperty({ example: 14, nullable: true, description: 'Average days open across this department\'s scored vacancies; null if none' })
  avgDaysOpen!: number | null;
}

export class DepartmentGapEntryDto {
  @ApiProperty({ example: 'a1b2c3d4-0000-0000-0000-000000000000' })
  departmentId!: string;

  @ApiProperty({ example: 'Field Operations' })
  departmentName!: string;

  @ApiProperty({
    example: false,
    description: 'true when this department is below the minimum reporting headcount (GD-M33-1 Decision 6) — readiness/attrition are null and the actual headcount is never disclosed',
  })
  suppressed!: boolean;

  @ApiProperty({ example: null, nullable: true })
  suppressionReason!: string | null;

  @ApiProperty({ type: DepartmentGapSignalDto, nullable: true })
  readiness!: DepartmentGapSignalDto | null;

  @ApiProperty({ type: DepartmentGapSignalDto, nullable: true })
  attrition!: DepartmentGapSignalDto | null;

  @ApiProperty({ type: DepartmentVacancyContextDto })
  vacancyContext!: DepartmentVacancyContextDto;
}

export class DepartmentGapDataDto {
  @ApiProperty({ type: [DepartmentGapEntryDto] })
  departments!: DepartmentGapEntryDto[];

  @ApiProperty({ example: 5, description: 'Governed minimum headcount below which a department is suppressed (GD-M33-1 Decision 6)' })
  minimumHeadcountThreshold!: number;

  @ApiProperty({ example: '2026-07-18T14:23:00.000Z' })
  computedAt!: string;

  @ApiProperty({ example: 'department-gap-deterministic-v1' })
  formulaVersion!: string;
}

export class DepartmentGapResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: DepartmentGapDataDto })
  data!: DepartmentGapDataDto;
}
