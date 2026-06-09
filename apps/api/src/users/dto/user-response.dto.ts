// Reference: spec/06_api_contracts.md — GET /api/v1/users, GET /api/v1/users/:id, POST /api/v1/users
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
//
// Fields excluded from all user responses:
//   passwordHash     — never exposed under any circumstance
//   tenantId         — implicit from auth context; matches GET /auth/me precedent (Milestone 5)
//   failedLoginAttempts — internal auth state
//   lockedUntil      — internal auth state
//   deletedAt        — soft-delete implementation detail; listed users always have deletedAt = null
//   updatedAt        — not in spec/06 contract
import { ApiProperty } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'Jane' })
  firstName!: string;

  @ApiProperty({ example: 'Smith' })
  lastName!: string;

  @ApiProperty({ example: 'jane.smith@agency.gov' })
  email!: string;

  @ApiProperty({ example: 'ACTIVE', description: 'ACTIVE | INVITED | SUSPENDED | DEACTIVATED' })
  status!: string;

  @ApiProperty({ type: [String], example: ['HR Director'] })
  roles!: string[];

  @ApiProperty({ example: '2026-06-09T15:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ nullable: true, example: null })
  lastLoginAt!: string | null;
}
