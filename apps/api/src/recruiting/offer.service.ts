// Reference: spec/01_requirements.md — FR-315 through FR-324 Offer Management
// Reference: spec/06_api_contracts.md — Offer API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: governance/GD-M18-1.md — Decisions 3, 6, 7, 9, 10, 13, 14, 16, 17
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (tenant isolation), Decision 8 (status values)
// Reference: governance/GD-PRE-PHASE3-003.md — RBAC authority (enforced at controller, not service)
//
// OfferService is transport-agnostic: no HTTP exceptions thrown, no HTTP responses returned.
// HTTP status mapping is the sole responsibility of OfferController (Step 4).
//
// tenantId is never derived from params — only from the caller-supplied JWT context (SEC-003).
// All read queries include WHERE tenantId AND deletedAt IS NULL (SEC-003; GD-M18-1 D16).
// OFFER_NOT_FOUND returned for absent, soft-deleted, and cross-tenant records — prevents enumeration.
// APPLICATION_NOT_FOUND returned for absent, soft-deleted, and cross-tenant applications.
// Audit events emitted after write operations (GD-M18-1 D17).
// PII safety: notes text and offerDate value must not appear in audit metadata (GD-M18-1 D17).
// Active offer = deleted_at IS NULL AND status NOT IN ('DECLINED', 'WITHDRAWN') (GD-M18-1 D10).
// ACCEPTED blocks re-offer — it is intentionally excluded from the partial unique index exclusion list.
// P2002 on prisma.offer.create → ACTIVE_OFFER_EXISTS (race condition on partial unique index).
// Offer acceptance must NOT create an employee record and must NOT set application.status (GD-M18-1 D3, D9).

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';

// ---------------------------------------------------------------------------
// Parameter types
// Plain TypeScript interfaces consumed by OfferService.
// DTOs with class-validator decorators are defined separately (Step 2).
// ---------------------------------------------------------------------------

export type CreateOfferParams = {
  applicationId: string;
  offerDate?: string;
  notes?: string;
};

export type UpdateOfferParams = {
  offerDate?: string | null;
  notes?: string | null;
};

export type RecordOfferResponseParams = {
  response: 'ACCEPTED' | 'DECLINED';
};

export type ListOffersParams = {
  page?: number;
  pageSize?: number;
  applicationId?: string;
  status?: string;
};

// ---------------------------------------------------------------------------
// OfferRecord — shared read shape produced by all service read paths.
// tenantId is present for service-layer completeness; controller must strip it
//   from HTTP responses (SEC-003 — GD-M18-1 D16).
// deletedAt is excluded: soft-deleted offers are invisible to all callers (→ NOT_FOUND).
// ---------------------------------------------------------------------------

