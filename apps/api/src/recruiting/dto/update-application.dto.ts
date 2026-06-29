// Reference: spec/06_api_contracts.md — PUT /api/v1/applications/{id}
// Reference: governance/GD-M17-1.md — Decision 12 (UpdateApplicationDto)
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (SEC-003 tenant isolation)
//
// All fields optional — PUT applies only supplied fields.
// tenantId: NOT a field — derived from JWT by controller (SEC-003; GD-PRE-PHASE3-002 D1).
// status: NOT a field — transitions handled by dedicated endpoints (advance/reject/withdraw).
// candidateId: NOT editable — immutable after creation (GD-M17-1 D12).
// vacancyId: NOT editable — immutable after creation (GD-M17-1 D12).

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateApplicationDto {
  @ApiPropertyOptional({ example: 'Passed phone screen', maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional({ example: 'Phone Screening', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  currentStage?: string;
}
