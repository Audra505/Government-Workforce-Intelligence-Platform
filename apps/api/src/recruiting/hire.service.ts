// Reference: governance/GD-M19-1.md — Decisions 4–12
// Reference: spec/01_requirements.md — FR-304 Hiring Workflow
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
//
// Transport-agnostic: no HTTP exceptions thrown; all outcomes returned as a
// discriminated union. HTTP status mapping is HireController's responsibility.
//
// tenantId comes from JWT only — never from the request body (SEC-003; GD-M19-1 D10).
// Cross-tenant and deleted records return not-found outcomes (enumeration prevention).
//
// Governed deviation from EMP-700: prisma.$transaction() wraps all 4 writes because
// a partial write (employee created but application not HIRED) is irrecoverable (D9).
// Audit events use the shared PrismaService — not the tx client — and are emitted
// only after the transaction commits. AuditService.logEvent() swallows its own errors
// so audit failure is non-blocking (D12).
//
// HireService does NOT inject EmployeeService (GD-M19-1 D5 cross-module boundary;
// consistent with GD-M17-1 D8 — RecruitingModule does not import WorkforceModule).

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';

// ---------------------------------------------------------------------------
// HireEmployeeRecord — service-layer response shape on SUCCESS.
// tenantId is present for completeness; HireController must exclude it from
// HTTP response bodies (SEC-003; GD-M19-1 D10).
// ---------------------------------------------------------------------------

