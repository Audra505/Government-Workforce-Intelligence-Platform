// Reference: spec/06_api_contracts.md — POST /api/v1/vacancies/{id}/close
// Reference: directives/03_vacancy_management_rules.md — VAC-500, VAC-402, VAC-502
//
// closureType drives the service closure path (VacancyService.closeVacancy()):
//   FILLED   → filledAt set to now; WORKFORCE_VACANCY_FILLED emitted; then VACANCY_CLOSED
//   CANCELLED → filledAt remains null; WORKFORCE_VACANCY_CANCELLED emitted; then VACANCY_CLOSED
// Both paths result in status='CLOSED' in the database.
// FILLED and CANCELLED are NOT stored in the status column — they are closure type discriminators.
// VAC-602: CANCELLED requires Manager Approval — enforced by RBAC guard at controller level
//   (Step 5), not in this DTO.
// Source state validation (FILLED requires OPEN or IN_RECRUITMENT; CANCELLED rejects CLOSED)
//   is enforced by VacancyService — not by this DTO.

import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class CloseVacancyDto {
  @ApiProperty({
    enum: ['FILLED', 'CANCELLED'],
    example: 'FILLED',
    description:
      'FILLED: candidate hired — sets filledAt (VAC-402). ' +
      'CANCELLED: vacancy withdrawn (VAC-500). Both result in status=CLOSED.',
  })
  @IsIn(['FILLED', 'CANCELLED'])
  closureType!: string;
}
