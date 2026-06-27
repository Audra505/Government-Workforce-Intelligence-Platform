// Reference: spec/06_api_contracts.md — Candidate response shape
// Reference: governance/GD-M16-1.md — Decision 9 (CandidateResponseDto)
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (SEC-003 tenant isolation)
//
// Fields excluded from all candidate responses:
//   tenantId  — SEC-003: implicit from auth context; clients must not receive tenantId
//   deletedAt — soft-delete implementation detail; archived candidates return NOT_FOUND

import { ApiProperty } from '@nestjs/swagger';

export class CandidateResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'Jane' })
  firstName!: string;

  @ApiProperty({ example: 'Smith' })
  lastName!: string;

  @ApiProperty({ example: 'jane.smith@agency.gov' })
  email!: string;

  @ApiProperty({ nullable: true, example: '202-555-0001' })
  phone!: string | null;

  @ApiProperty({ example: 'ACTIVE', description: 'ACTIVE | ARCHIVED' })
  status!: string;

  @ApiProperty({ nullable: true, example: 'USAJOBS' })
  source!: string | null;

  @ApiProperty({ nullable: true, example: 'Referred by department head' })
  notes!: string | null;

  @ApiProperty({ example: '2026-06-27T00:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-06-27T00:00:00.000Z' })
  updatedAt!: string;
}
