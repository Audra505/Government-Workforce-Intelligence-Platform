// Reference: spec/06_api_contracts.md — POST /api/v1/interviews
// Reference: governance/GD-M18-1.md — Decision 13 (CreateInterviewDto)
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (SEC-003 tenant isolation)
//
// Required fields: applicationId, interviewType (GD-M18-1 D13).
// Optional fields: scheduledAt, interviewerName, interviewerUserId.
// Service-layer rule: at least one of interviewerName or interviewerUserId must be
//   present — enforced at service layer, not DTO layer (GD-M18-1 D13 INTERVIEWER_REQUIRED).
// tenantId: NOT a field — derived from JWT by controller (SEC-003; GD-PRE-PHASE3-002 D1).
// status: NOT a field — always set to SCHEDULED by service (GD-M18-1 D13).
// feedback: NOT a field — use POST /interviews/:id/feedback (GD-M18-1 D13).

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const INTERVIEW_TYPE_VALUES = ['PHONE_SCREEN', 'PANEL', 'TECHNICAL', 'FINAL'] as const;

export class CreateInterviewDto {
  @ApiProperty({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'ID of the application this interview belongs to',
  })
  @IsUUID()
  @IsNotEmpty()
  applicationId!: string;

  @ApiProperty({
    example: 'PHONE_SCREEN',
    enum: INTERVIEW_TYPE_VALUES,
    description: 'Interview type — PHONE_SCREEN, PANEL, TECHNICAL, or FINAL',
  })
  @IsNotEmpty()
  @IsIn(INTERVIEW_TYPE_VALUES)
  interviewType!: string;

  @ApiPropertyOptional({
    example: '2026-07-15T10:00:00.000Z',
    description: 'ISO 8601 scheduled datetime',
  })
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @ApiPropertyOptional({
    example: 'Jane Smith',
    description: 'Name of the interviewer (required when interviewerUserId is absent)',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  interviewerName?: string;

  @ApiPropertyOptional({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'System user ID of the interviewer (required when interviewerName is absent)',
  })
  @IsOptional()
  @IsUUID()
  interviewerUserId?: string;
}
