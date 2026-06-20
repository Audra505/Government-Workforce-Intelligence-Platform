// Reference: spec/01_requirements.md — FR-114, FR-151 Certifications Management
// Reference: GD-M13-2 Decision 5 — POST /api/v1/certifications request contract
// Reference: directives/15_certification_management_rules.md — CRT-101
//
// Required: name (string, max 255), expirationRequired (boolean).
// Optional: issuer (string, max 255).
// tenantId: NOT a field — derived from JWT context by controller (SEC-003, GD-M13-1 Decision 3).
//
// CRT-101: expirationRequired is REQUIRED on create.
// When true, all employee assignments for this certification type must provide expirationDate
// (enforced at assignment time in Step 5 — not enforced here).

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateCertificationDto {
  @ApiProperty({
    example: 'Project Management Professional (PMP)',
    description: 'Certification name — must be unique within the tenant (GD-M13-2 Decision 9, CRT-003)',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({
    example: true,
    description: 'Whether employee assignments for this certification must include an expiration date (CRT-101, CRT-204)',
  })
  @IsBoolean()
  expirationRequired!: boolean;

  @ApiPropertyOptional({
    example: 'Project Management Institute',
    description: 'Issuing organization for the certification',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  issuer?: string;
}
