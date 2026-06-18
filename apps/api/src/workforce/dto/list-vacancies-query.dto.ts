// Reference: spec/06_api_contracts.md — GET /api/v1/vacancies
// Reference: directives/03_vacancy_management_rules.md — VAC-200
//
// All fields optional — unfiltered list returns all tenant vacancies paginated.
// status filter: DRAFT, OPEN, IN_RECRUITMENT, CLOSED only (stored states).
//   FILLED and CANCELLED are excluded — they are not stored states; filtering by
//   them would always return 0 results (Governance Decision 8-5).
// @Type(() => Number) required on page and pageSize — query string params arrive as
//   strings; @IsInt() rejects strings without this coercion decorator.
//   Global ValidationPipe(transform: true) enables class-transformer coercion.
// pageSize maximum 100 matches ListPositionsQueryDto and ListDepartmentsQueryDto convention.
// tenantId: NOT a query param — derived from JWT (SEC-003).

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListVacanciesQueryDto {
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
    enum: ['DRAFT', 'OPEN', 'IN_RECRUITMENT', 'CLOSED'],
    description: 'Filter by stored lifecycle state. FILLED and CANCELLED are closure types, not stored states.',
  })
  @IsOptional()
  @IsIn(['DRAFT', 'OPEN', 'IN_RECRUITMENT', 'CLOSED'])
  status?: string;

  @ApiPropertyOptional({
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    description: 'Filter by priority (VAC-200)',
  })
  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  priority?: string;

  @ApiPropertyOptional({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'Filter by department UUID',
  })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
