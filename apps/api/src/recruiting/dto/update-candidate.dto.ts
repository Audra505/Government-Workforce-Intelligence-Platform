// Reference: spec/06_api_contracts.md — PUT /api/v1/candidates/{id}
// Reference: governance/GD-M16-1.md — Decision 9 (UpdateCandidateDto — all create fields optional)
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (SEC-003 tenant isolation)
//
// All fields are optional — PUT applies only the supplied fields.
// tenantId: NOT a field — derived from JWT by controller (SEC-003; GD-PRE-PHASE3-002 D1).
// status: NOT a field — the only valid transition (ACTIVE → ARCHIVED) is performed exclusively
//   via POST /candidates/:id/archive. No update endpoint may set status directly.

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateCandidateDto {
  @ApiPropertyOptional({ example: 'Jane', maxLength: 100 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Smith', maxLength: 100 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ example: 'jane.smith@agency.gov', maxLength: 255 })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ example: '202-555-0001', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ example: 'USAJOBS', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  source?: string;

  @ApiPropertyOptional({ example: 'Referred by department head' })
  @IsOptional()
  @IsString()
  notes?: string;
}
