// Reference: spec/01_requirements.md — FR-307 through FR-314 Interview Management
// Reference: spec/06_api_contracts.md — Interview API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: governance/GD-M18-1.md — Decisions 4, 5, 8, 13, 14, 16, 17
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (tenant isolation), Decision 8 (status values)
// Reference: governance/GD-PRE-PHASE3-003.md — RBAC authority (enforced at controller, not service)
//
// InterviewService is transport-agnostic: no HTTP exceptions thrown, no HTTP responses returned.
// HTTP status mapping is the sole responsibility of InterviewController (Step 5).
//
// tenantId is never derived from params — only from the caller-supplied JWT context (SEC-003).
// All read queries include WHERE tenantId AND deletedAt IS NULL (SEC-003; GD-M18-1 D16).
// INTERVIEW_NOT_FOUND returned for absent, soft-deleted, and cross-tenant records — prevents enumeration.
// APPLICATION_NOT_FOUND returned for absent, soft-deleted, and cross-tenant applications — prevents enumeration.
// INTERVIEWER_NOT_FOUND returned for absent, soft-deleted, and cross-tenant users — prevents user enumeration.
// Audit events emitted after write operations (GD-M18-1 D17).
// PII safety: interviewer_name, feedback text must not appear in audit metadata (GD-M18-1 D17).
// interviewerUserId IS permitted in audit metadata (it is a UUID, not a name) (GD-M18-1 D17).
// Status set to SCHEDULED by createInterview — never accepted from caller (GD-M18-1 D13).
// Interview creation does not change application status (GD-M18-1 D8).
// Terminal interview states: COMPLETED, CANCELLED, NO_SHOW (GD-M18-1 D5).
// Feedback allowed only on SCHEDULED or COMPLETED interviews (GD-M18-1 D5).
// INTERVIEWER_REQUIRED enforced at service layer — DTO allows both fields absent (GD-M18-1 D13).
// interviewer_user_id has no DB-level FK — service validates existence and tenant membership (GD-M18-1 D4).

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';

// ---------------------------------------------------------------------------
// Parameter types
// Plain TypeScript interfaces consumed by InterviewService.
// DTOs with class-validator decorators are defined separately (Step 3).
// ---------------------------------------------------------------------------

export type CreateInterviewParams = {
  applicationId: string;
  interviewType: string;
  scheduledAt?: string;
  interviewerName?: string;
  interviewerUserId?: string;
};

export type UpdateInterviewParams = {
  scheduledAt?: string | null;
  interviewerName?: string | null;
  interviewerUserId?: string | null;
};

export type RecordFeedbackParams = {
  feedback: string;
};

export type ListInterviewsParams = {
  page?: number;
  pageSize?: number;
  applicationId?: string;
  status?: string;
  interviewType?: string;
};

// ---------------------------------------------------------------------------
// InterviewRecord — shared read shape produced by all service read paths.
// tenantId is present for service-layer completeness; controller must strip it
//   from HTTP responses (SEC-003 — GD-M18-1 D16).
// deletedAt is excluded: soft-deleted interviews are invisible to all callers (→ NOT_FOUND).
// ---------------------------------------------------------------------------

