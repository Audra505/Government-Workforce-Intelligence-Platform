// Reference: spec/01_requirements.md — FR-400 Vacancy Management
// Reference: spec/06_api_contracts.md — Vacancy API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/03_vacancy_management_rules.md — VAC-001 through VAC-702
// Reference: directives/08_audit_rules.md — AUD-400
//
// VacancyService is transport-agnostic: no HTTP exceptions thrown, no HTTP responses returned.
// HTTP status mapping is the sole responsibility of VacancyController.
//
// tenantId is never derived from the DTO — only from the caller-supplied JWT context (SEC-003).
// All read queries include WHERE tenantId AND deletedAt IS NULL (SEC-003).
// Position validation uses Prisma-direct query — no PositionService dependency.
// Audit events are emitted after write operations, not inside transactions (AUD-400).
//
// FILLED and CANCELLED are not written as intermediate DB states. The vacancy row moves directly
// to CLOSED in a single update. The closure type is encoded in:
//   (a) the audit trail — VACANCY_FILLED vs VACANCY_CANCELLED event
//   (b) the filledAt column — NOT NULL = filled, NULL = cancelled
// Reporting: status='CLOSED' AND filledAt IS NOT NULL = filled; filledAt IS NULL = cancelled.
//
// VAC-501: CLOSED vacancies are read-only. All write operations return VACANCY_CLOSED.
// VAC-102: Position must be ACTIVE (status = 'ACTIVE') before a vacancy can be created.
// VAC-602: Role restriction for cancellation enforced at controller/guard level — not here.
// IN_RECRUITMENT: Accepted as valid source state for closeVacancy; transition trigger is Phase 3.
// POS-500 gate: Not activated in this service — position dependency check is Step 8 (approved deferral).

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';

// ---------------------------------------------------------------------------
// Parameter types
// Plain TypeScript interfaces consumed by VacancyService.
// DTOs with class-validator decorators are defined in Step 4 and used by VacancyController.
// ---------------------------------------------------------------------------

export type CreateVacancyParams = {
  positionId: string;
  priority?: string;
  reason?: string;
  expectedFillDate?: Date;
};

export type UpdateVacancyParams = {
  priority?: string;
  reason?: string;
  expectedFillDate?: Date;
};

export type ListVacanciesParams = {
  status?: string;
  priority?: string;
  departmentId?: string;
  page?: number;
  pageSize?: number;
};

// ---------------------------------------------------------------------------
// VacancyRecord — shared intermediate shape produced by all service read paths.
// Includes joined position/department fields and computed aging metrics.
// ---------------------------------------------------------------------------

export type VacancyRecord = {
  id: string;
  tenantId: string;
  positionId: string;
  positionTitle: string;
  departmentId: string;
  departmentName: string;
  priority: string | null;
  reason: string | null;
  status: string;
  expectedFillDate: Date | null;
  filledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  ageInDays: number;
  agingStatus: 'OK' | 'WARNING' | 'HIGH_RISK';
  requiresReview: boolean;
};

// ---------------------------------------------------------------------------
// Discriminated union result types
// ---------------------------------------------------------------------------

export type CreateVacancyResult =
  | { outcome: 'SUCCESS'; vacancy: VacancyRecord }
  | { outcome: 'POSITION_NOT_ELIGIBLE' }
  | { outcome: 'INTERNAL_ERROR' };

export type ListVacanciesResult =
  | {
      outcome: 'SUCCESS';
      vacancies: VacancyRecord[];
      total: number;
      page: number;
      pageSize: number;
    }
  | { outcome: 'INTERNAL_ERROR' };

