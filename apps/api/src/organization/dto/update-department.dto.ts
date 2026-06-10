// Reference: spec/01_requirements.md — FR-051 Department Management
// Reference: spec/06_api_contracts.md — PATCH /api/v1/departments/:id
// Reference: directives/12_organization_management_rules.md — DEP-004
//
// All fields are optional — PATCH applies only the supplied fields.
// status is included to support deactivation via PATCH (DEP-004: ACTIVE → INACTIVE).
// Reactivation (INACTIVE → ACTIVE) is not supported in Phase 1 per DEP-004,
// but the DTO accepts 'ACTIVE' to avoid service-layer responsibility for DTO constraints.
// DepartmentService is responsible for rejecting invalid state transitions.
//
// @IsIn() is used rather than @IsEnum() because department.status is a plain
// VarChar(50) in Prisma — no TypeScript enum exists for it.

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateDepartmentDto {
  @ApiPropertyOptional({ example: 'Human Resources' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ example: 'HR-001', description: 'Unique within tenant' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  code?: string;

  @ApiPropertyOptional({ example: 'Handles all HR functions and personnel administration' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: string;
}
