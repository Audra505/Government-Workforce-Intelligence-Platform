// Reference: spec/06_api_contracts.md — PUT /api/v1/vacancies/{id}
// Reference: directives/03_vacancy_management_rules.md — VAC-200, VAC-501
//
// All fields are optional — partial updates apply only supplied fields.
// priority and reason share the same @IsIn() lists as CreateVacancyDto.
// reason is accepted by the DTO but the service silently discards it when
//   vacancy.status is OPEN or IN_RECRUITMENT (reason is locked after DRAFT).
// status: only 'OPEN' is accepted via PUT — triggers DRAFT→OPEN transition in service.
//   VacancyController routes: if dto.status === 'OPEN' → openVacancy(); else → updateVacancy().
//   'CLOSED' excluded — use POST /vacancies/:id/close (CloseVacancyDto).
//   'IN_RECRUITMENT' excluded — triggered by first application (VAC-301, Phase 3).
//   'DRAFT', 'FILLED', 'CANCELLED' excluded — not valid PUT targets.
// expectedFillDate: string in DTO; controller converts to Date (Governance Decision 8-4).
// tenantId: NOT a field — SEC-003.

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';

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

export class UpdateVacancyDto {
  @ApiPropertyOptional({ example: 'HIGH', enum: PRIORITY_VALUES })
  @IsOptional()
  @IsIn(PRIORITY_VALUES)
  priority?: string;

  @ApiPropertyOptional({
    example: 'RETIREMENT',
    enum: REASON_VALUES,
    description: 'Only editable in DRAFT status — service discards if vacancy is OPEN or IN_RECRUITMENT',
  })
  @IsOptional()
  @IsIn(REASON_VALUES)
  reason?: string;

  @ApiPropertyOptional({ example: '2027-12-01', description: 'ISO 8601 date string' })
  @IsOptional()
  @IsDateString()
  expectedFillDate?: string;

  @ApiPropertyOptional({
    enum: ['OPEN'],
    description: 'DRAFT→OPEN transition only. CLOSED transitions use POST /vacancies/:id/close.',
  })
  @IsOptional()
  @IsIn(['OPEN'])
  status?: string;
}