export type HireEmployeeRecord = {
  id: string;
  tenantId: string;
  departmentId: string;
  positionId: string | null;
  employeeNumber: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  employmentStatus: string;
  appointmentAuthority: string;
  hireDate: Date | null;
  terminationDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// Discriminated union result type (GD-M19-1 D13)
// ---------------------------------------------------------------------------

export type HireResult =
  | { outcome: 'SUCCESS'; employee: HireEmployeeRecord }
  | { outcome: 'APPLICATION_NOT_FOUND' }
  | { outcome: 'APPLICATION_ALREADY_HIRED' }
  | { outcome: 'APPLICATION_NOT_AT_OFFER_STATUS' }
  | { outcome: 'ACCEPTED_OFFER_NOT_FOUND' }
  | { outcome: 'CANDIDATE_NOT_FOUND' }
  | { outcome: 'CANDIDATE_ARCHIVED' }
  | { outcome: 'VACANCY_NOT_FOUND' }
  | { outcome: 'VACANCY_NOT_AVAILABLE' }
  | { outcome: 'POSITION_NOT_FOUND' }
  | { outcome: 'POSITION_NOT_AVAILABLE' }
  | { outcome: 'EMPLOYEE_NUMBER_GENERATION_FAILED' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const EMPLOYEE_SELECT = {
  id: true,
  tenantId: true,
  departmentId: true,
  positionId: true,
  employeeNumber: true,
  firstName: true,
  lastName: true,
  email: true,
  employmentStatus: true,
  appointmentAuthority: true,
  hireDate: true,
  terminationDate: true,
  createdAt: true,
  updatedAt: true,
} as const;

// GD-M19-1 D4 rule 6: acceptable statuses are OPEN, IN_RECRUITMENT, CLOSED;
// only FILLED and CANCELLED block hire.
const NON_HIREABLE_VACANCY_STATUSES: readonly string[] = ['FILLED', 'CANCELLED'];

// GD-M19-1 D4 rule 8: matches employee.service.ts createEmployee() lines 326–334.
const OCCUPIED_EMPLOYMENT_STATUSES: readonly string[] = [
  'PENDING_ONBOARDING',
  'ACTIVE',
  'ON_LEAVE',
  'SUSPENDED',
];

// ---------------------------------------------------------------------------
// HireService
// ---------------------------------------------------------------------------

@Injectable()
export class HireService {
  private readonly logger = new Logger(HireService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async hire(
    applicationId: string,
    tenantId: string,
    actorId: string,
  ): Promise<HireResult> {
    // -----------------------------------------------------------------------
    // Precondition 1 — Application exists in this tenant (GD-M19-1 D4 rule 1)
    // Cross-tenant and deleted applications are indistinguishable (SEC-003).
    // -----------------------------------------------------------------------
    let application: {
      id: string;
      status: string;
      candidateId: string;
      vacancyId: string;
    } | null;
    try {
      application = await this.prisma.application.findFirst({
        where: { id: applicationId, tenantId, deletedAt: null },
        select: { id: true, status: true, candidateId: true, vacancyId: true },
      });
    } catch (err) {
      this.logger.error(
        'hire: application lookup failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
    if (!application) return { outcome: 'APPLICATION_NOT_FOUND' };

    // -----------------------------------------------------------------------
    // Precondition 2 — Idempotency guard (GD-M19-1 D4 rule 2; D6)
    // Checked before rule 3 so HIRED returns 409, not 422.
    // -----------------------------------------------------------------------
    if (application.status === 'HIRED') return { outcome: 'APPLICATION_ALREADY_HIRED' };

    // -----------------------------------------------------------------------
    // Precondition 3 — Application must be at OFFER status (GD-M19-1 D4 rule 3)
    // -----------------------------------------------------------------------
    if (application.status !== 'OFFER') return { outcome: 'APPLICATION_NOT_AT_OFFER_STATUS' };

    // -----------------------------------------------------------------------
    // Precondition 4 — ACCEPTED offer must exist (GD-M19-1 D4 rule 4; D8)
    // -----------------------------------------------------------------------
    let acceptedOffer: { id: string } | null;
    try {
      acceptedOffer = await this.prisma.offer.findFirst({
        where: { applicationId, tenantId, status: 'ACCEPTED', deletedAt: null },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error(
        'hire: accepted offer lookup failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
    if (!acceptedOffer) return { outcome: 'ACCEPTED_OFFER_NOT_FOUND' };

    // -----------------------------------------------------------------------
    // Precondition 5 — Candidate exists and is not archived (GD-M19-1 D4 rule 5)
    // -----------------------------------------------------------------------
    let candidate: {
      id: string;
      status: string;
      firstName: string;
      lastName: string;
      email: string;
    } | null;
    try {
      candidate = await this.prisma.candidate.findFirst({
        where: { id: application.candidateId, tenantId, deletedAt: null },
        select: { id: true, status: true, firstName: true, lastName: true, email: true },
      });
    } catch (err) {
      this.logger.error(
        'hire: candidate lookup failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
    if (!candidate) return { outcome: 'CANDIDATE_NOT_FOUND' };
    if (candidate.status === 'ARCHIVED') return { outcome: 'CANDIDATE_ARCHIVED' };

    // -----------------------------------------------------------------------
    // Precondition 6 — Vacancy exists and is in a hireable state
    // Acceptable: OPEN, IN_RECRUITMENT, CLOSED (GD-M19-1 D4 rule 6)
    // -----------------------------------------------------------------------
    let vacancy: { id: string; status: string; positionId: string } | null;
    try {
      vacancy = await this.prisma.vacancy.findFirst({
        where: { id: application.vacancyId, tenantId, deletedAt: null },
        select: { id: true, status: true, positionId: true },
      });
    } catch (err) {
      this.logger.error(
        'hire: vacancy lookup failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
    if (!vacancy) return { outcome: 'VACANCY_NOT_FOUND' };
    if (NON_HIREABLE_VACANCY_STATUSES.includes(vacancy.status)) {
      return { outcome: 'VACANCY_NOT_AVAILABLE' };
    }

    // -----------------------------------------------------------------------
    // Precondition 7 — Position exists and is not soft-deleted (GD-M19-1 D4 rule 7)
    // vacancy.positionId is NOT NULL in schema (Gate 0 confirmed) but the
    // referenced position may have been soft-deleted independently.
    // -----------------------------------------------------------------------
    let position: { id: string; departmentId: string } | null;
    try {
      position = await this.prisma.position.findFirst({
        where: { id: vacancy.positionId, deletedAt: null },
        select: { id: true, departmentId: true },
      });
    } catch (err) {
      this.logger.error(
        'hire: position lookup failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
    if (!position) return { outcome: 'POSITION_NOT_FOUND' };

    // -----------------------------------------------------------------------
    // Precondition 8 — Position is not occupied by an active employee
    // No DB-level unique index on positionId; enforced at service layer only
    // (GD-M19-1 D4 rule 8; race condition acknowledged in D7).
    // -----------------------------------------------------------------------
    let incumbent: { id: string } | null;
    try {
      incumbent = await this.prisma.employee.findFirst({
        where: {
          positionId: position.id,
          employmentStatus: { in: OCCUPIED_EMPLOYMENT_STATUSES as string[] },
          deletedAt: null,
        },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error(
        'hire: position occupancy check failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
    if (incumbent) return { outcome: 'POSITION_NOT_AVAILABLE' };

    // -----------------------------------------------------------------------
    // Phase A — Employee number generation, outside transaction (GD-M19-1 D11)
    // count + 1 is the candidate number; P2002 inside Phase B handles collision.
    // -----------------------------------------------------------------------
    let employeeCount: number;
    try {
      employeeCount = await this.prisma.employee.count({
        where: { tenantId, deletedAt: null },
      });
    } catch (err) {
      this.logger.error(
        'hire: employee count failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
    const employeeNumber = this.generateEmployeeNumber(employeeCount + 1);

    // -----------------------------------------------------------------------
    // Phase B — Atomic hire transaction (GD-M19-1 D9 steps 1–4)
    // P2002 → EMPLOYEE_NUMBER_GENERATION_FAILED; no retry inside tx.
    // -----------------------------------------------------------------------
    const now = new Date();
    const previousVacancyStatus = vacancy.status;

    let newEmployee: HireEmployeeRecord;
    try {
      newEmployee = await this.prisma.$transaction(async (tx) => {
        // Step 1: Create employee record (GD-M19-1 D5; D11)
        const emp = await tx.employee.create({
          data: {
            tenantId,
            departmentId: position.departmentId,
            positionId: vacancy.positionId,
            employeeNumber,
            firstName: candidate.firstName,
            lastName: candidate.lastName,
            email: candidate.email,
            hireDate: now,
            employmentStatus: 'PENDING_ONBOARDING',
            appointmentAuthority: 'COMPETITIVE_APPOINTMENT',
          },
          select: EMPLOYEE_SELECT,
        });

        // Step 2: Set selected application to HIRED (GD-M19-1 D6)
        await tx.application.update({
          where: { id: applicationId },
          data: { status: 'HIRED' },
        });

        // Step 3: Set vacancy to FILLED and record filledAt (GD-M19-1 D7)
        await tx.vacancy.update({
          where: { id: vacancy.id },
          data: { status: 'FILLED', filledAt: now },
        });

        // Step 4: Displace other non-terminal applications to REJECTED (GD-M19-1 D6)
        // Offer records for displaced applications are NOT mutated (GD-M19-1 D8).
        await tx.application.updateMany({
          where: {
            vacancyId: vacancy.id,
            id: { not: applicationId },
            tenantId,
            deletedAt: null,
            status: { notIn: ['HIRED', 'REJECTED', 'WITHDRAWN'] },
          },
          data: { status: 'REJECTED' },
        });

        return emp;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { outcome: 'EMPLOYEE_NUMBER_GENERATION_FAILED' };
      }
      this.logger.error(
        'hire: transaction failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    // -----------------------------------------------------------------------
    // Post-transaction audit — shared PrismaService, not tx client (GD-M19-1 D12)
    // Four sequential calls; AuditService.logEvent() swallows write failures.
    // PII-safe: no name, email, phone, or free-text values in metadata.
    // -----------------------------------------------------------------------
    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: AuditEventType.RECRUITING_CANDIDATE_HIRED,
      result: 'SUCCESS',
      entityType: 'Application',
      entityId: applicationId,
      metadata: {
        candidateId: candidate.id,
        vacancyId: vacancy.id,
        trigger: 'M19_HIRE',
      },
    });

    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: AuditEventType.WORKFORCE_EMPLOYEE_CREATED_FROM_HIRE,
      result: 'SUCCESS',
      entityType: 'Employee',
      entityId: newEmployee.id,
      metadata: {
        applicationId,
        appointmentAuthority: 'COMPETITIVE_APPOINTMENT',
        employmentStatus: 'PENDING_ONBOARDING',
        positionId: vacancy.positionId,
        trigger: 'M19_HIRE',
      },
    });

    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: AuditEventType.WORKFORCE_VACANCY_FILLED_FROM_HIRE,
      result: 'SUCCESS',
      entityType: 'Vacancy',
      entityId: vacancy.id,
      metadata: {
        previousStatus: previousVacancyStatus,
        newStatus: 'FILLED',
        applicationId,
        trigger: 'M19_HIRE',
      },
    });

    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: AuditEventType.WORKFORCE_EMPLOYEE_POSITION_ASSIGNED_FROM_HIRE,
      result: 'SUCCESS',
      entityType: 'Employee',
      entityId: newEmployee.id,
      metadata: {
        positionId: vacancy.positionId,
        trigger: 'M19_HIRE',
      },
    });

    return { outcome: 'SUCCESS', employee: newEmployee };
  }

  // EMP-{N} where N is zero-padded to a minimum of 3 digits (GD-M19-1 D11).
  private generateEmployeeNumber(n: number): string {
    return `EMP-${String(n).padStart(3, '0')}`;
  }
}
