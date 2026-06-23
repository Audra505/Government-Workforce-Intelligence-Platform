// Reference: spec/01_requirements.md — FR-110 Employee Management
// Reference: spec/06_api_contracts.md — POST /api/v1/employees
// Reference: directives/13_employee_management_rules.md — EMP-200 through EMP-204, GD-M12-6
// Reference: governance/GD-M15-1.md — Decision 4 (appointmentAuthority required; positionId optional at creation)
//
// Required fields: employeeNumber, firstName, lastName, departmentId, appointmentAuthority (EMP-200; GD-M15-1 D4).
// Optional fields: email, hireDate, positionId (EMP-204; GD-M15-1 D4).
// employeeNumber: required at creation; immutable after creation (GD-M12-6/EMP-201).
// appointmentAuthority: required at creation; immutable after creation (GD-M15-1 D1/D8).
//   Valid values: LATERAL_TRANSFER, EMERGENCY_APPOINTMENT, SCHEDULE_A, SCHEDULE_C,
//   REINSTATEMENT, SENIOR_EXECUTIVE, ADMINISTRATIVE. COMPETITIVE_APPOINTMENT is system-only.
//   Business-rule validation (valid values, COMPETITIVE_APPOINTMENT rejection) is service-layer.
// positionId: optional at creation; if provided, position must be ACTIVE and unoccupied (GD-M15-1 D4).
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

  // @IsOptional() here is intentional: missing field passes DTO validation so the
  // service can return HTTP 422 APPOINTMENT_AUTHORITY_REQUIRED per GD-M15-1 D4.
  // An empty string still fails @IsNotEmpty() → HTTP 400. Only a fully absent
  // field reaches the service guard (undefined).
  @ApiProperty({
    example: 'ADMINISTRATIVE',
    description:
      'Appointment authority for this employee (GD-M15-1 D1; GD-PRE-M13-001). ' +
      'Required at creation. Immutable after creation (GD-M15-1 D8). ' +
      'Valid values: LATERAL_TRANSFER, EMERGENCY_APPOINTMENT, SCHEDULE_A, SCHEDULE_C, ' +
      'REINSTATEMENT, SENIOR_EXECUTIVE, ADMINISTRATIVE. ' +
      'COMPETITIVE_APPOINTMENT is reserved for system use and is rejected via API.',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  appointmentAuthority?: string;

  @ApiPropertyOptional({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description:
      'Initial position assignment at creation time (GD-M15-1 D4; GD-PRE-M13-002). ' +
      'If provided: position must exist in this tenant, be ACTIVE, and have no current incumbent. ' +
      'Emits WORKFORCE_EMPLOYEE_POSITION_ASSIGNED audit event on success (GD-M15-1 D9).',
  })
  @IsOptional()
  @IsUUID()
  positionId?: string;
}
