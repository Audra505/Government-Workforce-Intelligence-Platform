// Reference: spec/01_requirements.md — FR-110, FR-111, FR-112 Employee Management
// Reference: spec/06_api_contracts.md — Employee API contracts
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-001 through EMP-AUTH-005
//
// Pure unit tests — no HTTP server, no database.
// EmployeeService replaced with jest.fn() mocks.
// JwtAuthGuard and RolesGuard overridden to always pass.
// Controller methods called directly with mock RequestUser actor.
// Verifies: HTTP exception types, response envelope shapes, date serialization, error codes.
// RBAC and JWT are infrastructure concerns tested in employee.e2e-spec.ts.

import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';
import type { EmployeeRecord } from './employee.service';
import type { RequestUser } from '../identity/jwt.strategy';
import type { CreateEmployeeDto } from './dto/create-employee.dto';
import type { UpdateEmployeeDto } from './dto/update-employee.dto';
import type { ChangeEmployeeStatusDto } from './dto/change-employee-status.dto';
import type { ListEmployeesQueryDto } from './dto/list-employees-query.dto';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID    = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DEPT_ID     = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const EMPLOYEE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const CREATED_AT  = new Date('2026-06-18T12:00:00.000Z');
const UPDATED_AT  = new Date('2026-06-18T14:00:00.000Z');

const mockActor: RequestUser = {
  userId: ACTOR_ID,
  tenantId: TENANT_ID,
  email: 'admin@dev.gov',
  roles: ['System Administrator'],
};

