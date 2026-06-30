// Reference: spec/06_api_contracts.md — Interview response shape
// Reference: governance/GD-M18-1.md — Decision 13 (InterviewResponseDto)
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (SEC-003 tenant isolation)
//
// Fields excluded from all interview responses:
//   tenantId  — SEC-003: implicit from auth context; clients must not receive tenantId
//   deletedAt — soft-delete implementation detail; soft-deleted records appear as NOT_FOUND

import { ApiProperty } from '@nestjs/swagger';

export class InterviewResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  applicationId!: string;

  @ApiProperty({ example: 'PHONE_SCREEN', description: 'PHONE_SCREEN | PANEL | TECHNICAL | FINAL' })
  interviewType!: string;

  @ApiProperty({ nullable: true, example: '2026-07-15T10:00:00.000Z' })
  scheduledAt!: string | null;

  @ApiProperty({ example: 'SCHEDULED', description: 'SCHEDULED | COMPLETED | CANCELLED | NO_SHOW' })
  status!: string;

  @ApiProperty({ nullable: true, example: 'Jane Smith' })
  interviewerName!: string | null;

  @ApiProperty({ nullable: true, example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  interviewerUserId!: string | null;

  @ApiProperty({ nullable: true, example: 'Strong technical skills demonstrated.' })
  feedback!: string | null;

  @ApiProperty({ example: '2026-07-15T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-15T10:00:00.000Z' })
  updatedAt!: string;
}
