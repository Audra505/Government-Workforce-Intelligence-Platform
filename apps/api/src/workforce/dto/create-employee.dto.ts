// Reference: spec/01_requirements.md — FR-110 Employee Management
// Reference: spec/06_api_contracts.md — POST /api/v1/employees
// Reference: directives/13_employee_management_rules.md — EMP-200 through EMP-204, GD-M12-6
//
// Required fields: employeeNumber, firstName, lastName, departmentId (EMP-200).
// Optional fields: email, hireDate (EMP-204).
// employeeNumber: required at creation; immutable after creation (GD-M12-6/EMP-201).
// employmentStatus: NOT a field — all employees created with PENDING_ONBOARDING by service (GD-M12-1).
// tenantId: NOT a field — derived from JWT context by controller (SEC-003).

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateEmployeeDto {
  @ApiProperty({
    example: 'EMP-001',
    description:
      'Employee number — required at creation, immutable after creation (GD-M12-6). Must be unique within the tenant.',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  employeeNumber!: string;

  @ApiProperty({
    example: 'Jane',
    description: 'Employee first name',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({
    example: 'Smith',
    description: 'Employee last name',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'Department this employee belongs to',
  })
  @IsUUID()
  departmentId!: string;

  @ApiPropertyOptional({
    example: 'jane.smith@agency.gov',
    description: 'Employee work email address',
    maxLength: 255,
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({
    example: '2026-01-15',
    description: 'Employee hire date — ISO 8601 date string',
  })
  @IsOptional()
  @IsDateString()
  hireDate?: string;
}