export type GetVacancyByIdResult =
  | { outcome: 'SUCCESS'; vacancy: VacancyRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

export type UpdateVacancyResult =
  | { outcome: 'SUCCESS'; vacancy: VacancyRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'VACANCY_CLOSED' }
  | { outcome: 'INTERNAL_ERROR' };

export type OpenVacancyResult =
  | { outcome: 'SUCCESS'; vacancy: VacancyRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INVALID_TRANSITION' }
  | { outcome: 'VACANCY_CLOSED' }
  | { outcome: 'INTERNAL_ERROR' };

export type CloseVacancyResult =
  | { outcome: 'SUCCESS'; vacancy: VacancyRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INVALID_TRANSITION' }
  | { outcome: 'VACANCY_CLOSED' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// Internal types and constants
// ---------------------------------------------------------------------------

// Matches the Prisma select result shape for VACANCY_READ_SELECT.
type VacancyRow = {
  id: string;
  tenantId: string;
  positionId: string;
  priority: string | null;
  reason: string | null;
  status: string;
  expectedFillDate: Date | null;
  filledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  position: {
    title: string;
    department: {
      id: string;
      name: string;
    };
  };
};

// Shared Prisma select for all read operations — includes joined position/department.
const VACANCY_READ_SELECT = {
  id: true,
  tenantId: true,
  positionId: true,
  priority: true,
  reason: true,
  status: true,
  expectedFillDate: true,
  filledAt: true,
  createdAt: true,
  updatedAt: true,
  position: {
    select: {
      title: true,
      department: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
} as const;

// VAC-701: warning threshold = 30 days. VAC-702: high risk threshold = 90 days.
function computeAgeInDays(createdAt: Date): number {
  return Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
}

function computeAgingStatus(ageInDays: number): 'OK' | 'WARNING' | 'HIGH_RISK' {
  if (ageInDays >= 90) return 'HIGH_RISK';
  if (ageInDays >= 30) return 'WARNING';
  return 'OK';
}

function toVacancyRecord(row: VacancyRow): VacancyRecord {
  const ageInDays = computeAgeInDays(row.createdAt);
  return {
    id: row.id,
    tenantId: row.tenantId,
    positionId: row.positionId,
    positionTitle: row.position.title,
    departmentId: row.position.department.id,
    departmentName: row.position.department.name,
    priority: row.priority,
    reason: row.reason,
    status: row.status,
    expectedFillDate: row.expectedFillDate,
    filledAt: row.filledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ageInDays,
    agingStatus: computeAgingStatus(ageInDays),
    // VAC-201: CRITICAL + OPEN vacancies require HR Director review within 24 hours.
    requiresReview: row.priority === 'CRITICAL' && row.status === 'OPEN',
  };
}

// ---------------------------------------------------------------------------
// VacancyService
// ---------------------------------------------------------------------------

@Injectable()
export class VacancyService {
  private readonly logger = new Logger(VacancyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createVacancy(
    params: CreateVacancyParams,
    tenantId: string,
    actorId: string,
  ): Promise<CreateVacancyResult> {
    // VAC-101: Position must exist. VAC-102: Position must be Active (status = 'ACTIVE').
    // VAC-103/104: Frozen/Closed positions rejected by the ACTIVE status filter.
    // Prisma-direct query — no PositionService dependency.
    // POSITION_NOT_ELIGIBLE returned for absent, cross-tenant, soft-deleted, and non-ACTIVE — prevents enumeration (SEC-003).
    let eligiblePosition: { id: string } | null;
    try {
      eligiblePosition = await this.prisma.position.findFirst({
        where: {
          id: params.positionId,
          tenantId,
          deletedAt: null,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error(
        'createVacancy position validation failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (!eligiblePosition) return { outcome: 'POSITION_NOT_ELIGIBLE' };

    let row: VacancyRow;
    try {
      row = await this.prisma.vacancy.create({
        data: {
          tenantId,
          positionId: params.positionId,
          priority: params.priority ?? null,
          reason: params.reason ?? null,
          expectedFillDate: params.expectedFillDate ?? null,
          status: 'DRAFT',
        },
        select: VACANCY_READ_SELECT,
      });
    } catch (err) {
      this.logger.error(
        'createVacancy failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    // Audit emitted after write — outside transaction per AUD-400.
    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: AuditEventType.WORKFORCE_VACANCY_CREATED,
      result: 'SUCCESS',
      entityType: 'VACANCY',
      entityId: row.id,
      metadata: {
        positionId: row.positionId,
        priority: row.priority,
        reason: row.reason,
        status: row.status,
      },
    });

    return { outcome: 'SUCCESS', vacancy: toVacancyRecord(row) };
  }

  async listVacancies(
    tenantId: string,
    params: ListVacanciesParams,
  ): Promise<ListVacanciesResult> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;

    const where: Prisma.VacancyWhereInput = {
      tenantId,
      deletedAt: null,
      ...(params.status ? { status: params.status } : {}),
      ...(params.priority ? { priority: params.priority } : {}),
      // departmentId filtered via nested position relation — no extra query or JOIN needed.
      ...(params.departmentId ? { position: { departmentId: params.departmentId } } : {}),
    };

    let vacancies: VacancyRow[];
    let total: number;
    try {
      [vacancies, total] = await Promise.all([
        this.prisma.vacancy.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: VACANCY_READ_SELECT,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.vacancy.count({ where }),
      ]);
    } catch (err) {
      this.logger.error(
        'listVacancies failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    return {
      outcome: 'SUCCESS',
      vacancies: vacancies.map(toVacancyRecord),
      total,
      page,
      pageSize,
    };
  }

  async getVacancyById(
    id: string,
    tenantId: string,
  ): Promise<GetVacancyByIdResult> {
    let row: VacancyRow | null;
    try {
      // findFirst with tenantId enforces SEC-003 at the DB query level.
      // NOT_FOUND returned for both absent and cross-tenant — prevents enumeration.
      row = await this.prisma.vacancy.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: VACANCY_READ_SELECT,
      });
    } catch (err) {
      this.logger.error(
        'getVacancyById failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (!row) return { outcome: 'NOT_FOUND' };
    return { outcome: 'SUCCESS', vacancy: toVacancyRecord(row) };
  }

  async updateVacancy(
    id: string,
    params: UpdateVacancyParams,
    tenantId: string,
    actorId: string,
  ): Promise<UpdateVacancyResult> {
    try {
      const existing = await this.prisma.vacancy.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true },
      });

      if (!existing) return { outcome: 'NOT_FOUND' };
      // VAC-501: CLOSED vacancies are read-only.
      if (existing.status === 'CLOSED') return { outcome: 'VACANCY_CLOSED' };

      const row = await this.prisma.vacancy.update({
        where: { id },
        data: {
          ...(params.priority !== undefined ? { priority: params.priority } : {}),
          ...(params.expectedFillDate !== undefined ? { expectedFillDate: params.expectedFillDate } : {}),
          // reason is only editable in DRAFT — locked once OPEN or IN_RECRUITMENT.
          ...(params.reason !== undefined && existing.status === 'DRAFT' ? { reason: params.reason } : {}),
        },
        select: VACANCY_READ_SELECT,
      });

      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.WORKFORCE_VACANCY_UPDATED,
        result: 'SUCCESS',
        entityType: 'VACANCY',
        entityId: row.id,
        metadata: {
          priority: row.priority,
          reason: row.reason,
          status: row.status,
        },
      });

      return { outcome: 'SUCCESS', vacancy: toVacancyRecord(row) };
    } catch (err) {
      this.logger.error(
        'updateVacancy failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  async openVacancy(
    id: string,
    tenantId: string,
    actorId: string,
  ): Promise<OpenVacancyResult> {
    try {
      const existing = await this.prisma.vacancy.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true },
      });

      if (!existing) return { outcome: 'NOT_FOUND' };
      if (existing.status === 'CLOSED') return { outcome: 'VACANCY_CLOSED' };
      // DRAFT is the only valid source state — any other non-CLOSED state is an invalid transition.
      if (existing.status !== 'DRAFT') return { outcome: 'INVALID_TRANSITION' };

      const row = await this.prisma.vacancy.update({
        where: { id },
        data: { status: 'OPEN' },
        select: VACANCY_READ_SELECT,
      });

      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.WORKFORCE_VACANCY_OPENED,
        result: 'SUCCESS',
        entityType: 'VACANCY',
        entityId: row.id,
        metadata: { status: 'OPEN', previousStatus: 'DRAFT' },
      });

      return { outcome: 'SUCCESS', vacancy: toVacancyRecord(row) };
    } catch (err) {
      this.logger.error(
        'openVacancy failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  async closeVacancy(
    id: string,
    closureType: 'FILLED' | 'CANCELLED',
    tenantId: string,
    actorId: string,
  ): Promise<CloseVacancyResult> {
    // VAC-602: Role restriction (cancellation requires Manager Approval) enforced at controller level.
    try {
      const existing = await this.prisma.vacancy.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true },
      });

      if (!existing) return { outcome: 'NOT_FOUND' };
      if (existing.status === 'CLOSED') return { outcome: 'VACANCY_CLOSED' };

      // VAC-300/VAC-401: FILLED closure requires an active posting (OPEN or IN_RECRUITMENT).
      // A DRAFT vacancy has never been posted — no candidate can have been hired.
      if (closureType === 'FILLED' && !['OPEN', 'IN_RECRUITMENT'].includes(existing.status)) {
        return { outcome: 'INVALID_TRANSITION' };
      }

      // CANCELLED closure is valid from DRAFT, OPEN, or IN_RECRUITMENT.
      if (closureType === 'CANCELLED' && !['DRAFT', 'OPEN', 'IN_RECRUITMENT'].includes(existing.status)) {
        return { outcome: 'INVALID_TRANSITION' };
      }

      const now = new Date();
      const row = await this.prisma.vacancy.update({
        where: { id },
        data: closureType === 'FILLED'
          ? { status: 'CLOSED', filledAt: now }
          : { status: 'CLOSED' },
        select: VACANCY_READ_SELECT,
      });

      // Emit closure-type event first, then CLOSED event (AUD-400).
      // Two sequential emits — same actor, same operation, consecutive timestamps.
      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: closureType === 'FILLED'
          ? AuditEventType.WORKFORCE_VACANCY_FILLED
          : AuditEventType.WORKFORCE_VACANCY_CANCELLED,
        result: 'SUCCESS',
        entityType: 'VACANCY',
        entityId: row.id,
        metadata: closureType === 'FILLED'
          ? { closureType: 'FILLED', filledAt: now }
          : { closureType: 'CANCELLED' },
      });

      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.WORKFORCE_VACANCY_CLOSED,
        result: 'SUCCESS',
        entityType: 'VACANCY',
        entityId: row.id,
        metadata: { status: 'CLOSED', closureType },
      });

      return { outcome: 'SUCCESS', vacancy: toVacancyRecord(row) };
    } catch (err) {
      this.logger.error(
        'closeVacancy failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }
}
