// Reference: governance/GD-M13-2.md — Decision 6 (request contract)
// Reference: directives/14_skill_management_rules.md — SKL-201, SKL-210, SKL-211

import { IsIn, IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class AssignSkillDto {
  // Required: UUID v4 referencing a skill in the actor's tenant.
  // Cross-tenant or absent skill returns HTTP 422 SKILL_NOT_FOUND (service layer, not here).
  @IsUUID('4')
  skillId!: string;

  // Optional: OPM 5-level proficiency scale (SKL-210).
  // Invalid value → HTTP 422, INVALID_PROFICIENCY_LEVEL (service layer).
  // Omitted → stored as NULL (proficiency not assessed at assignment time).
  @IsOptional()
  @IsIn(['BEGINNER', 'DEVELOPING', 'PROFICIENT', 'ADVANCED', 'EXPERT'])
  proficiencyLevel?: string;

  // Optional: ISO 8601 datetime string (SKL-211).
  // SA and HR Director only — non-authorized roles have this silently dropped in the controller.
  // Omitted → stored as NULL (self-declared, unverified).
  // Controller converts to Date before passing to service.
  @IsOptional()
  @IsISO8601()
  verifiedAt?: string;
}
