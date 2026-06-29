// Reference: spec/01_requirements.md — FR-301 through FR-306 Application Management
// Reference: spec/06_api_contracts.md — Application API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: governance/GD-M17-1.md — Decisions 6–16
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (tenant isolation), Decision 2 (status values)
// Reference: governance/GD-PRE-PHASE3-003.md — RBAC authority (enforced at controller, not service)
//
// ApplicationService is transport-agnostic: no HTTP exceptions thrown, no HTTP responses returned.
// HTTP status mapping is the sole responsibility of ApplicationController (Step 4).
//
// tenantId is never derived from params — only from the caller-supplied JWT context (SEC-003).
// All read queries include WHERE tenantId AND deletedAt IS NULL (SEC-003).
// APPLICATION_NOT_FOUND returned for absent, soft-deleted, and cross-tenant records — prevents enumeration.
// Audit events emitted after write operations, outside transactions (EMP-700 pattern).
// PII safety: notes text, vacancy descriptions, and candidate PII must not appear in audit metadata.
// Status set to APPLIED by createApplication — never accepted from caller (GD-PRE-PHASE3-002 D2).
// VAC-301: first application on OPEN vacancy → updateMany to IN_RECRUITMENT (GD-M17-1 D8).
//   VAC-301 failure is non-fatal — application was created; self-healing inconsistency risk documented.
// Duplicate prevention: service pre-check + partial unique index + P2002 catch (GD-M17-1 D7).
// HIRED is unreachable in M17 — reserved for M19 (GD-M17-1 D10).
// Terminal states REJECTED/WITHDRAWN block further status transitions (GD-M17-1 D10).
// Advance audit decision: RECRUITING_APPLICATION_ADVANCED only — not also STATUS_CHANGED to
//   avoid duplicate audit noise (GD-M17-1 D16 — events are action-specific, not cumulative).
// Update audit decision: RECRUITING_APPLICATION_STATUS_CHANGED used for notes/currentStage updates
//   (no dedicated RECRUITING_APPLICATION_UPDATED event exists in AUD-500).

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';

// ---------------------------------------------------------------------------
// Parameter types
// Plain TypeScript interfaces consumed by ApplicationService.
// DTOs with class-validator decorators are defined separately (Step 2).
// ---------------------------------------------------------------------------

export type CreateApplicationParams = {
  candidateId: string;
  vacancyId: string;
  notes?: string;
  currentStage?: string;
};

export type UpdateApplicationParams = {
  notes?: string;
  currentStage?: string;
};

export type AdvanceApplicationParams = {
  targetStatus: string;
};

export type ListApplicationsParams = {
  page?: number;
  pageSize?: number;
  status?: string;
  candidateId?: string;
  vacancyId?: string;
};

// ---------------------------------------------------------------------------
// ApplicationRecord — shared read shape produced by all service read paths.
// tenantId is present for service-layer completeness; controller must strip it
//   from HTTP responses (SEC-003 — GD-PRE-PHASE3-002 D1).
// deletedAt is excluded: soft-deleted applications are invisible to all callers (→ NOT_FOUND).
// ---------------------------------------------------------------------------

