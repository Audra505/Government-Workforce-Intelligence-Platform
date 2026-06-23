// Reference: spec/01_requirements.md — FR-110, FR-111, FR-112 Employee Management
// Reference: directives/13_employee_management_rules.md — EMP-001 through EMP-805
// Reference: directives/13_employee_management_rules.md — GD-M12-1 through GD-M12-8
// Reference: directives/08_audit_rules.md — EMP-700 through EMP-702
// Reference: governance/GD-M15-1.md — Decision 1, 4, 8, 9 (appointmentAuthority; positionId at creation)
// Reference: governance/GD-PRE-M13-001.md — appointment authority design
// Reference: governance/GD-PRE-M13-002.md — 1:1 FTE Slot Model occupancy check
//
// Pure unit tests — no database.
// PrismaService and AuditService replaced with jest.fn() mocks.
// Verifies all discriminated-union outcomes for each EmployeeService method.
// SEC-003 tenant isolation: tenantId and deletedAt: null always present in where clauses.
// Lifecycle state machine: all 6 allowed and 10 forbidden transitions verified.
// GD-M12-6: employeeNumber immutability checked before any DB operation.
// GD-M15-1 D8: appointmentAuthority immutability checked before any DB operation.
// GD-M15-1 D1/D4: appointmentAuthority domain validation; positionId validation at creation.
// GD-M15-1 D9: WORKFORCE_EMPLOYEE_POSITION_ASSIGNED emitted for creation-time positionId.
// EMP-401: audit metadata must not contain PII field values (names, emails).
// EMP-303: terminationDate set by service on ACTIVE → SEPARATED — not client-supplied.
// GD-M12-8/EMP-805: SEPARATED rejected when hireDate is set and in the future.

import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { EmployeeService } from './employee.service';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import type {
  CreateEmployeeParams,
  UpdateEmployeeParams,
  ChangeEmployeeStatusParams,
} from './employee.service';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID    = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DEPT_ID     = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const EMPLOYEE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const POSITION_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-01-02T00:00:00.000Z');

const EMPLOYEE_ROW = {
  id: EMPLOYEE_ID,
  tenantId: TENANT_ID,
  departmentId: DEPT_ID,
  positionId: null as string | null,
  employeeNumber: 'EMP-001' as string | null,
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane.smith@agency.gov' as string | null,
  employmentStatus: 'PENDING_ONBOARDING',
  appointmentAuthority: 'ADMINISTRATIVE',
  hireDate: null as Date | null,
  terminationDate: null as Date | null,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  department: {
    name: 'Human Resources',
  },
};

