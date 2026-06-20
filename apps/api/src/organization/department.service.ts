// Reference: spec/01_requirements.md — FR-051 Department Management
// Reference: spec/06_api_contracts.md — Organization API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/12_organization_management_rules.md — DEP-001 through DEP-008
// Reference: directives/08_audit_rules.md — AUD-350
//
// DepartmentService is transport-agnostic: no HTTP exceptions thrown, no HTTP responses returned.
// HTTP status mapping is the sole responsibility of OrganizationController.
//
// tenantId is never derived from the DTO — only from the caller-supplied JWT context (SEC-003).
// All read queries include WHERE tenantId AND deletedAt IS NULL (SEC-003 + DEP-005).
// Code uniqueness is tenant-scoped: @@unique([tenantId, code]) maps P2002 → CODE_CONFLICT.
// Audit events are emitted after write operations, not inside transactions (AUD-350).

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { ListDepartmentsQueryDto } from './dto/list-departments-query.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

// Shared intermediate department shape — produced by all service methods.
// Excludes: tenantId (implicit from auth context), deletedAt (soft-delete detail), updatedAt.
export type DepartmentRecord = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  status: string;
  createdAt: Date;
};

export type CreateDepartmentResult =
  | { outcome: 'SUCCESS'; department: DepartmentRecord }
  | { outcome: 'CODE_CONFLICT' }
  | { outcome: 'INTERNAL_ERROR' };

export type ListDepartmentsResult =
  | {
      outcome: 'SUCCESS';
      departments: DepartmentRecord[];
      total: number;
      page: number;
      pageSize: number;
    }
  | { outcome: 'INTERNAL_ERROR' };

export type GetDepartmentByIdResult =
  | { outcome: 'SUCCESS'; department: DepartmentRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

export type UpdateDepartmentResult =
  | { outcome: 'SUCCESS'; department: DepartmentRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'CODE_CONFLICT' }
  | { outcome: 'DEPARTMENT_HAS_ACTIVE_EMPLOYEES'; activeEmployeeCount: number }
  | { outcome: 'INTERNAL_ERROR' };

// Helper type — matches the Prisma row shape returned by DEPT_READ_SELECT.
type DepartmentRow = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  status: string;
  createdAt: Date;
};

// Shared Prisma select for all read operations.
const DEPT_READ_SELECT = {
  id: true,
  name: true,
  code: true,
  description: true,
  status: true,
  createdAt: true,
} as const;

function toDepartmentRecord(row: DepartmentRow): DepartmentRecord {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class DepartmentService {
  private readonly logger = new Logger(DepartmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createDepartment(
    dto: CreateDepartmentDto,
    tenantId: string,
    actorId: string,
  ): Promise<CreateDepartmentResult> {
    let department: DepartmentRow;
    try {
      department = await this.prisma.department.create({
        data: {
          tenantId,
          name: dto.name,
          code: dto.code,
          description: dto.description ?? null,
          status: 'ACTIVE',
        },
        select: DEPT_READ_SELECT,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Only unique constraint reachable by department.create() is
        // idx_departments_tenant_code — code already exists within this tenant.
        return { outcome: 'CODE_CONFLICT' };
      }
      this.logger.error(
        'Department creation failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    // Audit emitted after write — outside transaction per AUD-350 / AUD-1300.
    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: AuditEventType.ORG_DEPARTMENT_CREATED,
      result: 'SUCCESS',
      entityType: 'DEPARTMENT',
      entityId: department.id,
      metadata: { name: department.name, code: department.code },
    });

    return { outcome: 'SUCCESS', department: toDepartmentRecord(department) };
  }

  async listDepartments(
    tenantId: string,
    query: ListDepartmentsQueryDto,
  ): Promise<ListDepartmentsResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.DepartmentWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    let departments: DepartmentRow[];
    let total: number;
    try {
      // Promise.all approved deviation — matches listUsers pattern (Milestone 6).
      // Avoids $transaction overhead for two independent read queries.
      [departments, total] = await Promise.all([
        this.prisma.department.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: DEPT_READ_SELECT,
          orderBy: { name: 'asc' },
        }),
        this.prisma.department.count({ where }),
      ]);
    } catch (err) {
      this.logger.error(
        'listDepartments failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    return {
      outcome: 'SUCCESS',
      departments: departments.map(toDepartmentRecord),
      total,
      page,
      pageSize,
    };
  }

  async getDepartmentById(
    id: string,
    tenantId: string,
  ): Promise<GetDepartmentByIdResult> {
    let row: DepartmentRow | null;
    try {
      // findFirst with tenantId enforces SEC-003 at the DB query level.
      // NOT_FOUND is returned for both absent and cross-tenant — prevents enumeration (DEP-006).
      row = await this.prisma.department.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: DEPT_READ_SELECT,
      });
    } catch (err) {
      this.logger.error(
        'getDepartmentById failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (!row) return { outcome: 'NOT_FOUND' };
    return { outcome: 'SUCCESS', department: toDepartmentRecord(row) };
  }

  async updateDepartment(
    id: string,
    dto: UpdateDepartmentDto,
    tenantId: string,
    actorId: string,
  ): Promise<UpdateDepartmentResult> {
    try {
      // Verify existence and tenant ownership before writing (SEC-003 + DEP-005).
      // findFirst + update is not atomic; TOCTOU is an acceptable Phase 1 risk
      // matching the risk profile of similar patterns across the codebase.
      const existing = await this.prisma.department.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true },
      });

      if (!existing) return { outcome: 'NOT_FOUND' };

      // DEP-008 Phase A (GD-PRE-M13-003): block deactivation when active employees
      // reference this department. SEPARATED employees and soft-deleted records do not block.
      if (dto.status === 'INACTIVE') {
        const activeEmployeeCount = await this.prisma.employee.count({
          where: {
            departmentId: id,
            deletedAt: null,
            employmentStatus: { in: ['PENDING_ONBOARDING', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED'] },
          },
        });
        if (activeEmployeeCount > 0) {
          return { outcome: 'DEPARTMENT_HAS_ACTIVE_EMPLOYEES', activeEmployeeCount };
        }
      }

      const row = await this.prisma.department.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.code !== undefined ? { code: dto.code } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
        select: DEPT_READ_SELECT,
      });

      // Deactivation (status → INACTIVE) uses a dedicated audit event per AUD-350.
      // All other field updates use ORG_DEPARTMENT_UPDATED.
      const auditAction =
        dto.status === 'INACTIVE'
          ? AuditEventType.ORG_DEPARTMENT_DEACTIVATED
          : AuditEventType.ORG_DEPARTMENT_UPDATED;

      await this.auditService.logEvent({
        tenantId,
        userId: actorId,
        action: auditAction,
        result: 'SUCCESS',
        entityType: 'DEPARTMENT',
        entityId: row.id,
        metadata: { name: row.name, code: row.code, status: row.status },
      });

      return { outcome: 'SUCCESS', department: toDepartmentRecord(row) };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return { outcome: 'CODE_CONFLICT' };
      }
      this.logger.error(
        'updateDepartment failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }
}
