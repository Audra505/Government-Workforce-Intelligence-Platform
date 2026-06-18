// Reference: spec/01_requirements.md — FR-103 Vacancy Management
// Reference: spec/06_api_contracts.md — POST /api/v1/vacancies
// Reference: directives/03_vacancy_management_rules.md — VAC-100 through VAC-104, VAC-200
//
// Required fields: positionId, priority, reason, expectedFillDate (VAC-100).
// positionId: UUID — vacancy belongs to exactly one position (VAC-001).
// priority: one of PRIORITY_VALUES (VAC-200); stored as UPPER_SNAKE_CASE VARCHAR.
// reason: one of REASON_VALUES per directives/03 (governance decision: directives/03
//   governs over spec/01 for reason values; TEMPORARY_COVERAGE is the stored value
//   for what spec/01 called Temporary Need).
// expectedFillDate: ISO 8601 date string; controller converts to Date before calling
//   VacancyService.createVacancy() (Governance Decision 8-4 — string in DTO, Date at service).
// tenantId: NOT a field — derived from JWT context by controller (SEC-003).
// status: NOT a field — all vacancies created with status DRAFT by service.

import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsUUID } from 'class-validator';

const PRIORITY_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const REASON_VALUES = [
  'NEW_POSITION',
  'RETIREMENT',
  'RESIGNATION',
  'TRANSFER',
  'TERMINATION',
  'EXPANSION',
  'TEMPORARY_COVERAGE',
];

export class CreateVacancyDto {
  @ApiProperty({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'Position this vacancy is for (VAC-001)',
  })
  @IsUUID()
  positionId!: string;

  @ApiProperty({
    example: 'HIGH',
    enum: PRIORITY_VALUES,
    description: 'Vacancy priority (VAC-200): LOW | MEDIUM | HIGH | CRITICAL',
  })
  @IsIn(PRIORITY_VALUES)
  priority!: string;

  @ApiProperty({
    example: 'RETIREMENT',
    enum: REASON_VALUES,
    description: 'Reason for vacancy (directives/03 Vacancy Reasons)',
  })
  @IsIn(REASON_VALUES)
  reason!: string;

  @ApiProperty({
    example: '2027-06-01',
    description: 'Target fill date — ISO 8601 date string (VAC-100)',
  })
  @IsDateString()
  expectedFillDate!: string;
}
