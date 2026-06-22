// Reference: governance/GD-M14-1.md — Decision 4 (withinDays behavioral contract; tenant isolation)
// Reference: governance/GD-M13-3.md — Decision 4 (expiration tracking query semantics)
// Reference: directives/15_certification_management_rules.md — CRT-400
//
// withinDays: caller-provided lookahead window in calendar days. Past-due ACTIVE
//   certifications (expirationDate < today) are included because they satisfy the
//   window condition and represent the highest-priority compliance risk (CRT-400).
//   Bounds and defaults are implementation choices; governance records behavioral
//   contract only (GD-M14-1 Decision 4).
// page / pageSize: standard pagination — follows list-employees-query.dto.ts convention.
// @Type(() => Number) required for query string coercion (class-transformer).

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListExpiringCertificationsQueryDto {
  @ApiPropertyOptional({
    description:
      'Return ACTIVE certifications expiring within this many calendar days from today. ' +
      'Includes past-due ACTIVE certifications (CRT-400).',
    default: 30,
    minimum: 1,
    maximum: 365,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  withinDays?: number = 30;

  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Results per page', default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
