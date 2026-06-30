// Reference: spec/06_api_contracts.md — POST /api/v1/interviews/{id}/feedback
// Reference: governance/GD-M18-1.md — Decision 13 (InterviewFeedbackDto)
//
// feedback: required; the structured feedback text for the interview.
// Max length 10000: GD-M18-1 D13 does not define an explicit character limit;
//   10000 chars is applied as a platform safety guard (DB column is TEXT with no limit).

import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class InterviewFeedbackDto {
  @ApiProperty({
    example: 'Strong communication skills. Technical knowledge meets role requirements.',
    description: 'Structured feedback text for this interview',
    maxLength: 10000,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(10000)
  feedback!: string;
}
