// Reference: governance/GD-M39-1.md — Decision 17 (Audit-Read API Design)
//
// pageSize maximum of 100 mirrors the existing ListUsersQueryDto convention
// (GD-M39-1 Decision 17's explicit requirement). Cursor pagination on
// (createdAt, id) — see AuditEventsService for the opaque cursor's encoding.
// caseId is a convenience filter that expands server-side into the
// Decision 19 ApprovalRequest.decisionCaseId traversal. search is bounded
// to action/entityType/result matching only — it never inspects metadata.

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { AuditEventType } from '../enums/audit-event-type.enum';

export class ListAuditEventsQueryDto {
  @ApiPropertyOptional({ example: 20, default: 20, description: 'Items per page (max 100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({ description: 'Opaque cursor from a previous page\'s nextCursor' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;

  @ApiPropertyOptional({ description: 'occurredAt lower bound (inclusive), ISO-8601' })
  @IsOptional()
  @IsDateString()
  occurredAtFrom?: string;

  @ApiPropertyOptional({ description: 'occurredAt upper bound (inclusive), ISO-8601' })
  @IsOptional()
  @IsDateString()
  occurredAtTo?: string;

  @ApiPropertyOptional({ description: 'Actor user id (UUID v4)' })
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @ApiPropertyOptional({ enum: AuditEventType })
  @IsOptional()
  @IsEnum(AuditEventType)
  action?: AuditEventType;

  @ApiPropertyOptional({ enum: ['SUCCESS', 'FAILURE'] })
  @IsOptional()
  @IsIn(['SUCCESS', 'FAILURE'])
  result?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityType?: string;

  @ApiPropertyOptional({ description: 'Entity id (UUID v4)' })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({ description: 'DecisionCase id — expands to the Decision 19 correlation traversal' })
  @IsOptional()
  @IsUUID()
  caseId?: string;

  @ApiPropertyOptional({ description: 'Bounded search over action/entityType/result only — never metadata' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
