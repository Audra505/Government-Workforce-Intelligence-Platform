// Reference: spec/01_requirements.md — FR-113, FR-150 Skills Management
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/14_skill_management_rules.md — SKL-001 through SKL-400
// Reference: governance/GD-M13-1.md — per-tenant skills catalog
// Reference: governance/GD-M13-2.md — API design decisions (Decisions 2, 4, 8)
// Reference: governance/GD-M13-4.md — audit event requirements (Decision 4)
//
// SkillService is transport-agnostic: no HTTP exceptions, no HTTP responses.
// HTTP status mapping is the sole responsibility of SkillController.
//
// SEC-003 enforcement (GD-M13-1 Decision 3):
//   - tenantId is never derived from DTOs; always passed in from the caller's JWT context.
//   - All read queries include WHERE tenantId = ? AND deletedAt IS NULL.
//   - NOT_FOUND is returned for absent, soft-deleted, and cross-tenant records identically.
//   - findFirst (not findUnique) used so tenantId can be included in the WHERE clause.
//
// SKL-003: name uniqueness is enforced at the DB via idx_skills_tenant_name UNIQUE(tenant_id, name).
//   P2002 from Prisma signals a constraint violation → SKILL_NAME_CONFLICT.
//
// GD-M13-4 Decision 4: audit events emitted after write operations, outside the write transaction.
//   If a write fails, no audit event is emitted.
//
// Skill name is not PII — safe to include in audit metadata.

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';

// ---------------------------------------------------------------------------
// Parameter types
// ---------------------------------------------------------------------------

export type CreateSkillParams = {
  name: string;
  category?: string;
  description?: string;
};

export type UpdateSkillParams = {
  name?: string;
  category?: string;
  description?: string;
};

export type ListSkillsParams = {
  page?: number;
  pageSize?: number;
  category?: string;
};

// ---------------------------------------------------------------------------
// SkillRecord — shared read shape produced by all service read paths.
// deletedAt excluded — never exposed to callers.
// ---------------------------------------------------------------------------

export type SkillRecord = {
  id: string;
  tenantId: string;
  name: string;
  category: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// Discriminated union result types
// ---------------------------------------------------------------------------

export type CreateSkillResult =
  | { outcome: 'SUCCESS'; skill: SkillRecord }
  | { outcome: 'SKILL_NAME_CONFLICT' }
  | { outcome: 'INTERNAL_ERROR' };

export type ListSkillsResult =
  | {
      outcome: 'SUCCESS';
      skills: SkillRecord[];
      total: number;
      page: number;
      pageSize: number;
    }
  | { outcome: 'INTERNAL_ERROR' };

export type GetSkillByIdResult =
  | { outcome: 'SUCCESS'; skill: SkillRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

export type UpdateSkillResult =
  | { outcome: 'SUCCESS'; skill: SkillRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'SKILL_NAME_CONFLICT' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type SkillRow = {
  id: string;
  tenantId: string;
  name: string;
  category: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const SKILL_READ_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  category: true,
  description: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toSkillRecord(row: SkillRow): SkillRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    category: row.category,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// SkillService
// ---------------------------------------------------------------------------

@Injectable()
export class SkillService {
  private readonly logger = new Logger(SkillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createSkill(
    params: CreateSkillParams,
    tenantId: string,
    actorId: string,
  ): Promise<CreateSkillResult> {
    let row: SkillRow;
    try {
      row = await this.prisma.skill.create({
        data: {
          tenantId,
          name: params.name,
          category: params.category ?? null,
          description: params.description ?? null,
        },
        select: SKILL_READ_SELECT,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return { outcome: 'SKILL_NAME_CONFLICT' };
      }
      this.logger.error(
        'createSkill failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: AuditEventType.WORKFORCE_SKILL_CREATED,
      result: 'SUCCESS',
      entityType: 'SKILL',
      entityId: row.id,
      metadata: { skillId: row.id, skillName: row.name },
    });

    return { outcome: 'SUCCESS', skill: toSkillRecord(row) };
  }

  async listSkills(
    tenantId: string,
    params: ListSkillsParams,
  ): Promise<ListSkillsResult> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;

    const where: Prisma.SkillWhereInput = {
      tenantId,
      deletedAt: null,
      ...(params.category !== undefined ? { category: params.category } : {}),
    };

    let rows: SkillRow[];
    let total: number;
    try {
      [rows, total] = await Promise.all([
        this.prisma.skill.findMany({
          where,
          select: SKILL_READ_SELECT,
          orderBy: { name: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.skill.count({ where }),
      ]);
    } catch (err) {
      this.logger.error(
        'listSkills failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    return {
      outcome: 'SUCCESS',
      skills: rows.map(toSkillRecord),
      total,
      page,
      pageSize,
    };
  }

  async getSkillById(
    id: string,
    tenantId: string,
  ): Promise<GetSkillByIdResult> {
    let row: SkillRow | null;
    try {
      row = await this.prisma.skill.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: SKILL_READ_SELECT,
      });
    } catch (err) {
      this.logger.error(
        'getSkillById failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (!row) return { outcome: 'NOT_FOUND' };
    return { outcome: 'SUCCESS', skill: toSkillRecord(row) };
  }

  async updateSkill(
    id: string,
    params: UpdateSkillParams,
    tenantId: string,
    actorId: string,
  ): Promise<UpdateSkillResult> {
    // Verify ownership before update — prevents cross-tenant mutation (SEC-003).
    let existing: SkillRow | null;
    try {
      existing = await this.prisma.skill.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: SKILL_READ_SELECT,
      });
    } catch (err) {
      this.logger.error(
        'updateSkill findFirst failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (!existing) return { outcome: 'NOT_FOUND' };

    const updatedFields = (Object.keys(params) as Array<keyof UpdateSkillParams>).filter(
      (k) => params[k] !== undefined,
    );

    let row: SkillRow;
    try {
      row = await this.prisma.skill.update({
        where: { id },
        data: {
          ...(params.name !== undefined ? { name: params.name } : {}),
          ...(params.category !== undefined ? { category: params.category } : {}),
          ...(params.description !== undefined ? { description: params.description } : {}),
        },
        select: SKILL_READ_SELECT,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return { outcome: 'SKILL_NAME_CONFLICT' };
      }
      this.logger.error(
        'updateSkill update failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: AuditEventType.WORKFORCE_SKILL_UPDATED,
      result: 'SUCCESS',
      entityType: 'SKILL',
      entityId: row.id,
      metadata: { skillId: row.id, updatedFields },
    });

    return { outcome: 'SUCCESS', skill: toSkillRecord(row) };
  }
}
