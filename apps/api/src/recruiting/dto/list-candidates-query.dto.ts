// Reference: spec/06_api_contracts.md — GET /api/v1/candidates query parameters
// Reference: governance/GD-M16-1.md — Decision 9 (ListCandidatesQueryDto)
//
// page and pageSize: integer-coerced query params with defaults (matches list DTO pattern).
// status: limited to ACTIVE or ARCHIVED — no other values valid in M16.
//   Absent status defaults to ACTIVE-only list in service layer.
// No search/free-text filter in M16 — deferred to M20 (GD-M16-1 Decision 3).
// tenantId: NOT a parameter — always derived from JWT (SEC-003; GD-PRE-PHASE3-002 D1).

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const CANDIDATE_STATUS_VALUES = ['ACTIVE', 'ARCHIVED'];

export class ListCandidatesQueryDto {
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
    example: 'ACTIVE',
    enum: CANDIDATE_STATUS_VALUES,
    description: 'Filter by candidate status — ACTIVE or ARCHIVED. Absent defaults to ACTIVE-only in service.',
  })
  @IsOptional()
  @IsIn(CANDIDATE_STATUS_VALUES)
  status?: string;
}
