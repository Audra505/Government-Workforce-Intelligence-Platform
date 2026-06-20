// Reference: spec/01_requirements.md — FR-113, FR-150 Skills Management
// Reference: GD-M13-2 Decision 4 — POST /api/v1/skills request contract
// Reference: directives/14_skill_management_rules.md — SKL-101
//
// Required: name (string, max 255).
// Optional: category (string, max 100), description (string, text).
// tenantId: NOT a field — derived from JWT context by controller (SEC-003, GD-M13-1 Decision 3).

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateSkillDto {
  @ApiProperty({
    example: 'Python Programming',
    description: 'Skill name — must be unique within the tenant (GD-M13-2 Decision 8, SKL-003)',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({
    example: 'Programming Languages',
    description: 'Skill category for grouping and filtering',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({
    example: 'Proficiency in Python 3.x including data structures, OOP, and async patterns.',
    description: 'Optional extended description of the skill',
  })
  @IsOptional()
  @IsString()
  description?: string;
}
