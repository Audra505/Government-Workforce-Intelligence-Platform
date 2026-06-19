// Reference: spec/01_requirements.md — FR-111 Employee Lifecycle Management
// Reference: spec/06_api_contracts.md — POST /api/v1/employees/{id}/status
// Reference: directives/13_employee_management_rules.md — GD-M12-1, EMP-001 through EMP-006, EMP-004
//
// status: target employment status — one of TARGET_STATUS_VALUES.
//   PENDING_ONBOARDING excluded: no allowed transition targets it (GD-M12-1).
//   Excluding it from the DTO prevents callers from requesting an unreachable state.
// separationReason: valid context when status = 'SEPARATED'.
//   Values from EMP-004 (TERMINATION, RETIREMENT, RESIGNATION, TRANSFER_OUT).
//   Recorded in audit metadata only — not stored as a DB column.
//   Silently ignored when status !== 'SEPARATED'; no cross-field validation required at DTO level.

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

const TARGET_STATUS_VALUES = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'SEPARATED'];
const SEPARATION_REASON_VALUES = ['TERMINATION', 'RETIREMENT', 'RESIGNATION', 'TRANSFER_OUT'];

export class ChangeEmployeeStatusDto {
  @ApiProperty({
    example: 'ACTIVE',
    enum: TARGET_STATUS_VALUES,
    description:
      'Target employment status. PENDING_ONBOARDING excluded — no transition targets it (GD-M12-1).',
  })
  @IsIn(TARGET_STATUS_VALUES)
  status!: string;

  @ApiPropertyOptional({
    example: 'RETIREMENT',
    enum: SEPARATION_REASON_VALUES,
    description:
      'Required context when status = SEPARATED. Recorded in audit metadata only — not stored in DB (EMP-004).',
  })
  @IsOptional()
  @IsIn(SEPARATION_REASON_VALUES)
  separationReason?: string;
}