const employeeRecord: EmployeeRecord = {
  id: EMPLOYEE_ID,
  tenantId: TENANT_ID,
  departmentId: DEPT_ID,
  departmentName: 'Engineering',
  employeeNumber: 'EMP-001',
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane.smith@agency.gov',
  employmentStatus: 'PENDING_ONBOARDING',
  hireDate: null,
  terminationDate: null,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

const createDto: CreateEmployeeDto = {
  employeeNumber: 'EMP-001',
  firstName: 'Jane',
  lastName: 'Smith',
  departmentId: DEPT_ID,
};

const updateDto: UpdateEmployeeDto = { firstName: 'Janet' };

const changeStatusDto: ChangeEmployeeStatusDto = { status: 'ACTIVE' };

const listQuery: ListEmployeesQueryDto = { page: 1, pageSize: 20 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmployeeController', () => {
  let controller: EmployeeController;
  let mockService: {
    createEmployee:       jest.Mock;
    listEmployees:        jest.Mock;
    getEmployeeById:      jest.Mock;
    updateEmployee:       jest.Mock;
    changeEmployeeStatus: jest.Mock;
  };

  beforeEach(async () => {
    mockService = {
      createEmployee:       jest.fn(),
      listEmployees:        jest.fn(),
      getEmployeeById:      jest.fn(),
      updateEmployee:       jest.fn(),
      changeEmployeeStatus: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmployeeController],
      providers: [
        { provide: EmployeeService, useValue: mockService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<EmployeeController>(EmployeeController);
  });

  afterEach(() => jest.clearAllMocks());

  // --------------------------------------------------------------------------
  // createEmployee()
  // --------------------------------------------------------------------------

  describe('createEmployee()', () => {
    it('SUCCESS: returns { success: true, data: employee shape }', async () => {
      mockService.createEmployee.mockResolvedValue({ outcome: 'SUCCESS', employee: employeeRecord });

      const result = await controller.createEmployee(createDto, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({
        id: EMPLOYEE_ID,
        employeeNumber: 'EMP-001',
        employmentStatus: 'PENDING_ONBOARDING',
      });
    });

    it('SUCCESS: createdAt and updatedAt serialized as ISO 8601 strings', async () => {
      mockService.createEmployee.mockResolvedValue({ outcome: 'SUCCESS', employee: employeeRecord });

      const result = await controller.createEmployee(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']!['createdAt']).toBe(CREATED_AT.toISOString());
      expect(result['data']!['updatedAt']).toBe(UPDATED_AT.toISOString());
    });

    it('SUCCESS: tenantId absent from response (SEC-003)', async () => {
      mockService.createEmployee.mockResolvedValue({ outcome: 'SUCCESS', employee: employeeRecord });

      const result = await controller.createEmployee(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: actor.tenantId and actor.userId forwarded to service — not from DTO (SEC-003)', async () => {
      mockService.createEmployee.mockResolvedValue({ outcome: 'SUCCESS', employee: employeeRecord });

      await controller.createEmployee(createDto, mockActor);

      expect(mockService.createEmployee).toHaveBeenCalledWith(
        expect.objectContaining({ employeeNumber: 'EMP-001', departmentId: DEPT_ID }),
        TENANT_ID,
        ACTOR_ID,
      );
    });

    it('DEPARTMENT_NOT_FOUND: throws UnprocessableEntityException with code DEPARTMENT_NOT_FOUND', async () => {
      mockService.createEmployee.mockResolvedValue({ outcome: 'DEPARTMENT_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.createEmployee(createDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('DEPARTMENT_NOT_FOUND');
    });

    it('EMPLOYEE_NUMBER_CONFLICT: throws ConflictException with code EMPLOYEE_NUMBER_CONFLICT', async () => {
      mockService.createEmployee.mockResolvedValue({ outcome: 'EMPLOYEE_NUMBER_CONFLICT' });

      let thrown: unknown;
      try { await controller.createEmployee(createDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(ConflictException);
      const body = (thrown as ConflictException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('EMPLOYEE_NUMBER_CONFLICT');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.createEmployee.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.createEmployee(createDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // listEmployees()
  // --------------------------------------------------------------------------

  describe('listEmployees()', () => {
    it('SUCCESS: returns { success: true, data: { employees, total, page, pageSize, totalPages } }', async () => {
      mockService.listEmployees.mockResolvedValue({
        outcome: 'SUCCESS',
        employees: [employeeRecord],
        total: 1,
        page: 1,
        pageSize: 20,
      });

      const result = await controller.listEmployees(listQuery, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ total: 1, page: 1, pageSize: 20 });
      expect((result['data']!['employees'] as unknown[]).length).toBe(1);
    });

    it('SUCCESS: totalPages = Math.ceil(total / pageSize)', async () => {
      mockService.listEmployees.mockResolvedValue({
        outcome: 'SUCCESS',
        employees: [],
        total: 25,
        page: 1,
        pageSize: 10,
      });

      const result = await controller.listEmployees(listQuery, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']!['totalPages']).toBe(3);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.listEmployees.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.listEmployees(listQuery, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // getEmployeeById()
  // --------------------------------------------------------------------------

  describe('getEmployeeById()', () => {
    it('SUCCESS: returns { success: true, data: employee shape }', async () => {
      mockService.getEmployeeById.mockResolvedValue({ outcome: 'SUCCESS', employee: employeeRecord });

      const result = await controller.getEmployeeById(EMPLOYEE_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']!['id']).toBe(EMPLOYEE_ID);
    });

    it('SUCCESS: tenantId absent from response (SEC-003)', async () => {
      mockService.getEmployeeById.mockResolvedValue({ outcome: 'SUCCESS', employee: employeeRecord });

      const result = await controller.getEmployeeById(EMPLOYEE_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: actor.tenantId from JWT forwarded to service (SEC-003)', async () => {
      mockService.getEmployeeById.mockResolvedValue({ outcome: 'SUCCESS', employee: employeeRecord });

      await controller.getEmployeeById(EMPLOYEE_ID, mockActor);

      expect(mockService.getEmployeeById).toHaveBeenCalledWith(EMPLOYEE_ID, TENANT_ID);
    });

    it('NOT_FOUND: throws NotFoundException with code NOT_FOUND', async () => {
      mockService.getEmployeeById.mockResolvedValue({ outcome: 'NOT_FOUND' });

      let thrown: unknown;
      try { await controller.getEmployeeById(EMPLOYEE_ID, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(NotFoundException);
      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('NOT_FOUND');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.getEmployeeById.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.getEmployeeById(EMPLOYEE_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // updateEmployee()
  // --------------------------------------------------------------------------

  describe('updateEmployee()', () => {
    it('SUCCESS: returns { success: true, data: updated employee shape }', async () => {
      const updated = { ...employeeRecord, firstName: 'Janet' };
      mockService.updateEmployee.mockResolvedValue({ outcome: 'SUCCESS', employee: updated });

      const result = await controller.updateEmployee(EMPLOYEE_ID, updateDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']!['id']).toBe(EMPLOYEE_ID);
    });

    it('NOT_FOUND: throws NotFoundException', async () => {
      mockService.updateEmployee.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(controller.updateEmployee(EMPLOYEE_ID, updateDto, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('EMPLOYEE_NUMBER_IMMUTABLE: throws UnprocessableEntityException with code EMPLOYEE_NUMBER_IMMUTABLE', async () => {
      mockService.updateEmployee.mockResolvedValue({ outcome: 'EMPLOYEE_NUMBER_IMMUTABLE' });

      let thrown: unknown;
      try { await controller.updateEmployee(EMPLOYEE_ID, updateDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('EMPLOYEE_NUMBER_IMMUTABLE');
    });

    it('EMPLOYEE_IS_SEPARATED: throws UnprocessableEntityException with code EMPLOYEE_IS_SEPARATED', async () => {
      mockService.updateEmployee.mockResolvedValue({ outcome: 'EMPLOYEE_IS_SEPARATED' });

      let thrown: unknown;
      try { await controller.updateEmployee(EMPLOYEE_ID, updateDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('EMPLOYEE_IS_SEPARATED');
    });

    it('DEPARTMENT_NOT_FOUND: throws UnprocessableEntityException with code DEPARTMENT_NOT_FOUND', async () => {
      mockService.updateEmployee.mockResolvedValue({ outcome: 'DEPARTMENT_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.updateEmployee(EMPLOYEE_ID, updateDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('DEPARTMENT_NOT_FOUND');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.updateEmployee.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.updateEmployee(EMPLOYEE_ID, updateDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // changeEmployeeStatus()
  // --------------------------------------------------------------------------

  describe('changeEmployeeStatus()', () => {
    it('STATUS_CHANGED: returns { success: true, data: employee with new status }', async () => {
      const activated = { ...employeeRecord, employmentStatus: 'ACTIVE' };
      mockService.changeEmployeeStatus.mockResolvedValue({ outcome: 'STATUS_CHANGED', employee: activated });

      const result = await controller.changeEmployeeStatus(EMPLOYEE_ID, changeStatusDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']!['employmentStatus']).toBe('ACTIVE');
    });

    it('NOT_FOUND: throws NotFoundException', async () => {
      mockService.changeEmployeeStatus.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(controller.changeEmployeeStatus(EMPLOYEE_ID, changeStatusDto, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('INVALID_TRANSITION: throws UnprocessableEntityException with code INVALID_TRANSITION', async () => {
      mockService.changeEmployeeStatus.mockResolvedValue({ outcome: 'INVALID_TRANSITION' });

      let thrown: unknown;
      try { await controller.changeEmployeeStatus(EMPLOYEE_ID, changeStatusDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INVALID_TRANSITION');
    });

    it('TERMINATION_BEFORE_HIRE_DATE: throws UnprocessableEntityException with code TERMINATION_BEFORE_HIRE_DATE (GD-M12-8/EMP-805)', async () => {
      mockService.changeEmployeeStatus.mockResolvedValue({ outcome: 'TERMINATION_BEFORE_HIRE_DATE' });

      let thrown: unknown;
      try { await controller.changeEmployeeStatus(EMPLOYEE_ID, changeStatusDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('TERMINATION_BEFORE_HIRE_DATE');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.changeEmployeeStatus.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.changeEmployeeStatus(EMPLOYEE_ID, changeStatusDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });
});
