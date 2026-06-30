// Reference: spec/06_api_contracts.md — GET /api/v1/offers query parameters
// Reference: governance/GD-M18-1.md — Decision 13 (ListOffersQueryDto)
//
// page and pageSize: integer-coerced query params (matches list DTO pattern).
// applicationId: optional UUID; filter to one application's offers.
// status: optional string; filter by offer status value (GD-M18-1 D13).
//   Governance specifies 'string' only — no @IsIn() constraint (unlike ListInterviewsQueryDto).
//   An unrecognised status value returns zero results; it is not a validation error.
// tenantId: NOT a parameter — always derived from JWT (SEC-003; GD-PRE-PHASE3-002 D1).

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class ListOffersQueryDto {
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
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'Filter to offers for one application',
  })
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @ApiPropertyOptional({
    example: 'DRAFT',
    description: 'Filter by offer status value — DRAFT, PENDING_APPROVAL, APPROVED, SENT, ACCEPTED, DECLINED, or WITHDRAWN',
  })
  @IsOptional()
  @IsString()
  status?: string;
}
