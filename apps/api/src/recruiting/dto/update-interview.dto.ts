// Reference: spec/06_api_contracts.md — PUT /api/v1/interviews/{id}
// Reference: governance/GD-M18-1.md — Decision 13 (UpdateInterviewDto)
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (SEC-003 tenant isolation)
//
// All fields optional — PUT applies only supplied fields.
// Service enforces: update only permitted when interview.status = SCHEDULED (GD-M18-1 D13).
// tenantId: NOT a field — derived from JWT (SEC-003; GD-PRE-PHASE3-002 D1).
// status: NOT a field — not editable via PUT (GD-M18-1 D13).
// applicationId: NOT a field — immutable after creation (GD-M18-1 D13).
// interviewType: NOT a field — immutable after creation (GD-M18-1 D13).
// feedback: NOT a field — use POST /interviews/:id/feedback (GD-M18-1 D13).

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdateInterviewDto {
  @ApiPropertyOptional({
    example: '2026-07-15T14:00:00.000Z',
    description: 'ISO 8601 rescheduled datetime',
  })
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @ApiPropertyOptional({
    example: 'Jane Smith',
    description: 'Updated name of the interviewer',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  interviewerName?: string;

  @ApiPropertyOptional({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'Updated system user ID of the interviewer',
  })
  @IsOptional()
  @IsUUID()
  interviewerUserId?: string;
}
