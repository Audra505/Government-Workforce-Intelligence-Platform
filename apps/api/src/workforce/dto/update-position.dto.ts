// Reference: spec/01_requirements.md — FR-100 Position Management
// Reference: spec/06_api_contracts.md — PUT /api/v1/positions/:id
// Reference: directives/02_position_management_rules.md — POS-200 through POS-202
//
// All fields are optional — PUT applies only the supplied fields.
// Editable fields per POS-200: title, classification, salaryBand.
//
// status is included to support DRAFT→ACTIVE, ACTIVE→FROZEN, and FROZEN→ACTIVE
// transitions via PUT. CLOSED is intentionally excluded from this DTO — closure
// is performed exclusively via POST /positions/:id/close (Decision 2).
// PositionService enforces POS-202: CLOSED positions reject all updates.
//
// @IsIn() is used rather than @IsEnum() because position.status is a plain
// VarChar(50) in Prisma — no TypeScript enum exists for it.
//
// departmentId is intentionally excluded from PUT per POS-201:
// department changes require approval (approval workflow deferred to future milestone).

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePositionDto {
  @ApiPropertyOptional({ example: 'Senior HR Specialist' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ example: 'Professional' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  classification?: string;

  @ApiPropertyOptional({ example: 'P5' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  salaryBand?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'ACTIVE', 'FROZEN'], description: 'CLOSED transitions must use POST /positions/:id/close' })
  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE', 'FROZEN'])
  status?: string;
}
