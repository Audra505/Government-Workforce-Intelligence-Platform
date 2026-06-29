// Reference: spec/06_api_contracts.md — Application response shape
// Reference: governance/GD-M17-1.md — Decision 12 (ApplicationResponseDto)
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (SEC-003 tenant isolation)
//
// Fields excluded from all application responses:
//   tenantId  — SEC-003: implicit from auth context; clients must not receive tenantId
//   deletedAt — soft-delete implementation detail

import { ApiProperty } from '@nestjs/swagger';

export class ApplicationResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  candidateId!: string;

  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  vacancyId!: string;

  @ApiProperty({
    example: 'APPLIED',
    description: 'APPLIED | SCREENING | INTERVIEW | EVALUATION | OFFER | HIRED | REJECTED | WITHDRAWN',
  })
  status!: string;

  @ApiProperty({ example: '2026-06-29T00:00:00.000Z' })
  submittedAt!: string;

  @ApiProperty({ nullable: true, example: 'Phone Screening' })
  currentStage!: string | null;

  @ApiProperty({ nullable: true, example: 'Passed phone screen' })
  notes!: string | null;

  @ApiProperty({ example: '2026-06-29T00:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-06-29T00:00:00.000Z' })
  updatedAt!: string;
}
