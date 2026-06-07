import {
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { AuditEventType } from '../enums/audit-event-type.enum';

// Single authoritative export — all callers must import AuditResult from here.
// Literal union is intentional: result semantics are binary per AUD-100.
// Promote to enum only if a third architecturally distinct result state emerges.
export type AuditResult = 'SUCCESS' | 'FAILURE';

// Typed metadata contract for audit.audit_events.metadata (JSONB).
// Named fields reflect Phase 1 metadata strategy; index signature preserves JSONB flexibility.
// Promotion schedule: actorType and ipAddress → dedicated columns in Milestone 5;
// correlationId → dedicated column in Phase 2; userAgent → permanent metadata.
export interface AuditMetadata {
  actorType?: 'USER' | 'SYSTEM' | 'SCHEDULED_JOB';
  ipAddress?: string;
  correlationId?: string;
  userAgent?: string;
  // AUD-701: required fields for AI audit records
  aiModel?: string;
  aiPromptVersion?: string;
  aiConfidence?: number;
  [key: string]: unknown;
}

// Internal contract for AuditService.logEvent().
// Not exposed via HTTP — ValidationPipe does not process this DTO.
// Compile-time TypeScript enforcement is the primary safety mechanism.
// Decorators document constraints and support test-harness validation.
export class CreateAuditEventDto {
  @IsUUID()
  tenantId!: string;

  @IsUUID()
  userId!: string;

  @IsEnum(AuditEventType)
  action!: AuditEventType;

  @IsIn(['SUCCESS', 'FAILURE'])
  result!: AuditResult;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityType?: string;

  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsObject()
  metadata?: AuditMetadata;
}
