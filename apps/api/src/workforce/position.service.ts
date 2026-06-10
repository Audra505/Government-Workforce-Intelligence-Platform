// Reference: spec/01_requirements.md — FR-100 Position Management
// Reference: spec/06_api_contracts.md — Position API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/02_position_management_rules.md — POS-001 through POS-602
// Reference: directives/08_audit_rules.md — AUD-400
//
// PositionService is transport-agnostic: no HTTP exceptions thrown, no HTTP responses returned.
// HTTP status mapping is the sole responsibility of PositionController.
//
// tenantId is never derived from the DTO — only from the caller-supplied JWT context (SEC-003).
// All read queries include WHERE tenantId AND deletedAt IS NULL (SEC-003).
// Department validation uses Prisma-direct query — no DepartmentService dependency (Decision 4).
// Audit events are emitted after write operations, not inside transactions (AUD-400).
//
// POS-202: CLOSED positions are read-only. updatePosition returns POSITION_CLOSED.
// POS-500 deferred gate: "No Active Employees, No Active Recruitment" is not enforced here.
//   Employee and Vacancy domains do not yet exist. This guard must be added when those
//   domains are implemented (Decision 2 — approved Milestone 8 scope).
// POS-201: departmentId is immutable after creation — excluded from all update paths.

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import { CreatePositionDto } from './dto/create-position.dto';
import { ListPositionsQueryDto } from './dto/list-positions-query.dto';
import { UpdatePositionDto } from './dto/update-position.dto';

// Shared intermediate position shape — produced by all service methods.
// Excludes: tenantId (implicit from auth context), deletedAt (soft-delete detail), updatedAt.
export type PositionRecord = {
  id: string;
  departmentId: string;
  title: string;
  classification: string | null;
  salaryBand: string | null;
  status: string;
  createdAt: Date;
};

