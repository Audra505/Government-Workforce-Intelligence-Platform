// Reference: spec/01_requirements.md — FR-300 Candidate Intake
// Reference: spec/06_api_contracts.md — POST /api/v1/candidates
// Reference: governance/GD-M16-1.md — Decision 9 (DTO/validation scope)
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (SEC-003 tenant isolation)
//
// Required fields: firstName, lastName, email (GD-M16-1 D9).
// Optional fields: phone, source, notes.
// tenantId: NOT a field — derived from JWT by controller (SEC-003; GD-PRE-PHASE3-002 D1).
// status: NOT a field — set to ACTIVE by service at creation (GD-M16-1 D9; GD-PRE-PHASE3-002 D2).

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateCandidateDto {
  @ApiProperty({ example: 'Jane', description: 'Candidate first name', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Smith', description: 'Candidate last name', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({ example: 'jane.smith@agency.gov', description: 'Candidate email address — unique per tenant among active records', maxLength: 255 })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiPropertyOptional({ example: '202-555-0001', description: 'Candidate phone number', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ example: 'USAJOBS', description: 'How the candidate was sourced', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  source?: string;

  @ApiPropertyOptional({ example: 'Referred by department head', description: 'Internal notes about the candidate' })
  @IsOptional()
  @IsString()
  notes?: string;
}
