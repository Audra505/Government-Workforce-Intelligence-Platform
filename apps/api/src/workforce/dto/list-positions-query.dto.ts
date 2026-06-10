// Reference: spec/01_requirements.md — FR-100 Position Management
// Reference: spec/06_api_contracts.md — GET /api/v1/positions query parameters
//
// pageSize maximum of 100 is a Phase 1 implementation decision — not a blueprint
// requirement. Matches the same decision made in ListUsersQueryDto and
// ListDepartmentsQueryDto.
//
// @Type(() => Number) is required for @IsInt() to work on query string parameters.
// The global ValidationPipe (transform: true) enables class-transformer coercion.
//
// @IsIn() is used for status to cover all four lifecycle states (Decision 1).
// departmentId filter allows callers to scope positions to a specific department.
// tenantId is NOT a query parameter — always derived from JWT (SEC-003).

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class ListPositionsQueryDto {
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

  @ApiPropertyOptional({ example: 'ACTIVE', enum: ['DRAFT', 'ACTIVE', 'FROZEN', 'CLOSED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE', 'FROZEN', 'CLOSED'])
  status?: string;

  @ApiPropertyOptional({ example: 'Professional', description: 'Filter by classification' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  classification?: string;

  @ApiPropertyOptional({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6', description: 'Filter by department UUID' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ example: 'HR Specialist', description: 'Case-insensitive search on title and classification' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
