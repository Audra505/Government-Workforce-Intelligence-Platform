// Reference: spec/06_api_contracts.md — GET /api/v1/users query parameters
//
// pageSize maximum of 100 is a Phase 1 implementation decision — not a blueprint requirement.
// It prevents unbounded DB queries. Revisable without a specification change.
//
// @Type(() => Number) is required for @IsInt() to work on query parameters.
// The global ValidationPipe (transform: true) enables class-transformer, which @Type uses
// to coerce the incoming query string to a number before class-validator runs.
//
// @IsIn() is used for status rather than @IsEnum() because identity.users.status is a
// plain VarChar(50) in the Prisma schema — no TypeScript enum exists for it.
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListUsersQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1, description: 'Page number (1-based)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, description: 'Items per page (max 100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({ example: 'jane', description: 'Case-insensitive search on email, firstName, lastName' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ example: 'ACTIVE', enum: ['ACTIVE', 'INVITED', 'SUSPENDED', 'DEACTIVATED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INVITED', 'SUSPENDED', 'DEACTIVATED'])
  status?: string;
}
