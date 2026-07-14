// Reference: spec/01_requirements.md — FR-050 Agency Management, FR-051 Department Management
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/12_organization_management_rules.md — ORG-AUTH-001, ORG-AUTH-002, ORG-AUTH-003
//
// Pure unit tests — no HTTP server, no database.
// DepartmentService and AgencyService replaced with jest.fn() mocks.
// JwtAuthGuard and RolesGuard overridden to always pass.
// Controller methods called directly with mock RequestUser actor.
// Verifies: HTTP exception types, response envelope shapes, date serialization, error codes.

import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import { OrganizationController } from './organization.controller';
import { DepartmentService, type DepartmentRecord } from './department.service';
import { AgencyService, type AgencyRecord } from './agency.service';
import type { RequestUser } from '../identity/jwt.strategy';
import type { CreateDepartmentDto } from './dto/create-department.dto';
import type { UpdateDepartmentDto } from './dto/update-department.dto';
import type { ListDepartmentsQueryDto } from './dto/list-departments-query.dto';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID  = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DEPT_ID   = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const CREATED_AT = new Date('2026-06-10T12:00:00.000Z');

const mockActor: RequestUser = {
  userId: ACTOR_ID,
  tenantId: TENANT_ID,
  email: 'admin@dev.gov',
  firstName: '',
  lastName: '',
  roles: ['System Administrator'],
};

const deptRecord: DepartmentRecord = {
  id: DEPT_ID,
  name: 'Human Resources',
  code: 'HR-001',
  description: null,
  status: 'ACTIVE',
  createdAt: CREATED_AT,
};

const agencyRecord: AgencyRecord = {
  name: 'Department of Labor',
  code: 'DOL',
  status: 'ACTIVE',
  createdAt: CREATED_AT,
};