export type OfferRecord = {
  id: string;
  tenantId: string;
  applicationId: string;
  status: string;
  offerDate: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// Discriminated union result types
// ---------------------------------------------------------------------------

export type CreateOfferResult =
  | { outcome: 'SUCCESS'; offer: OfferRecord }
  | { outcome: 'APPLICATION_NOT_FOUND' }
  | { outcome: 'APPLICATION_NOT_AT_OFFER_STATUS' }
  | { outcome: 'ACTIVE_OFFER_EXISTS' }
  | { outcome: 'INTERNAL_ERROR' };

export type ListOffersResult =
  | {
      outcome: 'SUCCESS';
      offers: OfferRecord[];
      total: number;
      page: number;
      pageSize: number;
    }
  | { outcome: 'INTERNAL_ERROR' };

export type GetOfferByIdResult =
  | { outcome: 'SUCCESS'; offer: OfferRecord }
  | { outcome: 'OFFER_NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

export type UpdateOfferResult =
  | { outcome: 'SUCCESS'; offer: OfferRecord }
  | { outcome: 'OFFER_NOT_FOUND' }
  | { outcome: 'OFFER_NOT_IN_DRAFT' }
  | { outcome: 'OFFER_IN_TERMINAL_STATE' }
  | { outcome: 'INTERNAL_ERROR' };

export type SubmitOfferResult =
  | { outcome: 'SUCCESS'; offer: OfferRecord }
  | { outcome: 'OFFER_NOT_FOUND' }
  | { outcome: 'OFFER_NOT_IN_DRAFT' }
  | { outcome: 'OFFER_IN_TERMINAL_STATE' }
  | { outcome: 'INTERNAL_ERROR' };

export type ApproveOfferResult =
  | { outcome: 'SUCCESS'; offer: OfferRecord }
  | { outcome: 'OFFER_NOT_FOUND' }
  | { outcome: 'OFFER_NOT_PENDING_APPROVAL' }
  | { outcome: 'OFFER_IN_TERMINAL_STATE' }
  | { outcome: 'INTERNAL_ERROR' };

export type SendOfferResult =
  | { outcome: 'SUCCESS'; offer: OfferRecord }
  | { outcome: 'OFFER_NOT_FOUND' }
  | { outcome: 'OFFER_NOT_APPROVED' }
  | { outcome: 'OFFER_IN_TERMINAL_STATE' }
  | { outcome: 'INTERNAL_ERROR' };

export type RecordOfferResponseResult =
  | { outcome: 'SUCCESS'; offer: OfferRecord }
  | { outcome: 'OFFER_NOT_FOUND' }
  | { outcome: 'OFFER_NOT_SENT' }
  | { outcome: 'OFFER_IN_TERMINAL_STATE' }
  | { outcome: 'INTERNAL_ERROR' };

export type WithdrawOfferResult =
  | { outcome: 'SUCCESS'; offer: OfferRecord }
  | { outcome: 'OFFER_NOT_FOUND' }
  | { outcome: 'OFFER_IN_TERMINAL_STATE' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// Internal types and constants
// ---------------------------------------------------------------------------

type OfferRow = {
  id: string;
  tenantId: string;
  applicationId: string;
  status: string;
  offerDate: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const OFFER_READ_SELECT = {
  id: true,
  tenantId: true,
  applicationId: true,
  status: true,
  offerDate: true,
  acceptedAt: true,
  declinedAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Terminal statuses — once reached, no further transitions are permitted (GD-M18-1 D7).
const OFFER_TERMINAL_STATUSES: readonly string[] = ['ACCEPTED', 'DECLINED', 'WITHDRAWN'];

function toOfferRecord(row: OfferRow): OfferRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    applicationId: row.applicationId,
    status: row.status,
    offerDate: row.offerDate,
    acceptedAt: row.acceptedAt,
    declinedAt: row.declinedAt,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// OfferService
// ---------------------------------------------------------------------------

@Injectable()
export class OfferService {
  private readonly logger = new Logger(OfferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createOffer(
    params: CreateOfferParams,
    tenantId: string,
    actorId: string,
  ): Promise<CreateOfferResult> {
    // Step 1: Validate application exists in this tenant, is not soft-deleted.
    // tenantId filter prevents cross-tenant enumeration (SEC-003; GD-M18-1 D16).
    let appRow: { id: string; status: string } | null;
    try {
      appRow = await this.prisma.application.findFirst({
        where: { id: params.applicationId, tenantId, deletedAt: null },
        select: { id: true, status: true },
      });
    } catch (err) {
      this.logger.error('createOffer application check failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
    if (!appRow) return { outcome: 'APPLICATION_NOT_FOUND' };

    // Step 2: Application must be in OFFER status (GD-M18-1 D7).
    // Covers ALL non-OFFER statuses including APPLIED, INTERVIEW, REJECTED, WITHDRAWN, HIRED.
    if (appRow.status !== 'OFFER') {
      return { outcome: 'APPLICATION_NOT_AT_OFFER_STATUS' };
    }

    // Step 3: Active offer guard — no active offer may exist.
    // Active = deleted_at IS NULL AND status NOT IN ('DECLINED', 'WITHDRAWN').
    // ACCEPTED intentionally blocks re-offer (GD-M18-1 D10).
    let existingOffer: { id: string } | null;
    try {
      existingOffer = await this.prisma.offer.findFirst({
        where: {
          applicationId: params.applicationId,
          deletedAt: null,
          status: { notIn: ['DECLINED', 'WITHDRAWN'] },
        },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error('createOffer active offer check failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
    if (existingOffer) return { outcome: 'ACTIVE_OFFER_EXISTS' };

    // Step 4: Create the offer with status DRAFT (GD-M18-1 D7).
    // Catch P2002 — partial unique index race condition (two concurrent creates) (GD-M18-1 D10).
    let row: OfferRow;
    try {
      row = await this.prisma.offer.create({
        data: {
          tenantId,
          applicationId: params.applicationId,
          status: 'DRAFT',
          offerDate: params.offerDate ? new Date(params.offerDate) : null,
          notes: params.notes ?? null,
        },
        select: OFFER_READ_SELECT,
      });
    } catch (err) {
      if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
        return { outcome: 'ACTIVE_OFFER_EXISTS' };
      }
      this.logger.error('createOffer failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }

    // Step 5: Audit event.
    // PII safety: notes text and offerDate value must NOT appear in metadata (GD-M18-1 D17).
    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: AuditEventType.RECRUITING_OFFER_CREATED,
      result: 'SUCCESS',
      entityType: 'OFFER',
      entityId: row.id,
      metadata: { offerId: row.id, applicationId: params.applicationId },
    });

    return { outcome: 'SUCCESS', offer: toOfferRecord(row) };
  }

  async listOffers(
    params: ListOffersParams,
    tenantId: string,
  ): Promise<ListOffersResult> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;

    const where = {
      tenantId,
      deletedAt: null,
      ...(params.applicationId !== undefined ? { applicationId: params.applicationId } : {}),
      ...(params.status !== undefined ? { status: params.status } : {}),
    };

    let offers: OfferRow[];
    let total: number;
    try {
      [offers, total] = await Promise.all([
        this.prisma.offer.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: OFFER_READ_SELECT,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.offer.count({ where }),
      ]);
    } catch (err) {
      this.logger.error('listOffers failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }

    return {
      outcome: 'SUCCESS',
      offers: offers.map(toOfferRecord),
      total,
      page,
      pageSize,
    };
  }

  async getOfferById(
    id: string,
    tenantId: string,
  ): Promise<GetOfferByIdResult> {
    let row: OfferRow | null;
    try {
      row = await this.prisma.offer.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: OFFER_READ_SELECT,
      });
    } catch (err) {
      this.logger.error('getOfferById failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (!row) return { outcome: 'OFFER_NOT_FOUND' };
    return { outcome: 'SUCCESS', offer: toOfferRecord(row) };
  }

  async updateOffer(
    id: string,
    params: UpdateOfferParams,
    tenantId: string,
    actorId: string,
  ): Promise<UpdateOfferResult> {
    try {
      const existing = await this.prisma.offer.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: OFFER_READ_SELECT,
      });

      if (!existing) return { outcome: 'OFFER_NOT_FOUND' };

      // Terminal check first — ACCEPTED/DECLINED/WITHDRAWN are fully locked.
      if (OFFER_TERMINAL_STATUSES.includes(existing.status)) {
        return { outcome: 'OFFER_IN_TERMINAL_STATE' };
      }

      // Only DRAFT offers may be updated (GD-M18-1 D7).
      // Non-terminal non-DRAFT (PENDING_APPROVAL, APPROVED, SENT) → OFFER_NOT_IN_DRAFT.
      if (existing.status !== 'DRAFT') {
        return { outcome: 'OFFER_NOT_IN_DRAFT' };
      }

      // Build updateData — only include fields that are explicitly provided.
      const updateData: Record<string, unknown> = {};
      if (params.offerDate !== undefined) {
        updateData.offerDate = params.offerDate ? new Date(params.offerDate) : null;
      }
      if (params.notes !== undefined) {
        updateData.notes = params.notes;
      }

      // No-op guard — return existing record without DB write or audit event.
      if (Object.keys(updateData).length === 0) {
        return { outcome: 'SUCCESS', offer: toOfferRecord(existing) };
      }

      const row = await this.prisma.offer.update({
        where: { id },
        data: updateData,
        select: OFFER_READ_SELECT,
      });

      // PII safety: field names only — no values in metadata (GD-M18-1 D17).
      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.RECRUITING_OFFER_UPDATED,
        result: 'SUCCESS',
        entityType: 'OFFER',
        entityId: id,
        metadata: { offerId: id, applicationId: existing.applicationId, fieldsChanged: Object.keys(updateData) },
      });

      return { outcome: 'SUCCESS', offer: toOfferRecord(row) };
    } catch (err) {
      this.logger.error('updateOffer failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  async submitOffer(
    id: string,
    tenantId: string,
    actorId: string,
  ): Promise<SubmitOfferResult> {
    try {
      const existing = await this.prisma.offer.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true, applicationId: true },
      });

      if (!existing) return { outcome: 'OFFER_NOT_FOUND' };

      if (OFFER_TERMINAL_STATUSES.includes(existing.status)) {
        return { outcome: 'OFFER_IN_TERMINAL_STATE' };
      }

      if (existing.status !== 'DRAFT') {
        return { outcome: 'OFFER_NOT_IN_DRAFT' };
      }

      const row = await this.prisma.offer.update({
        where: { id },
        data: { status: 'PENDING_APPROVAL' },
        select: OFFER_READ_SELECT,
      });

      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.RECRUITING_OFFER_SUBMITTED,
        result: 'SUCCESS',
        entityType: 'OFFER',
        entityId: id,
        metadata: { offerId: id, applicationId: existing.applicationId, previousStatus: existing.status },
      });

      return { outcome: 'SUCCESS', offer: toOfferRecord(row) };
    } catch (err) {
      this.logger.error('submitOffer failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  async approveOffer(
    id: string,
    tenantId: string,
    actorId: string,
  ): Promise<ApproveOfferResult> {
    try {
      const existing = await this.prisma.offer.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true, applicationId: true },
      });

      if (!existing) return { outcome: 'OFFER_NOT_FOUND' };

      if (OFFER_TERMINAL_STATUSES.includes(existing.status)) {
        return { outcome: 'OFFER_IN_TERMINAL_STATE' };
      }

      if (existing.status !== 'PENDING_APPROVAL') {
        return { outcome: 'OFFER_NOT_PENDING_APPROVAL' };
      }

      const row = await this.prisma.offer.update({
        where: { id },
        data: { status: 'APPROVED' },
        select: OFFER_READ_SELECT,
      });

      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.RECRUITING_OFFER_APPROVED,
        result: 'SUCCESS',
        entityType: 'OFFER',
        entityId: id,
        metadata: { offerId: id, applicationId: existing.applicationId, previousStatus: existing.status },
      });

      return { outcome: 'SUCCESS', offer: toOfferRecord(row) };
    } catch (err) {
      this.logger.error('approveOffer failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  async sendOffer(
    id: string,
    tenantId: string,
    actorId: string,
  ): Promise<SendOfferResult> {
    try {
      const existing = await this.prisma.offer.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true, applicationId: true },
      });

      if (!existing) return { outcome: 'OFFER_NOT_FOUND' };

      if (OFFER_TERMINAL_STATUSES.includes(existing.status)) {
        return { outcome: 'OFFER_IN_TERMINAL_STATE' };
      }

      if (existing.status !== 'APPROVED') {
        return { outcome: 'OFFER_NOT_APPROVED' };
      }

      const row = await this.prisma.offer.update({
        where: { id },
        data: { status: 'SENT' },
        select: OFFER_READ_SELECT,
      });

      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.RECRUITING_OFFER_SENT,
        result: 'SUCCESS',
        entityType: 'OFFER',
        entityId: id,
        metadata: { offerId: id, applicationId: existing.applicationId, previousStatus: existing.status },
      });

      return { outcome: 'SUCCESS', offer: toOfferRecord(row) };
    } catch (err) {
      this.logger.error('sendOffer failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  async recordOfferResponse(
    id: string,
    params: RecordOfferResponseParams,
    tenantId: string,
    actorId: string,
  ): Promise<RecordOfferResponseResult> {
    try {
      const existing = await this.prisma.offer.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true, applicationId: true },
      });

      if (!existing) return { outcome: 'OFFER_NOT_FOUND' };

      if (OFFER_TERMINAL_STATUSES.includes(existing.status)) {
        return { outcome: 'OFFER_IN_TERMINAL_STATE' };
      }

      if (existing.status !== 'SENT') {
        return { outcome: 'OFFER_NOT_SENT' };
      }

      const now = new Date();
      const updateData =
        params.response === 'ACCEPTED'
          ? { status: 'ACCEPTED', acceptedAt: now }
          : { status: 'DECLINED', declinedAt: now };

      const row = await this.prisma.offer.update({
        where: { id },
        data: updateData,
        select: OFFER_READ_SELECT,
      });

      // CRITICAL: Must NOT call prisma.application.update or prisma.employee.create.
      // Application status stays 'OFFER' after acceptance. Hire-to-employee is M19 scope (GD-M18-1 D3, D9).

      const auditAction =
        params.response === 'ACCEPTED'
          ? AuditEventType.RECRUITING_OFFER_ACCEPTED
          : AuditEventType.RECRUITING_OFFER_DECLINED;

      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: auditAction,
        result: 'SUCCESS',
        entityType: 'OFFER',
        entityId: id,
        metadata: { offerId: id, applicationId: existing.applicationId, previousStatus: existing.status },
      });

      return { outcome: 'SUCCESS', offer: toOfferRecord(row) };
    } catch (err) {
      this.logger.error('recordOfferResponse failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  async withdrawOffer(
    id: string,
    tenantId: string,
    actorId: string,
  ): Promise<WithdrawOfferResult> {
    try {
      const existing = await this.prisma.offer.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true, applicationId: true },
      });

      if (!existing) return { outcome: 'OFFER_NOT_FOUND' };

      if (OFFER_TERMINAL_STATUSES.includes(existing.status)) {
        return { outcome: 'OFFER_IN_TERMINAL_STATE' };
      }

      const row = await this.prisma.offer.update({
        where: { id },
        data: { status: 'WITHDRAWN' },
        select: OFFER_READ_SELECT,
      });

      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.RECRUITING_OFFER_WITHDRAWN,
        result: 'SUCCESS',
        entityType: 'OFFER',
        entityId: id,
        metadata: { offerId: id, applicationId: existing.applicationId, previousStatus: existing.status },
      });

      return { outcome: 'SUCCESS', offer: toOfferRecord(row) };
    } catch (err) {
      this.logger.error('withdrawOffer failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }
  }
}
