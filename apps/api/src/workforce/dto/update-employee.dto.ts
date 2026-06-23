// Reference: spec/01_requirements.md — FR-110 Employee Management
// Reference: spec/06_api_contracts.md — PUT /api/v1/employees/{id}
// Reference: directives/13_employee_management_rules.md — EMP-300 through EMP-304, GD-M12-6
// Reference: governance/GD-M15-1.md — Decision 8 (appointmentAuthority immutable after creation)
//
// Updatable fields: firstName, lastName, email, departmentId, hireDate (EMP-300).
// employeeNumber: accepted by DTO to enable service-layer immutability enforcement (GD-M12-6/EMP-304).
//   EmployeeService rejects any update that includes employeeNumber → HTTP 422 EMPLOYEE_NUMBER_IMMUTABLE.
//   @IsOptional() only — no format validation, because the value is never used; only presence is checked.
// appointmentAuthority: accepted by DTO to enable service-layer immutability enforcement (GD-M15-1 D8).
//   EmployeeService rejects any update that includes appointmentAuthority → HTTP 422 APPOINTMENT_AUTHORITY_IMMUTABLE.
//   @IsOptional() only — same pattern as employeeNumber.
// positionId: NOT updatable via this endpoint — use POST /employees/{id}/assign-position (GD-M15-1 D5).
// employmentStatus: NOT updatable via this endpoint — use POST /employees/{id}/status (EMP-301).
// tenantId: NOT a field — derived from JWT context by controller (SEC-003).

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class UpdateEmployeeDto {
  @ApiPropertyOptional({
    example: 'Jane',
    description: 'Employee first name',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({
    example: 'Smith',
    description: 'Employee last name',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName?: string;

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
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'Department this employee belongs to',
  })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({
    example: '2026-01-15',
    description: 'Employee hire date — ISO 8601 date string',
  })
  @IsOptional()
  @IsDateString()
  hireDate?: string;

  @ApiPropertyOptional({
    description:
      'Immutable after creation — sending this field returns HTTP 422 EMPLOYEE_NUMBER_IMMUTABLE (GD-M12-6/EMP-304)',
  })
  @IsOptional()
  employeeNumber?: string;

  @ApiPropertyOptional({
    description:
      'Immutable after creation — sending this field returns HTTP 422 APPOINTMENT_AUTHORITY_IMMUTABLE (GD-M15-1 D8)',
  })
  @IsOptional()
  appointmentAuthority?: string;
}
