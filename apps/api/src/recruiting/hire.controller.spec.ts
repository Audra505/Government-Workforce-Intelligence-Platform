// Reference: governance/GD-M19-1.md — Decisions 3, 13, 15
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
//
// Pure unit tests for HireController — no database, no network.
// HireService replaced with a jest.fn() mock.
// Guards overridden with { canActivate: () => true } — guard enforcement is tested separately
// via Reflect.getMetadata(ROLES_KEY, handler) to confirm @RequireRoles decorator presence.
//
// tenantId derived from actor.tenantId (JWT), never from body or route params — SEC-003.
// No request body accepted — hireApplication() has no @Body() parameter (GD-M19-1 D6).
// HTTP 201 on success (GD-M19-1 D13) — confirmed via __httpCode__ decorator metadata.
//
// RBAC (GD-M19-1 D3; GD-PRE-PHASE3-003 D3):
//   System Administrator — allowed
//   HR Director — allowed
//   Recruiter — explicitly denied (higher-privilege action than M18 offer approval)
//   Compliance Officer, Hiring Manager, Workforce Planner, Executive User — denied
//
// Error mapping (GD-M19-1 D13):
//   APPLICATION_NOT_FOUND             → 404 NotFoundException
//   APPLICATION_ALREADY_HIRED         → 409 ConflictException
//   APPLICATION_NOT_AT_OFFER_STATUS   → 422 UnprocessableEntityException
//   ACCEPTED_OFFER_NOT_FOUND          → 422 UnprocessableEntityException
//   CANDIDATE_NOT_FOUND               → 404 NotFoundException
//   CANDIDATE_ARCHIVED                → 422 UnprocessableEntityException
//   VACANCY_NOT_FOUND                 → 404 NotFoundException
//   VACANCY_NOT_AVAILABLE             → 422 UnprocessableEntityException
//   POSITION_NOT_FOUND                → 404 NotFoundException
//   POSITION_NOT_AVAILABLE            → 422 UnprocessableEntityException
//   EMPLOYEE_NUMBER_GENERATION_FAILED → 500 InternalServerErrorException
//   INTERNAL_ERROR                    → 500 InternalServerErrorException

