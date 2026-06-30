// Reference: spec/06_api_contracts.md — GET /api/v1/interviews query parameters
// Reference: governance/GD-M18-1.md — Decision 13 (ListInterviewsQueryDto)
//
// page and pageSize: integer-coerced query params (matches list DTO pattern).
// applicationId: optional UUID; filter to one application's interviews.
// status: optional; filter by interview status value (GD-PRE-PHASE3-002 D8).
// interviewType: optional; filter by interview type value (GD-M18-1 D13).
// tenantId: NOT a parameter — always derived from JWT (SEC-003; GD-PRE-PHASE3-002 D1).

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

const INTERVIEW_STATUS_VALUES = ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
const INTERVIEW_TYPE_VALUES = ['PHONE_SCREEN', 'PANEL', 'TECHNICAL', 'FINAL'];

export class ListInterviewsQueryDto {
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
    description: 'Filter to interviews for one application',
  })
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @ApiPropertyOptional({
    example: 'SCHEDULED',
    enum: INTERVIEW_STATUS_VALUES,
    description: 'Filter by interview status — SCHEDULED, COMPLETED, CANCELLED, or NO_SHOW',
  })
  @IsOptional()
  @IsIn(INTERVIEW_STATUS_VALUES)
  status?: string;

  @ApiPropertyOptional({
    example: 'PHONE_SCREEN',
    enum: INTERVIEW_TYPE_VALUES,
    description: 'Filter by interview type — PHONE_SCREEN, PANEL, TECHNICAL, or FINAL',
  })
  @IsOptional()
  @IsIn(INTERVIEW_TYPE_VALUES)
  interviewType?: string;
}
