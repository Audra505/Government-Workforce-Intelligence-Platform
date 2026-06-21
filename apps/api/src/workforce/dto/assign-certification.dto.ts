// Reference: governance/GD-M13-2.md — Decision 7 (request contract)
// Reference: governance/GD-M13-3.md — Decision 1 (canonical status values), Decision 7 (initial status constraint)
// Reference: directives/15_certification_management_rules.md — CRT-201, CRT-204, CRT-206, CRT-207

import { IsIn, IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class AssignCertificationDto {
  // Required: UUID v4 referencing a certification in the actor's tenant.
  // Cross-tenant, absent, or soft-deleted → HTTP 422 CERTIFICATION_NOT_FOUND (service layer).
  @IsUUID('4')
  certificationId!: string;

  // Optional: canonical status value (GD-M13-3 D1).
  // Absent → service defaults to ACTIVE (GD-M13-3 D2).
  // On INSERT: only ACTIVE accepted (CRT-207/GD-M13-3 D7); EXPIRED or REVOKED → HTTP 422 INVALID_STATUS_TRANSITION.
  // Invalid value → HTTP 400 validation error (class-validator rejects at DTO layer).
  @IsOptional()
  @IsIn(['ACTIVE', 'EXPIRED', 'REVOKED'])
  status?: string;

  // Optional: ISO 8601 date string (date portion only; CRT-204).
  // Controller converts to Date before passing to service.
  // Stored as @db.Date — time portion is discarded.
  @IsOptional()
  @IsISO8601()
  issueDate?: string;

  // Optional: ISO 8601 date string.
  // Required on INSERT when certification.expirationRequired = true (CRT-204 amended).
  // On UPDATE: effective-null check determines enforcement (CRT-204 amended).
  @IsOptional()
  @IsISO8601()
  expirationDate?: string;
}