export type InterviewRecord = {
  id: string;
  tenantId: string;
  applicationId: string;
  interviewType: string;
  scheduledAt: Date | null;
  status: string;
  interviewerName: string | null;
  interviewerUserId: string | null;
  feedback: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// Discriminated union result types
// ---------------------------------------------------------------------------

export type CreateInterviewResult =
  | { outcome: 'SUCCESS'; interview: InterviewRecord }
  | { outcome: 'APPLICATION_NOT_FOUND' }
  | { outcome: 'APPLICATION_IN_TERMINAL_STATE' }
  | { outcome: 'INTERVIEWER_REQUIRED' }
  | { outcome: 'INTERVIEWER_NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

export type ListInterviewsResult =
  | {
      outcome: 'SUCCESS';
      interviews: InterviewRecord[];
      total: number;
      page: number;
      pageSize: number;
    }
  | { outcome: 'INTERNAL_ERROR' };

export type GetInterviewByIdResult =
  | { outcome: 'SUCCESS'; interview: InterviewRecord }
  | { outcome: 'INTERVIEW_NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

export type UpdateInterviewResult =
  | { outcome: 'SUCCESS'; interview: InterviewRecord }
  | { outcome: 'INTERVIEW_NOT_FOUND' }
  | { outcome: 'INTERVIEW_IN_TERMINAL_STATE' }
  | { outcome: 'INTERVIEWER_REQUIRED' }
  | { outcome: 'INTERVIEWER_NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

export type CompleteInterviewResult =
  | { outcome: 'SUCCESS'; interview: InterviewRecord }
  | { outcome: 'INTERVIEW_NOT_FOUND' }
  | { outcome: 'INTERVIEW_IN_TERMINAL_STATE' }
  | { outcome: 'INTERNAL_ERROR' };

export type RecordFeedbackResult =
  | { outcome: 'SUCCESS'; interview: InterviewRecord }
  | { outcome: 'INTERVIEW_NOT_FOUND' }
  | { outcome: 'INTERVIEW_FEEDBACK_NOT_ALLOWED' }
  | { outcome: 'INTERNAL_ERROR' };

export type CancelInterviewResult =
  | { outcome: 'SUCCESS'; interview: InterviewRecord }
  | { outcome: 'INTERVIEW_NOT_FOUND' }
  | { outcome: 'INTERVIEW_IN_TERMINAL_STATE' }
  | { outcome: 'INTERNAL_ERROR' };

export type NoShowInterviewResult =
  | { outcome: 'SUCCESS'; interview: InterviewRecord }
  | { outcome: 'INTERVIEW_NOT_FOUND' }
  | { outcome: 'INTERVIEW_IN_TERMINAL_STATE' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// Internal types and constants
// ---------------------------------------------------------------------------

type InterviewRow = {
  id: string;
  tenantId: string;
  applicationId: string;
  interviewType: string;
  scheduledAt: Date | null;
  status: string;
  interviewerName: string | null;
  interviewerUserId: string | null;
  feedback: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const INTERVIEW_READ_SELECT = {
  id: true,
  tenantId: true,
  applicationId: true,
  interviewType: true,
  scheduledAt: true,
  status: true,
  interviewerName: true,
  interviewerUserId: true,
  feedback: true,
  createdAt: true,
  updatedAt: true,
} as const;

const INTERVIEW_TERMINAL_STATUSES: readonly string[] = ['COMPLETED', 'CANCELLED', 'NO_SHOW'];

// Feedback is blocked only for statuses where no interview actually took place.
const INTERVIEW_FEEDBACK_BLOCKED_STATUSES: readonly string[] = ['CANCELLED', 'NO_SHOW'];

// Applications in these statuses may not receive new interviews (GD-M18-1 D5).
const APPLICATION_TERMINAL_STATUSES: readonly string[] = ['REJECTED', 'WITHDRAWN', 'HIRED'];

function toInterviewRecord(row: InterviewRow): InterviewRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    applicationId: row.applicationId,
    interviewType: row.interviewType,
    scheduledAt: row.scheduledAt,
    status: row.status,
    interviewerName: row.interviewerName,
    interviewerUserId: row.interviewerUserId,
    feedback: row.feedback,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// InterviewService
// ---------------------------------------------------------------------------

@Injectable()
export class InterviewService {
  private readonly logger = new Logger(InterviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createInterview(
    params: CreateInterviewParams,
    tenantId: string,
    actorId: string,
  ): Promise<CreateInterviewResult> {
    // Step 1: INTERVIEWER_REQUIRED — at least one interviewer field must be present (GD-M18-1 D13).
    // Both fields are optional at the DTO layer; enforcement is here at the service layer.
    if (!params.interviewerName && !params.interviewerUserId) {
      return { outcome: 'INTERVIEWER_REQUIRED' };
    }

    // Step 2: Validate application exists in this tenant, is not soft-deleted, and is not terminal.
    // tenantId filter prevents cross-tenant enumeration (SEC-003; GD-M18-1 D16).
    let appRow: { id: string; status: string } | null;
    try {
      appRow = await this.prisma.application.findFirst({
        where: { id: params.applicationId, tenantId, deletedAt: null },
        select: { id: true, status: true },
      });
    } catch (err) {
      this.logger.error('createInterview application check failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
    if (!appRow) return { outcome: 'APPLICATION_NOT_FOUND' };
    if (APPLICATION_TERMINAL_STATUSES.includes(appRow.status)) {
      return { outcome: 'APPLICATION_IN_TERMINAL_STATE' };
    }

    // Step 3: Validate interviewerUserId if provided.
    // No DB-level FK — service validates existence and same-tenant membership (GD-M18-1 D4).
    // Cross-tenant, absent, or soft-deleted user → identical 404 response (prevents user enumeration).
    if (params.interviewerUserId) {
      let userRow: { id: string } | null;
      try {
        userRow = await this.prisma.user.findFirst({
          where: { id: params.interviewerUserId, tenantId, deletedAt: null },
          select: { id: true },
        });
      } catch (err) {
        this.logger.error('createInterview interviewer check failed', err instanceof Error ? err.stack : String(err));
        return { outcome: 'INTERNAL_ERROR' };
      }
      if (!userRow) return { outcome: 'INTERVIEWER_NOT_FOUND' };
    }

    // Step 4: Create the interview with status SCHEDULED (GD-M18-1 D5).
    let row: InterviewRow;
    try {
      row = await this.prisma.interview.create({
        data: {
          tenantId,
          applicationId: params.applicationId,
          interviewType: params.interviewType,
          scheduledAt: params.scheduledAt ? new Date(params.scheduledAt) : null,
          status: 'SCHEDULED',
          interviewerName: params.interviewerName ?? null,
          interviewerUserId: params.interviewerUserId ?? null,
        },
        select: INTERVIEW_READ_SELECT,
      });
    } catch (err) {
      this.logger.error('createInterview failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }

    // Step 5: Emit audit event.
    // PII safety: interviewer_name must not appear in metadata (GD-M18-1 D17).
    // interviewerUserId IS permitted — it is a UUID, not a name (GD-M18-1 D17).
    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: AuditEventType.RECRUITING_INTERVIEW_SCHEDULED,
      result: 'SUCCESS',
      entityType: 'INTERVIEW',
      entityId: row.id,
      metadata: {
        applicationId: params.applicationId,
        interviewType: params.interviewType,
        ...(params.interviewerUserId ? { interviewerUserId: params.interviewerUserId } : {}),
      },
    });

    return { outcome: 'SUCCESS', interview: toInterviewRecord(row) };
  }

  async listInterviews(
    params: ListInterviewsParams,
    tenantId: string,
  ): Promise<ListInterviewsResult> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;

    const where = {
      tenantId,
      deletedAt: null,
      ...(params.applicationId !== undefined ? { applicationId: params.applicationId } : {}),
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.interviewType !== undefined ? { interviewType: params.interviewType } : {}),
    };

    let interviews: InterviewRow[];
    let total: number;
    try {
      [interviews, total] = await Promise.all([
        this.prisma.interview.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: INTERVIEW_READ_SELECT,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.interview.count({ where }),
      ]);
    } catch (err) {
      this.logger.error('listInterviews failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }

    return {
      outcome: 'SUCCESS',
      interviews: interviews.map(toInterviewRecord),
      total,
      page,
      pageSize,
    };
  }

  async getInterviewById(
    id: string,
    tenantId: string,
  ): Promise<GetInterviewByIdResult> {
    let row: InterviewRow | null;
    try {
      row = await this.prisma.interview.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: INTERVIEW_READ_SELECT,
      });
    } catch (err) {
      this.logger.error('getInterviewById failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (!row) return { outcome: 'INTERVIEW_NOT_FOUND' };
    return { outcome: 'SUCCESS', interview: toInterviewRecord(row) };
  }

  async updateInterview(
    id: string,
    params: UpdateInterviewParams,
    tenantId: string,
    actorId: string,
  ): Promise<UpdateInterviewResult> {
    try {
      // Step 1: Load existing interview with full select so we can inspect current interviewer
      // fields for the INTERVIEWER_REQUIRED check and return the record on no-op.
      const existing = await this.prisma.interview.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: INTERVIEW_READ_SELECT,
      });

      if (!existing) return { outcome: 'INTERVIEW_NOT_FOUND' };

      if (INTERVIEW_TERMINAL_STATUSES.includes(existing.status)) {
        return { outcome: 'INTERVIEW_IN_TERMINAL_STATE' };
      }

      // Step 2: INTERVIEWER_REQUIRED — compute the resulting interviewer values after the update.
      // If both would be null/absent/empty after applying params, reject (GD-M18-1 D13).
      const resultingName =
        params.interviewerName !== undefined ? params.interviewerName : existing.interviewerName;
      const resultingUserId =
        params.interviewerUserId !== undefined ? params.interviewerUserId : existing.interviewerUserId;

      if (!resultingName && !resultingUserId) {
        return { outcome: 'INTERVIEWER_REQUIRED' };
      }

      // Step 3: Validate new interviewerUserId if the param provides a non-null value.
      // No re-validation if the existing value is unchanged (params.interviewerUserId undefined).
      if (params.interviewerUserId !== undefined && params.interviewerUserId !== null) {
        const userRow = await this.prisma.user.findFirst({
          where: { id: params.interviewerUserId, tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!userRow) return { outcome: 'INTERVIEWER_NOT_FOUND' };
      }

      // Step 4: Build updateData — only include fields that are explicitly provided.
      const updateData: Record<string, unknown> = {};
      if (params.scheduledAt !== undefined) {
        updateData.scheduledAt = params.scheduledAt ? new Date(params.scheduledAt) : null;
      }
      if (params.interviewerName !== undefined) {
        updateData.interviewerName = params.interviewerName;
      }
      if (params.interviewerUserId !== undefined) {
        updateData.interviewerUserId = params.interviewerUserId;
      }

      // Step 5: No-op guard — return existing record without a DB write or audit event.
      if (Object.keys(updateData).length === 0) {
        return { outcome: 'SUCCESS', interview: toInterviewRecord(existing) };
      }

      // Step 6: Apply the update.
      const row = await this.prisma.interview.update({
        where: { id },
        data: updateData,
        select: INTERVIEW_READ_SELECT,
      });

      // Step 7: Emit audit event.
      // PII safety: field names only — no new values in metadata (GD-M18-1 D17).
      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.RECRUITING_INTERVIEW_UPDATED,
        result: 'SUCCESS',
        entityType: 'INTERVIEW',
        entityId: id,
        metadata: { interviewId: id, fieldsChanged: Object.keys(updateData) },
      });

      return { outcome: 'SUCCESS', interview: toInterviewRecord(row) };
    } catch (err) {
      this.logger.error('updateInterview failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  async completeInterview(
    id: string,
    tenantId: string,
    actorId: string,
  ): Promise<CompleteInterviewResult> {
    try {
      const existing = await this.prisma.interview.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true, applicationId: true },
      });

      if (!existing) return { outcome: 'INTERVIEW_NOT_FOUND' };

      if (INTERVIEW_TERMINAL_STATUSES.includes(existing.status)) {
        return { outcome: 'INTERVIEW_IN_TERMINAL_STATE' };
      }

      const row = await this.prisma.interview.update({
        where: { id },
        data: { status: 'COMPLETED' },
        select: INTERVIEW_READ_SELECT,
      });

      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.RECRUITING_INTERVIEW_COMPLETED,
        result: 'SUCCESS',
        entityType: 'INTERVIEW',
        entityId: id,
        metadata: { interviewId: id, applicationId: existing.applicationId, previousStatus: existing.status },
      });

      return { outcome: 'SUCCESS', interview: toInterviewRecord(row) };
    } catch (err) {
      this.logger.error('completeInterview failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  async recordFeedback(
    id: string,
    params: RecordFeedbackParams,
    tenantId: string,
    actorId: string,
  ): Promise<RecordFeedbackResult> {
    try {
      const existing = await this.prisma.interview.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true, applicationId: true },
      });

      if (!existing) return { outcome: 'INTERVIEW_NOT_FOUND' };

      // Feedback blocked on CANCELLED and NO_SHOW — no substantive interview took place (GD-M18-1 D5).
      if (INTERVIEW_FEEDBACK_BLOCKED_STATUSES.includes(existing.status)) {
        return { outcome: 'INTERVIEW_FEEDBACK_NOT_ALLOWED' };
      }

      const row = await this.prisma.interview.update({
        where: { id },
        data: { feedback: params.feedback },
        select: INTERVIEW_READ_SELECT,
      });

      // PII safety: feedback text MUST NOT appear in audit metadata (GD-M18-1 D17).
      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.RECRUITING_INTERVIEW_FEEDBACK_RECORDED,
        result: 'SUCCESS',
        entityType: 'INTERVIEW',
        entityId: id,
        metadata: { interviewId: id, applicationId: existing.applicationId },
      });

      return { outcome: 'SUCCESS', interview: toInterviewRecord(row) };
    } catch (err) {
      this.logger.error('recordFeedback failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  async cancelInterview(
    id: string,
    tenantId: string,
    actorId: string,
  ): Promise<CancelInterviewResult> {
    try {
      const existing = await this.prisma.interview.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true, applicationId: true },
      });

      if (!existing) return { outcome: 'INTERVIEW_NOT_FOUND' };

      if (INTERVIEW_TERMINAL_STATUSES.includes(existing.status)) {
        return { outcome: 'INTERVIEW_IN_TERMINAL_STATE' };
      }

      const row = await this.prisma.interview.update({
        where: { id },
        data: { status: 'CANCELLED' },
        select: INTERVIEW_READ_SELECT,
      });

      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.RECRUITING_INTERVIEW_CANCELLED,
        result: 'SUCCESS',
        entityType: 'INTERVIEW',
        entityId: id,
        metadata: { interviewId: id, applicationId: existing.applicationId, previousStatus: existing.status },
      });

      return { outcome: 'SUCCESS', interview: toInterviewRecord(row) };
    } catch (err) {
      this.logger.error('cancelInterview failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  async noShowInterview(
    id: string,
    tenantId: string,
    actorId: string,
  ): Promise<NoShowInterviewResult> {
    try {
      const existing = await this.prisma.interview.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true, applicationId: true },
      });

      if (!existing) return { outcome: 'INTERVIEW_NOT_FOUND' };

      if (INTERVIEW_TERMINAL_STATUSES.includes(existing.status)) {
        return { outcome: 'INTERVIEW_IN_TERMINAL_STATE' };
      }

      const row = await this.prisma.interview.update({
        where: { id },
        data: { status: 'NO_SHOW' },
        select: INTERVIEW_READ_SELECT,
      });

      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.RECRUITING_INTERVIEW_NO_SHOW,
        result: 'SUCCESS',
        entityType: 'INTERVIEW',
        entityId: id,
        metadata: { interviewId: id, applicationId: existing.applicationId, previousStatus: existing.status },
      });

      return { outcome: 'SUCCESS', interview: toInterviewRecord(row) };
    } catch (err) {
      this.logger.error('noShowInterview failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
  }
}
