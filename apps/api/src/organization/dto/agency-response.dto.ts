// Reference: spec/01_requirements.md — FR-050 Agency Management
// Reference: spec/06_api_contracts.md — GET /api/v1/agencies/current
// Reference: directives/12_organization_management_rules.md — AGY-003
//
// Fields returned per AGY-003: name, code, status, createdAt.
// id is intentionally excluded — AGY-003 prohibits exposing internal identifiers.
// Agency data is read-only in Phase 1 (AGY-001). No create or update response shape exists.

import { ApiProperty } from '@nestjs/swagger';

export class AgencyResponseDto {
  @ApiProperty({ example: 'Department of Labor' })
  name!: string;

  @ApiProperty({ example: 'DOL', description: 'Unique agency code' })
  code!: string;

  @ApiProperty({ example: 'ACTIVE', description: 'ACTIVE | INACTIVE' })
  status!: string;

  @ApiProperty({ example: '2026-01-15T08:00:00.000Z' })
  createdAt!: string;
}
