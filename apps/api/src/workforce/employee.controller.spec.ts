// Reference: spec/01_requirements.md — FR-110, FR-111, FR-112 Employee Management; FR-113 Skill Assignment; FR-114 Certification Assignment
// Reference: spec/06_api_contracts.md — Employee API contracts
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-001 through EMP-AUTH-005
// Reference: directives/14_skill_management_rules.md — SKL-200 through SKL-211
// Reference: directives/15_certification_management_rules.md — CRT-200 through CRT-302
//
// Pure unit tests — no HTTP server, no database.
// EmployeeService, EmployeeSkillService, and EmployeeCertificationService replaced with jest.fn() mocks.
// JwtAuthGuard and RolesGuard overridden to always pass.
// Controller methods called directly with mock RequestUser actor.
// For assignEmployeeSkill() and assignEmployeeCertification(): a mockRes object ({ status: jest.fn() })
// is passed as the 4th argument to capture dynamic HTTP status codes set via @Res({ passthrough: true }).
// Verifies: HTTP exception types, response envelope shapes, date serialization (YYYY-MM-DD for cert dates),
// error codes, SEC-003 tenantId exclusion, dynamic 201/200 status differentiation (GD-M13-2 D15).

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
import { EmployeeCertificationService } from './employee-certification.service';
import type { EmployeeCertificationRecord } from './employee-certification.service';
import type { RequestUser } from '../identity/jwt.strategy';
import type { CreateEmployeeDto } from './dto/create-employee.dto';
import type { UpdateEmployeeDto } from './dto/update-employee.dto';
import type { ChangeEmployeeStatusDto } from './dto/change-employee-status.dto';
import type { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import type { AssignSkillDto } from './dto/assign-skill.dto';
import type { AssignCertificationDto } from './dto/assign-certification.dto';
import type { AssignPositionDto } from './dto/assign-position.dto';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID    = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DEPT_ID     = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const EMPLOYEE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const SKILL_ID    = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const CERT_ID     = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const POSITION_ID = 'a1b2c3d4-a1b2-a1b2-a1b2-a1b2c3d4e5f6';
const CREATED_AT  = new Date('2026-06-18T12:00:00.000Z');
const UPDATED_AT  = new Date('2026-06-18T14:00:00.000Z');
const VERIFIED_AT = new Date('2026-06-15T14:32:00.000Z');
const ISSUE_DATE      = new Date('2026-01-01T00:00:00.000Z');
const EXPIRATION_DATE = new Date('2027-01-01T00:00:00.000Z');

const mockActor: RequestUser = {
  userId: ACTOR_ID,
  tenantId: TENANT_ID,
  email: 'admin@dev.gov',
  firstName: '',
  lastName: '',
  roles: ['System Administrator'],
};

const employeeRecord: EmployeeRecord = {
  id: EMPLOYEE_ID,
  tenantId: TENANT_ID,
  departmentId: DEPT_ID,
  departmentName: 'Engineering',
  positionId: null,
  employeeNumber: 'EMP-001',
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane.smith@agency.gov',
  employmentStatus: 'PENDING_ONBOARDING',
  appointmentAuthority: 'ADMINISTRATIVE',
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
  appointmentAuthority: 'ADMINISTRATIVE',
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

// Certification assignment record returned from EmployeeCertificationService
const certificationRecord: EmployeeCertificationRecord = {
  certificationId:   CERT_ID,
  certificationName: 'AWS Certified',
  issuer:            'Amazon Web Services',
  status:            'ACTIVE',
  issueDate:         ISSUE_DATE,
  expirationDate:    EXPIRATION_DATE,
};

const assignCertDto: AssignCertificationDto = {
  certificationId: CERT_ID,
  status:          'ACTIVE',
  issueDate:       '2026-01-01',
  expirationDate:  '2027-01-01',
};

describe('EmployeeController', () => {
  let controller: EmployeeController;
  let mockService: {
    createEmployee:       jest.Mock;
    listEmployees:        jest.Mock;
    getEmployeeById:      jest.Mock;
    updateEmployee:       jest.Mock;
    changeEmployeeStatus: jest.Mock;
    assignPosition:       jest.Mock;
  };
  let mockSkillService: {
    assignSkill:        jest.Mock;
    listEmployeeSkills: jest.Mock;
  };
  let mockCertificationService: {
    assignCertification:        jest.Mock;
    listEmployeeCertifications: jest.Mock;
  };

  beforeEach(async () => {
    mockService = {
      createEmployee:       jest.fn(),
      listEmployees:        jest.fn(),
      getEmployeeById:      jest.fn(),
      updateEmployee:       jest.fn(),
      changeEmployeeStatus: jest.fn(),
      assignPosition:       jest.fn(),
    };
    mockSkillService = {
      assignSkill:        jest.fn(),
      listEmployeeSkills: jest.fn(),
    };
    mockCertificationService = {
      assignCertification:        jest.fn(),
      listEmployeeCertifications: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmployeeController],
      providers: [
        { provide: EmployeeService,              useValue: mockService },
        { provide: EmployeeSkillService,         useValue: mockSkillService },
        { provide: EmployeeCertificationService, useValue: mockCertificationService },
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

    it('SUCCESS: response shape includes appointmentAuthority and positionId (GD-M15-1 D4)', async () => {
      mockService.createEmployee.mockResolvedValue({ outcome: 'SUCCESS', employee: employeeRecord });

      const result = await controller.createEmployee(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).toHaveProperty('appointmentAuthority', 'ADMINISTRATIVE');
      expect(result['data']).toHaveProperty('positionId', null);
    });

    it('SUCCESS: dto.appointmentAuthority and dto.positionId forwarded to service (GD-M15-1 D4)', async () => {
      mockService.createEmployee.mockResolvedValue({ outcome: 'SUCCESS', employee: employeeRecord });

      await controller.createEmployee(createDto, mockActor);

      expect(mockService.createEmployee).toHaveBeenCalledWith(
        expect.objectContaining({ appointmentAuthority: 'ADMINISTRATIVE' }),
        TENANT_ID,
        ACTOR_ID,
      );
    });

    it('APPOINTMENT_AUTHORITY_REQUIRED: throws UnprocessableEntityException with code APPOINTMENT_AUTHORITY_REQUIRED (GD-M15-1 D4)', async () => {
      mockService.createEmployee.mockResolvedValue({ outcome: 'APPOINTMENT_AUTHORITY_REQUIRED' });

      let thrown: unknown;
      try { await controller.createEmployee(createDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('APPOINTMENT_AUTHORITY_REQUIRED');
    });

    it('INVALID_APPOINTMENT_AUTHORITY: throws UnprocessableEntityException with code INVALID_APPOINTMENT_AUTHORITY (GD-M15-1 D1)', async () => {
      mockService.createEmployee.mockResolvedValue({ outcome: 'INVALID_APPOINTMENT_AUTHORITY' });

      let thrown: unknown;
      try { await controller.createEmployee(createDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INVALID_APPOINTMENT_AUTHORITY');
    });

    it('COMPETITIVE_APPOINTMENT_SYSTEM_ONLY: throws UnprocessableEntityException with code COMPETITIVE_APPOINTMENT_SYSTEM_ONLY (GD-PRE-M13-001)', async () => {
      mockService.createEmployee.mockResolvedValue({ outcome: 'COMPETITIVE_APPOINTMENT_SYSTEM_ONLY' });

      let thrown: unknown;
      try { await controller.createEmployee(createDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('COMPETITIVE_APPOINTMENT_SYSTEM_ONLY');
    });

    it('POSITION_NOT_FOUND: throws UnprocessableEntityException with code POSITION_NOT_FOUND (GD-M15-1 D4)', async () => {
      mockService.createEmployee.mockResolvedValue({ outcome: 'POSITION_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.createEmployee(createDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('POSITION_NOT_FOUND');
    });

    it('POSITION_NOT_ACTIVE_FOR_ASSIGNMENT: throws UnprocessableEntityException with code POSITION_NOT_ACTIVE_FOR_ASSIGNMENT (GD-M15-1 D4)', async () => {
      mockService.createEmployee.mockResolvedValue({ outcome: 'POSITION_NOT_ACTIVE_FOR_ASSIGNMENT' });

      let thrown: unknown;
      try { await controller.createEmployee(createDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('POSITION_NOT_ACTIVE_FOR_ASSIGNMENT');
    });

    it('POSITION_ALREADY_OCCUPIED: throws UnprocessableEntityException with code POSITION_ALREADY_OCCUPIED (GD-M15-1 D4)', async () => {
      mockService.createEmployee.mockResolvedValue({ outcome: 'POSITION_ALREADY_OCCUPIED' });

      let thrown: unknown;
      try { await controller.createEmployee(createDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('POSITION_ALREADY_OCCUPIED');
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

    it('APPOINTMENT_AUTHORITY_IMMUTABLE: throws UnprocessableEntityException with code APPOINTMENT_AUTHORITY_IMMUTABLE (GD-M15-1 D8)', async () => {
      mockService.updateEmployee.mockResolvedValue({ outcome: 'APPOINTMENT_AUTHORITY_IMMUTABLE' });

      let thrown: unknown;
      try { await controller.updateEmployee(EMPLOYEE_ID, updateDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('APPOINTMENT_AUTHORITY_IMMUTABLE');
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

  // --------------------------------------------------------------------------
  // assignEmployeeCertification() — POST /employees/:id/certifications
  // --------------------------------------------------------------------------

  describe('assignEmployeeCertification()', () => {
    let mockRes: { status: jest.Mock };

    beforeEach(() => {
      mockRes = { status: jest.fn().mockReturnThis() };
    });

    it('ECC-A1: ASSIGNED — res.status(201) called; returns { success: true, data: { assignment: shape } }', async () => {
      mockCertificationService.assignCertification.mockResolvedValue({
        outcome: 'ASSIGNED',
        assignment: certificationRecord,
      });

      const result = await controller.assignEmployeeCertification(
        EMPLOYEE_ID, assignCertDto, mockActor, mockRes as any,
      ) as Record<string, unknown>;

      expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.CREATED);
      expect(result['success']).toBe(true);
      expect(result['data']).toBeTruthy();
    });

    it('ECC-A2: UPDATED — res.status(200) called; returns { success: true, data: { assignment: shape } }', async () => {
      mockCertificationService.assignCertification.mockResolvedValue({
        outcome: 'UPDATED',
        assignment: certificationRecord,
      });

      const result = await controller.assignEmployeeCertification(
        EMPLOYEE_ID, assignCertDto, mockActor, mockRes as any,
      ) as Record<string, unknown>;

      expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(result['success']).toBe(true);
    });

    it('ECC-A3: response shape matches GD-M13-2 D16 field set; issueDate and expirationDate as YYYY-MM-DD strings', async () => {
      mockCertificationService.assignCertification.mockResolvedValue({
        outcome: 'ASSIGNED',
        assignment: certificationRecord,
      });

      const result = await controller.assignEmployeeCertification(
        EMPLOYEE_ID, assignCertDto, mockActor, mockRes as any,
      ) as Record<string, Record<string, unknown>>;

      const data = result['data']!['assignment'] as Record<string, unknown>;
      expect(data).toHaveProperty('certificationId', CERT_ID);
      expect(data).toHaveProperty('certificationName', 'AWS Certified');
      expect(data).toHaveProperty('issuer', 'Amazon Web Services');
      expect(data).toHaveProperty('status', 'ACTIVE');
      expect(data['issueDate']).toBe('2026-01-01');
      expect(data['expirationDate']).toBe('2027-01-01');
      expect(data).not.toHaveProperty('tenantId');
      expect(data).not.toHaveProperty('employeeId');
      expect(data).not.toHaveProperty('expirationRequired');
    });

    it('ECC-A4: null issueDate and expirationDate serialized as null (not YYYY-MM-DD)', async () => {
      const nullDateRecord: EmployeeCertificationRecord = {
        ...certificationRecord,
        issueDate:      null,
        expirationDate: null,
      };
      mockCertificationService.assignCertification.mockResolvedValue({
        outcome: 'ASSIGNED',
        assignment: nullDateRecord,
      });

      const result = await controller.assignEmployeeCertification(
        EMPLOYEE_ID, assignCertDto, mockActor, mockRes as any,
      ) as Record<string, Record<string, unknown>>;

      const data = result['data']!['assignment'] as Record<string, unknown>;
      expect(data['issueDate']).toBeNull();
      expect(data['expirationDate']).toBeNull();
    });

    it('ECC-A5: NOT_FOUND → NotFoundException', async () => {
      mockCertificationService.assignCertification.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(
        controller.assignEmployeeCertification(EMPLOYEE_ID, assignCertDto, mockActor, mockRes as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('ECC-A6: EMPLOYEE_SEPARATED → UnprocessableEntityException with code EMPLOYEE_SEPARATED', async () => {
      mockCertificationService.assignCertification.mockResolvedValue({ outcome: 'EMPLOYEE_SEPARATED' });

      let thrown: unknown;
      try {
        await controller.assignEmployeeCertification(EMPLOYEE_ID, assignCertDto, mockActor, mockRes as any);
      } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('EMPLOYEE_SEPARATED');
    });

    it('ECC-A7: CERTIFICATION_NOT_FOUND → UnprocessableEntityException with code CERTIFICATION_NOT_FOUND', async () => {
      mockCertificationService.assignCertification.mockResolvedValue({ outcome: 'CERTIFICATION_NOT_FOUND' });

      let thrown: unknown;
      try {
        await controller.assignEmployeeCertification(EMPLOYEE_ID, assignCertDto, mockActor, mockRes as any);
      } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('CERTIFICATION_NOT_FOUND');
    });

    it('ECC-A8: INVALID_STATUS_TRANSITION → UnprocessableEntityException with code INVALID_STATUS_TRANSITION (CRT-207)', async () => {
      mockCertificationService.assignCertification.mockResolvedValue({ outcome: 'INVALID_STATUS_TRANSITION' });

      let thrown: unknown;
      try {
        await controller.assignEmployeeCertification(EMPLOYEE_ID, assignCertDto, mockActor, mockRes as any);
      } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INVALID_STATUS_TRANSITION');
    });

    it('ECC-A9: EXPIRATION_DATE_REQUIRED → UnprocessableEntityException with code EXPIRATION_DATE_REQUIRED', async () => {
      mockCertificationService.assignCertification.mockResolvedValue({ outcome: 'EXPIRATION_DATE_REQUIRED' });

      let thrown: unknown;
      try {
        await controller.assignEmployeeCertification(EMPLOYEE_ID, assignCertDto, mockActor, mockRes as any);
      } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('EXPIRATION_DATE_REQUIRED');
    });

    it('ECC-A10: INVALID_DATE_RANGE → UnprocessableEntityException with code INVALID_DATE_RANGE', async () => {
      mockCertificationService.assignCertification.mockResolvedValue({ outcome: 'INVALID_DATE_RANGE' });

      let thrown: unknown;
      try {
        await controller.assignEmployeeCertification(EMPLOYEE_ID, assignCertDto, mockActor, mockRes as any);
      } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INVALID_DATE_RANGE');
    });

    it('ECC-A11: CERTIFICATION_REVOKED → UnprocessableEntityException with code CERTIFICATION_REVOKED (CRT-301)', async () => {
      mockCertificationService.assignCertification.mockResolvedValue({ outcome: 'CERTIFICATION_REVOKED' });

      let thrown: unknown;
      try {
        await controller.assignEmployeeCertification(EMPLOYEE_ID, assignCertDto, mockActor, mockRes as any);
      } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('CERTIFICATION_REVOKED');
    });

    it('ECC-A12: INTERNAL_ERROR → InternalServerErrorException', async () => {
      mockCertificationService.assignCertification.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(
        controller.assignEmployeeCertification(EMPLOYEE_ID, assignCertDto, mockActor, mockRes as any),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // listEmployeeCertifications() — GET /employees/:id/certifications
  // --------------------------------------------------------------------------

  describe('listEmployeeCertifications()', () => {
    it('ECC-L1: SUCCESS — returns { success: true, data: { certifications: [...] } }; dates as YYYY-MM-DD', async () => {
      mockCertificationService.listEmployeeCertifications.mockResolvedValue({
        outcome: 'SUCCESS',
        certifications: [certificationRecord],
      });

      const result = await controller.listEmployeeCertifications(EMPLOYEE_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      const items = result['data']!['certifications'] as Record<string, unknown>[];
      expect(items).toHaveLength(1);
      expect(items[0]!['issueDate']).toBe('2026-01-01');
      expect(items[0]!['expirationDate']).toBe('2027-01-01');
      expect(items[0]).not.toHaveProperty('tenantId');
      expect(items[0]).not.toHaveProperty('employeeId');
    });

    it('ECC-L2: NOT_FOUND → NotFoundException', async () => {
      mockCertificationService.listEmployeeCertifications.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(controller.listEmployeeCertifications(EMPLOYEE_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('ECC-L3: INTERNAL_ERROR → InternalServerErrorException', async () => {
      mockCertificationService.listEmployeeCertifications.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.listEmployeeCertifications(EMPLOYEE_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });

    it('ECC-L4: actor.tenantId forwarded to service from JWT — not from route params (SEC-003)', async () => {
      mockCertificationService.listEmployeeCertifications.mockResolvedValue({
        outcome: 'SUCCESS',
        certifications: [],
      });

      await controller.listEmployeeCertifications(EMPLOYEE_ID, mockActor);

      expect(mockCertificationService.listEmployeeCertifications).toHaveBeenCalledWith(
        EMPLOYEE_ID,
        TENANT_ID,
      );
    });
  });

  // --------------------------------------------------------------------------
  // assignPosition()  (GD-M15-1 D5/D6/D9/D10)
  // --------------------------------------------------------------------------

  describe('assignPosition()', () => {
    const positionedEmployee: EmployeeRecord = { ...employeeRecord, positionId: POSITION_ID };
    const unpositionedEmployee: EmployeeRecord = { ...employeeRecord, positionId: null };

    const assignDto: AssignPositionDto = { positionId: POSITION_ID };
    const clearDto: AssignPositionDto = { positionId: null };

    it('SUCCESS (assignment): returns { success: true, data: employee } with HTTP 200', async () => {
      mockService.assignPosition.mockResolvedValue({ outcome: 'SUCCESS', employee: positionedEmployee });

      const result = await controller.assignPosition(EMPLOYEE_ID, assignDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']!['positionId']).toBe(POSITION_ID);
    });

    it('SUCCESS (clearance): response positionId is null', async () => {
      mockService.assignPosition.mockResolvedValue({ outcome: 'SUCCESS', employee: unpositionedEmployee });

      const result = await controller.assignPosition(EMPLOYEE_ID, clearDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']!['positionId']).toBeNull();
    });

    it('SUCCESS: response shape includes appointmentAuthority and positionId', async () => {
      mockService.assignPosition.mockResolvedValue({ outcome: 'SUCCESS', employee: positionedEmployee });

      const result = await controller.assignPosition(EMPLOYEE_ID, assignDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).toHaveProperty('appointmentAuthority', 'ADMINISTRATIVE');
      expect(result['data']).toHaveProperty('positionId', POSITION_ID);
    });

    it('SUCCESS: tenantId absent from response (SEC-003)', async () => {
      mockService.assignPosition.mockResolvedValue({ outcome: 'SUCCESS', employee: positionedEmployee });

      const result = await controller.assignPosition(EMPLOYEE_ID, assignDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('service called with positionId from DTO and tenantId/userId from JWT (SEC-003)', async () => {
      mockService.assignPosition.mockResolvedValue({ outcome: 'SUCCESS', employee: positionedEmployee });

      await controller.assignPosition(EMPLOYEE_ID, assignDto, mockActor);

      expect(mockService.assignPosition).toHaveBeenCalledWith(
        EMPLOYEE_ID,
        { positionId: POSITION_ID },
        TENANT_ID,
        ACTOR_ID,
      );
    });

    it('NOT_FOUND: throws NotFoundException', async () => {
      mockService.assignPosition.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(controller.assignPosition(EMPLOYEE_ID, assignDto, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('EMPLOYEE_SEPARATED: throws UnprocessableEntityException with code EMPLOYEE_SEPARATED (GD-M15-1 D5/D6)', async () => {
      mockService.assignPosition.mockResolvedValue({ outcome: 'EMPLOYEE_SEPARATED' });

      let thrown: unknown;
      try { await controller.assignPosition(EMPLOYEE_ID, assignDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('EMPLOYEE_SEPARATED');
    });

    it('POSITION_NOT_FOUND: throws NotFoundException with code POSITION_NOT_FOUND (GD-M15-1 D5; SEC-003)', async () => {
      mockService.assignPosition.mockResolvedValue({ outcome: 'POSITION_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.assignPosition(EMPLOYEE_ID, assignDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(NotFoundException);
      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('POSITION_NOT_FOUND');
    });

    it('POSITION_NOT_ACTIVE_FOR_ASSIGNMENT: throws UnprocessableEntityException (GD-M15-1 D5)', async () => {
      mockService.assignPosition.mockResolvedValue({ outcome: 'POSITION_NOT_ACTIVE_FOR_ASSIGNMENT' });

      let thrown: unknown;
      try { await controller.assignPosition(EMPLOYEE_ID, assignDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('POSITION_NOT_ACTIVE_FOR_ASSIGNMENT');
    });

    it('POSITION_ALREADY_OCCUPIED: throws UnprocessableEntityException (GD-M15-1 D5; GD-PRE-M13-002)', async () => {
      mockService.assignPosition.mockResolvedValue({ outcome: 'POSITION_ALREADY_OCCUPIED' });

      let thrown: unknown;
      try { await controller.assignPosition(EMPLOYEE_ID, assignDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('POSITION_ALREADY_OCCUPIED');
    });

    it('POSITION_CLEARANCE_NOT_PERMITTED_FOR_STATUS: throws UnprocessableEntityException (GD-M15-1 D6)', async () => {
      mockService.assignPosition.mockResolvedValue({ outcome: 'POSITION_CLEARANCE_NOT_PERMITTED_FOR_STATUS' });

      let thrown: unknown;
      try { await controller.assignPosition(EMPLOYEE_ID, clearDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('POSITION_CLEARANCE_NOT_PERMITTED_FOR_STATUS');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.assignPosition.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.assignPosition(EMPLOYEE_ID, assignDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });
});
