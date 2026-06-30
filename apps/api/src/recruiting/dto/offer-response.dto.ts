// Reference: spec/06_api_contracts.md — Offer response shape
// Reference: governance/GD-M18-1.md — Decision 13 (OfferResponseDto)
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (SEC-003 tenant isolation)
//
// Fields excluded from all offer responses:
//   tenantId  — SEC-003: implicit from auth context; clients must not receive tenantId
//   deletedAt — soft-delete implementation detail; soft-deleted records appear as NOT_FOUND
//
// Note: acceptedAt and declinedAt are nullable — they are only set when the offer
//   reaches ACCEPTED or DECLINED status via POST /offers/:id/record-response.
//   accepted offer does NOT set application.status to HIRED (M19 scope; GD-M18-1 D9).

import { ApiProperty } from '@nestjs/swagger';

export class OfferResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  applicationId!: string;

  @ApiProperty({ example: 'DRAFT', description: 'DRAFT | PENDING_APPROVAL | APPROVED | SENT | ACCEPTED | DECLINED | WITHDRAWN' })
  status!: string;

  @ApiProperty({ nullable: true, example: '2026-08-01T00:00:00.000Z' })
  offerDate!: string | null;

  @ApiProperty({ nullable: true, example: '2026-08-15T14:30:00.000Z' })
  acceptedAt!: string | null;

  @ApiProperty({ nullable: true, example: null })
  declinedAt!: string | null;

  @ApiProperty({ nullable: true, example: 'Offer includes standard government benefits package.' })
  notes!: string | null;

  @ApiProperty({ example: '2026-07-30T09:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-08-15T14:30:00.000Z' })
  updatedAt!: string;
}
