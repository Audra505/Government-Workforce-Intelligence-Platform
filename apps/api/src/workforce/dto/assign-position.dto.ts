// Reference: governance/GD-M15-1.md — Decision 5 (assign-position endpoint request contract)
//
// positionId is required in the request body (D5: "positionId is required in the request body").
//   UUID → initial assignment or reassignment (GD-M15-1 D5/D9)
//   null  → position clearance — PENDING_ONBOARDING employees only (GD-M15-1 D6)
//   absent (undefined) → HTTP 400 (positionId required)
//
// @ValidateIf trick: when positionId is null the UUID check is skipped (null is a valid clearance request).
// When positionId is undefined (field absent), @ValidateIf returns true (undefined !== null) and @IsUUID
// runs on undefined, failing validation → HTTP 400. No @IsOptional needed.

import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, ValidateIf } from 'class-validator';

export class AssignPositionDto {
  @ApiProperty({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description:
      'UUID of the position to assign or reassign (GD-M15-1 D5), or null to clear the current assignment ' +
      '(PENDING_ONBOARDING employees only — GD-M15-1 D6). Required field — absent positionId returns HTTP 400.',
    nullable: true,
  })
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  positionId!: string | null;
}
