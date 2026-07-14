// ApplicationController unit tests
// Reference: governance/GD-M17-1.md — D10 (status machine), D13 (RBAC), D15 (update), D16 (audit)
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
//
// Pattern: mirrors apps/api/src/recruiting/candidate.controller.spec.ts
// Guards overridden with { canActivate: () => true } — RBAC enforcement tested separately
// by confirming @RequireRoles metadata on each method via Reflector; guard behavior tested
// in guard unit tests, not here.
// tenantId comes from actor.tenantId (JWT), never from body/params — SEC-003 tested
// by asserting the exact call signature passed to the mock service.
// rejectApplication and withdrawApplication return { success: true, data: ApplicationResponse }
// consistent with all other mutation endpoints (GD-M17-1 D12 — clarified in commit 55fbc51).

import { Test, type TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import type { RequestUser } from '../identity/jwt.strategy';
import { ApplicationController } from './application.controller';
import { ApplicationService, type ApplicationRecord } from './application.service';
import type { CreateApplicationDto } from './dto/create-application.dto';
import type { UpdateApplicationDto } from './dto/update-application.dto';
import type { AdvanceApplicationDto } from './dto/advance-application.dto';
import type { ListApplicationsQueryDto } from './dto/list-applications-query.dto';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const APPLICATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_ID      = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTOR_ID       = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CANDIDATE_ID   = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const VACANCY_ID     = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const NOW = new Date('2026-06-29T00:00:00.000Z');

const applicationRecord: ApplicationRecord = {
  id:           APPLICATION_ID,
  tenantId:     TENANT_ID,
  candidateId:  CANDIDATE_ID,
  vacancyId:    VACANCY_ID,
  status:       'APPLIED',
  submittedAt:  NOW,
  currentStage: null,
  notes:        'Referred by department head',
  createdAt:    NOW,
  updatedAt:    NOW,
};

const createDto: CreateApplicationDto = {
  candidateId: CANDIDATE_ID,
  vacancyId:   VACANCY_ID,
  notes:       'Referred by department head',
};

const updateDto: UpdateApplicationDto = {
  notes:        'Updated note',
  currentStage: 'Phone Screen',
};

const advanceDto: AdvanceApplicationDto = {
  targetStatus: 'SCREENING',
};

const listQuery: ListApplicationsQueryDto = {
  page:     1,
  pageSize: 20,
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

describe('ApplicationController', () => {
  let controller: ApplicationController;
  let mockService: {
    createApplication:   jest.Mock;
    listApplications:    jest.Mock;
    getApplicationById:  jest.Mock;
    updateApplication:   jest.Mock;
    advanceApplication:  jest.Mock;
    rejectApplication:   jest.Mock;
    withdrawApplication: jest.Mock;
  };

  beforeEach(async () => {
    mockService = {
      createApplication:   jest.fn(),
      listApplications:    jest.fn(),
      getApplicationById:  jest.fn(),
      updateApplication:   jest.fn(),
      advanceApplication:  jest.fn(),
      rejectApplication:   jest.fn(),
      withdrawApplication: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApplicationController],
      providers: [
        { provide: ApplicationService, useValue: mockService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ApplicationController>(ApplicationController);
  });

  afterEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------------------
  // createApplication
  // ---------------------------------------------------------------------------

  describe('createApplication()', () => {
    it('SUCCESS: returns { success: true, data: application shape }', async () => {
      mockService.createApplication.mockResolvedValue({ outcome: 'SUCCESS', application: applicationRecord });

      const result = await controller.createApplication(createDto, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({
        id:          APPLICATION_ID,
        candidateId: CANDIDATE_ID,
        vacancyId:   VACANCY_ID,
        status:      'APPLIED',
      });
    });

    it('SUCCESS: submittedAt, createdAt, updatedAt are ISO 8601 strings', async () => {
      mockService.createApplication.mockResolvedValue({ outcome: 'SUCCESS', application: applicationRecord });

      const result = await controller.createApplication(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(typeof result['data']['submittedAt']).toBe('string');
      expect(typeof result['data']['createdAt']).toBe('string');
      expect(typeof result['data']['updatedAt']).toBe('string');
      expect(result['data']['submittedAt']).toBe(NOW.toISOString());
    });

    it('SUCCESS: response data does not include tenantId (SEC-003)', async () => {
      mockService.createApplication.mockResolvedValue({ outcome: 'SUCCESS', application: applicationRecord });

      const result = await controller.createApplication(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: response data does not include deletedAt', async () => {
      mockService.createApplication.mockResolvedValue({ outcome: 'SUCCESS', application: applicationRecord });

      const result = await controller.createApplication(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: actor.tenantId and actor.userId forwarded to service — not from DTO (SEC-003)', async () => {
      mockService.createApplication.mockResolvedValue({ outcome: 'SUCCESS', application: applicationRecord });

      await controller.createApplication(createDto, mockActor);

      expect(mockService.createApplication).toHaveBeenCalledWith(
        expect.objectContaining({ candidateId: CANDIDATE_ID, vacancyId: VACANCY_ID }),
        TENANT_ID,
        ACTOR_ID,
      );
    });

    it('CANDIDATE_NOT_FOUND: throws NotFoundException', async () => {
      mockService.createApplication.mockResolvedValue({ outcome: 'CANDIDATE_NOT_FOUND' });

      await expect(controller.createApplication(createDto, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('CANDIDATE_NOT_FOUND: error body code = CANDIDATE_NOT_FOUND', async () => {
      mockService.createApplication.mockResolvedValue({ outcome: 'CANDIDATE_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.createApplication(createDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('CANDIDATE_NOT_FOUND');
      expect(body['success']).toBe(false);
    });

    it('CANDIDATE_ARCHIVED: throws UnprocessableEntityException', async () => {
      mockService.createApplication.mockResolvedValue({ outcome: 'CANDIDATE_ARCHIVED' });

      await expect(controller.createApplication(createDto, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('CANDIDATE_ARCHIVED: error body code = CANDIDATE_ARCHIVED', async () => {
      mockService.createApplication.mockResolvedValue({ outcome: 'CANDIDATE_ARCHIVED' });

      let thrown: unknown;
      try { await controller.createApplication(createDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('CANDIDATE_ARCHIVED');
      expect(body['success']).toBe(false);
    });

    it('VACANCY_NOT_FOUND: throws NotFoundException', async () => {
      mockService.createApplication.mockResolvedValue({ outcome: 'VACANCY_NOT_FOUND' });

      await expect(controller.createApplication(createDto, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('VACANCY_NOT_FOUND: error body code = VACANCY_NOT_FOUND', async () => {
      mockService.createApplication.mockResolvedValue({ outcome: 'VACANCY_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.createApplication(createDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('VACANCY_NOT_FOUND');
    });

    it('VACANCY_NOT_OPEN: throws UnprocessableEntityException', async () => {
      mockService.createApplication.mockResolvedValue({ outcome: 'VACANCY_NOT_OPEN' });

      await expect(controller.createApplication(createDto, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('VACANCY_NOT_OPEN: error body code = VACANCY_NOT_OPEN', async () => {
      mockService.createApplication.mockResolvedValue({ outcome: 'VACANCY_NOT_OPEN' });

      let thrown: unknown;
      try { await controller.createApplication(createDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('VACANCY_NOT_OPEN');
    });

    it('APPLICATION_ALREADY_EXISTS: throws ConflictException', async () => {
      mockService.createApplication.mockResolvedValue({ outcome: 'APPLICATION_ALREADY_EXISTS' });

      await expect(controller.createApplication(createDto, mockActor)).rejects.toThrow(ConflictException);
    });

    it('APPLICATION_ALREADY_EXISTS: error body code = APPLICATION_ALREADY_EXISTS', async () => {
      mockService.createApplication.mockResolvedValue({ outcome: 'APPLICATION_ALREADY_EXISTS' });

      let thrown: unknown;
      try { await controller.createApplication(createDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as ConflictException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('APPLICATION_ALREADY_EXISTS');
      expect(body['success']).toBe(false);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.createApplication.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.createApplication(createDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // listApplications
  // ---------------------------------------------------------------------------

  describe('listApplications()', () => {
    it('SUCCESS: returns { success: true, data: paginated envelope }', async () => {
      mockService.listApplications.mockResolvedValue({
        outcome:      'SUCCESS',
        applications: [applicationRecord],
        total:        1,
        page:         1,
        pageSize:     20,
      });

      const result = await controller.listApplications(listQuery, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      const data = result['data'] as Record<string, unknown>;
      expect(data['applications']).toHaveLength(1);
      expect(data['total']).toBe(1);
      expect(data['page']).toBe(1);
      expect(data['pageSize']).toBe(20);
    });

    it('SUCCESS: totalPages computed as Math.ceil(total / pageSize)', async () => {
      mockService.listApplications.mockResolvedValue({
        outcome: 'SUCCESS', applications: [], total: 41, page: 1, pageSize: 20,
      });

      const result = await controller.listApplications(listQuery, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']['totalPages']).toBe(3);
    });

    it('SUCCESS: application records in list do not include tenantId (SEC-003)', async () => {
      mockService.listApplications.mockResolvedValue({
        outcome: 'SUCCESS', applications: [applicationRecord], total: 1, page: 1, pageSize: 20,
      });

      const result = await controller.listApplications(listQuery, mockActor) as Record<string, Record<string, unknown[]>>;
      const applications = result['data']['applications'] as Record<string, unknown>[];

      expect(applications[0]).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: application records in list do not include deletedAt', async () => {
      mockService.listApplications.mockResolvedValue({
        outcome: 'SUCCESS', applications: [applicationRecord], total: 1, page: 1, pageSize: 20,
      });

      const result = await controller.listApplications(listQuery, mockActor) as Record<string, Record<string, unknown[]>>;
      const applications = result['data']['applications'] as Record<string, unknown>[];

      expect(applications[0]).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: actor.tenantId forwarded to service — not from query (SEC-003)', async () => {
      mockService.listApplications.mockResolvedValue({
        outcome: 'SUCCESS', applications: [], total: 0, page: 1, pageSize: 20,
      });

      await controller.listApplications(listQuery, mockActor);

      expect(mockService.listApplications).toHaveBeenCalledWith(
        expect.any(Object),
        TENANT_ID,
      );
    });

    it('SUCCESS: Compliance Officer actor passes through (read authorization via @RequireRoles decorator)', async () => {
      const complianceActor: RequestUser = { ...mockActor, roles: ['Compliance Officer'] };
      mockService.listApplications.mockResolvedValue({
        outcome: 'SUCCESS', applications: [], total: 0, page: 1, pageSize: 20,
      });

      const result = await controller.listApplications(listQuery, complianceActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.listApplications.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.listApplications(listQuery, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // getApplicationById
  // ---------------------------------------------------------------------------

  describe('getApplicationById()', () => {
    it('SUCCESS: returns { success: true, data: application shape }', async () => {
      mockService.getApplicationById.mockResolvedValue({ outcome: 'SUCCESS', application: applicationRecord });

      const result = await controller.getApplicationById(APPLICATION_ID, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: APPLICATION_ID, status: 'APPLIED' });
    });

    it('SUCCESS: response data does not include tenantId (SEC-003)', async () => {
      mockService.getApplicationById.mockResolvedValue({ outcome: 'SUCCESS', application: applicationRecord });

      const result = await controller.getApplicationById(APPLICATION_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: response data does not include deletedAt', async () => {
      mockService.getApplicationById.mockResolvedValue({ outcome: 'SUCCESS', application: applicationRecord });

      const result = await controller.getApplicationById(APPLICATION_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: id and actor.tenantId forwarded to service (SEC-003 — no actorId needed for read)', async () => {
      mockService.getApplicationById.mockResolvedValue({ outcome: 'SUCCESS', application: applicationRecord });

      await controller.getApplicationById(APPLICATION_ID, mockActor);

      expect(mockService.getApplicationById).toHaveBeenCalledWith(APPLICATION_ID, TENANT_ID);
    });

    it('APPLICATION_NOT_FOUND: throws NotFoundException', async () => {
      mockService.getApplicationById.mockResolvedValue({ outcome: 'APPLICATION_NOT_FOUND' });

      await expect(controller.getApplicationById(APPLICATION_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('APPLICATION_NOT_FOUND: error body code = APPLICATION_NOT_FOUND', async () => {
      mockService.getApplicationById.mockResolvedValue({ outcome: 'APPLICATION_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.getApplicationById(APPLICATION_ID, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('APPLICATION_NOT_FOUND');
      expect(body['success']).toBe(false);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.getApplicationById.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.getApplicationById(APPLICATION_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // updateApplication
  // ---------------------------------------------------------------------------

  describe('updateApplication()', () => {
    it('SUCCESS: returns { success: true, data: application shape }', async () => {
      const updatedRecord = { ...applicationRecord, notes: 'Updated note', currentStage: 'Phone Screen' };
      mockService.updateApplication.mockResolvedValue({ outcome: 'SUCCESS', application: updatedRecord });

      const result = await controller.updateApplication(APPLICATION_ID, updateDto, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: APPLICATION_ID });
    });

    it('SUCCESS: response data does not include tenantId (SEC-003)', async () => {
      mockService.updateApplication.mockResolvedValue({ outcome: 'SUCCESS', application: applicationRecord });

      const result = await controller.updateApplication(APPLICATION_ID, updateDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: response data does not include deletedAt', async () => {
      mockService.updateApplication.mockResolvedValue({ outcome: 'SUCCESS', application: applicationRecord });

      const result = await controller.updateApplication(APPLICATION_ID, updateDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: id, actor.tenantId, actor.userId forwarded to service — tenantId not from DTO (SEC-003)', async () => {
      mockService.updateApplication.mockResolvedValue({ outcome: 'SUCCESS', application: applicationRecord });

      await controller.updateApplication(APPLICATION_ID, updateDto, mockActor);

      expect(mockService.updateApplication).toHaveBeenCalledWith(
        APPLICATION_ID,
        expect.objectContaining({ notes: 'Updated note' }),
        TENANT_ID,
        ACTOR_ID,
      );
    });

    it('APPLICATION_NOT_FOUND: throws NotFoundException', async () => {
      mockService.updateApplication.mockResolvedValue({ outcome: 'APPLICATION_NOT_FOUND' });

      await expect(controller.updateApplication(APPLICATION_ID, updateDto, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('APPLICATION_NOT_FOUND: error body code = APPLICATION_NOT_FOUND', async () => {
      mockService.updateApplication.mockResolvedValue({ outcome: 'APPLICATION_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.updateApplication(APPLICATION_ID, updateDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('APPLICATION_NOT_FOUND');
      expect(body['success']).toBe(false);
    });

    it('APPLICATION_IN_TERMINAL_STATE: throws UnprocessableEntityException', async () => {
      mockService.updateApplication.mockResolvedValue({ outcome: 'APPLICATION_IN_TERMINAL_STATE' });

      await expect(controller.updateApplication(APPLICATION_ID, updateDto, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('APPLICATION_IN_TERMINAL_STATE: error body code = APPLICATION_IN_TERMINAL_STATE', async () => {
      mockService.updateApplication.mockResolvedValue({ outcome: 'APPLICATION_IN_TERMINAL_STATE' });

      let thrown: unknown;
      try { await controller.updateApplication(APPLICATION_ID, updateDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('APPLICATION_IN_TERMINAL_STATE');
      expect(body['success']).toBe(false);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.updateApplication.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.updateApplication(APPLICATION_ID, updateDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // advanceApplication
  // ---------------------------------------------------------------------------

  describe('advanceApplication()', () => {
    it('SUCCESS: returns { success: true, data: application shape }', async () => {
      const advancedRecord = { ...applicationRecord, status: 'SCREENING' };
      mockService.advanceApplication.mockResolvedValue({ outcome: 'SUCCESS', application: advancedRecord });

      const result = await controller.advanceApplication(APPLICATION_ID, advanceDto, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: APPLICATION_ID, status: 'SCREENING' });
    });

    it('SUCCESS: response data does not include tenantId (SEC-003)', async () => {
      mockService.advanceApplication.mockResolvedValue({ outcome: 'SUCCESS', application: applicationRecord });

      const result = await controller.advanceApplication(APPLICATION_ID, advanceDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: response data does not include deletedAt', async () => {
      mockService.advanceApplication.mockResolvedValue({ outcome: 'SUCCESS', application: applicationRecord });

      const result = await controller.advanceApplication(APPLICATION_ID, advanceDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: id, targetStatus, actor.tenantId, actor.userId forwarded to service (SEC-003)', async () => {
      mockService.advanceApplication.mockResolvedValue({ outcome: 'SUCCESS', application: applicationRecord });

      await controller.advanceApplication(APPLICATION_ID, advanceDto, mockActor);

      expect(mockService.advanceApplication).toHaveBeenCalledWith(
        APPLICATION_ID,
        { targetStatus: 'SCREENING' },
        TENANT_ID,
        ACTOR_ID,
      );
    });

    it('APPLICATION_NOT_FOUND: throws NotFoundException', async () => {
      mockService.advanceApplication.mockResolvedValue({ outcome: 'APPLICATION_NOT_FOUND' });

      await expect(controller.advanceApplication(APPLICATION_ID, advanceDto, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('APPLICATION_NOT_FOUND: error body code = APPLICATION_NOT_FOUND', async () => {
      mockService.advanceApplication.mockResolvedValue({ outcome: 'APPLICATION_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.advanceApplication(APPLICATION_ID, advanceDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('APPLICATION_NOT_FOUND');
    });

    it('APPLICATION_IN_TERMINAL_STATE: throws UnprocessableEntityException', async () => {
      mockService.advanceApplication.mockResolvedValue({ outcome: 'APPLICATION_IN_TERMINAL_STATE' });

      await expect(controller.advanceApplication(APPLICATION_ID, advanceDto, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('APPLICATION_IN_TERMINAL_STATE: error body code = APPLICATION_IN_TERMINAL_STATE', async () => {
      mockService.advanceApplication.mockResolvedValue({ outcome: 'APPLICATION_IN_TERMINAL_STATE' });

      let thrown: unknown;
      try { await controller.advanceApplication(APPLICATION_ID, advanceDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('APPLICATION_IN_TERMINAL_STATE');
      expect(body['success']).toBe(false);
    });

    it('APPLICATION_AWAITING_HIRE: throws UnprocessableEntityException', async () => {
      mockService.advanceApplication.mockResolvedValue({ outcome: 'APPLICATION_AWAITING_HIRE' });

      await expect(controller.advanceApplication(APPLICATION_ID, advanceDto, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('APPLICATION_AWAITING_HIRE: error body code = APPLICATION_AWAITING_HIRE', async () => {
      mockService.advanceApplication.mockResolvedValue({ outcome: 'APPLICATION_AWAITING_HIRE' });

      let thrown: unknown;
      try { await controller.advanceApplication(APPLICATION_ID, advanceDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('APPLICATION_AWAITING_HIRE');
      expect(body['success']).toBe(false);
    });

    it('INVALID_APPLICATION_TRANSITION: throws UnprocessableEntityException', async () => {
      mockService.advanceApplication.mockResolvedValue({ outcome: 'INVALID_APPLICATION_TRANSITION' });

      await expect(controller.advanceApplication(APPLICATION_ID, advanceDto, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('INVALID_APPLICATION_TRANSITION: error body code = INVALID_APPLICATION_TRANSITION', async () => {
      mockService.advanceApplication.mockResolvedValue({ outcome: 'INVALID_APPLICATION_TRANSITION' });

      let thrown: unknown;
      try { await controller.advanceApplication(APPLICATION_ID, advanceDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INVALID_APPLICATION_TRANSITION');
      expect(body['success']).toBe(false);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.advanceApplication.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.advanceApplication(APPLICATION_ID, advanceDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // rejectApplication
  // ---------------------------------------------------------------------------

  describe('rejectApplication()', () => {
    it('SUCCESS: returns { success: true, data: application shape } with status REJECTED (GD-M17-1 D12)', async () => {
      const rejectedRecord = { ...applicationRecord, status: 'REJECTED' };
      mockService.rejectApplication.mockResolvedValue({ outcome: 'SUCCESS', application: rejectedRecord });

      const result = await controller.rejectApplication(APPLICATION_ID, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: APPLICATION_ID, status: 'REJECTED' });
    });

    it('SUCCESS: response data does not include tenantId (SEC-003)', async () => {
      const rejectedRecord = { ...applicationRecord, status: 'REJECTED' };
      mockService.rejectApplication.mockResolvedValue({ outcome: 'SUCCESS', application: rejectedRecord });

      const result = await controller.rejectApplication(APPLICATION_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: response data does not include deletedAt', async () => {
      const rejectedRecord = { ...applicationRecord, status: 'REJECTED' };
      mockService.rejectApplication.mockResolvedValue({ outcome: 'SUCCESS', application: rejectedRecord });

      const result = await controller.rejectApplication(APPLICATION_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: id, actor.tenantId, actor.userId forwarded to service (SEC-003)', async () => {
      const rejectedRecord = { ...applicationRecord, status: 'REJECTED' };
      mockService.rejectApplication.mockResolvedValue({ outcome: 'SUCCESS', application: rejectedRecord });

      await controller.rejectApplication(APPLICATION_ID, mockActor);

      expect(mockService.rejectApplication).toHaveBeenCalledWith(APPLICATION_ID, TENANT_ID, ACTOR_ID);
    });

    it('APPLICATION_NOT_FOUND: throws NotFoundException', async () => {
      mockService.rejectApplication.mockResolvedValue({ outcome: 'APPLICATION_NOT_FOUND' });

      await expect(controller.rejectApplication(APPLICATION_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('APPLICATION_NOT_FOUND: error body code = APPLICATION_NOT_FOUND', async () => {
      mockService.rejectApplication.mockResolvedValue({ outcome: 'APPLICATION_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.rejectApplication(APPLICATION_ID, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('APPLICATION_NOT_FOUND');
      expect(body['success']).toBe(false);
    });

    it('APPLICATION_IN_TERMINAL_STATE: throws UnprocessableEntityException', async () => {
      mockService.rejectApplication.mockResolvedValue({ outcome: 'APPLICATION_IN_TERMINAL_STATE' });

      await expect(controller.rejectApplication(APPLICATION_ID, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('APPLICATION_IN_TERMINAL_STATE: error body code = APPLICATION_IN_TERMINAL_STATE', async () => {
      mockService.rejectApplication.mockResolvedValue({ outcome: 'APPLICATION_IN_TERMINAL_STATE' });

      let thrown: unknown;
      try { await controller.rejectApplication(APPLICATION_ID, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('APPLICATION_IN_TERMINAL_STATE');
      expect(body['success']).toBe(false);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.rejectApplication.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.rejectApplication(APPLICATION_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // withdrawApplication
  // ---------------------------------------------------------------------------

  describe('withdrawApplication()', () => {
    it('SUCCESS: returns { success: true, data: application shape } with status WITHDRAWN (GD-M17-1 D12)', async () => {
      const withdrawnRecord = { ...applicationRecord, status: 'WITHDRAWN' };
      mockService.withdrawApplication.mockResolvedValue({ outcome: 'SUCCESS', application: withdrawnRecord });

      const result = await controller.withdrawApplication(APPLICATION_ID, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: APPLICATION_ID, status: 'WITHDRAWN' });
    });

    it('SUCCESS: response data does not include tenantId (SEC-003)', async () => {
      const withdrawnRecord = { ...applicationRecord, status: 'WITHDRAWN' };
      mockService.withdrawApplication.mockResolvedValue({ outcome: 'SUCCESS', application: withdrawnRecord });

      const result = await controller.withdrawApplication(APPLICATION_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: response data does not include deletedAt', async () => {
      const withdrawnRecord = { ...applicationRecord, status: 'WITHDRAWN' };
      mockService.withdrawApplication.mockResolvedValue({ outcome: 'SUCCESS', application: withdrawnRecord });

      const result = await controller.withdrawApplication(APPLICATION_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: id, actor.tenantId, actor.userId forwarded to service (SEC-003)', async () => {
      const withdrawnRecord = { ...applicationRecord, status: 'WITHDRAWN' };
      mockService.withdrawApplication.mockResolvedValue({ outcome: 'SUCCESS', application: withdrawnRecord });

      await controller.withdrawApplication(APPLICATION_ID, mockActor);

      expect(mockService.withdrawApplication).toHaveBeenCalledWith(APPLICATION_ID, TENANT_ID, ACTOR_ID);
    });

    it('APPLICATION_NOT_FOUND: throws NotFoundException', async () => {
      mockService.withdrawApplication.mockResolvedValue({ outcome: 'APPLICATION_NOT_FOUND' });

      await expect(controller.withdrawApplication(APPLICATION_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('APPLICATION_NOT_FOUND: error body code = APPLICATION_NOT_FOUND', async () => {
      mockService.withdrawApplication.mockResolvedValue({ outcome: 'APPLICATION_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.withdrawApplication(APPLICATION_ID, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('APPLICATION_NOT_FOUND');
      expect(body['success']).toBe(false);
    });

    it('APPLICATION_IN_TERMINAL_STATE: throws UnprocessableEntityException', async () => {
      mockService.withdrawApplication.mockResolvedValue({ outcome: 'APPLICATION_IN_TERMINAL_STATE' });

      await expect(controller.withdrawApplication(APPLICATION_ID, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('APPLICATION_IN_TERMINAL_STATE: error body code = APPLICATION_IN_TERMINAL_STATE', async () => {
      mockService.withdrawApplication.mockResolvedValue({ outcome: 'APPLICATION_IN_TERMINAL_STATE' });

      let thrown: unknown;
      try { await controller.withdrawApplication(APPLICATION_ID, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('APPLICATION_IN_TERMINAL_STATE');
      expect(body['success']).toBe(false);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.withdrawApplication.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.withdrawApplication(APPLICATION_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });
});
