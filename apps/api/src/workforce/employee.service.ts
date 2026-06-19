// Reference: spec/01_requirements.md — FR-110, FR-111, FR-112 Employee Management
// Reference: spec/06_api_contracts.md — Employee API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/13_employee_management_rules.md — EMP-001 through EMP-805
// Reference: directives/13_employee_management_rules.md — GD-M12-1 through GD-M12-8
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
// GD-M12-1/EMP-001: PENDING_ONBOARDING is the initial state for all created employees.
// EMP-302: SEPARATED employees are read-only — updateEmployee returns EMPLOYEE_IS_SEPARATED.
// EMP-303: terminationDate is system-managed — set to now() when ACTIVE → SEPARATED.
// SEPARATED is a terminal state — changeEmployeeStatus returns INVALID_TRANSITION.
// GD-M12-8/EMP-805: SEPARATED rejected when terminationDate (now) < hireDate — returns TERMINATION_BEFORE_HIRE_DATE.

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

// ---------------------------------------------------------------------------
// EmployeeRecord — shared read shape produced by all service read paths.
// Includes joined department name field.
// ---------------------------------------------------------------------------

export type EmployeeRecord = {
  id: string;
  tenantId: string;
  departmentId: string;
  departmentName: string;
  employeeNumber: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  employmentStatus: string;
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
  employeeNumber: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  employmentStatus: string;
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
  employeeNumber: true,
  firstName: true,
  lastName: true,
  email: true,
  employmentStatus: true,
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
    employeeNumber: row.employeeNumber,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    employmentStatus: row.employmentStatus,
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

    let row: EmployeeRow;
    try {
      row = await this.prisma.employee.create({
        data: {
          tenantId,
          departmentId: params.departmentId,
          employeeNumber: params.employeeNumber,
          firstName: params.firstName,
          lastName: params.lastName,
          email: params.email ?? null,
          hireDate: params.hireDate ?? null,
          employmentStatus: 'PENDING_ONBOARDING',
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
      },
    });

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
}