const createDto: CreateDepartmentDto = { name: 'Human Resources', code: 'HR-001' };
const updateDto: UpdateDepartmentDto = { name: 'HR Updated' };
const listQuery: ListDepartmentsQueryDto = { page: 1, pageSize: 20 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrganizationController', () => {
  let controller: OrganizationController;
  let mockDeptService: {
    createDepartment: jest.Mock;
    listDepartments: jest.Mock;
    getDepartmentById: jest.Mock;
    updateDepartment: jest.Mock;
  };
  let mockAgencyService: { getAgency: jest.Mock };

  beforeEach(async () => {
    mockDeptService = {
      createDepartment: jest.fn(),
      listDepartments:  jest.fn(),
      getDepartmentById: jest.fn(),
      updateDepartment: jest.fn(),
    };
    mockAgencyService = { getAgency: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrganizationController],
      providers: [
        { provide: DepartmentService, useValue: mockDeptService },
        { provide: AgencyService, useValue: mockAgencyService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<OrganizationController>(OrganizationController);
  });

  afterEach(() => jest.clearAllMocks());

  // --------------------------------------------------------------------------
  // createDepartment()
  // --------------------------------------------------------------------------

  describe('createDepartment()', () => {
    it('SUCCESS: returns { success: true, data: { id, name, code, status } }', async () => {
      mockDeptService.createDepartment.mockResolvedValue({ outcome: 'SUCCESS', department: deptRecord });

      const result = await controller.createDepartment(createDto, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: DEPT_ID, name: 'Human Resources', code: 'HR-001' });
    });

    it('SUCCESS: createdAt serialized as ISO 8601 string', async () => {
      mockDeptService.createDepartment.mockResolvedValue({ outcome: 'SUCCESS', department: deptRecord });

      const result = await controller.createDepartment(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']!['createdAt']).toBe(CREATED_AT.toISOString());
    });

    it('CODE_CONFLICT: throws ConflictException', async () => {
      mockDeptService.createDepartment.mockResolvedValue({ outcome: 'CODE_CONFLICT' });

      await expect(controller.createDepartment(createDto, mockActor)).rejects.toThrow(ConflictException);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockDeptService.createDepartment.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.createDepartment(createDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // listDepartments()
  // --------------------------------------------------------------------------

  describe('listDepartments()', () => {
    it('SUCCESS: returns { success: true, data: { departments, total, page, pageSize, totalPages } }', async () => {
      mockDeptService.listDepartments.mockResolvedValue({
        outcome: 'SUCCESS',
        departments: [deptRecord],
        total: 1,
        page: 1,
        pageSize: 20,
      });

      const result = await controller.listDepartments(listQuery, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ total: 1, page: 1, pageSize: 20 });
      expect((result['data']!['departments'] as unknown[]).length).toBe(1);
    });

    it('SUCCESS: totalPages = Math.ceil(total / pageSize)', async () => {
      mockDeptService.listDepartments.mockResolvedValue({
        outcome: 'SUCCESS',
        departments: [],
        total: 25,
        page: 1,
        pageSize: 10,
      });

      const result = await controller.listDepartments(listQuery, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']!['totalPages']).toBe(3);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockDeptService.listDepartments.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.listDepartments(listQuery, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // getDepartmentById()
  // --------------------------------------------------------------------------

  describe('getDepartmentById()', () => {
    it('SUCCESS: returns { success: true, data: department shape }', async () => {
      mockDeptService.getDepartmentById.mockResolvedValue({ outcome: 'SUCCESS', department: deptRecord });

      const result = await controller.getDepartmentById(DEPT_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']!['id']).toBe(DEPT_ID);
    });

    it('NOT_FOUND: throws NotFoundException', async () => {
      mockDeptService.getDepartmentById.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(controller.getDepartmentById(DEPT_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockDeptService.getDepartmentById.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.getDepartmentById(DEPT_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });

    it('actor.tenantId from JWT passed to service — controller does not accept tenantId from params (SEC-003)', async () => {
      mockDeptService.getDepartmentById.mockResolvedValue({ outcome: 'SUCCESS', department: deptRecord });

      await controller.getDepartmentById(DEPT_ID, mockActor);

      expect(mockDeptService.getDepartmentById).toHaveBeenCalledWith(DEPT_ID, TENANT_ID);
    });
  });

  // --------------------------------------------------------------------------
  // updateDepartment()
  // --------------------------------------------------------------------------

  describe('updateDepartment()', () => {
    it('SUCCESS: returns { success: true, data: updated department shape }', async () => {
      mockDeptService.updateDepartment.mockResolvedValue({ outcome: 'SUCCESS', department: deptRecord });

      const result = await controller.updateDepartment(DEPT_ID, updateDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']!['id']).toBe(DEPT_ID);
    });

    it('NOT_FOUND: throws NotFoundException', async () => {
      mockDeptService.updateDepartment.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(controller.updateDepartment(DEPT_ID, updateDto, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('CODE_CONFLICT: throws ConflictException', async () => {
      mockDeptService.updateDepartment.mockResolvedValue({ outcome: 'CODE_CONFLICT' });

      await expect(controller.updateDepartment(DEPT_ID, updateDto, mockActor)).rejects.toThrow(ConflictException);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockDeptService.updateDepartment.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.updateDepartment(DEPT_ID, updateDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });

    it('DEP-008-C1: DEPARTMENT_HAS_ACTIVE_EMPLOYEES → throws UnprocessableEntityException with correct error code', async () => {
      mockDeptService.updateDepartment.mockResolvedValue({
        outcome: 'DEPARTMENT_HAS_ACTIVE_EMPLOYEES',
        activeEmployeeCount: 7,
      });

      await expect(
        controller.updateDepartment(DEPT_ID, { status: 'INACTIVE' } as UpdateDepartmentDto, mockActor),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('DEP-008-C2: DEPARTMENT_HAS_ACTIVE_POSITIONS → throws UnprocessableEntityException with code DEPARTMENT_HAS_ACTIVE_POSITIONS', async () => {
      mockDeptService.updateDepartment.mockResolvedValue({
        outcome: 'DEPARTMENT_HAS_ACTIVE_POSITIONS',
        activePositionCount: 3,
      });

      let caught: UnprocessableEntityException | null = null;
      try {
        await controller.updateDepartment(DEPT_ID, { status: 'INACTIVE' } as UpdateDepartmentDto, mockActor);
      } catch (e) {
        caught = e as UnprocessableEntityException;
      }

      expect(caught).not.toBeNull();
      expect(caught).toBeInstanceOf(UnprocessableEntityException);
      const response = caught!.getResponse() as Record<string, unknown>;
      const error = response['error'] as Record<string, unknown>;
      expect(error!['code']).toBe('DEPARTMENT_HAS_ACTIVE_POSITIONS');
    });

    it('DEP-008-C3: DEPARTMENT_HAS_ACTIVE_DEPENDENTS → throws UnprocessableEntityException with code DEPARTMENT_HAS_ACTIVE_DEPENDENTS', async () => {
      mockDeptService.updateDepartment.mockResolvedValue({
        outcome: 'DEPARTMENT_HAS_ACTIVE_DEPENDENTS',
        activeEmployeeCount: 4,
        activePositionCount: 2,
      });

      let caught: UnprocessableEntityException | null = null;
      try {
        await controller.updateDepartment(DEPT_ID, { status: 'INACTIVE' } as UpdateDepartmentDto, mockActor);
      } catch (e) {
        caught = e as UnprocessableEntityException;
      }

      expect(caught).not.toBeNull();
      expect(caught).toBeInstanceOf(UnprocessableEntityException);
      const response = caught!.getResponse() as Record<string, unknown>;
      const error = response['error'] as Record<string, unknown>;
      expect(error!['code']).toBe('DEPARTMENT_HAS_ACTIVE_DEPENDENTS');
    });
  });

  // --------------------------------------------------------------------------
  // getAgency()
  // --------------------------------------------------------------------------

  describe('getAgency()', () => {
    it('SUCCESS: returns { success: true, data: { name, code, status, createdAt } } without id field (AGY-003)', async () => {
      mockAgencyService.getAgency.mockResolvedValue({ outcome: 'SUCCESS', agency: agencyRecord });

      const result = await controller.getAgency(mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ name: 'Department of Labor', code: 'DOL', status: 'ACTIVE' });
      expect(result['data']).not.toHaveProperty('id');
    });

    it('NOT_FOUND: throws NotFoundException', async () => {
      mockAgencyService.getAgency.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(controller.getAgency(mockActor)).rejects.toThrow(NotFoundException);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockAgencyService.getAgency.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.getAgency(mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });
});
