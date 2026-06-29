// Reference: spec/01_requirements.md — FR-301 Application Submission
// Reference: spec/06_api_contracts.md — POST /api/v1/applications
// Reference: governance/GD-M17-1.md — Decision 12 (DTO scope)
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (SEC-003 tenant isolation)
//
// Required fields: candidateId, vacancyId (GD-M17-1 D12).
// Optional fields: notes, currentStage.
// tenantId: NOT a field — derived from JWT by controller (SEC-003; GD-PRE-PHASE3-002 D1).
// status: NOT a field — set to APPLIED by service at creation (GD-M17-1 D12; GD-PRE-PHASE3-002 D2).

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateApplicationDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6', description: 'ID of the candidate applying' })
  @IsUUID()
  @IsNotEmpty()
  candidateId!: string;

  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6', description: 'ID of the vacancy being applied to' })
  @IsUUID()
  @IsNotEmpty()
  vacancyId!: string;

  @ApiPropertyOptional({ example: 'Referred by department head', description: 'Internal notes on the application', maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional({ example: 'Phone Screening', description: 'Current stage label', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  currentStage?: string;
}
