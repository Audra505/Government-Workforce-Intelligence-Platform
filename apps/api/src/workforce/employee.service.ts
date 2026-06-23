// Reference: spec/01_requirements.md — FR-110, FR-111, FR-112 Employee Management
// Reference: spec/06_api_contracts.md — Employee API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/13_employee_management_rules.md — EMP-001 through EMP-805
// Reference: directives/13_employee_management_rules.md — GD-M12-1 through GD-M12-8
// Reference: governance/GD-M15-1.md — Decision 1, 4, 5, 6, 8, 9 (appointmentAuthority; positionId at creation; assign-position endpoint)
// Reference: governance/GD-PRE-M13-001.md — appointment authority design
// Reference: governance/GD-PRE-M13-002.md — 1:1 FTE Slot Model (service-layer occupancy check only)
//
// EmployeeService is transport-agnostic: no HTTP exceptions thrown, no HTTP responses returned.
// HTTP status mapping is the sole responsibility of EmployeeController (Step 3).
//
// tenantId is never derived from the DTO — only from the caller-supplied JWT context (SEC-003).
// All read queries include WHERE tenantId AND deletedAt IS NULL (SEC-003).
// NOT_FOUND returned for absent, soft-deleted, and cross-tenant records — prevents enumeration (SEC-003).
// Department validation uses Prisma-direct query — no DepartmentService dependency.
// Audit events are emitted after write operations, not inside transactions (EMP-700).
// EMP-401: Field values (names, emails) must not appear in audit metadata — field names only.
// GD-M12-6/EMP-304: employeeNumber is immutable after creation — checked before any DB operation.
// GD-M15-1 D8: appointmentAuthority is immutable after creation — checked before any DB operation.
// GD-M12-1/EMP-001: PENDING_ONBOARDING is the initial state for all created employees.
// EMP-302: SEPARATED employees are read-only — updateEmployee returns EMPLOYEE_IS_SEPARATED.
// EMP-303: terminationDate is system-managed — set to now() when ACTIVE → SEPARATED.
// SEPARATED is a terminal state — changeEmployeeStatus returns INVALID_TRANSITION.
// GD-M12-8/EMP-805: SEPARATED rejected when terminationDate (now) < hireDate — returns TERMINATION_BEFORE_HIRE_DATE.
// GD-M15-1 D1: VALID_APPOINTMENT_AUTHORITIES are the 7 Path A values. COMPETITIVE_APPOINTMENT is DB-only.
// GD-M15-1 D4: positionId optional at creation; if provided: must be ACTIVE and unoccupied (service-layer check).
// GD-PRE-M13-002 D1: occupancy enforced at service layer only — no DB unique constraint on position_id.
// GD-M15-1 D9: WORKFORCE_EMPLOYEE_POSITION_ASSIGNED emitted when employee created with initial positionId.

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';

// ---------------------------------------------------------------------------
// Parameter types
// Plain TypeScript interfaces consumed by EmployeeService.
// DTOs with class-validator decorators are defined separately and used by EmployeeController.
// ---------------------------------------------------------------------------

export type CreateEmployeeParams = {
  employeeNumber: string;
  firstName: string;
  lastName: string;
  departmentId: string;
  appointmentAuthority?: string;   // optional: missing field → APPOINTMENT_AUTHORITY_REQUIRED (GD-M15-1 D4)
  positionId?: string;
  email?: string;
  hireDate?: Date;
};

export type UpdateEmployeeParams = {
  firstName?: string;
  lastName?: string;
  email?: string;
  departmentId?: string;
  hireDate?: Date;
  employeeNumber?: string;
  appointmentAuthority?: string;
};

export type ListEmployeesParams = {
  employmentStatus?: string;
  departmentId?: string;
  page?: number;
  pageSize?: number;
};

export type ChangeEmployeeStatusParams = {
  status: string;
  separationReason?: string;
};

// GD-M15-1 D5/D6: assign-position endpoint params and result types.
export type AssignPositionParams = {
  positionId: string | null;
};

