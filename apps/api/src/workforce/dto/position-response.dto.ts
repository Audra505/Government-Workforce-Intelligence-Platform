// Reference: spec/01_requirements.md — FR-100 Position Management
// Reference: spec/06_api_contracts.md — Position response shape
//
// Fields excluded from all position responses:
//   tenantId    — implicit from auth context; clients derive tenant from their JWT
//   deletedAt   — soft-delete implementation detail; returned positions always have deletedAt = null
//   updatedAt   — not in spec/06 response contract
//
// departmentId is included so clients can navigate to the owning department.
// classification and salaryBand are nullable — optional at creation time (POS-103, POS-104).
// createdAt serialized as ISO 8601 string (Date → string in controller toDtoShape()).

import { ApiProperty } from '@nestjs/swagger';

export class PositionResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: 'Owning department UUID' })
  departmentId!: string;

  @ApiProperty({ example: 'HR Specialist' })
  title!: string;

  @ApiProperty({ nullable: true, example: 'Professional' })
  classification!: string | null;

  @ApiProperty({ nullable: true, example: 'P4' })
  salaryBand!: string | null;

  @ApiProperty({ example: 'DRAFT', description: 'DRAFT | ACTIVE | FROZEN | CLOSED' })
  status!: string;

  @ApiProperty({ example: '2026-06-10T12:00:00.000Z' })
  createdAt!: string;
}
