// Reference: GD-M13-2 Decision 4 — PATCH /api/v1/skills/:id request contract
// Reference: directives/14_skill_management_rules.md — SKL-102
//
// All fields optional — partial update supported.
// If name is provided, it must not be empty (IsNotEmpty with IsOptional: skip if absent, reject if empty string).
// PATCH with empty body is valid — updatedAt bumps, WORKFORCE_SKILL_UPDATED audit event emitted.

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateSkillDto {
  @ApiPropertyOptional({
    example: 'Python 3 Programming',
    description: 'Updated skill name — must be unique within the tenant (SKL-003)',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    example: 'Software Development',
    description: 'Updated skill category',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({
    example: 'Updated description of the skill.',
    description: 'Updated skill description',
  })
  @IsOptional()
  @IsString()
  description?: string;
}
