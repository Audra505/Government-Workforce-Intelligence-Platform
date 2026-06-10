// Reference: spec/01_requirements.md — FR-051 Department Management
// Reference: spec/06_api_contracts.md — POST /api/v1/departments
// Reference: directives/12_organization_management_rules.md — DEP-001, DEP-002, DEP-007
//
// description is optional per DEP-007.
// code is required and must be unique within the tenant (DEP-002).
// Code uniqueness is enforced at the DB level (@@unique([tenantId, code])) and mapped
// to CODE_CONFLICT in DepartmentService.

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDepartmentDto {
  @ApiProperty({ example: 'Human Resources' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ example: 'HR-001', description: 'Unique within tenant' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  code!: string;

  @ApiPropertyOptional({ example: 'Handles all HR functions and personnel administration' })
  @IsOptional()
  @IsString()
  description?: string;
}
