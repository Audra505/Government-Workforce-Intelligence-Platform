// Reference: spec/01_requirements.md — FR-114, FR-151 Certifications Management
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/15_certification_management_rules.md — CRT-001 through CRT-103
// Reference: governance/GD-M13-1.md — per-tenant certifications catalog
// Reference: governance/GD-M13-2.md — API design decisions (Decisions 2, 5, 9)
// Reference: governance/GD-M13-4.md — audit event requirements (Decision 4)
//
// CertificationService is transport-agnostic: no HTTP exceptions, no HTTP responses.
// HTTP status mapping is the sole responsibility of CertificationController.
//
// SEC-003 enforcement (GD-M13-1 Decision 3, CRT-002):
//   - tenantId is never derived from DTOs; always passed in from the caller's JWT context.
//   - All read queries include WHERE tenantId = ? AND deletedAt IS NULL.
//   - NOT_FOUND returned for absent, soft-deleted, and cross-tenant records identically.
//   - findFirst (not findUnique) used so tenantId can be included in the WHERE clause.
//
// CRT-003: name uniqueness enforced by idx_certifications_tenant_name UNIQUE(tenant_id, name).
//   P2002 from Prisma → CERTIFICATION_NAME_CONFLICT.
//
// GD-M13-4 Decision 4: audit events emitted after write operations, outside the write transaction.

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';

// ---------------------------------------------------------------------------
// Parameter types
// ---------------------------------------------------------------------------

export type CreateCertificationParams = {
  name: string;
  expirationRequired: boolean;
  issuer?: string;
};

export type UpdateCertificationParams = {
  name?: string;
  expirationRequired?: boolean;
  issuer?: string;
};

export type ListCertificationsParams = {
  page?: number;
  pageSize?: number;
};

// ---------------------------------------------------------------------------
// CertificationRecord — shared read shape produced by all service read paths.
// deletedAt excluded — never exposed to callers.
// ---------------------------------------------------------------------------

export type CertificationRecord = {
  id: string;
  tenantId: string;
  name: string;
  issuer: string | null;
  expirationRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// Discriminated union result types
// ---------------------------------------------------------------------------

export type CreateCertificationResult =
  | { outcome: 'SUCCESS'; certification: CertificationRecord }
  | { outcome: 'CERTIFICATION_NAME_CONFLICT' }
  | { outcome: 'INTERNAL_ERROR' };

export type ListCertificationsResult =
  | {
      outcome: 'SUCCESS';
      certifications: CertificationRecord[];
      total: number;
      page: number;
      pageSize: number;
    }
  | { outcome: 'INTERNAL_ERROR' };

export type GetCertificationByIdResult =
  | { outcome: 'SUCCESS'; certification: CertificationRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

export type UpdateCertificationResult =
  | { outcome: 'SUCCESS'; certification: CertificationRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'CERTIFICATION_NAME_CONFLICT' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type CertificationRow = {
  id: string;
  tenantId: string;
  name: string;
  issuer: string | null;
  expirationRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const CERTIFICATION_READ_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  issuer: true,
  expirationRequired: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toCertificationRecord(row: CertificationRow): CertificationRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    issuer: row.issuer,
    expirationRequired: row.expirationRequired,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// CertificationService
// ---------------------------------------------------------------------------

@Injectable()
export class CertificationService {
  private readonly logger = new Logger(CertificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createCertification(
    params: CreateCertificationParams,
    tenantId: string,
    actorId: string,
  ): Promise<CreateCertificationResult> {
    let row: CertificationRow;
    try {
      row = await this.prisma.certification.create({
        data: {
          tenantId,
          name: params.name,
          expirationRequired: params.expirationRequired,
          issuer: params.issuer ?? null,
        },
        select: CERTIFICATION_READ_SELECT,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return { outcome: 'CERTIFICATION_NAME_CONFLICT' };
      }
      this.logger.error(
        'createCertification failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: AuditEventType.WORKFORCE_CERTIFICATION_CREATED,
      result: 'SUCCESS',
      entityType: 'CERTIFICATION',
      entityId: row.id,
      metadata: { certificationId: row.id, certificationName: row.name },
    });

    return { outcome: 'SUCCESS', certification: toCertificationRecord(row) };
  }

  async listCertifications(
    tenantId: string,
    params: ListCertificationsParams,
  ): Promise<ListCertificationsResult> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;

    const where: Prisma.CertificationWhereInput = {
      tenantId,
      deletedAt: null,
    };

    let rows: CertificationRow[];
    let total: number;
    try {
      [rows, total] = await Promise.all([
        this.prisma.certification.findMany({
          where,
          select: CERTIFICATION_READ_SELECT,
          orderBy: { name: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.certification.count({ where }),
      ]);
    } catch (err) {
      this.logger.error(
        'listCertifications failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    return {
      outcome: 'SUCCESS',
      certifications: rows.map(toCertificationRecord),
      total,
      page,
      pageSize,
    };
  }

  async getCertificationById(
    id: string,
    tenantId: string,
  ): Promise<GetCertificationByIdResult> {
    let row: CertificationRow | null;
    try {
      row = await this.prisma.certification.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: CERTIFICATION_READ_SELECT,
      });
    } catch (err) {
      this.logger.error(
        'getCertificationById failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (!row) return { outcome: 'NOT_FOUND' };
    return { outcome: 'SUCCESS', certification: toCertificationRecord(row) };
  }

  async updateCertification(
    id: string,
    params: UpdateCertificationParams,
    tenantId: string,
    actorId: string,
  ): Promise<UpdateCertificationResult> {
    // Verify ownership before update — prevents cross-tenant mutation (SEC-003, CRT-002).
    let existing: CertificationRow | null;
    try {
      existing = await this.prisma.certification.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: CERTIFICATION_READ_SELECT,
      });
    } catch (err) {
      this.logger.error(
        'updateCertification findFirst failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (!existing) return { outcome: 'NOT_FOUND' };

    const updatedFields = (Object.keys(params) as Array<keyof UpdateCertificationParams>).filter(
      (k) => params[k] !== undefined,
    );

    let row: CertificationRow;
    try {
      row = await this.prisma.certification.update({
        where: { id },
        data: {
          ...(params.name !== undefined ? { name: params.name } : {}),
          ...(params.expirationRequired !== undefined ? { expirationRequired: params.expirationRequired } : {}),
          ...(params.issuer !== undefined ? { issuer: params.issuer } : {}),
        },
        select: CERTIFICATION_READ_SELECT,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return { outcome: 'CERTIFICATION_NAME_CONFLICT' };
      }
      this.logger.error(
        'updateCertification update failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: AuditEventType.WORKFORCE_CERTIFICATION_UPDATED,
      result: 'SUCCESS',
      entityType: 'CERTIFICATION',
      entityId: row.id,
      metadata: { certificationId: row.id, updatedFields },
    });

    return { outcome: 'SUCCESS', certification: toCertificationRecord(row) };
  }
}
