// Reference: spec/01_requirements.md — FR-051 Department Management
// Reference: directives/12_organization_management_rules.md — DEP-001 through DEP-008, ORG-003
// Reference: directives/08_audit_rules.md — AUD-350
//
// Pure unit tests — no database.
// PrismaService and AuditService replaced with jest.fn() mocks.
// Verifies all discriminated-union outcomes for each DepartmentService method.
// SEC-003 tenant isolation: tenantId and deletedAt: null always present in where clauses.

import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { DepartmentService } from './department.service';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import type { CreateDepartmentDto } from './dto/create-department.dto';
import type { UpdateDepartmentDto } from './dto/update-department.dto';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID  = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DEPT_ID   = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const DEPT_ROW = {
  id: DEPT_ID,
  name: 'Human Resources',
  code: 'HR-001',
  description: null as string | null,
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DepartmentService', () => {
  let service: DepartmentService;

  const mockPrisma = {
    department: {
      create:   jest.fn(),
      findMany: jest.fn(),
      count:    jest.fn(),
      findFirst: jest.fn(),
      update:   jest.fn(),
    },
    employee: {
      count: jest.fn(),
    },
    position: {
      count: jest.fn(),
    },
  };
  const mockAuditService = { logEvent: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepartmentService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<DepartmentService>(DepartmentService);
  });

  // ---------------------------------------------------------------------------
  // createDepartment
  // ---------------------------------------------------------------------------

  describe('createDepartment()', () => {
    it('valid input → outcome SUCCESS with DepartmentRecord', async () => {
      mockPrisma.department.create.mockResolvedValue(DEPT_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.createDepartment(
        { name: 'Human Resources', code: 'HR-001' } as CreateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.department).toMatchObject({
          id: DEPT_ID,
          name: 'Human Resources',
          code: 'HR-001',
          status: 'ACTIVE',
        });
      }
    });

    it('description not provided → create data contains description: null', async () => {
      mockPrisma.department.create.mockResolvedValue(DEPT_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createDepartment(
        { name: 'HR', code: 'HR-001' } as CreateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockPrisma.department.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ description: null }),
        }),
      );
    });

    it('P2002 unique constraint violation → outcome CODE_CONFLICT', async () => {
      mockPrisma.department.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.0.0',
        }),
      );

      const result = await service.createDepartment(
        { name: 'HR', code: 'HR-001' } as CreateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('CODE_CONFLICT');
    });

    it('unexpected error → outcome INTERNAL_ERROR', async () => {
      mockPrisma.department.create.mockRejectedValue(new Error('DB unavailable'));

      const result = await service.createDepartment(
        { name: 'HR', code: 'HR-001' } as CreateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('ORG_DEPARTMENT_CREATED audit event emitted after successful create', async () => {
      mockPrisma.department.create.mockResolvedValue(DEPT_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createDepartment(
        { name: 'HR', code: 'HR-001' } as CreateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.ORG_DEPARTMENT_CREATED,
          tenantId: TENANT_ID,
          userId: ACTOR_ID,
          entityType: 'DEPARTMENT',
          entityId: DEPT_ID,
        }),
      );
    });

    it('audit event NOT emitted when CODE_CONFLICT', async () => {
      mockPrisma.department.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.0.0',
        }),
      );

      await service.createDepartment(
        { name: 'HR', code: 'HR-001' } as CreateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // listDepartments
  // ---------------------------------------------------------------------------

  describe('listDepartments()', () => {
    it('returns SUCCESS with departments array and correct pagination metadata', async () => {
      mockPrisma.department.findMany.mockResolvedValue([DEPT_ROW]);
      mockPrisma.department.count.mockResolvedValue(1);

      const result = await service.listDepartments(TENANT_ID, { page: 1, pageSize: 20 });

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.departments).toHaveLength(1);
        expect(result.total).toBe(1);
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(20);
      }
    });

    it('skip calculated from (page - 1) * pageSize', async () => {
      mockPrisma.department.findMany.mockResolvedValue([]);
      mockPrisma.department.count.mockResolvedValue(0);

      await service.listDepartments(TENANT_ID, { page: 3, pageSize: 10 });

      expect(mockPrisma.department.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('status filter included in where clause when provided', async () => {
      mockPrisma.department.findMany.mockResolvedValue([]);
      mockPrisma.department.count.mockResolvedValue(0);

      await service.listDepartments(TENANT_ID, { status: 'INACTIVE' });

      expect(mockPrisma.department.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'INACTIVE' }),
        }),
      );
    });

    it('search generates OR filter across name, code, and description', async () => {
      mockPrisma.department.findMany.mockResolvedValue([]);
      mockPrisma.department.count.mockResolvedValue(0);

      await service.listDepartments(TENANT_ID, { search: 'HR' });

      expect(mockPrisma.department.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ name: expect.objectContaining({ contains: 'HR' }) }),
              expect.objectContaining({ code: expect.objectContaining({ contains: 'HR' }) }),
              expect.objectContaining({ description: expect.objectContaining({ contains: 'HR' }) }),
            ]),
          }),
        }),
      );
    });

    it('where clause always includes tenantId and deletedAt: null (SEC-003 + DEP-005)', async () => {
      mockPrisma.department.findMany.mockResolvedValue([]);
      mockPrisma.department.count.mockResolvedValue(0);

      await service.listDepartments(TENANT_ID, {});

      expect(mockPrisma.department.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_ID, deletedAt: null }),
        }),
      );
    });

    it('Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.department.findMany.mockRejectedValue(new Error('DB error'));

      const result = await service.listDepartments(TENANT_ID, {});

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // getDepartmentById
  // ---------------------------------------------------------------------------

  describe('getDepartmentById()', () => {
    it('department found → outcome SUCCESS with DepartmentRecord', async () => {
      mockPrisma.department.findFirst.mockResolvedValue(DEPT_ROW);

      const result = await service.getDepartmentById(DEPT_ID, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.department.id).toBe(DEPT_ID);
      }
    });

    it('findFirst returns null (absent or cross-tenant) → outcome NOT_FOUND', async () => {
      mockPrisma.department.findFirst.mockResolvedValue(null);

      const result = await service.getDepartmentById(DEPT_ID, TENANT_ID);

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.department.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await service.getDepartmentById(DEPT_ID, TENANT_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('findFirst where clause includes id, tenantId, and deletedAt: null (SEC-003 + DEP-005)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue(DEPT_ROW);

      await service.getDepartmentById(DEPT_ID, TENANT_ID);

      expect(mockPrisma.department.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: DEPT_ID, tenantId: TENANT_ID, deletedAt: null }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // updateDepartment
  // ---------------------------------------------------------------------------

  describe('updateDepartment()', () => {
    it('department found and updated → outcome SUCCESS with updated DepartmentRecord', async () => {
      const updatedRow = { ...DEPT_ROW, name: 'HR Updated' };
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.department.update.mockResolvedValue(updatedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.updateDepartment(
        DEPT_ID,
        { name: 'HR Updated' } as UpdateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.department.name).toBe('HR Updated');
      }
    });

    it('findFirst returns null → outcome NOT_FOUND', async () => {
      mockPrisma.department.findFirst.mockResolvedValue(null);

      const result = await service.updateDepartment(
        DEPT_ID,
        { name: 'X' } as UpdateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('update throws P2002 → outcome CODE_CONFLICT', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.department.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.0.0',
        }),
      );

      const result = await service.updateDepartment(
        DEPT_ID,
        { code: 'DUPLICATE' } as UpdateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('CODE_CONFLICT');
    });

    it('update throws unknown error → outcome INTERNAL_ERROR', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.department.update.mockRejectedValue(new Error('DB error'));

      const result = await service.updateDepartment(
        DEPT_ID,
        { name: 'X' } as UpdateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('dto.status === "INACTIVE" → emits ORG_DEPARTMENT_DEACTIVATED event (AUD-350)', async () => {
      const deactivatedRow = { ...DEPT_ROW, status: 'INACTIVE' };
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.employee.count.mockResolvedValue(0); // DEP-008: no blocking employees
      mockPrisma.department.update.mockResolvedValue(deactivatedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateDepartment(
        DEPT_ID,
        { status: 'INACTIVE' } as UpdateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.ORG_DEPARTMENT_DEACTIVATED }),
      );
    });

    it('dto.status not "INACTIVE" → emits ORG_DEPARTMENT_UPDATED event (AUD-350)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.department.update.mockResolvedValue(DEPT_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateDepartment(
        DEPT_ID,
        { name: 'New Name' } as UpdateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.ORG_DEPARTMENT_UPDATED }),
      );
    });

    it('only supplied dto fields included in update data', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.department.update.mockResolvedValue(DEPT_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateDepartment(
        DEPT_ID,
        { name: 'Name Only' } as UpdateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      const callData = (mockPrisma.department.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
      expect(callData).toHaveProperty('name', 'Name Only');
      expect(callData).not.toHaveProperty('code');
      expect(callData).not.toHaveProperty('status');
      expect(callData).not.toHaveProperty('description');
    });

    it('audit event NOT emitted when outcome is NOT_FOUND', async () => {
      mockPrisma.department.findFirst.mockResolvedValue(null);

      await service.updateDepartment(
        DEPT_ID,
        { name: 'X' } as UpdateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // updateDepartment() — DEP-008 deactivation constraint (GD-PRE-M13-003)
  // ---------------------------------------------------------------------------

  describe('updateDepartment() — DEP-008 deactivation constraint', () => {
    it('DEP-008-U1: active employee count > 1 → outcome DEPARTMENT_HAS_ACTIVE_EMPLOYEES with correct count', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.employee.count.mockResolvedValue(3);

      const result = await service.updateDepartment(
        DEPT_ID,
        { status: 'INACTIVE' } as UpdateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('DEPARTMENT_HAS_ACTIVE_EMPLOYEES');
      if (result.outcome === 'DEPARTMENT_HAS_ACTIVE_EMPLOYEES') {
        expect(result.activeEmployeeCount).toBe(3);
      }
    });

    it('DEP-008-U2: exactly 1 active employee → outcome DEPARTMENT_HAS_ACTIVE_EMPLOYEES with count 1', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.employee.count.mockResolvedValue(1);

      const result = await service.updateDepartment(
        DEPT_ID,
        { status: 'INACTIVE' } as UpdateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('DEPARTMENT_HAS_ACTIVE_EMPLOYEES');
      if (result.outcome === 'DEPARTMENT_HAS_ACTIVE_EMPLOYEES') {
        expect(result.activeEmployeeCount).toBe(1);
      }
    });

    it('DEP-008-U3: zero active employees and zero active positions → deactivation proceeds, outcome SUCCESS', async () => {
      const deactivatedRow = { ...DEPT_ROW, status: 'INACTIVE' };
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.employee.count.mockResolvedValue(0);
      mockPrisma.position.count.mockResolvedValue(0);
      mockPrisma.department.update.mockResolvedValue(deactivatedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.updateDepartment(
        DEPT_ID,
        { status: 'INACTIVE' } as UpdateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('SUCCESS');
    });

    it('DEP-008-U4: employee count query excludes SEPARATED employees via status filter', async () => {
      const deactivatedRow = { ...DEPT_ROW, status: 'INACTIVE' };
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      // count returns 0 — SEPARATED employees are excluded by the where clause in the service
      mockPrisma.employee.count.mockResolvedValue(0);
      mockPrisma.position.count.mockResolvedValue(0);
      mockPrisma.department.update.mockResolvedValue(deactivatedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateDepartment(
        DEPT_ID,
        { status: 'INACTIVE' } as UpdateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockPrisma.employee.count).toHaveBeenCalledWith({
        where: {
          departmentId: DEPT_ID,
          deletedAt: null,
          employmentStatus: { in: ['PENDING_ONBOARDING', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED'] },
        },
      });
    });

    it('DEP-008-U5: non-deactivation status update → employee count query NOT called', async () => {
      const reactivatedRow = { ...DEPT_ROW, status: 'ACTIVE' };
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.department.update.mockResolvedValue(reactivatedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateDepartment(
        DEPT_ID,
        { status: 'ACTIVE' } as UpdateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockPrisma.employee.count).not.toHaveBeenCalled();
    });

    it('DEP-008-U6: department.update NOT called when blocked by active employees', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.employee.count.mockResolvedValue(5);
      mockPrisma.position.count.mockResolvedValue(0);

      await service.updateDepartment(
        DEPT_ID,
        { status: 'INACTIVE' } as UpdateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockPrisma.department.update).not.toHaveBeenCalled();
    });

    // DEP-008 Phase B (GD-PRE-M13-003 D3): position guard

    it('DEP-008-B1: active positions exist (no employees) → outcome DEPARTMENT_HAS_ACTIVE_POSITIONS with count', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.employee.count.mockResolvedValue(0);
      mockPrisma.position.count.mockResolvedValue(2);

      const result = await service.updateDepartment(
        DEPT_ID,
        { status: 'INACTIVE' } as UpdateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('DEPARTMENT_HAS_ACTIVE_POSITIONS');
      if (result.outcome === 'DEPARTMENT_HAS_ACTIVE_POSITIONS') {
        expect(result.activePositionCount).toBe(2);
      }
    });

    it('DEP-008-B2: both active employees AND active positions → outcome DEPARTMENT_HAS_ACTIVE_DEPENDENTS with both counts', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.employee.count.mockResolvedValue(3);
      mockPrisma.position.count.mockResolvedValue(2);

      const result = await service.updateDepartment(
        DEPT_ID,
        { status: 'INACTIVE' } as UpdateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('DEPARTMENT_HAS_ACTIVE_DEPENDENTS');
      if (result.outcome === 'DEPARTMENT_HAS_ACTIVE_DEPENDENTS') {
        expect(result.activeEmployeeCount).toBe(3);
        expect(result.activePositionCount).toBe(2);
      }
    });

    it('DEP-008-B3: position count query filters DRAFT, ACTIVE, FROZEN status (CLOSED does not block)', async () => {
      const deactivatedRow = { ...DEPT_ROW, status: 'INACTIVE' };
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.employee.count.mockResolvedValue(0);
      // position.count returns 0 — CLOSED positions excluded by the where clause
      mockPrisma.position.count.mockResolvedValue(0);
      mockPrisma.department.update.mockResolvedValue(deactivatedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateDepartment(
        DEPT_ID,
        { status: 'INACTIVE' } as UpdateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockPrisma.position.count).toHaveBeenCalledWith({
        where: {
          departmentId: DEPT_ID,
          deletedAt: null,
          status: { in: ['DRAFT', 'ACTIVE', 'FROZEN'] },
        },
      });
    });

    it('DEP-008-B4: department.update NOT called when blocked by active positions only', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.employee.count.mockResolvedValue(0);
      mockPrisma.position.count.mockResolvedValue(1);

      await service.updateDepartment(
        DEPT_ID,
        { status: 'INACTIVE' } as UpdateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockPrisma.department.update).not.toHaveBeenCalled();
    });

    it('DEP-008-B5: non-INACTIVE status update → position count query NOT called', async () => {
      const reactivatedRow = { ...DEPT_ROW, status: 'ACTIVE' };
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.department.update.mockResolvedValue(reactivatedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateDepartment(
        DEPT_ID,
        { status: 'ACTIVE' } as UpdateDepartmentDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockPrisma.position.count).not.toHaveBeenCalled();
    });
  });
});