export type CreatePositionResult =
  | { outcome: 'SUCCESS'; position: PositionRecord }
  | { outcome: 'DEPARTMENT_NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

export type ListPositionsResult =
  | {
      outcome: 'SUCCESS';
      positions: PositionRecord[];
      total: number;
      page: number;
      pageSize: number;
    }
  | { outcome: 'INTERNAL_ERROR' };

export type GetPositionByIdResult =
  | { outcome: 'SUCCESS'; position: PositionRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

export type UpdatePositionResult =
  | { outcome: 'SUCCESS'; position: PositionRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'POSITION_CLOSED' }
  | { outcome: 'INTERNAL_ERROR' };

export type ClosePositionResult =
  | { outcome: 'SUCCESS'; position: PositionRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'ALREADY_CLOSED' }
  | { outcome: 'INTERNAL_ERROR' };

// Helper type — matches the Prisma row shape returned by POSITION_READ_SELECT.
type PositionRow = {
  id: string;
  departmentId: string;
  title: string;
  classification: string | null;
  salaryBand: string | null;
  status: string;
  createdAt: Date;
};

// Shared Prisma select for all read operations.
const POSITION_READ_SELECT = {
  id: true,
  departmentId: true,
  title: true,
  classification: true,
  salaryBand: true,
  status: true,
  createdAt: true,
} as const;

function toPositionRecord(row: PositionRow): PositionRecord {
  return {
    id: row.id,
    departmentId: row.departmentId,
    title: row.title,
    classification: row.classification,
    salaryBand: row.salaryBand,
    status: row.status,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PositionService {
  private readonly logger = new Logger(PositionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createPosition(
    dto: CreatePositionDto,
    tenantId: string,
    actorId: string,
  ): Promise<CreatePositionResult> {
    // POS-102: Department must exist within the tenant.
    // Prisma-direct query — no DepartmentService dependency (Decision 4).
    // Cross-tenant isolation enforced by tenantId filter (SEC-003).
    let deptExists: { id: string } | null;
    try {
      deptExists = await this.prisma.department.findFirst({
        where: { id: dto.departmentId, tenantId, deletedAt: null },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error(
        'createPosition department validation failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (!deptExists) return { outcome: 'DEPARTMENT_NOT_FOUND' };

    let position: PositionRow;
    try {
      position = await this.prisma.position.create({
        data: {
          tenantId,
          departmentId: dto.departmentId,
          title: dto.title,
          classification: dto.classification ?? null,
          salaryBand: dto.salaryBand ?? null,
          status: 'DRAFT',
        },
        select: POSITION_READ_SELECT,
      });
    } catch (err) {
      this.logger.error(
        'createPosition failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    // Audit emitted after write — outside transaction per AUD-400.
    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: AuditEventType.WORKFORCE_POSITION_CREATED,
      result: 'SUCCESS',
      entityType: 'POSITION',
      entityId: position.id,
      metadata: {
        title: position.title,
        departmentId: position.departmentId,
        status: position.status,
      },
    });

    return { outcome: 'SUCCESS', position: toPositionRecord(position) };
  }

  async listPositions(
    tenantId: string,
    query: ListPositionsQueryDto,
  ): Promise<ListPositionsResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.PositionWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.classification ? { classification: query.classification } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { classification: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    let positions: PositionRow[];
    let total: number;
    try {
      // Promise.all matches the established listDepartments/listUsers pattern (Milestones 6–7).
      [positions, total] = await Promise.all([
        this.prisma.position.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: POSITION_READ_SELECT,
          orderBy: { title: 'asc' },
        }),
        this.prisma.position.count({ where }),
      ]);
    } catch (err) {
      this.logger.error(
        'listPositions failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    return {
      outcome: 'SUCCESS',
      positions: positions.map(toPositionRecord),
      total,
      page,
      pageSize,
    };
  }

  async getPositionById(
    id: string,
    tenantId: string,
  ): Promise<GetPositionByIdResult> {
    let row: PositionRow | null;
    try {
      // findFirst with tenantId enforces SEC-003 at the DB query level.
      // NOT_FOUND returned for both absent and cross-tenant — prevents enumeration.
      row = await this.prisma.position.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: POSITION_READ_SELECT,
      });
    } catch (err) {
      this.logger.error(
        'getPositionById failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (!row) return { outcome: 'NOT_FOUND' };
    return { outcome: 'SUCCESS', position: toPositionRecord(row) };
  }

  async updatePosition(
    id: string,
    dto: UpdatePositionDto,
    tenantId: string,
    actorId: string,
  ): Promise<UpdatePositionResult> {
    try {
      // Verify existence, tenant ownership, and CLOSED guard before writing (SEC-003 + POS-202).
      const existing = await this.prisma.position.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true },
      });

      if (!existing) return { outcome: 'NOT_FOUND' };
      // POS-202: Closed positions are read-only.
      if (existing.status === 'CLOSED') return { outcome: 'POSITION_CLOSED' };

      const row = await this.prisma.position.update({
        where: { id },
        data: {
          // departmentId intentionally excluded — immutable after creation (POS-201).
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.classification !== undefined ? { classification: dto.classification } : {}),
          ...(dto.salaryBand !== undefined ? { salaryBand: dto.salaryBand } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
        select: POSITION_READ_SELECT,
      });

      // Emit the most specific event for the transition (AUD-400 / directive audit rules).
      // Matches the ORG_DEPARTMENT_DEACTIVATED precedent in DepartmentService.
      const auditAction =
        dto.status === 'ACTIVE'  ? AuditEventType.WORKFORCE_POSITION_ACTIVATED :
        dto.status === 'FROZEN'  ? AuditEventType.WORKFORCE_POSITION_FROZEN    :
                                   AuditEventType.WORKFORCE_POSITION_UPDATED;

      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: auditAction,
        result: 'SUCCESS',
        entityType: 'POSITION',
        entityId: row.id,
        metadata: { title: row.title, status: row.status },
      });

      return { outcome: 'SUCCESS', position: toPositionRecord(row) };
    } catch (err) {
      this.logger.error(
        'updatePosition failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  async closePosition(
    id: string,
    tenantId: string,
    actorId: string,
  ): Promise<ClosePositionResult> {
    // POS-500 deferred gate: "No Active Employees, No Active Recruitment" check omitted.
    // Employee and Vacancy domains do not yet exist. This guard is additive — it must be
    // implemented when those domains are introduced (Decision 2 — approved deferral).
    try {
      const existing = await this.prisma.position.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true },
      });

      if (!existing) return { outcome: 'NOT_FOUND' };
      if (existing.status === 'CLOSED') return { outcome: 'ALREADY_CLOSED' };

      const row = await this.prisma.position.update({
        where: { id },
        data: { status: 'CLOSED' },
        select: POSITION_READ_SELECT,
      });

      // POS-501: Closure must create audit event.
      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.WORKFORCE_POSITION_CLOSED,
        result: 'SUCCESS',
        entityType: 'POSITION',
        entityId: row.id,
        metadata: { title: row.title, status: row.status },
      });

      return { outcome: 'SUCCESS', position: toPositionRecord(row) };
    } catch (err) {
      this.logger.error(
        'closePosition failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }
}
