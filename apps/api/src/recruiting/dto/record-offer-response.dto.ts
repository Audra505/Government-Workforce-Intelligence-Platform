// Reference: spec/06_api_contracts.md — POST /api/v1/offers/{id}/record-response
// Reference: governance/GD-M18-1.md — Decision 13 (RecordOfferResponseDto)
//
// response: required; one of ACCEPTED or DECLINED (GD-M18-1 D13, D7).
// Service precondition: offer.status = SENT — enforced at service layer.
// ACCEPTED: sets offer.status = ACCEPTED and offer.accepted_at = now().
// DECLINED: sets offer.status = DECLINED and offer.declined_at = now().
// Neither transition changes application.status (GD-M18-1 D9).
// Employee record creation on ACCEPTED is M19 scope — NOT implemented here (GD-M18-1 D3).

import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty } from 'class-validator';

const OFFER_RESPONSE_VALUES = ['ACCEPTED', 'DECLINED'] as const;

export class RecordOfferResponseDto {
  @ApiProperty({
    example: 'ACCEPTED',
    enum: OFFER_RESPONSE_VALUES,
    description: 'Candidate response — ACCEPTED or DECLINED',
  })
  @IsNotEmpty()
  @IsIn(OFFER_RESPONSE_VALUES)
  response!: string;
}
