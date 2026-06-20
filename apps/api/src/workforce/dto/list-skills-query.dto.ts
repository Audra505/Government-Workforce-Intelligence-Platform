// Reference: GD-M13-2 Decision 2 — list skills (tenant-scoped, paginated)
// Reference: directives/14_skill_management_rules.md — SKL-100
//
// page default 1, pageSize default 20, max 100.
// category: optional filter (implementation choice — derivable from data model, within governance scope).
// @Type(() => Number) required for query string coercion (class-transformer).

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ListSkillsQueryDto {
  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Results per page', default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({ description: 'Filter by category', example: 'Programming Languages' })
  @IsOptional()
  @IsString()
  category?: string;
}
