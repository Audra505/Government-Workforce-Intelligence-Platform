// Reference: spec/06_api_contracts.md — POST /api/v1/offers
// Reference: governance/GD-M18-1.md — Decision 13 (CreateOfferDto)
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (SEC-003 tenant isolation)
//
// Required fields: applicationId (GD-M18-1 D13).
// Optional fields: offerDate, notes.
// Service-layer preconditions: application.status = 'OFFER' (GD-M18-1 D9);
//   no active offer for this application (GD-M18-1 D10).
// tenantId: NOT a field — derived from JWT by controller (SEC-003; GD-PRE-PHASE3-002 D1).
// status: NOT a field — always set to DRAFT by service (GD-M18-1 D13, D7).

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateOfferDto {
  @ApiProperty({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'ID of the application this offer belongs to (must be at OFFER status)',
  })
  @IsUUID()
  @IsNotEmpty()
  applicationId!: string;

  @ApiPropertyOptional({
    example: '2026-08-01T00:00:00.000Z',
    description: 'ISO 8601 offer date',
  })
  @IsOptional()
  @IsISO8601()
  offerDate?: string;

  @ApiPropertyOptional({
    example: 'Offer includes standard government benefits package.',
    description: 'Optional notes for this offer',
    maxLength: 5000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
