// Reference: spec/01_requirements.md — FR-051 Department Management
// Reference: spec/06_api_contracts.md — GET /api/v1/departments query parameters
//
// pageSize maximum of 100 is a Phase 1 implementation decision — not a blueprint requirement.
// Matches the same decision made in ListUsersQueryDto (Milestone 6 Step 5).
//
// @Type(() => Number) is required for @IsInt() to work on query string parameters.
// The global ValidationPipe (transform: true) enables class-transformer coercion.
//
// @IsIn() is used for status rather than @IsEnum() because department.status is a
// plain VarChar(50) in Prisma — no TypeScript enum exists for it.
//
// Tenant isolation: tenantId is NOT a query parameter. It is always derived from the
// authenticated user's JWT (SEC-003). Callers cannot supply or override tenant context.

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListDepartmentsQueryDto {
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

  @ApiPropertyOptional({ example: 'ACTIVE', enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: string;

  @ApiPropertyOptional({ example: 'Human Resources', description: 'Case-insensitive search on name, code, description' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
