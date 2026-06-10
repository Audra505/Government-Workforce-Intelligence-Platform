// Reference: spec/01_requirements.md — FR-051 Department Management
// Reference: spec/06_api_contracts.md — Department response shape
//
// Fields excluded from all department responses (same convention as UserResponseDto):
//   tenantId    — implicit from auth context; clients derive tenant from their JWT
//   deletedAt   — soft-delete implementation detail; returned departments always have deletedAt = null
//   updatedAt   — not in spec/06 response contract

import { ApiProperty } from '@nestjs/swagger';

export class DepartmentResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'Human Resources' })
  name!: string;

  @ApiProperty({ example: 'HR-001' })
  code!: string;

  @ApiProperty({ nullable: true, example: 'Handles all HR functions and personnel administration' })
  description!: string | null;

  @ApiProperty({ example: 'ACTIVE', description: 'ACTIVE | INACTIVE' })
  status!: string;

  @ApiProperty({ example: '2026-06-10T12:00:00.000Z' })
  createdAt!: string;
}
