// Reference: spec/01_requirements.md — FR-100 Position Management
// Reference: spec/06_api_contracts.md — POST /api/v1/positions
// Reference: directives/02_position_management_rules.md — POS-100 through POS-104
//
// Required fields: title, departmentId (POS-100).
// title max 200 characters per POS-101.
// departmentId must reference an existing department within the tenant (POS-102).
//   Existence validation is performed in PositionService via Prisma-direct query
//   (Decision 4: no DepartmentService dependency).
// classification and salaryBand are optional at DTO level (POS-103, POS-104 require
//   them for approved positions; service enforces any lifecycle-gated rules).
// description field is explicitly excluded per approved Milestone 8 scope
//   (not present in spec/05_database_schema.md).

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreatePositionDto {
  @ApiProperty({ example: 'HR Specialist', description: 'Position title (max 200 characters)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6', description: 'Department this position belongs to (POS-001, POS-102)' })
  @IsUUID()
  departmentId!: string;

  @ApiPropertyOptional({ example: 'Professional', description: 'Position classification (e.g. Professional, Administrative, Technical)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  classification?: string;

  @ApiPropertyOptional({ example: 'P4', description: 'Salary band identifier' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  salaryBand?: string;
}
