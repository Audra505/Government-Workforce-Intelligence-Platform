// Reference: spec/01_requirements.md — FR-300 through FR-304 Candidate Management
// Reference: spec/06_api_contracts.md — Candidate API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: governance/GD-M16-1.md — Decisions 4, 5, 9, 10, 11, 12
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (tenant isolation), Decision 2 (status values)
// Reference: governance/GD-PRE-PHASE3-003.md — RBAC authority (enforced at controller, not service)
//
// CandidateService is transport-agnostic: no HTTP exceptions thrown, no HTTP responses returned.
// HTTP status mapping is the sole responsibility of CandidateController (Step 4).
//
// tenantId is never derived from params — only from the caller-supplied JWT context (SEC-003).
// All read queries include WHERE tenantId AND deletedAt IS NULL (SEC-003).
// CANDIDATE_NOT_FOUND returned for absent, soft-deleted, and cross-tenant records — prevents enumeration (SEC-003).
// Audit events are emitted after write operations, not inside transactions (EMP-700 pattern).
// PII safety: field values (names, email, phone, notes) must not appear in audit metadata — field names only.
// Email uniqueness: enforced by partial unique index WHERE deleted_at IS NULL (GD-M16-1 D5).
//   Pre-check provides deterministic error code; P2002 catch handles race condition.
// status is always set to ACTIVE by createCandidate — never accepted from caller (GD-PRE-PHASE3-002 D2).
// listCandidates defaults to ACTIVE-only when status filter is absent (GD-M16-1 D9).
// CANDIDATE_HAS_ACTIVE_APPLICATIONS: returned when candidate has non-terminal applications.
//   Real implementation added in M17 (GD-M17-1 D9 — replaced M16 stub).

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';

// ---------------------------------------------------------------------------
// Parameter types
// Plain TypeScript interfaces consumed by CandidateService.
// DTOs with class-validator decorators are defined separately and used by CandidateController.
// ---------------------------------------------------------------------------

export type CreateCandidateParams = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  source?: string;
  notes?: string;
};

export type UpdateCandidateParams = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  source?: string;
  notes?: string;
};

export type ListCandidatesParams = {
  page?: number;
  pageSize?: number;
  status?: string;
};

// ---------------------------------------------------------------------------
// CandidateRecord — shared read shape produced by all service read paths.
// tenantId is present for service-layer completeness; controller must not expose it in HTTP
//   responses (SEC-003 — GD-PRE-PHASE3-002 D1).
// deletedAt is excluded: archived candidates are soft-deleted and invisible to all callers (→ NOT_FOUND).
// ---------------------------------------------------------------------------

