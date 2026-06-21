// Reference: spec/01_requirements.md — FR-114 Employee Certification Assignment
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/15_certification_management_rules.md — CRT-200 through CRT-302
// Reference: governance/GD-M13-1.md — Decision 7 (no tenant_id on junction)
// Reference: governance/GD-M13-2.md — Decision 16 (GET contract), Decision 15 (HTTP status)
// Reference: governance/GD-M13-3.md — Decisions 1–7 (status enumeration and constraints)
// Reference: governance/GD-M13-4.md — Decision 3 (upsert semantics), Decisions 4–5 (audit events)
//
// Transport-agnostic service — no HTTP exceptions, no HttpStatus references.
//
// Tenant isolation (GD-M13-1 D7):
//   workforce.employee_certifications has NO tenant_id column. Isolation is enforced via
//   the employee FK chain (employee lookup includes tenantId in WHERE) and the
//   certification FK chain (certification lookup includes tenantId in WHERE).
//
// EMP-302 enforcement (CRT-202):
//   Only SEPARATED employment status is blocked. PENDING_ONBOARDING, ACTIVE,
//   ON_LEAVE, and SUSPENDED employees may all receive certification assignments.
//
// Upsert semantics (CRT-203, GD-M13-4 D3):
//   findFirst → branch to create (ASSIGNED) or update (UPDATED). NOT prisma.upsert().
//   Explicit branching enables: correct audit event selection; prior-value capture
//   for CERT_RENEWED and CERT_REVOKED metadata (GD-M13-4 D5); CRT-206 partial update.
//
// Certification lookup (Step C) selects name to support CERT_REVOKED metadata (GD-M13-4 D5).
//   The name is captured at no extra DB cost during the expirationRequired check.
//
// Date serialization:
//   issueDate and expirationDate are @db.Date — Prisma returns JavaScript Date objects
//   at midnight UTC. The controller serializes them as YYYY-MM-DD strings (GD-M13-2 D16).

import { Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// Public parameter and result types
// ---------------------------------------------------------------------------

export type AssignCertificationParams = {
  employeeId:      string;
  certificationId: string;
  status?:         string;  // undefined = omitted → defaults to ACTIVE in service
  issueDate?:      Date;    // undefined = not provided
  expirationDate?: Date;    // undefined = not provided
};

export type EmployeeCertificationRecord = {
  certificationId:   string;
  certificationName: string | null;  // null only if catalog entry hard-deleted (rare; CRT-004 prevents in M13)
  issuer:            string | null;  // null when not set on catalog entry
  status:            string;         // ACTIVE | EXPIRED | REVOKED; never null
  issueDate:         Date | null;    // @db.Date — controller serializes as YYYY-MM-DD
  expirationDate:    Date | null;    // @db.Date — controller serializes as YYYY-MM-DD
};

export type AssignCertificationResult =
  | { outcome: 'ASSIGNED';                  assignment: EmployeeCertificationRecord }
  | { outcome: 'UPDATED';                   assignment: EmployeeCertificationRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'EMPLOYEE_SEPARATED' }
  | { outcome: 'CERTIFICATION_NOT_FOUND' }
  | { outcome: 'INVALID_STATUS_TRANSITION' }
  | { outcome: 'EXPIRATION_DATE_REQUIRED' }
  | { outcome: 'INVALID_DATE_RANGE' }
  | { outcome: 'CERTIFICATION_REVOKED' }
  | { outcome: 'INTERNAL_ERROR' };

export type ListEmployeeCertificationsResult =
  | { outcome: 'SUCCESS'; certifications: EmployeeCertificationRecord[] }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Mirrors GD-M13-2 Decision 16 field set. certification is always a non-null object
// because certificationId is a NOT NULL FK — the catalog row always exists
// (soft-delete preserves the row with deleted_at set; CRT-004 prevents soft-delete
// of certifications with active assignments, making the null-name case unreachable in M13).
type EmployeeCertificationRow = {
  certificationId: string;
  status:          string;
  issueDate:       Date | null;
  expirationDate:  Date | null;
  certification: {
    name:   string;
    issuer: string | null;
  };
};

// Prisma select for all employeeCertification queries.
// Nested certification select per GD-M13-2 D16.
// certification select has NO deletedAt filter — D16 requires preserving refs to soft-deleted entries.
const EMPLOYEE_CERT_SELECT = {
  certificationId: true,
  status:          true,
  issueDate:       true,
  expirationDate:  true,
  certification: {
    select: {
      name:   true,
      issuer: true,
    },
  },
} as const;

function toEmployeeCertificationRecord(row: EmployeeCertificationRow): EmployeeCertificationRecord {
  return {
    certificationId:   row.certificationId,
    certificationName: row.certification.name,
    issuer:            row.certification.issuer,
    status:            row.status,
    issueDate:         row.issueDate,
    expirationDate:    row.expirationDate,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class EmployeeCertificationService {
  private readonly logger = new Logger(EmployeeCertificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // assignCertification — upsert an employee certification assignment
  // -------------------------------------------------------------------------

  async assignCertification(
    params: AssignCertificationParams,
    tenantId: string,
    actorId: string,
  ): Promise<AssignCertificationResult> {
    // Step A — Employee lookup (SEC-003 + EMP-302 source)
    let employee: { employmentStatus: string } | null;
    try {
      employee = await this.prisma.employee.findFirst({
        where: { id: params.employeeId, tenantId, deletedAt: null },
        select: { employmentStatus: true },
      });
    } catch (err) {
      this.logger.error('assignCertification: employee lookup failed', err);
      return { outcome: 'INTERNAL_ERROR' };
    }
    if (!employee) return { outcome: 'NOT_FOUND' };

    // Step B — EMP-302: only SEPARATED is blocked (CRT-202)
    if (employee.employmentStatus === 'SEPARATED') {
      return { outcome: 'EMPLOYEE_SEPARATED' };
    }

    // Step C — Certification lookup (SEC-003; also fetches name for CERT_REVOKED metadata and expirationRequired)
    let certification: { expirationRequired: boolean; name: string } | null;
    try {
      certification = await this.prisma.certification.findFirst({
        where: { id: params.certificationId, tenantId, deletedAt: null },
        select: { expirationRequired: true, name: true },
      });
    } catch (err) {
      this.logger.error('assignCertification: certification lookup failed', err);
      return { outcome: 'INTERNAL_ERROR' };
    }
    if (!certification) return { outcome: 'CERTIFICATION_NOT_FOUND' };

    // Step D — Existing record check (determines INSERT vs UPDATE branch)
    let existing: { status: string; issueDate: Date | null; expirationDate: Date | null } | null;
    try {
      existing = await this.prisma.employeeCertification.findFirst({
        where: { employeeId: params.employeeId, certificationId: params.certificationId },
        select: { status: true, issueDate: true, expirationDate: true },
      });
    } catch (err) {
      this.logger.error('assignCertification: existing record check failed', err);
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (existing === null) {
      // ── INSERT PATH ────────────────────────────────────────────────────────

      // Step E_I — CRT-207 / GD-M13-3 D7: initial status must be ACTIVE
      if (params.status !== undefined && params.status !== 'ACTIVE') {
        return { outcome: 'INVALID_STATUS_TRANSITION' };
      }

      // Step F_I — expirationRequired enforcement on INSERT (CRT-204 amended)
      if (certification.expirationRequired && params.expirationDate === undefined) {
        return { outcome: 'EXPIRATION_DATE_REQUIRED' };
      }

      // Step G_I — Date range validation: expirationDate must not precede issueDate (CRT-204)
      if (
        params.issueDate !== undefined &&
        params.expirationDate !== undefined &&
        params.expirationDate.getTime() < params.issueDate.getTime()
      ) {
        return { outcome: 'INVALID_DATE_RANGE' };
      }

      return this.insertCertificationAssignment(params, tenantId, actorId);
    }

    // ── UPDATE PATH ──────────────────────────────────────────────────────────

    // Step E_U — CRT-301: REVOKED is terminal; no outbound transitions permitted
    if (existing.status === 'REVOKED') {
      return { outcome: 'CERTIFICATION_REVOKED' };
    }

    // Step F_U — expirationRequired effective-null check on UPDATE (CRT-204 amended)
    // Fires only when the effective post-write expirationDate would be null.
    const effectiveExpirationDate = params.expirationDate ?? existing.expirationDate;
    if (certification.expirationRequired && effectiveExpirationDate === null) {
      return { outcome: 'EXPIRATION_DATE_REQUIRED' };
    }

    // Step G_U — Date range validation (applies only when both dates provided in request)
    if (
      params.issueDate !== undefined &&
      params.expirationDate !== undefined &&
      params.expirationDate.getTime() < params.issueDate.getTime()
    ) {
      return { outcome: 'INVALID_DATE_RANGE' };
    }

    return this.updateCertificationAssignment(
      params,
      existing,
      certification.name,
      tenantId,
      actorId,
    );
  }

  private async insertCertificationAssignment(
    params: AssignCertificationParams,
    tenantId: string,
    actorId: string,
  ): Promise<AssignCertificationResult> {
    const effectiveStatus = params.status ?? 'ACTIVE';

    let row: EmployeeCertificationRow;
    try {
      row = await this.prisma.employeeCertification.create({
        data: {
          employeeId:      params.employeeId,
          certificationId: params.certificationId,
          status:          effectiveStatus,
          issueDate:       params.issueDate ?? null,
          expirationDate:  params.expirationDate ?? null,
        },
        select: EMPLOYEE_CERT_SELECT,
      }) as EmployeeCertificationRow;
    } catch (err) {
      this.logger.error('assignCertification: INSERT failed', err);
      return { outcome: 'INTERNAL_ERROR' };
    }

    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: AuditEventType.WORKFORCE_EMPLOYEE_CERT_ASSIGNED,
      result: 'SUCCESS',
      entityType: 'EMPLOYEE_CERTIFICATION',
      entityId: params.employeeId,
      metadata: {
        employeeId:      params.employeeId,
        certificationId: params.certificationId,
        status:          effectiveStatus,
        issueDate:       params.issueDate?.toISOString().substring(0, 10) ?? null,
        expirationDate:  params.expirationDate?.toISOString().substring(0, 10) ?? null,
      },
    });

    return { outcome: 'ASSIGNED', assignment: toEmployeeCertificationRecord(row) };
  }

  private async updateCertificationAssignment(
    params: AssignCertificationParams,
    existing: { status: string; issueDate: Date | null; expirationDate: Date | null },
    certificationName: string,
    tenantId: string,
    actorId: string,
  ): Promise<AssignCertificationResult> {
    // CRT-206 partial update: only fields explicitly provided are written.
    const updateData: { status?: string; issueDate?: Date; expirationDate?: Date } = {};
    if (params.status !== undefined)         updateData.status = params.status;
    if (params.issueDate !== undefined)      updateData.issueDate = params.issueDate;
    if (params.expirationDate !== undefined) updateData.expirationDate = params.expirationDate;

    // Effective new values used in audit metadata
    const newStatus        = params.status        ?? existing.status;
    const newIssueDate     = params.issueDate      ?? existing.issueDate;
    const newExpirationDate = params.expirationDate ?? existing.expirationDate;

    // GD-M13-4 D4: audit event selection
    let auditEventType: AuditEventType;
    if (newStatus === 'REVOKED') {
      auditEventType = AuditEventType.WORKFORCE_EMPLOYEE_CERT_REVOKED;
    } else if (newStatus === 'ACTIVE' && existing.status === 'EXPIRED') {
      auditEventType = AuditEventType.WORKFORCE_EMPLOYEE_CERT_RENEWED;
    } else {
      auditEventType = AuditEventType.WORKFORCE_EMPLOYEE_CERT_UPDATED;
    }

    let row: EmployeeCertificationRow;
    try {
      row = await this.prisma.employeeCertification.update({
        where: {
          employeeId_certificationId: {
            employeeId:      params.employeeId,
            certificationId: params.certificationId,
          },
        },
        data: updateData,
        select: EMPLOYEE_CERT_SELECT,
      }) as EmployeeCertificationRow;
    } catch (err) {
      this.logger.error('assignCertification: UPDATE failed', err);
      return { outcome: 'INTERNAL_ERROR' };
    }

    // GD-M13-4 D5: audit metadata differs by event type
    let metadata: Record<string, unknown>;
    if (auditEventType === AuditEventType.WORKFORCE_EMPLOYEE_CERT_REVOKED) {
      metadata = {
        employeeId:           params.employeeId,
        certificationId:      params.certificationId,
        certification_name:   certificationName,
        prior_status:         existing.status,
        revocation_timestamp: new Date().toISOString(),
      };
    } else if (auditEventType === AuditEventType.WORKFORCE_EMPLOYEE_CERT_RENEWED) {
      metadata = {
        employeeId:            params.employeeId,
        certificationId:       params.certificationId,
        prior_expiration_date: existing.expirationDate?.toISOString().substring(0, 10) ?? null,
        new_expiration_date:   newExpirationDate?.toISOString().substring(0, 10) ?? null,
        prior_issue_date:      existing.issueDate?.toISOString().substring(0, 10) ?? null,
        new_issue_date:        newIssueDate?.toISOString().substring(0, 10) ?? null,
      };
    } else {
      metadata = {
        employeeId:            params.employeeId,
        certificationId:       params.certificationId,
        prior_status:          existing.status,
        new_status:            newStatus,
        prior_issue_date:      existing.issueDate?.toISOString().substring(0, 10) ?? null,
        new_issue_date:        newIssueDate?.toISOString().substring(0, 10) ?? null,
        prior_expiration_date: existing.expirationDate?.toISOString().substring(0, 10) ?? null,
        new_expiration_date:   newExpirationDate?.toISOString().substring(0, 10) ?? null,
        updated_fields:        Object.keys(updateData),
      };
    }

    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: auditEventType,
      result: 'SUCCESS',
      entityType: 'EMPLOYEE_CERTIFICATION',
      entityId: params.employeeId,
      metadata,
    });

    return { outcome: 'UPDATED', assignment: toEmployeeCertificationRecord(row) };
  }

  // -------------------------------------------------------------------------
  // listEmployeeCertifications — return all certification assignments for an employee
  // -------------------------------------------------------------------------

  async listEmployeeCertifications(
    employeeId: string,
    tenantId: string,
  ): Promise<ListEmployeeCertificationsResult> {
    // Employee existence check (SEC-003): empty array and NOT_FOUND are
    // indistinguishable from findMany alone; this guard ensures correct NOT_FOUND.
    let employeeExists: { id: string } | null;
    try {
      employeeExists = await this.prisma.employee.findFirst({
        where: { id: employeeId, tenantId, deletedAt: null },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error('listEmployeeCertifications: employee lookup failed', err);
      return { outcome: 'INTERNAL_ERROR' };
    }
    if (!employeeExists) return { outcome: 'NOT_FOUND' };

    // Fetch all assignments with certification JOIN (GD-M13-2 D16)
    let rows: EmployeeCertificationRow[];
    try {
      rows = (await this.prisma.employeeCertification.findMany({
        where:  { employeeId },
        select: EMPLOYEE_CERT_SELECT,
      })) as EmployeeCertificationRow[];
    } catch (err) {
      this.logger.error('listEmployeeCertifications: findMany failed', err);
      return { outcome: 'INTERNAL_ERROR' };
    }

    return { outcome: 'SUCCESS', certifications: rows.map(toEmployeeCertificationRecord) };
  }
}
