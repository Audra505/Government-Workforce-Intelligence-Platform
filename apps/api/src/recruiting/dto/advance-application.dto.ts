// Reference: spec/06_api_contracts.md — PATCH /api/v1/applications/{id}/advance
// Reference: governance/GD-M17-1.md — Decision 10 (status transitions) and Decision 12 (AdvanceApplicationDto)
//
// targetStatus: required; drives sequential status machine (GD-M17-1 D10, Option B).
// Accepted: SCREENING, INTERVIEW, EVALUATION, OFFER.
// Not accepted:
//   APPLIED      — initial state, not a forward advancement target
//   HIRED        — unreachable in M17 (reserved M19); advance from OFFER → 422 APPLICATION_AWAITING_HIRE
//   REJECTED     — terminal; use POST /applications/{id}/reject
//   WITHDRAWN    — terminal; use POST /applications/{id}/withdraw
// tenantId: NOT a field — derived from JWT by controller (SEC-003).

import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty } from 'class-validator';

const ADVANCE_TARGET_VALUES = ['SCREENING', 'INTERVIEW', 'EVALUATION', 'OFFER'] as const;

export class AdvanceApplicationDto {
  @ApiProperty({
    example: 'SCREENING',
    enum: ADVANCE_TARGET_VALUES,
    description: 'Target status — SCREENING, INTERVIEW, EVALUATION, or OFFER. APPLIED/HIRED/REJECTED/WITHDRAWN are not valid targets.',
  })
  @IsNotEmpty()
  @IsIn(ADVANCE_TARGET_VALUES)
  targetStatus!: string;
}