export type AssignPositionResult =
  | { outcome: 'SUCCESS'; employee: EmployeeRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'EMPLOYEE_SEPARATED' }
  | { outcome: 'POSITION_NOT_FOUND' }
  | { outcome: 'POSITION_NOT_ACTIVE_FOR_ASSIGNMENT' }
  | { outcome: 'POSITION_ALREADY_OCCUPIED' }
  | { outcome: 'POSITION_CLEARANCE_NOT_PERMITTED_FOR_STATUS' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// EmployeeRecord — shared read shape produced by all service read paths.
// Includes joined department name field and M15 position linkage fields.
// ---------------------------------------------------------------------------

export type EmployeeRecord = {
  id: string;
  tenantId: string;
  departmentId: string;
  departmentName: string;
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
// Discriminated union result types
// ---------------------------------------------------------------------------

export type CreateEmployeeResult =
  | { outcome: 'SUCCESS'; employee: EmployeeRecord }
  | { outcome: 'DEPARTMENT_NOT_FOUND' }
  | { outcome: 'EMPLOYEE_NUMBER_CONFLICT' }
  | { outcome: 'APPOINTMENT_AUTHORITY_REQUIRED' }
  | { outcome: 'INVALID_APPOINTMENT_AUTHORITY' }
  | { outcome: 'COMPETITIVE_APPOINTMENT_SYSTEM_ONLY' }
  | { outcome: 'POSITION_NOT_FOUND' }
  | { outcome: 'POSITION_NOT_ACTIVE_FOR_ASSIGNMENT' }
  | { outcome: 'POSITION_ALREADY_OCCUPIED' }
  | { outcome: 'INTERNAL_ERROR' };

export type ListEmployeesResult =
  | {
      outcome: 'SUCCESS';
      employees: EmployeeRecord[];
      total: number;
      page: number;
      pageSize: number;
    }
  | { outcome: 'INTERNAL_ERROR' };

export type GetEmployeeByIdResult =
  | { outcome: 'SUCCESS'; employee: EmployeeRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

export type UpdateEmployeeResult =
  | { outcome: 'SUCCESS'; employee: EmployeeRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'EMPLOYEE_IS_SEPARATED' }
  | { outcome: 'EMPLOYEE_NUMBER_IMMUTABLE' }
  | { outcome: 'APPOINTMENT_AUTHORITY_IMMUTABLE' }
  | { outcome: 'DEPARTMENT_NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

export type ChangeEmployeeStatusResult =
  | { outcome: 'STATUS_CHANGED'; employee: EmployeeRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INVALID_TRANSITION' }
  | { outcome: 'TERMINATION_BEFORE_HIRE_DATE' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// Internal types and constants
// ---------------------------------------------------------------------------

// Matches the Prisma select result shape for EMPLOYEE_READ_SELECT.
type EmployeeRow = {
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
  department: {
    name: string;
  };
};

// Shared Prisma select for all read operations — includes joined department name.
const EMPLOYEE_READ_SELECT = {
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
  department: {
    select: {
      name: true,
    },
  },
} as const;

// GD-M15-1 D1 / GD-PRE-M13-001: Valid Path A appointment authority values.
// COMPETITIVE_APPOINTMENT is reserved for system use and rejected at the API layer.
const VALID_APPOINTMENT_AUTHORITIES = new Set([
  'LATERAL_TRANSFER',
  'EMERGENCY_APPOINTMENT',
  'SCHEDULE_A',
  'SCHEDULE_C',
  'REINSTATEMENT',
  'SENIOR_EXECUTIVE',
  'ADMINISTRATIVE',
]);

// GD-M12-1: Allowed lifecycle transitions and their corresponding audit events.
// Map key format: "<fromState>→<toState>"
// Only entries in this map are valid. All others return INVALID_TRANSITION.
const ALLOWED_TRANSITIONS = new Map<string, AuditEventType>([
  ['PENDING_ONBOARDING→ACTIVE',  AuditEventType.WORKFORCE_EMPLOYEE_ACTIVATED],
  ['ACTIVE→ON_LEAVE',            AuditEventType.WORKFORCE_EMPLOYEE_LEAVE_STARTED],
  ['ACTIVE→SUSPENDED',           AuditEventType.WORKFORCE_EMPLOYEE_SUSPENDED],
  ['ACTIVE→SEPARATED',           AuditEventType.WORKFORCE_EMPLOYEE_SEPARATED],
  ['ON_LEAVE→ACTIVE',            AuditEventType.WORKFORCE_EMPLOYEE_RETURNED],
  ['SUSPENDED→ACTIVE',           AuditEventType.WORKFORCE_EMPLOYEE_REINSTATED],
]);

function toEmployeeRecord(row: EmployeeRow): EmployeeRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    departmentId: row.departmentId,
    departmentName: row.department.name,
    positionId: row.positionId,
    employeeNumber: row.employeeNumber,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    employmentStatus: row.employmentStatus,
    appointmentAuthority: row.appointmentAuthority,
    hireDate: row.hireDate,
    terminationDate: row.terminationDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// EmployeeService
// ---------------------------------------------------------------------------

@Injectable()
export class EmployeeService {
  private readonly logger = new Logger(EmployeeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createEmployee(
    params: CreateEmployeeParams,
    tenantId: string,
    actorId: string,
  ): Promise<CreateEmployeeResult> {
    // GD-M15-1 D4: appointmentAuthority is required at creation.
    // Missing field (undefined) returns APPOINTMENT_AUTHORITY_REQUIRED → HTTP 422.
    // DTO makes the field @IsOptional so a missing body key bypasses ValidationPipe
    // and reaches this guard, satisfying the GD-M15-1 D4 HTTP 422 specification.
    if (!params.appointmentAuthority) {
      return { outcome: 'APPOINTMENT_AUTHORITY_REQUIRED' };
    }
    // GD-M15-1 D1/D4: appointmentAuthority domain validation.
    // COMPETITIVE_APPOINTMENT is reserved for system use — rejected via API per GD-PRE-M13-001.
    // Value validation runs before any DB operation to fail fast on invalid input.
    if (params.appointmentAuthority === 'COMPETITIVE_APPOINTMENT') {
      return { outcome: 'COMPETITIVE_APPOINTMENT_SYSTEM_ONLY' };
    }
    if (!VALID_APPOINTMENT_AUTHORITIES.has(params.appointmentAuthority)) {
      return { outcome: 'INVALID_APPOINTMENT_AUTHORITY' };
    }

    // Department validation: must exist, belong to tenant, not soft-deleted (EMP-202).
    // Prisma-direct query — no DepartmentService dependency.
    // DEPARTMENT_NOT_FOUND returned for absent, cross-tenant, and soft-deleted — prevents enumeration (SEC-003).
    let eligibleDepartment: { id: string } | null;
    try {
      eligibleDepartment = await this.prisma.department.findFirst({
        where: {
          id: params.departmentId,
          tenantId,
          deletedAt: null,
        },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error(
        'createEmployee department validation failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (!eligibleDepartment) return { outcome: 'DEPARTMENT_NOT_FOUND' };

    // GD-M15-1 D4: positionId validation at creation time (optional field).
    // If provided: position must exist in this tenant, be ACTIVE, and have no current incumbent.
    // GD-PRE-M13-002 D1: occupancy enforced at service layer only — no DB unique constraint.
    let positionTitle: string | null = null;
    if (params.positionId) {
      try {
        const position = await this.prisma.position.findFirst({
          where: { id: params.positionId, tenantId, deletedAt: null },
          select: { id: true, status: true, title: true },
        });

        if (!position) return { outcome: 'POSITION_NOT_FOUND' };
        if (position.status !== 'ACTIVE') return { outcome: 'POSITION_NOT_ACTIVE_FOR_ASSIGNMENT' };

        const incumbent = await this.prisma.employee.findFirst({
          where: {
            positionId: params.positionId,
            employmentStatus: { in: ['PENDING_ONBOARDING', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED'] },
            deletedAt: null,
          },
          select: { id: true },
        });
        if (incumbent) return { outcome: 'POSITION_ALREADY_OCCUPIED' };

        positionTitle = position.title;
      } catch (err) {
        this.logger.error(
          'createEmployee position validation failed',
          err instanceof Error ? err.stack : String(err),
        );
        return { outcome: 'INTERNAL_ERROR' };
      }
    }

    let row: EmployeeRow;
    try {
      row = await this.prisma.employee.create({
        data: {
          tenantId,
          departmentId: params.departmentId,
          positionId: params.positionId ?? null,
          employeeNumber: params.employeeNumber,
          firstName: params.firstName,
          lastName: params.lastName,
          email: params.email ?? null,
          hireDate: params.hireDate ?? null,
          employmentStatus: 'PENDING_ONBOARDING',
          appointmentAuthority: params.appointmentAuthority,
        },
        select: EMPLOYEE_READ_SELECT,
      });
    } catch (err) {
      // P2002: unique constraint violation on idx_employee_number_tenant.
      // employeeNumber must be unique within a tenant (GD-M12-6/EMP-201).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return { outcome: 'EMPLOYEE_NUMBER_CONFLICT' };
      }
      this.logger.error(
        'createEmployee failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    // Audit emitted after write — outside transaction per EMP-700.
    // EMP-401: metadata contains IDs and status only — no PII field values.
    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: AuditEventType.WORKFORCE_EMPLOYEE_CREATED,
      result: 'SUCCESS',
      entityType: 'EMPLOYEE',
      entityId: row.id,
      metadata: {
        employeeNumber: row.employeeNumber,
        departmentId: row.departmentId,
        employmentStatus: row.employmentStatus,
        appointmentAuthority: row.appointmentAuthority,
      },
    });

    // GD-M15-1 D9: emit WORKFORCE_EMPLOYEE_POSITION_ASSIGNED when employee is created with initial positionId.
    if (params.positionId) {
      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.WORKFORCE_EMPLOYEE_POSITION_ASSIGNED,
        result: 'SUCCESS',
        entityType: 'EMPLOYEE',
        entityId: row.id,
        metadata: {
          new_position_id: params.positionId,
          new_position_title: positionTitle,
        },
      });
    }

    return { outcome: 'SUCCESS', employee: toEmployeeRecord(row) };
  }

  async listEmployees(
    tenantId: string,
    params: ListEmployeesParams,
  ): Promise<ListEmployeesResult> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;

    const where: Prisma.EmployeeWhereInput = {
      tenantId,
      deletedAt: null,
      ...(params.employmentStatus ? { employmentStatus: params.employmentStatus } : {}),
      ...(params.departmentId ? { departmentId: params.departmentId } : {}),
    };

    let employees: EmployeeRow[];
    let total: number;
    try {
      [employees, total] = await Promise.all([
        this.prisma.employee.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: EMPLOYEE_READ_SELECT,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.employee.count({ where }),
      ]);
    } catch (err) {
      this.logger.error(
        'listEmployees failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    return {
      outcome: 'SUCCESS',
      employees: employees.map(toEmployeeRecord),
      total,
      page,
      pageSize,
    };
  }

  async getEmployeeById(
    id: string,
    tenantId: string,
  ): Promise<GetEmployeeByIdResult> {
    let row: EmployeeRow | null;
    try {
      // findFirst with tenantId enforces SEC-003 at the DB query level.
      // NOT_FOUND returned for both absent and cross-tenant — prevents enumeration.
      row = await this.prisma.employee.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: EMPLOYEE_READ_SELECT,
      });
    } catch (err) {
      this.logger.error(
        'getEmployeeById failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (!row) return { outcome: 'NOT_FOUND' };
    return { outcome: 'SUCCESS', employee: toEmployeeRecord(row) };
  }

  async updateEmployee(
    id: string,
    params: UpdateEmployeeParams,
    tenantId: string,
    actorId: string,
  ): Promise<UpdateEmployeeResult> {
    // GD-M12-6/EMP-304: employeeNumber is immutable after creation.
    // Check runs before any DB operation — no partial execution on immutability violation.
    if (params.employeeNumber !== undefined) {
      return { outcome: 'EMPLOYEE_NUMBER_IMMUTABLE' };
    }

    // GD-M15-1 D8: appointmentAuthority is immutable after creation.
    // Same pattern as employeeNumber — presence of the field triggers rejection.
    if (params.appointmentAuthority !== undefined) {
      return { outcome: 'APPOINTMENT_AUTHORITY_IMMUTABLE' };
    }

    try {
      const existing = await this.prisma.employee.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, employmentStatus: true },
      });

      if (!existing) return { outcome: 'NOT_FOUND' };
      // EMP-302: SEPARATED employees are read-only — all update attempts rejected.
      if (existing.employmentStatus === 'SEPARATED') return { outcome: 'EMPLOYEE_IS_SEPARATED' };

      // Department FK validation when departmentId is being updated (EMP-202).
      if (params.departmentId !== undefined) {
        const eligibleDepartment = await this.prisma.department.findFirst({
          where: {
            id: params.departmentId,
            tenantId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!eligibleDepartment) return { outcome: 'DEPARTMENT_NOT_FOUND' };
      }

      const updateData = {
        ...(params.firstName !== undefined ? { firstName: params.firstName } : {}),
        ...(params.lastName !== undefined ? { lastName: params.lastName } : {}),
        ...(params.email !== undefined ? { email: params.email } : {}),
        ...(params.departmentId !== undefined ? { departmentId: params.departmentId } : {}),
        ...(params.hireDate !== undefined ? { hireDate: params.hireDate } : {}),
      };

      const row = await this.prisma.employee.update({
        where: { id },
        data: updateData,
        select: EMPLOYEE_READ_SELECT,
      });

      // EMP-401: audit metadata records field names only — not field values (PII protection).
      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.WORKFORCE_EMPLOYEE_UPDATED,
        result: 'SUCCESS',
        entityType: 'EMPLOYEE',
        entityId: row.id,
        metadata: {
          updatedFields: Object.keys(updateData),
        },
      });

      return { outcome: 'SUCCESS', employee: toEmployeeRecord(row) };
    } catch (err) {
      this.logger.error(
        'updateEmployee failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  async changeEmployeeStatus(
    id: string,
    params: ChangeEmployeeStatusParams,
    tenantId: string,
    actorId: string,
  ): Promise<ChangeEmployeeStatusResult> {
    try {
      const existing = await this.prisma.employee.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, employmentStatus: true, hireDate: true },
      });

      if (!existing) return { outcome: 'NOT_FOUND' };

      const current = existing.employmentStatus;
      const target = params.status;

      // Terminal state check: SEPARATED employees cannot transition to any state (GD-M12-1).
      // Checked before transition table lookup to prevent table pollution with SEPARATED source states.
      if (current === 'SEPARATED') return { outcome: 'INVALID_TRANSITION' };

      // GD-M12-8/EMP-805: Reject SEPARATED transition when terminationDate (now) would precede hireDate.
      // Both dates normalized to midnight to avoid timezone edge cases at day boundaries.
      // Guard applies only when hireDate is set — null hireDate is permitted (EMP-204).
      if (target === 'SEPARATED' && existing.hireDate !== null) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const hire = new Date(existing.hireDate);
        hire.setHours(0, 0, 0, 0);
        if (today < hire) {
          return { outcome: 'TERMINATION_BEFORE_HIRE_DATE' };
        }
      }

      const transitionKey = `${current}→${target}`;
      const auditEvent = ALLOWED_TRANSITIONS.get(transitionKey);
      if (!auditEvent) return { outcome: 'INVALID_TRANSITION' };

      const updateData = {
        employmentStatus: target,
        // EMP-303: terminationDate is system-managed — set to now() on ACTIVE → SEPARATED transition.
        ...(target === 'SEPARATED' ? { terminationDate: new Date() } : {}),
      };

      const row = await this.prisma.employee.update({
        where: { id },
        data: updateData,
        select: EMPLOYEE_READ_SELECT,
      });

      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: auditEvent,
        result: 'SUCCESS',
        entityType: 'EMPLOYEE',
        entityId: row.id,
        metadata: {
          previousStatus: current,
          newStatus: target,
          ...(target === 'SEPARATED' && params.separationReason !== undefined
            ? { separationReason: params.separationReason }
            : {}),
        },
      });

      return { outcome: 'STATUS_CHANGED', employee: toEmployeeRecord(row) };
    } catch (err) {
      this.logger.error(
        'changeEmployeeStatus failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  // ---------------------------------------------------------------------------
  // assignPosition — GD-M15-1 D5 / D6 / D9
  //
  // Handles three distinct operations:
  //   positionId = null         → clearance (PENDING_ONBOARDING only — D6)
  //   positionId = current UUID → no-op (no write, no audit — D9)
  //   positionId = new UUID     → initial assignment or reassignment (D5)
  //
  // SEPARATED employees are rejected for all three operations (D5/D6).
  // tenantId from JWT; position looked up with tenantId filter (SEC-003 — D5 rule 4).
  // Cross-tenant position returns POSITION_NOT_FOUND (→ HTTP 404) per SEC-003.
  // Occupancy check excludes self to support the no-op and reassignment paths (D5 rule 3).
  // Audit events selected per D9 event-selection rules.
  // ---------------------------------------------------------------------------

  async assignPosition(
    employeeId: string,
    params: AssignPositionParams,
    tenantId: string,
    actorId: string,
  ): Promise<AssignPositionResult> {
    // Step 1: fetch employee with current position info for audit metadata.
    let existing: {
      id: string;
      positionId: string | null;
      employmentStatus: string;
      appointmentAuthority: string;
      position: { title: string } | null;
    } | null;

    try {
      existing = await this.prisma.employee.findFirst({
        where: { id: employeeId, tenantId, deletedAt: null },
        select: {
          id: true,
          positionId: true,
          employmentStatus: true,
          appointmentAuthority: true,
          position: { select: { title: true } },
        },
      });
    } catch (err) {
      this.logger.error(
        'assignPosition employee lookup failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (!existing) return { outcome: 'NOT_FOUND' };
    // GD-M15-1 D5 / D6: SEPARATED employees cannot have positionId modified under any operation.
    if (existing.employmentStatus === 'SEPARATED') return { outcome: 'EMPLOYEE_SEPARATED' };

    const currentPositionId = existing.positionId;
    const priorPositionTitle = existing.position?.title ?? null;
    const requestedPositionId = params.positionId;

    // ---- Clearance path: positionId = null (GD-M15-1 D6) ----
    if (requestedPositionId === null) {
      // Clearance permitted for PENDING_ONBOARDING only.
      if (existing.employmentStatus !== 'PENDING_ONBOARDING') {
        return { outcome: 'POSITION_CLEARANCE_NOT_PERMITTED_FOR_STATUS' };
      }

      // No-op: positionId is already null — no write, no audit event (GD-M15-1 D9).
      if (currentPositionId === null) {
        let noopRow: EmployeeRow | null;
        try {
          noopRow = await this.prisma.employee.findFirst({
            where: { id: employeeId },
            select: EMPLOYEE_READ_SELECT,
          });
        } catch (err) {
          this.logger.error('assignPosition no-op read failed', err instanceof Error ? err.stack : String(err));
          return { outcome: 'INTERNAL_ERROR' };
        }
        return { outcome: 'SUCCESS', employee: toEmployeeRecord(noopRow!) };
      }

      // Perform clearance: set positionId = null.
      let clearedRow: EmployeeRow;
      try {
        clearedRow = await this.prisma.employee.update({
          where: { id: employeeId },
          data: { positionId: null },
          select: EMPLOYEE_READ_SELECT,
        });
      } catch (err) {
        this.logger.error('assignPosition clearance update failed', err instanceof Error ? err.stack : String(err));
        return { outcome: 'INTERNAL_ERROR' };
      }

      // GD-M15-1 D9 WORKFORCE_EMPLOYEE_POSITION_CLEARED metadata.
      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.WORKFORCE_EMPLOYEE_POSITION_CLEARED,
        result: 'SUCCESS',
        entityType: 'EMPLOYEE',
        entityId: employeeId,
        metadata: {
          prior_position_id: currentPositionId,
          prior_position_title: priorPositionTitle,
          employment_status_at_clearance: existing.employmentStatus,
        },
      });

      return { outcome: 'SUCCESS', employee: toEmployeeRecord(clearedRow) };
    }

    // ---- Assignment / Reassignment path: positionId = UUID ----

    // Look up target position. tenantId filter enforces SEC-003 — cross-tenant returns NOT_FOUND → HTTP 404.
    let targetPosition: { id: string; status: string; title: string } | null;
    try {
      targetPosition = await this.prisma.position.findFirst({
        where: { id: requestedPositionId, tenantId, deletedAt: null },
        select: { id: true, status: true, title: true },
      });
    } catch (err) {
      this.logger.error('assignPosition position lookup failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (!targetPosition) return { outcome: 'POSITION_NOT_FOUND' };
    if (targetPosition.status !== 'ACTIVE') return { outcome: 'POSITION_NOT_ACTIVE_FOR_ASSIGNMENT' };

    // No-op: same position already assigned — no write, no audit event (GD-M15-1 D9).
    if (currentPositionId === requestedPositionId) {
      let noopRow: EmployeeRow | null;
      try {
        noopRow = await this.prisma.employee.findFirst({
          where: { id: employeeId },
          select: EMPLOYEE_READ_SELECT,
        });
      } catch (err) {
        this.logger.error('assignPosition no-op read failed', err instanceof Error ? err.stack : String(err));
        return { outcome: 'INTERNAL_ERROR' };
      }
      return { outcome: 'SUCCESS', employee: toEmployeeRecord(noopRow!) };
    }

    // Occupancy check: no other non-SEPARATED incumbent allowed (GD-M15-1 D5 rule 3; GD-PRE-M13-002 D1).
    // Self excluded — allows reassignment to same position (which is the no-op case handled above).
    let incumbent: { id: string } | null;
    try {
      incumbent = await this.prisma.employee.findFirst({
        where: {
          positionId: requestedPositionId,
          employmentStatus: { in: ['PENDING_ONBOARDING', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED'] },
          deletedAt: null,
          NOT: { id: employeeId },
        },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error('assignPosition occupancy check failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (incumbent) return { outcome: 'POSITION_ALREADY_OCCUPIED' };

    // Write the assignment.
    let assignedRow: EmployeeRow;
    try {
      assignedRow = await this.prisma.employee.update({
        where: { id: employeeId },
        data: { positionId: requestedPositionId },
        select: EMPLOYEE_READ_SELECT,
      });
    } catch (err) {
      this.logger.error('assignPosition update failed', err instanceof Error ? err.stack : String(err));
      return { outcome: 'INTERNAL_ERROR' };
    }

    // GD-M15-1 D9: select audit event based on prior state.
    if (currentPositionId === null) {
      // Prior positionId null → new UUID: POSITION_ASSIGNED.
      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.WORKFORCE_EMPLOYEE_POSITION_ASSIGNED,
        result: 'SUCCESS',
        entityType: 'EMPLOYEE',
        entityId: employeeId,
        metadata: {
          new_position_id: requestedPositionId,
          new_position_title: targetPosition.title,
          appointment_authority: existing.appointmentAuthority,
        },
      });
    } else {
      // Prior positionId UUID → different UUID: POSITION_REASSIGNED.
      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: AuditEventType.WORKFORCE_EMPLOYEE_POSITION_REASSIGNED,
        result: 'SUCCESS',
        entityType: 'EMPLOYEE',
        entityId: employeeId,
        metadata: {
          prior_position_id: currentPositionId,
          prior_position_title: priorPositionTitle,
          new_position_id: requestedPositionId,
          new_position_title: targetPosition.title,
        },
      });
    }

    return { outcome: 'SUCCESS', employee: toEmployeeRecord(assignedRow) };
  }
}