import { Test, type TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import { ROLES_KEY } from '../identity/decorators/require-roles.decorator';
import type { RequestUser } from '../identity/jwt.strategy';
import { HireController } from './hire.controller';
import { HireService, type HireEmployeeRecord } from './hire.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HTTP_CODE_METADATA = '__httpCode__';

const APP_ID    = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EMP_ID    = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TENANT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ACTOR_ID  = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DEPT_ID   = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const POS_ID    = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const HIRE_DATE = new Date('2026-06-30T00:00:00.000Z');
const NOW       = new Date('2026-06-30T12:00:00.000Z');

const employeeRecord: HireEmployeeRecord = {
  id:                   EMP_ID,
  tenantId:             TENANT_ID,
  departmentId:         DEPT_ID,
  positionId:           POS_ID,
  employeeNumber:       'EMP-001',
  firstName:            'Jane',
  lastName:             'Smith',
  email:                'jane.smith@example.gov',
  employmentStatus:     'PENDING_ONBOARDING',
  appointmentAuthority: 'COMPETITIVE_APPOINTMENT',
  hireDate:             HIRE_DATE,
  terminationDate:      null,
  createdAt:            NOW,
  updatedAt:            NOW,
};

const mockActor: RequestUser = {
  userId:    ACTOR_ID,
  tenantId:  TENANT_ID,
  email:     'actor@tenant.gov',
  firstName: '',
  lastName:  '',
  roles:     ['System Administrator'],
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe('HireController', () => {
  let controller: HireController;
  let mockService: { hire: jest.Mock };

  beforeEach(async () => {
    mockService = { hire: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HireController],
      providers: [
        { provide: HireService, useValue: mockService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<HireController>(HireController);
  });

  afterEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------------------
  // hireApplication — SUCCESS
  // ---------------------------------------------------------------------------

  describe('hireApplication() — SUCCESS', () => {
    beforeEach(() => {
      mockService.hire.mockResolvedValue({ outcome: 'SUCCESS', employee: employeeRecord });
    });

    it('returns { success: true, data: employee shape }', async () => {
      const result = await controller.hireApplication(APP_ID, mockActor) as Record<string, unknown>;
      expect(result['success']).toBe(true);
      expect(result['data']).toBeDefined();
    });

    it('response data includes id, employeeNumber, employmentStatus, appointmentAuthority', async () => {
      const result = await controller.hireApplication(APP_ID, mockActor) as Record<string, Record<string, unknown>>;
      expect(result['data']['id']).toBe(EMP_ID);
      expect(result['data']['employeeNumber']).toBe('EMP-001');
      expect(result['data']['employmentStatus']).toBe('PENDING_ONBOARDING');
      expect(result['data']['appointmentAuthority']).toBe('COMPETITIVE_APPOINTMENT');
    });

    it('response data does not include tenantId (SEC-003)', async () => {
      const result = await controller.hireApplication(APP_ID, mockActor) as Record<string, Record<string, unknown>>;
      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('response data does not include deletedAt', async () => {
      const result = await controller.hireApplication(APP_ID, mockActor) as Record<string, Record<string, unknown>>;
      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('hireDate is serialized as ISO 8601 string', async () => {
      const result = await controller.hireApplication(APP_ID, mockActor) as Record<string, Record<string, unknown>>;
      expect(result['data']['hireDate']).toBe(HIRE_DATE.toISOString());
    });

    it('terminationDate is null when not set on record', async () => {
      const result = await controller.hireApplication(APP_ID, mockActor) as Record<string, Record<string, unknown>>;
      expect(result['data']['terminationDate']).toBeNull();
    });

    it('createdAt and updatedAt are ISO 8601 strings', async () => {
      const result = await controller.hireApplication(APP_ID, mockActor) as Record<string, Record<string, unknown>>;
      expect(result['data']['createdAt']).toBe(NOW.toISOString());
      expect(result['data']['updatedAt']).toBe(NOW.toISOString());
    });

    it('calls hireService.hire(id, actor.tenantId, actor.userId) — not from body (SEC-003)', async () => {
      await controller.hireApplication(APP_ID, mockActor);
      expect(mockService.hire).toHaveBeenCalledWith(APP_ID, TENANT_ID, ACTOR_ID);
      expect(mockService.hire).toHaveBeenCalledTimes(1);
    });

    it('no request body parameter — method signature accepts only id and actor', async () => {
      // hireApplication takes exactly 2 args; passing none beyond them still works.
      await expect(controller.hireApplication(APP_ID, mockActor)).resolves.not.toThrow();
      expect(mockService.hire).toHaveBeenCalledWith(APP_ID, TENANT_ID, ACTOR_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // HTTP code metadata
  // ---------------------------------------------------------------------------

  describe('HTTP code metadata', () => {
    it('hireApplication uses 201 Created (GD-M19-1 D13)', () => {
      const code = Reflect.getMetadata(HTTP_CODE_METADATA, controller.hireApplication);
      expect(code).toBe(201);
    });
  });

  // ---------------------------------------------------------------------------
  // RBAC metadata (GD-M19-1 D3; GD-PRE-PHASE3-003 D3)
  // ---------------------------------------------------------------------------

  describe('RBAC metadata', () => {
    it('hireApplication includes System Administrator', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.hireApplication);
      expect(roles).toContain('System Administrator');
    });

    it('hireApplication includes HR Director', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.hireApplication);
      expect(roles).toContain('HR Director');
    });

    it('hireApplication does NOT include Recruiter — hire authority restricted to SA+HRD (GD-M19-1 D3)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.hireApplication);
      expect(roles).not.toContain('Recruiter');
    });

    it('hireApplication does NOT include Compliance Officer', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.hireApplication);
      expect(roles).not.toContain('Compliance Officer');
    });

    it('hireApplication does NOT include Hiring Manager', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.hireApplication);
      expect(roles).not.toContain('Hiring Manager');
    });

    it('hireApplication does NOT include Workforce Planner', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.hireApplication);
      expect(roles).not.toContain('Workforce Planner');
    });

    it('hireApplication does NOT include Executive User', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.hireApplication);
      expect(roles).not.toContain('Executive User');
    });
  });

  // ---------------------------------------------------------------------------
  // HTTP error mapping (GD-M19-1 D13)
  // ---------------------------------------------------------------------------

  describe('hireApplication() — HTTP error mapping', () => {
    it('APPLICATION_NOT_FOUND → 404 NotFoundException', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'APPLICATION_NOT_FOUND' });
      await expect(controller.hireApplication(APP_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('APPLICATION_NOT_FOUND → error body code = APPLICATION_NOT_FOUND', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'APPLICATION_NOT_FOUND' });
      let thrown: unknown;
      try { await controller.hireApplication(APP_ID, mockActor); } catch (e) { thrown = e; }
      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['success']).toBe(false);
      expect(body['error']['code']).toBe('APPLICATION_NOT_FOUND');
    });

    it('APPLICATION_ALREADY_HIRED → 409 ConflictException', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'APPLICATION_ALREADY_HIRED' });
      await expect(controller.hireApplication(APP_ID, mockActor)).rejects.toThrow(ConflictException);
    });

    it('APPLICATION_ALREADY_HIRED → error body code = APPLICATION_ALREADY_HIRED', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'APPLICATION_ALREADY_HIRED' });
      let thrown: unknown;
      try { await controller.hireApplication(APP_ID, mockActor); } catch (e) { thrown = e; }
      const body = (thrown as ConflictException).getResponse() as Record<string, Record<string, string>>;
      expect(body['success']).toBe(false);
      expect(body['error']['code']).toBe('APPLICATION_ALREADY_HIRED');
    });

    it('APPLICATION_NOT_AT_OFFER_STATUS → 422 UnprocessableEntityException', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'APPLICATION_NOT_AT_OFFER_STATUS' });
      await expect(controller.hireApplication(APP_ID, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('APPLICATION_NOT_AT_OFFER_STATUS → error body code = APPLICATION_NOT_AT_OFFER_STATUS', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'APPLICATION_NOT_AT_OFFER_STATUS' });
      let thrown: unknown;
      try { await controller.hireApplication(APP_ID, mockActor); } catch (e) { thrown = e; }
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['success']).toBe(false);
      expect(body['error']['code']).toBe('APPLICATION_NOT_AT_OFFER_STATUS');
    });

    it('ACCEPTED_OFFER_NOT_FOUND → 422 UnprocessableEntityException', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'ACCEPTED_OFFER_NOT_FOUND' });
      await expect(controller.hireApplication(APP_ID, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('ACCEPTED_OFFER_NOT_FOUND → error body code = ACCEPTED_OFFER_NOT_FOUND', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'ACCEPTED_OFFER_NOT_FOUND' });
      let thrown: unknown;
      try { await controller.hireApplication(APP_ID, mockActor); } catch (e) { thrown = e; }
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['success']).toBe(false);
      expect(body['error']['code']).toBe('ACCEPTED_OFFER_NOT_FOUND');
    });

    it('CANDIDATE_NOT_FOUND → 404 NotFoundException', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'CANDIDATE_NOT_FOUND' });
      await expect(controller.hireApplication(APP_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('CANDIDATE_NOT_FOUND → error body code = CANDIDATE_NOT_FOUND', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'CANDIDATE_NOT_FOUND' });
      let thrown: unknown;
      try { await controller.hireApplication(APP_ID, mockActor); } catch (e) { thrown = e; }
      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['success']).toBe(false);
      expect(body['error']['code']).toBe('CANDIDATE_NOT_FOUND');
    });

    it('CANDIDATE_ARCHIVED → 422 UnprocessableEntityException', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'CANDIDATE_ARCHIVED' });
      await expect(controller.hireApplication(APP_ID, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('CANDIDATE_ARCHIVED → error body code = CANDIDATE_ARCHIVED', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'CANDIDATE_ARCHIVED' });
      let thrown: unknown;
      try { await controller.hireApplication(APP_ID, mockActor); } catch (e) { thrown = e; }
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['success']).toBe(false);
      expect(body['error']['code']).toBe('CANDIDATE_ARCHIVED');
    });

    it('VACANCY_NOT_FOUND → 404 NotFoundException', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'VACANCY_NOT_FOUND' });
      await expect(controller.hireApplication(APP_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('VACANCY_NOT_FOUND → error body code = VACANCY_NOT_FOUND', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'VACANCY_NOT_FOUND' });
      let thrown: unknown;
      try { await controller.hireApplication(APP_ID, mockActor); } catch (e) { thrown = e; }
      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['success']).toBe(false);
      expect(body['error']['code']).toBe('VACANCY_NOT_FOUND');
    });

    it('VACANCY_NOT_AVAILABLE → 422 UnprocessableEntityException', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'VACANCY_NOT_AVAILABLE' });
      await expect(controller.hireApplication(APP_ID, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('VACANCY_NOT_AVAILABLE → error body code = VACANCY_NOT_AVAILABLE', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'VACANCY_NOT_AVAILABLE' });
      let thrown: unknown;
      try { await controller.hireApplication(APP_ID, mockActor); } catch (e) { thrown = e; }
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['success']).toBe(false);
      expect(body['error']['code']).toBe('VACANCY_NOT_AVAILABLE');
    });

    it('POSITION_NOT_FOUND → 404 NotFoundException', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'POSITION_NOT_FOUND' });
      await expect(controller.hireApplication(APP_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('POSITION_NOT_FOUND → error body code = POSITION_NOT_FOUND', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'POSITION_NOT_FOUND' });
      let thrown: unknown;
      try { await controller.hireApplication(APP_ID, mockActor); } catch (e) { thrown = e; }
      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['success']).toBe(false);
      expect(body['error']['code']).toBe('POSITION_NOT_FOUND');
    });

    it('POSITION_NOT_AVAILABLE → 422 UnprocessableEntityException', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'POSITION_NOT_AVAILABLE' });
      await expect(controller.hireApplication(APP_ID, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('POSITION_NOT_AVAILABLE → error body code = POSITION_NOT_AVAILABLE', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'POSITION_NOT_AVAILABLE' });
      let thrown: unknown;
      try { await controller.hireApplication(APP_ID, mockActor); } catch (e) { thrown = e; }
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['success']).toBe(false);
      expect(body['error']['code']).toBe('POSITION_NOT_AVAILABLE');
    });

    it('EMPLOYEE_NUMBER_GENERATION_FAILED → 500 InternalServerErrorException', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'EMPLOYEE_NUMBER_GENERATION_FAILED' });
      await expect(controller.hireApplication(APP_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });

    it('EMPLOYEE_NUMBER_GENERATION_FAILED → error body code = EMPLOYEE_NUMBER_GENERATION_FAILED', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'EMPLOYEE_NUMBER_GENERATION_FAILED' });
      let thrown: unknown;
      try { await controller.hireApplication(APP_ID, mockActor); } catch (e) { thrown = e; }
      const body = (thrown as InternalServerErrorException).getResponse() as Record<string, Record<string, string>>;
      expect(body['success']).toBe(false);
      expect(body['error']['code']).toBe('EMPLOYEE_NUMBER_GENERATION_FAILED');
    });

    it('INTERNAL_ERROR → 500 InternalServerErrorException', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });
      await expect(controller.hireApplication(APP_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });

    it('INTERNAL_ERROR → error body code = INTERNAL_ERROR', async () => {
      mockService.hire.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });
      let thrown: unknown;
      try { await controller.hireApplication(APP_ID, mockActor); } catch (e) { thrown = e; }
      const body = (thrown as InternalServerErrorException).getResponse() as Record<string, Record<string, string>>;
      expect(body['success']).toBe(false);
      expect(body['error']['code']).toBe('INTERNAL_ERROR');
    });
  });
});
