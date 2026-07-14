// Reference: governance/GD-M27-1.md — Decision 3 (Updatable Fields Policy)
// Reference: spec/06_api_contracts.md — PATCH /api/v1/users/:id
//
// All fields are optional — PATCH semantics (partial update).
// At least one meaningful field must be present; this is enforced at the
// service layer (not here) so the service remains transport-agnostic.
//
// status is restricted to the three operator-settable values (GD-M27-1 D3).
// INVITED is intentionally excluded — its lifecycle is managed by NotificationModule (not built).
//
// roleIds: [] (empty array) is blocked by @ArrayMinSize(1) — not a no-op.
// roleIds omitted (undefined) means "do not change role assignments".

import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const UPDATABLE_STATUSES = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Jane' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Smith' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  lastName?: string;

  @ApiPropertyOptional({ example: 'jane.smith@agency.gov' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: 'SUSPENDED',
    enum: UPDATABLE_STATUSES,
    description: 'INVITED is not an operator-settable status. Transitions are validated at the service layer.',
  })
  @IsOptional()
  @IsString()
  @IsIn(UPDATABLE_STATUSES)
  status?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['<role-uuid>'],
    description: 'Replaces the complete role set. Must contain at least one element if provided.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  roleIds?: string[];
}
