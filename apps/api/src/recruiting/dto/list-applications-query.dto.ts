// Reference: spec/06_api_contracts.md — GET /api/v1/applications query parameters
// Reference: governance/GD-M17-1.md — Decision 12 (ListApplicationsQueryDto)
//
// page and pageSize: integer-coerced query params (matches list DTO pattern).
// status: limited to canonical application status values (GD-PRE-PHASE3-002 D2).
// candidateId, vacancyId: optional UUID filters.
// No search/free-text in M17 (GD-M17-1 Decision 3).
// tenantId: NOT a parameter — always derived from JWT (SEC-003; GD-PRE-PHASE3-002 D1).

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

const APPLICATION_STATUS_VALUES = [
  'APPLIED',
  'SCREENING',
  'INTERVIEW',
  'EVALUATION',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
];

export class ListApplicationsQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1, description: 'Page number (1-based)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, description: 'Items per page (max 100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({
    example: 'APPLIED',
    enum: APPLICATION_STATUS_VALUES,
    description: 'Filter by application status',
  })
  @IsOptional()
  @IsIn(APPLICATION_STATUS_VALUES)
  status?: string;

  @ApiPropertyOptional({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6', description: 'Filter by candidate ID' })
  @IsOptional()
  @IsUUID()
  candidateId?: string;

  @ApiPropertyOptional({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6', description: 'Filter by vacancy ID' })
  @IsOptional()
  @IsUUID()
  vacancyId?: string;
}