export type CandidateRecord = {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  status: string;
  source: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// Discriminated union result types
// ---------------------------------------------------------------------------

export type CreateCandidateResult =
  | { outcome: 'SUCCESS'; candidate: CandidateRecord }
  | { outcome: 'CANDIDATE_EMAIL_ALREADY_EXISTS' }
  | { outcome: 'INTERNAL_ERROR' };

export type ListCandidatesResult =
  | {
      outcome: 'SUCCESS';
      candidates: CandidateRecord[];
      total: number;
      page: number;
      pageSize: number;
    }
  | { outcome: 'INTERNAL_ERROR' };

export type GetCandidateByIdResult =
  | { outcome: 'SUCCESS'; candidate: CandidateRecord }
  | { outcome: 'CANDIDATE_NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

export type UpdateCandidateResult =
  | { outcome: 'SUCCESS'; candidate: CandidateRecord }
  | { outcome: 'CANDIDATE_NOT_FOUND' }
  | { outcome: 'CANDIDATE_EMAIL_ALREADY_EXISTS' }
  | { outcome: 'INTERNAL_ERROR' };

export type ArchiveCandidateResult =
  | { outcome: 'SUCCESS' }
  | { outcome: 'CANDIDATE_NOT_FOUND' }
  | { outcome: 'CANDIDATE_HAS_ACTIVE_APPLICATIONS' }   // M17 stub — unreachable in M16
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// Internal types and constants
// ---------------------------------------------------------------------------

// Matches the Prisma select result shape for CANDIDATE_READ_SELECT.
type CandidateRow = {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  status: string;
  source: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// Shared Prisma select for all read operations.
const CANDIDATE_READ_SELECT = {
  id: true,
  tenantId: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  status: true,
  source: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toCandidateRecord(row: CandidateRow): CandidateRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    status: row.status,
    source: row.source,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// CandidateService
// ---------------------------------------------------------------------------

@Injectable()
export class CandidateService {
  private readonly logger = new Logger(CandidateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createCandidate(
    params: CreateCandidateParams,
    tenantId: string,
    actorId: string,
  ): Promise<CreateCandidateResult> {
    // Pre-check: email uniqueness within tenant among non-archived records (GD-M16-1 D5).
    // Partial unique index (WHERE deleted_at IS NULL) backs this up at the DB layer.
    // Pre-check here gives a deterministic error code; P2002 catch below handles race conditions.
    try {
      const duplicate = await this.prisma.candidate.findFirst({
        where: { tenantId, email: params.email, deletedAt: null },
        select: { id: true },
      });
      if (duplicate) return { outcome: 'CANDIDATE_EMAIL_ALREADY_EXISTS' };
    } catch (err) {
      this.logger.error(
        'createCandidate email check failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    let row: CandidateRow;
    try {
      row = await this.prisma.candidate.create({
        data: {
          tenantId,
          firstName: params.firstName,
          lastName: params.lastName,
          email: params.email,
          phone: params.phone ?? null,
          source: params.source ?? null,
          notes: params.notes ?? null,
          status: 'ACTIVE',
        },
        select: CANDIDATE_READ_SELECT,
      });
    } catch (err) {
      // Backup: P2002 from partial unique index when pre-check and insert race.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return { outcome: 'CANDIDATE_EMAIL_ALREADY_EXISTS' };
      }
      this.logger.error(
        'createCandidate failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    // Audit emitted after write — outside transaction per EMP-700 pattern.
    // PII safety: metadata contains only status — no names, email, phone, or notes.
    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: AuditEventType.RECRUITING_CANDIDATE_CREATED,
      result: 'SUCCESS',
      entityType: 'CANDIDATE',
      entityId: row.id,
      metadata: {
        status: row.status,
      },
    });

    return { outcome: 'SUCCESS', candidate: toCandidateRecord(row) };
  }

  async listCandidates(
    params: ListCandidatesParams,
    tenantId: string,
  ): Promise<ListCandidatesResult> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;

    // Absent status defaults to ACTIVE-only (GD-M16-1 D9 list semantics).
    // Callers supplying ARCHIVED receive archived records (RBAC enforced at controller).
    const statusFilter = params.status ?? 'ACTIVE';

    const where = {
      tenantId,
      // ACTIVE candidates have deletedAt=null; ARCHIVED have deletedAt set — exclude the null
      // guard when querying ARCHIVED so soft-deleted rows are visible to the caller.
      ...(statusFilter === 'ACTIVE' ? { deletedAt: null } : {}),
      status: statusFilter,
    };

    let candidates: CandidateRow[];
    let total: number;
    try {
      [candidates, total] = await Promise.all([
        this.prisma.candidate.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: CANDIDATE_READ_SELECT,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.candidate.count({ where }),
      ]);
    } catch (err) {
      this.logger.error(
        'listCandidates failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    return {
      outcome: 'SUCCESS',
      candidates: candidates.map(toCandidateRecord),
      total,
      page,
      pageSize,
    };
  }

  async getCandidateById(
    id: string,
    tenantId: string,
  ): Promise<GetCandidateByIdResult> {
    let row: CandidateRow | null;
    try {
      // findFirst with tenantId enforces SEC-003 at the DB query level.
      // CANDIDATE_NOT_FOUND returned for absent, cross-tenant, and archived/deleted — prevents enumeration.
      row = await this.prisma.candidate.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: CANDIDATE_READ_SELECT,
      });
    } catch (err) {
      this.logger.error(
        'getCandidateById failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (!row) return { outcome: 'CANDIDATE_NOT_FOUND' };
    return { outcome: 'SUCCESS', candidate: toCandidateRecord(row) };
  }

  async updateCandidate(
    id: string,
    params: UpdateCandidateParams,
    tenantId: string,
    actorId: string,
  ): Promise<UpdateCandidateResult> {
    try {
      const existing = await this.prisma.candidate.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true },
      });

      if (!existing) return { outcome: 'CANDIDATE_NOT_FOUND' };

      // Email uniqueness check: only when email is changing (GD-M16-1 D5).
      // Self-excluded so a no-change email re-submission does not falsely conflict.
      if (params.email !== undefined) {
        const duplicate = await this.prisma.candidate.findFirst({
          where: {
            tenantId,
            email: params.email,
            deletedAt: null,
            NOT: { id },
          },
          select: { id: true },
        });
        if (duplicate) return { outcome: 'CANDIDATE_EMAIL_ALREADY_EXISTS' };
      }

      const updateData = {
        ...(params.firstName !== undefined ? { firstName: params.firstName } : {}),
        ...(params.lastName !== undefined ? { lastName: params.lastName } : {}),
        ...(params.email !== undefined ? { email: params.email } : {}),
        ...(params.phone !== undefined ? { phone: params.phone } : {}),
        ...(params.source !== undefined ? { source: params.source } : {}),
        ...(params.notes !== undefined ? { notes: params.notes } : {}),
      };

      const row = await this.prisma.candidate.update({
        where: { id },
        data: updateData,
        select: CANDIDATE_READ_SELECT,
      });

      // PII safety: audit metadata records field names only — not field values (EMP-401 pattern).
      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.RECRUITING_CANDIDATE_UPDATED,
        result: 'SUCCESS',
        entityType: 'CANDIDATE',
        entityId: row.id,
        metadata: {
          updatedFields: Object.keys(updateData),
        },
      });

      return { outcome: 'SUCCESS', candidate: toCandidateRecord(row) };
    } catch (err) {
      this.logger.error(
        'updateCandidate failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  async archiveCandidate(
    id: string,
    tenantId: string,
    actorId: string,
  ): Promise<ArchiveCandidateResult> {
    try {
      const existing = await this.prisma.candidate.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true },
      });

      if (!existing) return { outcome: 'CANDIDATE_NOT_FOUND' };

      // M17 active application guard (GD-M17-1 D9).
      // Blocking statuses: any application that is not REJECTED, WITHDRAWN, or soft-deleted.
      // HIRED is included in the blocking set for M19 forward-compatibility (GD-M17-1 D9).
      const activeApplicationCount = await this.prisma.application.count({
        where: {
          tenantId,
          candidateId: id,
          deletedAt: null,
          status: { notIn: ['REJECTED', 'WITHDRAWN'] },
        },
      });
      if (activeApplicationCount > 0) return { outcome: 'CANDIDATE_HAS_ACTIVE_APPLICATIONS' };

      await this.prisma.candidate.update({
        where: { id },
        data: {
          status: 'ARCHIVED',
          deletedAt: new Date(),
        },
      });

      // PII safety: metadata contains only the archive action marker — no names, email, notes.
      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.RECRUITING_CANDIDATE_ARCHIVED,
        result: 'SUCCESS',
        entityType: 'CANDIDATE',
        entityId: id,
        metadata: {
          action: 'ARCHIVE',
        },
      });

      return { outcome: 'SUCCESS' };
    } catch (err) {
      this.logger.error(
        'archiveCandidate failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }
}
