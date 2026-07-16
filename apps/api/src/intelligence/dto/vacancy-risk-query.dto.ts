// Reference: governance/GD-M30-1.md — Decision 6 (pagination defaults and limits)
// Reference: governance/GD-M30-1.md — Decision 5 (eligible vacancy status values)
// Reference: spec/06_api_contracts.md — API validation strategy

import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class VacancyRiskQueryDto {
  @ApiPropertyOptional({
    description: 'Maximum vacancies to return, sorted by riskScore descending (default 10, max 50)',
    default: 10,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;

  @ApiPropertyOptional({
    description: 'Filter by vacancy status (omit to include both OPEN and IN_RECRUITMENT)',
    enum: ['OPEN', 'IN_RECRUITMENT'],
  })
  @IsOptional()
  @IsIn(['OPEN', 'IN_RECRUITMENT'])
  status?: string;
}
