// Reference: GD-M13-2 Decision 5 — PATCH /api/v1/certifications/:id request contract
// Reference: directives/15_certification_management_rules.md — CRT-102
//
// All fields optional — partial update supported (CRT-102).
// If name is provided, it must not be empty.
// expirationRequired may be toggled; downstream assignment enforcement applies at Step 5.

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateCertificationDto {
  @ApiPropertyOptional({
    example: 'PMP — Project Management Professional',
    description: 'Updated certification name — must be unique within the tenant (CRT-003)',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Updated expiration requirement flag',
  })
  @IsOptional()
  @IsBoolean()
  expirationRequired?: boolean;

  @ApiPropertyOptional({
    example: 'PMI',
    description: 'Updated issuing organization',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  issuer?: string;
}