const CREATE_PARAMS: CreateEmployeeParams = {
  employeeNumber: 'EMP-001',
  firstName: 'Jane',
  lastName: 'Smith',
  departmentId: DEPT_ID,
  appointmentAuthority: 'ADMINISTRATIVE',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmployeeService', () => {
  let service: EmployeeService;

  const mockPrisma = {
    department: {
      findFirst: jest.fn(),
    },
    position: {
      findFirst: jest.fn(),
    },
    employee: {
      create:    jest.fn(),
      findMany:  jest.fn(),
      count:     jest.fn(),
      findFirst: jest.fn(),
      update:    jest.fn(),
    },
  };
  const mockAuditService = { logEvent: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<EmployeeService>(EmployeeService);
  });

  // ---------------------------------------------------------------------------
  // createEmployee
  // ---------------------------------------------------------------------------

  describe('createEmployee()', () => {
    it('valid params → outcome SUCCESS with EmployeeRecord and PENDING_ONBOARDING status (EMP-001)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.employee.create.mockResolvedValue(EMPLOYEE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.createEmployee(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.employee.id).toBe(EMPLOYEE_ID);
        expect(result.employee.employmentStatus).toBe('PENDING_ONBOARDING');
        expect(result.employee.departmentName).toBe('Human Resources');
      }
    });

    it('create data always sets employmentStatus: "PENDING_ONBOARDING" (GD-M12-1/EMP-001)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.employee.create.mockResolvedValue(EMPLOYEE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createEmployee(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ employmentStatus: 'PENDING_ONBOARDING' }),
        }),
      );
    });

    it('create data includes tenantId from auth context, never from params (SEC-003)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.employee.create.mockResolvedValue(EMPLOYEE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createEmployee(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: TENANT_ID }),
        }),
      );
    });

    it('department not found → outcome DEPARTMENT_NOT_FOUND', async () => {
      mockPrisma.department.findFirst.mockResolvedValue(null);

      const result = await service.createEmployee(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('DEPARTMENT_NOT_FOUND');
    });

    it('department validation where clause includes tenantId and deletedAt: null (SEC-003)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.employee.create.mockResolvedValue(EMPLOYEE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createEmployee(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.department.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: DEPT_ID,
            tenantId: TENANT_ID,
            deletedAt: null,
          }),
        }),
      );
    });

    it('Prisma P2002 on employee create → outcome EMPLOYEE_NUMBER_CONFLICT (GD-M12-6/EMP-201)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      const p2002Error = new Prisma.PrismaClientKnownRequestError('Unique constraint violated', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['tenant_id', 'employee_number'] },
      });
      mockPrisma.employee.create.mockRejectedValue(p2002Error);

      const result = await service.createEmployee(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('EMPLOYEE_NUMBER_CONFLICT');
    });

    it('WORKFORCE_EMPLOYEE_CREATED audit event emitted after successful create (EMP-700)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.employee.create.mockResolvedValue(EMPLOYEE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createEmployee(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.WORKFORCE_EMPLOYEE_CREATED,
          tenantId: TENANT_ID,
          userId: ACTOR_ID,
          entityType: 'EMPLOYEE',
          entityId: EMPLOYEE_ID,
        }),
      );
    });

    it('audit metadata does NOT contain firstName value (EMP-401)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.employee.create.mockResolvedValue(EMPLOYEE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createEmployee(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      const callArg = (mockAuditService.logEvent.mock.calls[0] as [Record<string, unknown>])[0];
      const metadata = callArg.metadata as Record<string, unknown>;
      expect(JSON.stringify(metadata)).not.toContain('Jane');
    });

    it('audit metadata does NOT contain lastName value (EMP-401)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.employee.create.mockResolvedValue(EMPLOYEE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createEmployee(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      const callArg = (mockAuditService.logEvent.mock.calls[0] as [Record<string, unknown>])[0];
      const metadata = callArg.metadata as Record<string, unknown>;
      expect(JSON.stringify(metadata)).not.toContain('Smith');
    });

    it('Prisma unknown error → outcome INTERNAL_ERROR', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.employee.create.mockRejectedValue(new Error('DB connection lost'));

      const result = await service.createEmployee(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('audit event NOT emitted on DEPARTMENT_NOT_FOUND', async () => {
      mockPrisma.department.findFirst.mockResolvedValue(null);

      await service.createEmployee(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    // M15 appointmentAuthority validation (GD-M15-1 D1/D4)

    it('missing appointmentAuthority (undefined) → APPOINTMENT_AUTHORITY_REQUIRED, no DB query (GD-M15-1 D4)', async () => {
      const result = await service.createEmployee(
        { ...CREATE_PARAMS, appointmentAuthority: undefined },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('APPOINTMENT_AUTHORITY_REQUIRED');
      expect(mockPrisma.department.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.employee.create).not.toHaveBeenCalled();
      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('COMPETITIVE_APPOINTMENT → COMPETITIVE_APPOINTMENT_SYSTEM_ONLY, no DB query (GD-M15-1 D1; GD-PRE-M13-001)', async () => {
      const result = await service.createEmployee(
        { ...CREATE_PARAMS, appointmentAuthority: 'COMPETITIVE_APPOINTMENT' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('COMPETITIVE_APPOINTMENT_SYSTEM_ONLY');
      expect(mockPrisma.department.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.employee.create).not.toHaveBeenCalled();
      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('unknown appointmentAuthority value → INVALID_APPOINTMENT_AUTHORITY, no DB query (GD-M15-1 D1)', async () => {
      const result = await service.createEmployee(
        { ...CREATE_PARAMS, appointmentAuthority: 'BANANA' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('INVALID_APPOINTMENT_AUTHORITY');
      expect(mockPrisma.department.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.employee.create).not.toHaveBeenCalled();
    });

    it('create data includes appointmentAuthority from params (GD-M15-1 D4)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.employee.create.mockResolvedValue(EMPLOYEE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createEmployee(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ appointmentAuthority: 'ADMINISTRATIVE' }),
        }),
      );
    });

    // M15 positionId validation at creation time (GD-M15-1 D4; GD-PRE-M13-002)

    it('positionId provided + position not in tenant → POSITION_NOT_FOUND (GD-M15-1 D4)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.position.findFirst.mockResolvedValue(null);

      const result = await service.createEmployee(
        { ...CREATE_PARAMS, positionId: POSITION_ID },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('POSITION_NOT_FOUND');
      expect(mockPrisma.employee.create).not.toHaveBeenCalled();
    });

    it('positionId provided + position not ACTIVE → POSITION_NOT_ACTIVE_FOR_ASSIGNMENT (GD-M15-1 D4)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.position.findFirst.mockResolvedValue({
        id: POSITION_ID, status: 'DRAFT', title: 'Staff Analyst',
      });

      const result = await service.createEmployee(
        { ...CREATE_PARAMS, positionId: POSITION_ID },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('POSITION_NOT_ACTIVE_FOR_ASSIGNMENT');
      expect(mockPrisma.employee.create).not.toHaveBeenCalled();
    });

    it('positionId provided + position ACTIVE but has incumbent → POSITION_ALREADY_OCCUPIED (GD-PRE-M13-002)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.position.findFirst.mockResolvedValue({
        id: POSITION_ID, status: 'ACTIVE', title: 'Staff Analyst',
      });
      mockPrisma.employee.findFirst.mockResolvedValue({ id: 'existing-emp-id' });

      const result = await service.createEmployee(
        { ...CREATE_PARAMS, positionId: POSITION_ID },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('POSITION_ALREADY_OCCUPIED');
      expect(mockPrisma.employee.create).not.toHaveBeenCalled();
    });

    it('positionId provided + valid unoccupied ACTIVE position → SUCCESS with positionId in data (GD-M15-1 D4)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.position.findFirst.mockResolvedValue({
        id: POSITION_ID, status: 'ACTIVE', title: 'Staff Analyst',
      });
      mockPrisma.employee.findFirst.mockResolvedValue(null); // no incumbent
      mockPrisma.employee.create.mockResolvedValue({ ...EMPLOYEE_ROW, positionId: POSITION_ID });
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.createEmployee(
        { ...CREATE_PARAMS, positionId: POSITION_ID },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('SUCCESS');
      expect(mockPrisma.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ positionId: POSITION_ID }),
        }),
      );
    });

    it('positionId provided + valid position → WORKFORCE_EMPLOYEE_POSITION_ASSIGNED audit event emitted (GD-M15-1 D9)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.position.findFirst.mockResolvedValue({
        id: POSITION_ID, status: 'ACTIVE', title: 'Staff Analyst',
      });
      mockPrisma.employee.findFirst.mockResolvedValue(null);
      mockPrisma.employee.create.mockResolvedValue({ ...EMPLOYEE_ROW, positionId: POSITION_ID });
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createEmployee(
        { ...CREATE_PARAMS, positionId: POSITION_ID },
        TENANT_ID,
        ACTOR_ID,
      );

      const auditCalls = (mockAuditService.logEvent.mock.calls as [Record<string, unknown>][]).map(
        ([arg]) => (arg as Record<string, unknown>).action,
      );
      expect(auditCalls).toContain(AuditEventType.WORKFORCE_EMPLOYEE_CREATED);
      expect(auditCalls).toContain(AuditEventType.WORKFORCE_EMPLOYEE_POSITION_ASSIGNED);
    });

    it('no positionId provided → WORKFORCE_EMPLOYEE_POSITION_ASSIGNED NOT emitted (GD-M15-1 D9)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.employee.create.mockResolvedValue(EMPLOYEE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createEmployee(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      const auditCalls = (mockAuditService.logEvent.mock.calls as [Record<string, unknown>][]).map(
        ([arg]) => (arg as Record<string, unknown>).action,
      );
      expect(auditCalls).not.toContain(AuditEventType.WORKFORCE_EMPLOYEE_POSITION_ASSIGNED);
    });

    it('occupancy check where clause includes non-SEPARATED statuses and deletedAt: null (GD-PRE-M13-002)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.position.findFirst.mockResolvedValue({
        id: POSITION_ID, status: 'ACTIVE', title: 'Staff Analyst',
      });
      mockPrisma.employee.findFirst.mockResolvedValue(null);
      mockPrisma.employee.create.mockResolvedValue({ ...EMPLOYEE_ROW, positionId: POSITION_ID });
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createEmployee(
        { ...CREATE_PARAMS, positionId: POSITION_ID },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockPrisma.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            positionId: POSITION_ID,
            employmentStatus: { in: ['PENDING_ONBOARDING', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED'] },
            deletedAt: null,
          }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // listEmployees
  // ---------------------------------------------------------------------------

  describe('listEmployees()', () => {
    it('returns SUCCESS with employees array and pagination metadata', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([EMPLOYEE_ROW]);
      mockPrisma.employee.count.mockResolvedValue(1);

      const result = await service.listEmployees(TENANT_ID, { page: 1, pageSize: 20 });

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.employees).toHaveLength(1);
        expect(result.total).toBe(1);
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(20);
      }
    });

    it('returns SUCCESS with empty array when no employees match', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([]);
      mockPrisma.employee.count.mockResolvedValue(0);

      const result = await service.listEmployees(TENANT_ID, {});

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.employees).toHaveLength(0);
        expect(result.total).toBe(0);
      }
    });

    it('skip = (page - 1) * pageSize', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([]);
      mockPrisma.employee.count.mockResolvedValue(0);

      await service.listEmployees(TENANT_ID, { page: 3, pageSize: 10 });

      expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('where clause always includes tenantId and deletedAt: null (SEC-003)', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([]);
      mockPrisma.employee.count.mockResolvedValue(0);

      await service.listEmployees(TENANT_ID, {});

      expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_ID, deletedAt: null }),
        }),
      );
    });

    it('employmentStatus filter included in where clause when provided (FR-112/EMP-500)', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([]);
      mockPrisma.employee.count.mockResolvedValue(0);

      await service.listEmployees(TENANT_ID, { employmentStatus: 'ACTIVE' });

      expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ employmentStatus: 'ACTIVE' }),
        }),
      );
    });

    it('departmentId filter included in where clause when provided', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([]);
      mockPrisma.employee.count.mockResolvedValue(0);

      await service.listEmployees(TENANT_ID, { departmentId: DEPT_ID });

      expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ departmentId: DEPT_ID }),
        }),
      );
    });

    it('Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.employee.findMany.mockRejectedValue(new Error('DB error'));

      const result = await service.listEmployees(TENANT_ID, {});

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // getEmployeeById
  // ---------------------------------------------------------------------------

  describe('getEmployeeById()', () => {
    it('employee found → outcome SUCCESS with EmployeeRecord', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(EMPLOYEE_ROW);

      const result = await service.getEmployeeById(EMPLOYEE_ID, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.employee.id).toBe(EMPLOYEE_ID);
        expect(result.employee.departmentName).toBe('Human Resources');
      }
    });

    it('findFirst returns null (absent or soft-deleted) → outcome NOT_FOUND', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      const result = await service.getEmployeeById(EMPLOYEE_ID, TENANT_ID);

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('cross-tenant employee (findFirst returns null due to tenantId filter) → NOT_FOUND (SEC-003)', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      const result = await service.getEmployeeById(EMPLOYEE_ID, 'different-tenant-id');

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('findFirst where clause includes id, tenantId, and deletedAt: null (SEC-003)', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(EMPLOYEE_ROW);

      await service.getEmployeeById(EMPLOYEE_ID, TENANT_ID);

      expect(mockPrisma.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: EMPLOYEE_ID,
            tenantId: TENANT_ID,
            deletedAt: null,
          }),
        }),
      );
    });

    it('Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.employee.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await service.getEmployeeById(EMPLOYEE_ID, TENANT_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // updateEmployee
  // ---------------------------------------------------------------------------

  describe('updateEmployee()', () => {
    it('params.employeeNumber !== undefined → EMPLOYEE_NUMBER_IMMUTABLE without any DB query (GD-M12-6/EMP-304)', async () => {
      const result = await service.updateEmployee(
        EMPLOYEE_ID,
        { employeeNumber: 'NEW-NUM' } as UpdateEmployeeParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('EMPLOYEE_NUMBER_IMMUTABLE');
      expect(mockPrisma.employee.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('EMPLOYEE_NUMBER_IMMUTABLE: no audit event emitted (GD-M12-6)', async () => {
      await service.updateEmployee(
        EMPLOYEE_ID,
        { employeeNumber: 'NEW-NUM' } as UpdateEmployeeParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('params.appointmentAuthority !== undefined → APPOINTMENT_AUTHORITY_IMMUTABLE without any DB query (GD-M15-1 D8)', async () => {
      const result = await service.updateEmployee(
        EMPLOYEE_ID,
        { appointmentAuthority: 'SCHEDULE_A' } as UpdateEmployeeParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('APPOINTMENT_AUTHORITY_IMMUTABLE');
      expect(mockPrisma.employee.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('APPOINTMENT_AUTHORITY_IMMUTABLE: no audit event emitted (GD-M15-1 D8)', async () => {
      await service.updateEmployee(
        EMPLOYEE_ID,
        { appointmentAuthority: 'SCHEDULE_A' } as UpdateEmployeeParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('valid update → outcome SUCCESS with updated EmployeeRecord', async () => {
      const updatedRow = { ...EMPLOYEE_ROW, firstName: 'Janet' };
      mockPrisma.employee.findFirst.mockResolvedValue({
        id: EMPLOYEE_ID,
        employmentStatus: 'ACTIVE',
      });
      mockPrisma.employee.update.mockResolvedValue(updatedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.updateEmployee(
        EMPLOYEE_ID,
        { firstName: 'Janet' } as UpdateEmployeeParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.employee.firstName).toBe('Janet');
      }
    });

    it('employee not found → outcome NOT_FOUND', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      const result = await service.updateEmployee(
        EMPLOYEE_ID,
        { firstName: 'Janet' } as UpdateEmployeeParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('SEPARATED employee → outcome EMPLOYEE_IS_SEPARATED (EMP-302)', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({
        id: EMPLOYEE_ID,
        employmentStatus: 'SEPARATED',
      });

      const result = await service.updateEmployee(
        EMPLOYEE_ID,
        { firstName: 'Janet' } as UpdateEmployeeParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('EMPLOYEE_IS_SEPARATED');
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('invalid departmentId on update → outcome DEPARTMENT_NOT_FOUND', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({
        id: EMPLOYEE_ID,
        employmentStatus: 'ACTIVE',
      });
      mockPrisma.department.findFirst.mockResolvedValue(null);

      const result = await service.updateEmployee(
        EMPLOYEE_ID,
        { departmentId: 'nonexistent-dept' } as UpdateEmployeeParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('DEPARTMENT_NOT_FOUND');
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('WORKFORCE_EMPLOYEE_UPDATED audit emitted — metadata.updatedFields contains field names only (EMP-401/EMP-700)', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({
        id: EMPLOYEE_ID,
        employmentStatus: 'ACTIVE',
      });
      mockPrisma.employee.update.mockResolvedValue(EMPLOYEE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateEmployee(
        EMPLOYEE_ID,
        { firstName: 'Janet' } as UpdateEmployeeParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.WORKFORCE_EMPLOYEE_UPDATED,
          entityType: 'EMPLOYEE',
          entityId: EMPLOYEE_ID,
          metadata: expect.objectContaining({ updatedFields: expect.arrayContaining(['firstName']) }),
        }),
      );
    });

    it('audit metadata does not contain the actual value of firstName (EMP-401)', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({
        id: EMPLOYEE_ID,
        employmentStatus: 'ACTIVE',
      });
      mockPrisma.employee.update.mockResolvedValue(EMPLOYEE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateEmployee(
        EMPLOYEE_ID,
        { firstName: 'SuperSecretName' } as UpdateEmployeeParams,
        TENANT_ID,
        ACTOR_ID,
      );

      const callArg = (mockAuditService.logEvent.mock.calls[0] as [Record<string, unknown>])[0];
      expect(JSON.stringify(callArg.metadata)).not.toContain('SuperSecretName');
    });

    it('partial update: only supplied fields present in Prisma update data', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({
        id: EMPLOYEE_ID,
        employmentStatus: 'ACTIVE',
      });
      mockPrisma.employee.update.mockResolvedValue(EMPLOYEE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateEmployee(
        EMPLOYEE_ID,
        { firstName: 'Janet' } as UpdateEmployeeParams,
        TENANT_ID,
        ACTOR_ID,
      );

      const callData = (
        mockPrisma.employee.update.mock.calls[0] as [{ data: Record<string, unknown> }]
      )[0].data;
      expect(callData).toHaveProperty('firstName', 'Janet');
      expect(callData).not.toHaveProperty('lastName');
      expect(callData).not.toHaveProperty('email');
      expect(callData).not.toHaveProperty('departmentId');
    });

    it('no audit event emitted on NOT_FOUND', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      await service.updateEmployee(
        EMPLOYEE_ID,
        { firstName: 'Janet' } as UpdateEmployeeParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('no audit event emitted on EMPLOYEE_IS_SEPARATED', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({
        id: EMPLOYEE_ID,
        employmentStatus: 'SEPARATED',
      });

      await service.updateEmployee(
        EMPLOYEE_ID,
        { firstName: 'Janet' } as UpdateEmployeeParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('Prisma update throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({
        id: EMPLOYEE_ID,
        employmentStatus: 'ACTIVE',
      });
      mockPrisma.employee.update.mockRejectedValue(new Error('DB error'));

      const result = await service.updateEmployee(
        EMPLOYEE_ID,
        { firstName: 'Janet' } as UpdateEmployeeParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // changeEmployeeStatus — allowed transitions
  // ---------------------------------------------------------------------------

  describe('changeEmployeeStatus() — allowed transitions', () => {
    // hireDate: null by default — GD-M12-8 guard does not apply when hireDate is null.
    const makeStatusRow = (employmentStatus: string, hireDate: Date | null = null) => ({
      id: EMPLOYEE_ID,
      employmentStatus,
      hireDate,
    });

    const makeUpdatedRow = (employmentStatus: string, terminationDate: Date | null = null) => ({
      ...EMPLOYEE_ROW,
      employmentStatus,
      terminationDate,
    });

    it('PENDING_ONBOARDING → ACTIVE: outcome STATUS_CHANGED, WORKFORCE_EMPLOYEE_ACTIVATED emitted (GD-M12-1)', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(makeStatusRow('PENDING_ONBOARDING'));
      mockPrisma.employee.update.mockResolvedValue(makeUpdatedRow('ACTIVE'));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.changeEmployeeStatus(
        EMPLOYEE_ID,
        { status: 'ACTIVE' } as ChangeEmployeeStatusParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('STATUS_CHANGED');
      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.WORKFORCE_EMPLOYEE_ACTIVATED }),
      );
    });

    it('ACTIVE → ON_LEAVE: outcome STATUS_CHANGED, WORKFORCE_EMPLOYEE_LEAVE_STARTED emitted', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(makeStatusRow('ACTIVE'));
      mockPrisma.employee.update.mockResolvedValue(makeUpdatedRow('ON_LEAVE'));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.changeEmployeeStatus(
        EMPLOYEE_ID,
        { status: 'ON_LEAVE' } as ChangeEmployeeStatusParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('STATUS_CHANGED');
      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.WORKFORCE_EMPLOYEE_LEAVE_STARTED }),
      );
    });

    it('ON_LEAVE → ACTIVE: outcome STATUS_CHANGED, WORKFORCE_EMPLOYEE_RETURNED emitted', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(makeStatusRow('ON_LEAVE'));
      mockPrisma.employee.update.mockResolvedValue(makeUpdatedRow('ACTIVE'));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.changeEmployeeStatus(
        EMPLOYEE_ID,
        { status: 'ACTIVE' } as ChangeEmployeeStatusParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('STATUS_CHANGED');
      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.WORKFORCE_EMPLOYEE_RETURNED }),
      );
    });

    it('ACTIVE → SUSPENDED: outcome STATUS_CHANGED, WORKFORCE_EMPLOYEE_SUSPENDED emitted', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(makeStatusRow('ACTIVE'));
      mockPrisma.employee.update.mockResolvedValue(makeUpdatedRow('SUSPENDED'));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.changeEmployeeStatus(
        EMPLOYEE_ID,
        { status: 'SUSPENDED' } as ChangeEmployeeStatusParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('STATUS_CHANGED');
      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.WORKFORCE_EMPLOYEE_SUSPENDED }),
      );
    });

    it('SUSPENDED → ACTIVE: outcome STATUS_CHANGED, WORKFORCE_EMPLOYEE_REINSTATED emitted', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(makeStatusRow('SUSPENDED'));
      mockPrisma.employee.update.mockResolvedValue(makeUpdatedRow('ACTIVE'));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.changeEmployeeStatus(
        EMPLOYEE_ID,
        { status: 'ACTIVE' } as ChangeEmployeeStatusParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('STATUS_CHANGED');
      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.WORKFORCE_EMPLOYEE_REINSTATED }),
      );
    });

    it('ACTIVE → SEPARATED: STATUS_CHANGED, terminationDate set, WORKFORCE_EMPLOYEE_SEPARATED emitted (EMP-303)', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(makeStatusRow('ACTIVE'));
      mockPrisma.employee.update.mockResolvedValue(makeUpdatedRow('SEPARATED', new Date()));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.changeEmployeeStatus(
        EMPLOYEE_ID,
        { status: 'SEPARATED' } as ChangeEmployeeStatusParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('STATUS_CHANGED');
      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.WORKFORCE_EMPLOYEE_SEPARATED }),
      );
      // Verify terminationDate was included in the update call
      const callData = (
        mockPrisma.employee.update.mock.calls[0] as [{ data: Record<string, unknown> }]
      )[0].data;
      expect(callData).toHaveProperty('terminationDate');
      expect(callData['terminationDate']).toBeInstanceOf(Date);
    });

    it('ACTIVE → SEPARATED with separationReason: audit metadata includes separationReason (EMP-004)', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(makeStatusRow('ACTIVE'));
      mockPrisma.employee.update.mockResolvedValue(makeUpdatedRow('SEPARATED', new Date()));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.changeEmployeeStatus(
        EMPLOYEE_ID,
        { status: 'SEPARATED', separationReason: 'RETIREMENT' } as ChangeEmployeeStatusParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ separationReason: 'RETIREMENT' }),
        }),
      );
    });

    it('ACTIVE → SEPARATED without separationReason: audit metadata does not include separationReason key', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(makeStatusRow('ACTIVE'));
      mockPrisma.employee.update.mockResolvedValue(makeUpdatedRow('SEPARATED', new Date()));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.changeEmployeeStatus(
        EMPLOYEE_ID,
        { status: 'SEPARATED' } as ChangeEmployeeStatusParams,
        TENANT_ID,
        ACTOR_ID,
      );

      const callArg = (mockAuditService.logEvent.mock.calls[0] as [Record<string, unknown>])[0];
      const metadata = callArg.metadata as Record<string, unknown>;
      expect(metadata).not.toHaveProperty('separationReason');
    });
  });

  // ---------------------------------------------------------------------------
  // changeEmployeeStatus — forbidden transitions
  // ---------------------------------------------------------------------------

  describe('changeEmployeeStatus() — forbidden transitions', () => {
    const makeForbiddenTest = (fromStatus: string, toStatus: string) =>
      async () => {
        mockPrisma.employee.findFirst.mockResolvedValue({
          id: EMPLOYEE_ID,
          employmentStatus: fromStatus,
        });

        const result = await service.changeEmployeeStatus(
          EMPLOYEE_ID,
          { status: toStatus },
          TENANT_ID,
          ACTOR_ID,
        );

        expect(result.outcome).toBe('INVALID_TRANSITION');
        expect(mockPrisma.employee.update).not.toHaveBeenCalled();
      };

    it('PENDING_ONBOARDING → ON_LEAVE → INVALID_TRANSITION', makeForbiddenTest('PENDING_ONBOARDING', 'ON_LEAVE'));
    it('PENDING_ONBOARDING → SUSPENDED → INVALID_TRANSITION', makeForbiddenTest('PENDING_ONBOARDING', 'SUSPENDED'));
    it('PENDING_ONBOARDING → SEPARATED → INVALID_TRANSITION', makeForbiddenTest('PENDING_ONBOARDING', 'SEPARATED'));
    it('ON_LEAVE → SUSPENDED → INVALID_TRANSITION', makeForbiddenTest('ON_LEAVE', 'SUSPENDED'));
    it('ON_LEAVE → SEPARATED → INVALID_TRANSITION', makeForbiddenTest('ON_LEAVE', 'SEPARATED'));
    it('SUSPENDED → ON_LEAVE → INVALID_TRANSITION', makeForbiddenTest('SUSPENDED', 'ON_LEAVE'));
    it('SUSPENDED → SEPARATED → INVALID_TRANSITION', makeForbiddenTest('SUSPENDED', 'SEPARATED'));
    it('SEPARATED → ACTIVE → INVALID_TRANSITION (terminal state — GD-M12-1)', makeForbiddenTest('SEPARATED', 'ACTIVE'));
    it('SEPARATED → ON_LEAVE → INVALID_TRANSITION (terminal state)', makeForbiddenTest('SEPARATED', 'ON_LEAVE'));
    it('SEPARATED → SUSPENDED → INVALID_TRANSITION (terminal state)', makeForbiddenTest('SEPARATED', 'SUSPENDED'));
    it('ACTIVE → ACTIVE (same-state) → INVALID_TRANSITION', makeForbiddenTest('ACTIVE', 'ACTIVE'));

    it('no audit event emitted on any INVALID_TRANSITION', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({
        id: EMPLOYEE_ID,
        employmentStatus: 'ON_LEAVE',
      });

      await service.changeEmployeeStatus(
        EMPLOYEE_ID,
        { status: 'SUSPENDED' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // changeEmployeeStatus — error cases
  // ---------------------------------------------------------------------------

  describe('changeEmployeeStatus() — error cases', () => {
    it('non-existent employee → outcome NOT_FOUND', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      const result = await service.changeEmployeeStatus(
        'nonexistent-id',
        { status: 'ACTIVE' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('soft-deleted employee (findFirst returns null due to deletedAt: null filter) → NOT_FOUND', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      const result = await service.changeEmployeeStatus(
        EMPLOYEE_ID,
        { status: 'ACTIVE' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.employee.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await service.changeEmployeeStatus(
        EMPLOYEE_ID,
        { status: 'ACTIVE' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // changeEmployeeStatus — GD-M12-8 date integrity guard (EMP-805)
  // ---------------------------------------------------------------------------

  describe('changeEmployeeStatus() — GD-M12-8 date integrity guard (EMP-805)', () => {
    const makeStatusRow = (employmentStatus: string, hireDate: Date | null = null) => ({
      id: EMPLOYEE_ID,
      employmentStatus,
      hireDate,
    });

    const makeUpdatedRow = (employmentStatus: string, terminationDate: Date | null = null) => ({
      ...EMPLOYEE_ROW,
      employmentStatus,
      terminationDate,
    });

    it('ACTIVE → SEPARATED with future hireDate → TERMINATION_BEFORE_HIRE_DATE, no DB write (GD-M12-8/EMP-805)', async () => {
      const futureHireDate = new Date();
      futureHireDate.setDate(futureHireDate.getDate() + 30);

      mockPrisma.employee.findFirst.mockResolvedValue(makeStatusRow('ACTIVE', futureHireDate));

      const result = await service.changeEmployeeStatus(
        EMPLOYEE_ID,
        { status: 'SEPARATED' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('TERMINATION_BEFORE_HIRE_DATE');
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('TERMINATION_BEFORE_HIRE_DATE: no audit event emitted (GD-M12-8/EMP-805)', async () => {
      const futureHireDate = new Date();
      futureHireDate.setDate(futureHireDate.getDate() + 30);

      mockPrisma.employee.findFirst.mockResolvedValue(makeStatusRow('ACTIVE', futureHireDate));

      await service.changeEmployeeStatus(
        EMPLOYEE_ID,
        { status: 'SEPARATED' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('ACTIVE → SEPARATED with null hireDate → STATUS_CHANGED, guard does not apply (EMP-204/EMP-805)', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(makeStatusRow('ACTIVE', null));
      mockPrisma.employee.update.mockResolvedValue(makeUpdatedRow('SEPARATED', new Date()));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.changeEmployeeStatus(
        EMPLOYEE_ID,
        { status: 'SEPARATED' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('STATUS_CHANGED');
    });

    it('ACTIVE → SEPARATED with past hireDate → STATUS_CHANGED, guard does not apply', async () => {
      const pastHireDate = new Date('2020-01-15');

      mockPrisma.employee.findFirst.mockResolvedValue(makeStatusRow('ACTIVE', pastHireDate));
      mockPrisma.employee.update.mockResolvedValue(makeUpdatedRow('SEPARATED', new Date()));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.changeEmployeeStatus(
        EMPLOYEE_ID,
        { status: 'SEPARATED' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('STATUS_CHANGED');
    });

    it('ACTIVE → ON_LEAVE with future hireDate → STATUS_CHANGED, guard applies only to SEPARATED', async () => {
      const futureHireDate = new Date();
      futureHireDate.setDate(futureHireDate.getDate() + 30);

      mockPrisma.employee.findFirst.mockResolvedValue(makeStatusRow('ACTIVE', futureHireDate));
      mockPrisma.employee.update.mockResolvedValue(makeUpdatedRow('ON_LEAVE'));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.changeEmployeeStatus(
        EMPLOYEE_ID,
        { status: 'ON_LEAVE' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('STATUS_CHANGED');
    });
  });
});
