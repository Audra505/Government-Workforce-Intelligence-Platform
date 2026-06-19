// Reference: spec/01_requirements.md — FR-110 Employee Management, FR-112 Availability
// Reference: spec/06_api_contracts.md — GET /api/v1/employees query parameters
// Reference: directives/13_employee_management_rules.md — EMP-501 (employmentStatus filter for schedulers)
//
// employmentStatus: all 5 GD-M12-1 canonical values are valid filter targets.
//   PENDING_ONBOARDING and SEPARATED are included — HR personnel may filter for any state.
// departmentId: optional UUID filter — scopes the list to a single department.
// tenantId: NOT a parameter — always derived from JWT context (SEC-003/EMP-002).

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

const EMPLOYMENT_STATUS_VALUES = [
  'PENDING_ONBOARDING',
  'ACTIVE',
  'ON_LEAVE',
  'SUSPENDED',
  'SEPARATED',
];

export class ListEmployeesQueryDto {
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
    enum: EMPLOYMENT_STATUS_VALUES,
    description: 'Filter by employment status — all 5 GD-M12-1 canonical values accepted (EMP-501)',
  })
  @IsOptional()
  @IsIn(EMPLOYMENT_STATUS_VALUES)
  employmentStatus?: string;

  @ApiPropertyOptional({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'Filter by department UUID',
  })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