export type ApplicationRecord = {
  id: string;
  tenantId: string;
  candidateId: string;
  vacancyId: string;
  status: string;
  submittedAt: Date;
  currentStage: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// Discriminated union result types
// ---------------------------------------------------------------------------

export type CreateApplicationResult =
  | { outcome: 'SUCCESS'; application: ApplicationRecord }
  | { outcome: 'CANDIDATE_NOT_FOUND' }
  | { outcome: 'CANDIDATE_ARCHIVED' }
  | { outcome: 'VACANCY_NOT_FOUND' }
  | { outcome: 'VACANCY_NOT_OPEN' }
  | { outcome: 'APPLICATION_ALREADY_EXISTS' }
  | { outcome: 'INTERNAL_ERROR' };

export type ListApplicationsResult =
  | {
      outcome: 'SUCCESS';
      applications: ApplicationRecord[];
      total: number;
      page: number;
      pageSize: number;
    }
  | { outcome: 'INTERNAL_ERROR' };

export type GetApplicationByIdResult =
  | { outcome: 'SUCCESS'; application: ApplicationRecord }
  | { outcome: 'APPLICATION_NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

export type UpdateApplicationResult =
  | { outcome: 'SUCCESS'; application: ApplicationRecord }
  | { outcome: 'APPLICATION_NOT_FOUND' }
  | { outcome: 'APPLICATION_IN_TERMINAL_STATE' }
  | { outcome: 'INTERNAL_ERROR' };

export type AdvanceApplicationResult =
  | { outcome: 'SUCCESS'; application: ApplicationRecord }
  | { outcome: 'APPLICATION_NOT_FOUND' }
  | { outcome: 'APPLICATION_IN_TERMINAL_STATE' }
  | { outcome: 'APPLICATION_AWAITING_HIRE' }
  | { outcome: 'INVALID_APPLICATION_TRANSITION' }
  | { outcome: 'INTERNAL_ERROR' };

export type RejectApplicationResult =
  | { outcome: 'SUCCESS' }
  | { outcome: 'APPLICATION_NOT_FOUND' }
  | { outcome: 'APPLICATION_IN_TERMINAL_STATE' }
  | { outcome: 'INTERNAL_ERROR' };

export type WithdrawApplicationResult =
  | { outcome: 'SUCCESS' }
  | { outcome: 'APPLICATION_NOT_FOUND' }
  | { outcome: 'APPLICATION_IN_TERMINAL_STATE' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// Internal types and constants
// ---------------------------------------------------------------------------

type ApplicationRow = {
  id: string;
  tenantId: string;
  candidateId: string;
  vacancyId: string;
  status: string;
  submittedAt: Date;
  currentStage: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const APPLICATION_READ_SELECT = {
  id: true,
  tenantId: true,
  candidateId: true,
  vacancyId: true,
  status: true,
  submittedAt: true,
  currentStage: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} as const;

const TERMINAL_STATUSES: readonly string[] = ['REJECTED', 'WITHDRAWN'];

// Sequential status machine (GD-M17-1 D10, Option B — explicit targetStatus).
// Maps currentStatus → the single valid next status.
// HIRED deliberately absent — unreachable in M17, reserved for M19.
// OFFER maps to undefined: advancing from OFFER returns APPLICATION_AWAITING_HIRE.
const STATUS_NEXT: Record<string, string | undefined> = {
  APPLIED:    'SCREENING',
  SCREENING:  'INTERVIEW',
  INTERVIEW:  'EVALUATION',
  EVALUATION: 'OFFER',
};

function toApplicationRecord(row: ApplicationRow): ApplicationRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    candidateId: row.candidateId,
    vacancyId: row.vacancyId,
    status: row.status,
    submittedAt: row.submittedAt,
    currentStage: row.currentStage,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// ApplicationService
// ---------------------------------------------------------------------------

@Injectable()
export class ApplicationService {
  private readonly logger = new Logger(ApplicationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createApplication(
    params: CreateApplicationParams,
    tenantId: string,
    actorId: string,
  ): Promise<CreateApplicationResult> {
    // Step 1: Validate candidate exists in this tenant and is not archived.
    // tenantId filter prevents cross-tenant enumeration (SEC-003).
    // Does NOT filter deletedAt here — allows us to distinguish NOT_FOUND from ARCHIVED.
    let candidateRow: { id: string; status: string; deletedAt: Date | null } | null;
    try {
      candidateRow = await this.prisma.candidate.findFirst({
        where: { id: params.candidateId, tenantId },
        select: { id: true, status: true, deletedAt: true },
      });
    } catch (err) {
      this.logger.error('createApplication candidate check failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
    if (!candidateRow) return { outcome: 'CANDIDATE_NOT_FOUND' };
    if (candidateRow.status === 'ARCHIVED' || candidateRow.deletedAt !== null) {
      return { outcome: 'CANDIDATE_ARCHIVED' };
    }

    // Step 2: Validate vacancy exists in this tenant and is open for applications (GD-M17-1 D6).
    let vacancyRow: { id: string; status: string } | null;
    try {
      vacancyRow = await this.prisma.vacancy.findFirst({
        where: { id: params.vacancyId, tenantId, deletedAt: null },
        select: { id: true, status: true },
      });
    } catch (err) {
      this.logger.error('createApplication vacancy check failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
    if (!vacancyRow) return { outcome: 'VACANCY_NOT_FOUND' };
    if (vacancyRow.status !== 'OPEN' && vacancyRow.status !== 'IN_RECRUITMENT') {
      return { outcome: 'VACANCY_NOT_OPEN' };
    }

    // Step 3: Duplicate active application pre-check (GD-M17-1 D7).
    // Partial unique index is the DB-level guard. Pre-check provides a deterministic error
    // code before the write; P2002 catch below handles race conditions.
    try {
      const duplicate = await this.prisma.application.findFirst({
        where: {
          tenantId,
          candidateId: params.candidateId,
          vacancyId: params.vacancyId,
          deletedAt: null,
          status: { notIn: ['REJECTED', 'WITHDRAWN'] },
        },
        select: { id: true },
      });
      if (duplicate) return { outcome: 'APPLICATION_ALREADY_EXISTS' };
    } catch (err) {
      this.logger.error('createApplication duplicate check failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }

    // Step 4: Create the application with status APPLIED (GD-PRE-PHASE3-002 D2).
    let row: ApplicationRow;
    try {
      row = await this.prisma.application.create({
        data: {
          tenantId,
          candidateId: params.candidateId,
          vacancyId: params.vacancyId,
          status: 'APPLIED',
          notes: params.notes ?? null,
          currentStage: params.currentStage ?? null,
        },
        select: APPLICATION_READ_SELECT,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { outcome: 'APPLICATION_ALREADY_EXISTS' };
      }
      this.logger.error('createApplication failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }

    // Step 5: VAC-301 — if vacancy was OPEN, transition to IN_RECRUITMENT (GD-M17-1 D8).
    // updateMany with WHERE status='OPEN' is idempotent (race-safe).
    // Audit emitted only when transition actually occurs (count > 0).
    // VAC-301 failure is non-fatal: application was already created; inconsistency is self-healing
    // when next application arrives or vacancy is manually updated.
    if (vacancyRow.status === 'OPEN') {
      try {
        const vac301 = await this.prisma.vacancy.updateMany({
          where: { id: params.vacancyId, tenantId, status: 'OPEN' },
          data: { status: 'IN_RECRUITMENT' },
        });
        if (vac301.count > 0) {
          await this.auditService.logEvent({
            tenantId,
            userId: actorId,
            action: AuditEventType.WORKFORCE_VACANCY_UPDATED,
            result: 'SUCCESS',
            entityType: 'VACANCY',
            entityId: params.vacancyId,
            metadata: { trigger: 'VAC-301', newStatus: 'IN_RECRUITMENT' },
          });
        }
      } catch (err) {
        this.logger.error('VAC-301 vacancy transition failed', err instanceof Error ? err.stack : String(err));
      }
    }

    // Step 6: Emit application submitted audit (PII-safe: IDs and status only).
    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: AuditEventType.RECRUITING_APPLICATION_SUBMITTED,
      result: 'SUCCESS',
      entityType: 'APPLICATION',
      entityId: row.id,
      metadata: {
        candidateId: row.candidateId,
        vacancyId: row.vacancyId,
        status: row.status,
      },
    });

    return { outcome: 'SUCCESS', application: toApplicationRecord(row) };
  }

  async listApplications(
    params: ListApplicationsParams,
    tenantId: string,
  ): Promise<ListApplicationsResult> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;

    const where = {
      tenantId,
      deletedAt: null,
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.candidateId !== undefined ? { candidateId: params.candidateId } : {}),
      ...(params.vacancyId !== undefined ? { vacancyId: params.vacancyId } : {}),
    };

    let applications: ApplicationRow[];
    let total: number;
    try {
      [applications, total] = await Promise.all([
        this.prisma.application.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: APPLICATION_READ_SELECT,
          orderBy: { submittedAt: 'desc' },
        }),
        this.prisma.application.count({ where }),
      ]);
    } catch (err) {
      this.logger.error('listApplications failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }

    return {
      outcome: 'SUCCESS',
      applications: applications.map(toApplicationRecord),
      total,
      page,
      pageSize,
    };
  }

  async getApplicationById(
    id: string,
    tenantId: string,
  ): Promise<GetApplicationByIdResult> {
    let row: ApplicationRow | null;
    try {
      row = await this.prisma.application.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: APPLICATION_READ_SELECT,
      });
    } catch (err) {
      this.logger.error('getApplicationById failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (!row) return { outcome: 'APPLICATION_NOT_FOUND' };
    return { outcome: 'SUCCESS', application: toApplicationRecord(row) };
  }

  async updateApplication(
    id: string,
    params: UpdateApplicationParams,
    tenantId: string,
    actorId: string,
  ): Promise<UpdateApplicationResult> {
    try {
      const existing = await this.prisma.application.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true },
      });

      if (!existing) return { outcome: 'APPLICATION_NOT_FOUND' };

      if (TERMINAL_STATUSES.includes(existing.status)) {
        return { outcome: 'APPLICATION_IN_TERMINAL_STATE' };
      }

      const updateData = {
        ...(params.notes !== undefined ? { notes: params.notes } : {}),
        ...(params.currentStage !== undefined ? { currentStage: params.currentStage } : {}),
      };

      const row = await this.prisma.application.update({
        where: { id },
        data: updateData,
        select: APPLICATION_READ_SELECT,
      });

      // Audit decision: RECRUITING_APPLICATION_STATUS_CHANGED is used for notes/currentStage
      // updates. No formal RECRUITING_APPLICATION_UPDATED event exists in AUD-500. No status
      // transition occurred in this path; ADVANCED/REJECTED/WITHDRAWN remain for status changes.
      // PII safety: metadata records field names only — not notes text (EMP-401 pattern).
      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.RECRUITING_APPLICATION_STATUS_CHANGED,
        result: 'SUCCESS',
        entityType: 'APPLICATION',
        entityId: row.id,
        metadata: { updatedFields: Object.keys(updateData) },
      });

      return { outcome: 'SUCCESS', application: toApplicationRecord(row) };
    } catch (err) {
      this.logger.error('updateApplication failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  async advanceApplication(
    id: string,
    params: AdvanceApplicationParams,
    tenantId: string,
    actorId: string,
  ): Promise<AdvanceApplicationResult> {
    try {
      const existing = await this.prisma.application.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true },
      });

      if (!existing) return { outcome: 'APPLICATION_NOT_FOUND' };

      const currentStatus = existing.status;

      if (TERMINAL_STATUSES.includes(currentStatus)) {
        return { outcome: 'APPLICATION_IN_TERMINAL_STATE' };
      }

      // OFFER is the last reachable stage in M17; advancing returns APPLICATION_AWAITING_HIRE
      // to signal hire-to-employee is required (M19 scope — GD-M17-1 D10).
      if (currentStatus === 'OFFER') {
        return { outcome: 'APPLICATION_AWAITING_HIRE' };
      }

      // Validate targetStatus is the single allowed next step (GD-M17-1 D10, Option B).
      const allowedNext = STATUS_NEXT[currentStatus];
      if (allowedNext === undefined || params.targetStatus !== allowedNext) {
        return { outcome: 'INVALID_APPLICATION_TRANSITION' };
      }

      const row = await this.prisma.application.update({
        where: { id },
        data: { status: params.targetStatus },
        select: APPLICATION_READ_SELECT,
      });

      // Emit RECRUITING_APPLICATION_ADVANCED only — not also RECRUITING_APPLICATION_STATUS_CHANGED.
      // Both events covering the same transition would create duplicate audit noise (GD-M17-1 D16).
      // previousStatus and newStatus are safe (status labels, no PII).
      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.RECRUITING_APPLICATION_ADVANCED,
        result: 'SUCCESS',
        entityType: 'APPLICATION',
        entityId: row.id,
        metadata: { previousStatus: currentStatus, newStatus: params.targetStatus },
      });

      return { outcome: 'SUCCESS', application: toApplicationRecord(row) };
    } catch (err) {
      this.logger.error('advanceApplication failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  async rejectApplication(
    id: string,
    tenantId: string,
    actorId: string,
  ): Promise<RejectApplicationResult> {
    try {
      const existing = await this.prisma.application.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true },
      });

      if (!existing) return { outcome: 'APPLICATION_NOT_FOUND' };

      if (TERMINAL_STATUSES.includes(existing.status)) {
        return { outcome: 'APPLICATION_IN_TERMINAL_STATE' };
      }

      const previousStatus = existing.status;

      await this.prisma.application.update({
        where: { id },
        data: { status: 'REJECTED' },
      });

      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.RECRUITING_APPLICATION_REJECTED,
        result: 'SUCCESS',
        entityType: 'APPLICATION',
        entityId: id,
        metadata: { previousStatus },
      });

      return { outcome: 'SUCCESS' };
    } catch (err) {
      this.logger.error('rejectApplication failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  async withdrawApplication(
    id: string,
    tenantId: string,
    actorId: string,
  ): Promise<WithdrawApplicationResult> {
    try {
      const existing = await this.prisma.application.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true },
      });

      if (!existing) return { outcome: 'APPLICATION_NOT_FOUND' };

      if (TERMINAL_STATUSES.includes(existing.status)) {
        return { outcome: 'APPLICATION_IN_TERMINAL_STATE' };
      }

      const previousStatus = existing.status;

      await this.prisma.application.update({
        where: { id },
        data: { status: 'WITHDRAWN' },
      });

      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.RECRUITING_APPLICATION_WITHDRAWN,
        result: 'SUCCESS',
        entityType: 'APPLICATION',
        entityId: id,
        metadata: { previousStatus },
      });

      return { outcome: 'SUCCESS' };
    } catch (err) {
      this.logger.error('withdrawApplication failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
  }
}
