// Reference: spec/06_api_contracts.md — Vacancy response shape
// Reference: directives/03_vacancy_management_rules.md — VAC-601, VAC-701, VAC-702
//
// No class-validator decorators — response DTOs are not validated by the pipe.
// The controller maps VacancyRecord → VacancyResponseDto via toResponseDto():
//   Date fields → ISO 8601 strings via .toISOString()
//   null Date fields → null
//
// Fields excluded from response:
//   tenantId   — implicit from auth context; consistent with PositionResponseDto (SEC-003)
//   deletedAt  — soft-delete detail; returned records always have deletedAt = null
//
// filledAt: NOT NULL = filled closure; NULL = cancelled closure or vacancy not yet closed.
//   This is the authoritative discriminator for Time To Fill reporting.
// agingStatus: computed by VacancyService per VAC-701 (WARNING ≥30d) / VAC-702 (HIGH_RISK ≥90d).
// requiresReview: true when priority='CRITICAL' AND status='OPEN' per VAC-601.

import { ApiProperty } from '@nestjs/swagger';

export class VacancyResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  positionId!: string;

  @ApiProperty({ example: 'HR Specialist' })
  positionTitle!: string;

  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  departmentId!: string;

  @ApiProperty({ example: 'Human Resources' })
  departmentName!: string;

  @ApiProperty({
    nullable: true,
    example: 'HIGH',
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
  })
  priority!: string | null;

  @ApiProperty({ nullable: true, example: 'RETIREMENT' })
  reason!: string | null;

  @ApiProperty({ example: 'DRAFT', description: 'DRAFT | OPEN | IN_RECRUITMENT | CLOSED' })
  status!: string;

  @ApiProperty({ nullable: true, example: '2027-06-01T00:00:00.000Z' })
  expectedFillDate!: string | null;

  @ApiProperty({
    nullable: true,
    example: '2027-05-15T10:30:00.000Z',
    description: 'NOT NULL = filled closure; NULL = cancelled closure or vacancy not yet closed',
  })
  filledAt!: string | null;

  @ApiProperty({ example: '2026-06-17T00:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-06-17T12:00:00.000Z' })
  updatedAt!: string;

  @ApiProperty({ example: 5, description: 'Days since vacancy was created' })
  ageInDays!: number;

  @ApiProperty({
    example: 'OK',
    enum: ['OK', 'WARNING', 'HIGH_RISK'],
    description: 'OK < 30d; WARNING 30–89d (VAC-701); HIGH_RISK ≥90d (VAC-702)',
  })
  agingStatus!: string;

  @ApiProperty({
    example: false,
    description: 'true when priority=CRITICAL and status=OPEN — requires HR Director review (VAC-601)',
  })
  requiresReview!: boolean;
}
