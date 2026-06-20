// Reference: spec/01_requirements.md — FR-110, FR-111, FR-112 Employee Management; FR-113 Skill Assignment
// Reference: spec/06_api_contracts.md — Employee API contracts
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-001 through EMP-AUTH-005
// Reference: directives/14_skill_management_rules.md — SKL-200 through SKL-211
//
// Pure unit tests — no HTTP server, no database.
// EmployeeService and EmployeeSkillService replaced with jest.fn() mocks.
// JwtAuthGuard and RolesGuard overridden to always pass.
// Controller methods called directly with mock RequestUser actor.
// For assignEmployeeSkill(): a mockRes object ({ status: jest.fn() }) is passed as the
// 4th argument to capture dynamic HTTP status codes set via @Res({ passthrough: true }).
// Verifies: HTTP exception types, response envelope shapes, date serialization, error codes,
// SEC-003 tenantId exclusion, dynamic 201/200 status differentiation (GD-M13-2 D15).

import {
  ConflictException,
  HttpStatus,
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
import { EmployeeSkillService } from './employee-skill.service';
import type { EmployeeSkillRecord } from './employee-skill.service';
import type { RequestUser } from '../identity/jwt.strategy';
import type { CreateEmployeeDto } from './dto/create-employee.dto';
import type { UpdateEmployeeDto } from './dto/update-employee.dto';
import type { ChangeEmployeeStatusDto } from './dto/change-employee-status.dto';
import type { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import type { AssignSkillDto } from './dto/assign-skill.dto';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID    = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DEPT_ID     = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const EMPLOYEE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const SKILL_ID    = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const CREATED_AT  = new Date('2026-06-18T12:00:00.000Z');
const UPDATED_AT  = new Date('2026-06-18T14:00:00.000Z');
const VERIFIED_AT = new Date('2026-06-15T14:32:00.000Z');

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

// Skill assignment record returned from EmployeeSkillService
const skillRecord: EmployeeSkillRecord = {
  skillId:         SKILL_ID,
  skillName:       'Python Programming',
  skillCategory:   'Technical',
  proficiencyLevel: 'ADVANCED',
  verifiedAt:      VERIFIED_AT,
};

const assignDto: AssignSkillDto = {
  skillId:         SKILL_ID,
  proficiencyLevel: 'ADVANCED',
  verifiedAt:      VERIFIED_AT.toISOString(),
};

describe('EmployeeController', () => {
  let controller: EmployeeController;
  let mockService: {
    createEmployee:       jest.Mock;
    listEmployees:        jest.Mock;
    getEmployeeById:      jest.Mock;
    updateEmployee:       jest.Mock;
    changeEmployeeStatus: jest.Mock;
  };
  let mockSkillService: {
    assignSkill:        jest.Mock;
    listEmployeeSkills: jest.Mock;
  };

  beforeEach(async () => {
    mockService = {
      createEmployee:       jest.fn(),
      listEmployees:        jest.fn(),
      getEmployeeById:      jest.fn(),
      updateEmployee:       jest.fn(),
      changeEmployeeStatus: jest.fn(),
    };
    mockSkillService = {
      assignSkill:        jest.fn(),
      listEmployeeSkills: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmployeeController],
      providers: [
        { provide: EmployeeService,      useValue: mockService },
        { provide: EmployeeSkillService, useValue: mockSkillService },
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

  // --------------------------------------------------------------------------
  // assignEmployeeSkill() — POST /employees/:id/skills
  // --------------------------------------------------------------------------

  describe('assignEmployeeSkill()', () => {
    // Mock response object with chainable status() — required for @Res({ passthrough: true })
    let mockRes: { status: jest.Mock };

    beforeEach(() => {
      mockRes = { status: jest.fn().mockReturnThis() };
    });

    it('ESC-A1: ASSIGNED — res.status(201) called; returns { success: true, data: shape }', async () => {
      mockSkillService.assignSkill.mockResolvedValue({ outcome: 'ASSIGNED', assignment: skillRecord });

      const result = await controller.assignEmployeeSkill(
        EMPLOYEE_ID, assignDto, mockActor, mockRes as any,
      ) as Record<string, unknown>;

      expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.CREATED);
      expect(result['success']).toBe(true);
      expect(result['data']).toBeTruthy();
    });

    it('ESC-A2: UPDATED — res.status(200) called; returns { success: true, data: shape }', async () => {
      mockSkillService.assignSkill.mockResolvedValue({ outcome: 'UPDATED', assignment: skillRecord });

      const result = await controller.assignEmployeeSkill(
        EMPLOYEE_ID, assignDto, mockActor, mockRes as any,
      ) as Record<string, unknown>;

      expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(result['success']).toBe(true);
    });

    it('ESC-A3: response shape matches GD-M13-2 D14 field set (skillId, skillName, skillCategory, proficiencyLevel, verifiedAt)', async () => {
      mockSkillService.assignSkill.mockResolvedValue({ outcome: 'ASSIGNED', assignment: skillRecord });

      const result = await controller.assignEmployeeSkill(
        EMPLOYEE_ID, assignDto, mockActor, mockRes as any,
      ) as Record<string, Record<string, unknown>>;

      const data = result['data']!;
      expect(data).toHaveProperty('skillId', SKILL_ID);
      expect(data).toHaveProperty('skillName', 'Python Programming');
      expect(data).toHaveProperty('skillCategory', 'Technical');
      expect(data).toHaveProperty('proficiencyLevel', 'ADVANCED');
      expect(data).toHaveProperty('verifiedAt');
      expect(data).not.toHaveProperty('tenantId');
      expect(data).not.toHaveProperty('employeeId');
    });

    it('ESC-A4: verifiedAt serialized as ISO 8601 string', async () => {
      mockSkillService.assignSkill.mockResolvedValue({ outcome: 'ASSIGNED', assignment: skillRecord });

      const result = await controller.assignEmployeeSkill(
        EMPLOYEE_ID, assignDto, mockActor, mockRes as any,
      ) as Record<string, Record<string, unknown>>;

      expect(result['data']!['verifiedAt']).toBe(VERIFIED_AT.toISOString());
    });

    it('ESC-A5: NOT_FOUND — throws NotFoundException', async () => {
      mockSkillService.assignSkill.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(
        controller.assignEmployeeSkill(EMPLOYEE_ID, assignDto, mockActor, mockRes as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('ESC-A6: EMPLOYEE_SEPARATED — throws UnprocessableEntityException with code EMPLOYEE_SEPARATED', async () => {
      mockSkillService.assignSkill.mockResolvedValue({ outcome: 'EMPLOYEE_SEPARATED' });

      let thrown: unknown;
      try {
        await controller.assignEmployeeSkill(EMPLOYEE_ID, assignDto, mockActor, mockRes as any);
      } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('EMPLOYEE_SEPARATED');
    });

    it('ESC-A7: SKILL_NOT_FOUND — throws UnprocessableEntityException with code SKILL_NOT_FOUND', async () => {
      mockSkillService.assignSkill.mockResolvedValue({ outcome: 'SKILL_NOT_FOUND' });

      let thrown: unknown;
      try {
        await controller.assignEmployeeSkill(EMPLOYEE_ID, assignDto, mockActor, mockRes as any);
      } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('SKILL_NOT_FOUND');
    });

    it('ESC-A8: INVALID_PROFICIENCY_LEVEL — throws UnprocessableEntityException with code INVALID_PROFICIENCY_LEVEL', async () => {
      mockSkillService.assignSkill.mockResolvedValue({ outcome: 'INVALID_PROFICIENCY_LEVEL' });

      let thrown: unknown;
      try {
        await controller.assignEmployeeSkill(EMPLOYEE_ID, assignDto, mockActor, mockRes as any);
      } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INVALID_PROFICIENCY_LEVEL');
    });

    it('ESC-A9: INTERNAL_ERROR — throws InternalServerErrorException', async () => {
      mockSkillService.assignSkill.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(
        controller.assignEmployeeSkill(EMPLOYEE_ID, assignDto, mockActor, mockRes as any),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('ESC-A10: actor.tenantId forwarded to service — not from route params (SEC-003)', async () => {
      mockSkillService.assignSkill.mockResolvedValue({ outcome: 'ASSIGNED', assignment: skillRecord });

      await controller.assignEmployeeSkill(EMPLOYEE_ID, assignDto, mockActor, mockRes as any);

      expect(mockSkillService.assignSkill).toHaveBeenCalledWith(
        expect.objectContaining({ employeeId: EMPLOYEE_ID, skillId: SKILL_ID }),
        TENANT_ID,
        ACTOR_ID,
      );
    });
  });

  // --------------------------------------------------------------------------
  // listEmployeeSkills() — GET /employees/:id/skills
  // --------------------------------------------------------------------------

  describe('listEmployeeSkills()', () => {
    it('ESC-A11: SUCCESS — returns { success: true, data: { skills: [...] } }', async () => {
      mockSkillService.listEmployeeSkills.mockResolvedValue({
        outcome: 'SUCCESS',
        assignments: [skillRecord],
      });

      const result = await controller.listEmployeeSkills(EMPLOYEE_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(Array.isArray(result['data']!['skills'])).toBe(true);
      expect((result['data']!['skills'] as unknown[]).length).toBe(1);
    });

    it('ESC-A12: NOT_FOUND — throws NotFoundException', async () => {
      mockSkillService.listEmployeeSkills.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(controller.listEmployeeSkills(EMPLOYEE_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('ESC-A13: INTERNAL_ERROR — throws InternalServerErrorException', async () => {
      mockSkillService.listEmployeeSkills.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.listEmployeeSkills(EMPLOYEE_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });

    it('ESC-A14: response items contain no tenantId (SEC-003)', async () => {
      mockSkillService.listEmployeeSkills.mockResolvedValue({
        outcome: 'SUCCESS',
        assignments: [skillRecord],
      });

      const result = await controller.listEmployeeSkills(EMPLOYEE_ID, mockActor) as Record<string, Record<string, unknown>>;
      const items = result['data']!['skills'] as Record<string, unknown>[];

      expect(items[0]).not.toHaveProperty('tenantId');
      expect(items[0]).not.toHaveProperty('employeeId');
    });
  });
});
