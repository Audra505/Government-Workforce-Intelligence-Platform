// Reference: spec/06_api_contracts.md — PUT /api/v1/offers/{id}
// Reference: governance/GD-M18-1.md — Decision 13 (UpdateOfferDto)
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (SEC-003 tenant isolation)
//
// All fields optional — PUT applies only supplied fields.
// Service enforces: update only permitted when offer.status = DRAFT (GD-M18-1 D7, D13).
//   Non-DRAFT → OFFER_NOT_IN_DRAFT; terminal → OFFER_IN_TERMINAL_STATE.
// tenantId: NOT a field — derived from JWT (SEC-003; GD-PRE-PHASE3-002 D1).
// status: NOT a field — not editable via PUT (GD-M18-1 D13).
// applicationId: NOT a field — immutable after creation (GD-M18-1 D13).

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOfferDto {
  @ApiPropertyOptional({
    example: '2026-08-15T00:00:00.000Z',
    description: 'ISO 8601 updated offer date',
  })
  @IsOptional()
  @IsISO8601()
  offerDate?: string;

  @ApiPropertyOptional({
    example: 'Updated to include relocation assistance.',
    description: 'Updated notes for this offer',
    maxLength: 5000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
