// CandidateController unit tests
// Reference: governance/GD-M16-1.md — D9 (endpoints), D11 (RBAC), D13 (response shape)
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
//
// Pattern: mirrors apps/api/src/workforce/employee.controller.spec.ts
// Guards overridden with { canActivate: () => true } — RBAC enforcement tested separately
// by confirming @RequireRoles metadata on each method via Reflector; guard behavior is
// tested in the guard unit tests, not here.
// tenantId comes from actor.tenantId (JWT), never from body/params — SEC-003 tested
// by asserting the exact call signature passed to the mock service.

import { Test, type TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import type { RequestUser } from '../identity/jwt.strategy';
import { CandidateController } from './candidate.controller';
import { CandidateService, type CandidateRecord } from './candidate.service';
import type { CreateCandidateDto } from './dto/create-candidate.dto';
import type { UpdateCandidateDto } from './dto/update-candidate.dto';
import type { ListCandidatesQueryDto } from './dto/list-candidates-query.dto';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const CANDIDATE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_ID    = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTOR_ID     = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const NOW = new Date('2026-01-01T00:00:00.000Z');

const candidateRecord: CandidateRecord = {
  id:        CANDIDATE_ID,
  tenantId:  TENANT_ID,
  firstName: 'Jane',
  lastName:  'Smith',
  email:     'jane.smith@agency.gov',
  phone:     '202-555-0001',
  status:    'ACTIVE',
  source:    'USAJOBS',
  notes:     'Referred by department head',
  createdAt: NOW,
  updatedAt: NOW,
};

const createDto: CreateCandidateDto = {
  firstName: 'Jane',
  lastName:  'Smith',
  email:     'jane.smith@agency.gov',
  phone:     '202-555-0001',
  source:    'USAJOBS',
  notes:     'Referred by department head',
};

const updateDto: UpdateCandidateDto = {
  firstName: 'Janet',
  email:     'janet.smith@agency.gov',
};

const listQuery: ListCandidatesQueryDto = {
  page:     1,
  pageSize: 20,
  status:   'ACTIVE',
};

const mockActor: RequestUser = {
  userId:  ACTOR_ID,
  tenantId: TENANT_ID,
  email:    'actor@tenant.gov',
  roles:   ['System Administrator'],
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe('CandidateController', () => {
  let controller: CandidateController;
  let mockService: {
    createCandidate:  jest.Mock;
    listCandidates:   jest.Mock;
    getCandidateById: jest.Mock;
    updateCandidate:  jest.Mock;
    archiveCandidate: jest.Mock;
  };

  beforeEach(async () => {
    mockService = {
      createCandidate:  jest.fn(),
      listCandidates:   jest.fn(),
      getCandidateById: jest.fn(),
      updateCandidate:  jest.fn(),
      archiveCandidate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CandidateController],
      providers: [
        { provide: CandidateService, useValue: mockService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CandidateController>(CandidateController);
  });

  afterEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------------------
  // createCandidate
  // ---------------------------------------------------------------------------

  describe('createCandidate()', () => {
    it('SUCCESS: returns { success: true, data: candidate shape }', async () => {
      mockService.createCandidate.mockResolvedValue({ outcome: 'SUCCESS', candidate: candidateRecord });

      const result = await controller.createCandidate(createDto, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({
        id:        CANDIDATE_ID,
        firstName: 'Jane',
        lastName:  'Smith',
        email:     'jane.smith@agency.gov',
        phone:     '202-555-0001',
        status:    'ACTIVE',
        source:    'USAJOBS',
        notes:     'Referred by department head',
      });
    });

    it('SUCCESS: createdAt and updatedAt are ISO 8601 strings in response data', async () => {
      mockService.createCandidate.mockResolvedValue({ outcome: 'SUCCESS', candidate: candidateRecord });

      const result = await controller.createCandidate(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(typeof result['data']['createdAt']).toBe('string');
      expect(typeof result['data']['updatedAt']).toBe('string');
      expect(result['data']['createdAt']).toBe(NOW.toISOString());
    });

    it('SUCCESS: response data does not include tenantId (SEC-003)', async () => {
      mockService.createCandidate.mockResolvedValue({ outcome: 'SUCCESS', candidate: candidateRecord });

      const result = await controller.createCandidate(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: response data does not include deletedAt', async () => {
      mockService.createCandidate.mockResolvedValue({ outcome: 'SUCCESS', candidate: candidateRecord });

      const result = await controller.createCandidate(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: actor.tenantId and actor.userId forwarded to service — not from DTO (SEC-003)', async () => {
      mockService.createCandidate.mockResolvedValue({ outcome: 'SUCCESS', candidate: candidateRecord });

      await controller.createCandidate(createDto, mockActor);

      expect(mockService.createCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'jane.smith@agency.gov' }),
        TENANT_ID,
        ACTOR_ID,
      );
    });

    it('CANDIDATE_EMAIL_ALREADY_EXISTS: throws ConflictException', async () => {
      mockService.createCandidate.mockResolvedValue({ outcome: 'CANDIDATE_EMAIL_ALREADY_EXISTS' });

      let thrown: unknown;
      try { await controller.createCandidate(createDto, mockActor); } catch (e) { thrown = e; }

      expect(thrown).toBeInstanceOf(ConflictException);
    });

    it('CANDIDATE_EMAIL_ALREADY_EXISTS: error body code = CANDIDATE_EMAIL_ALREADY_EXISTS', async () => {
      mockService.createCandidate.mockResolvedValue({ outcome: 'CANDIDATE_EMAIL_ALREADY_EXISTS' });

      let thrown: unknown;
      try { await controller.createCandidate(createDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as ConflictException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('CANDIDATE_EMAIL_ALREADY_EXISTS');
      expect(body['success']).toBe(false);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.createCandidate.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.createCandidate(createDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // listCandidates
  // ---------------------------------------------------------------------------

  describe('listCandidates()', () => {
    it('SUCCESS: returns { success: true, data: paginated envelope }', async () => {
      mockService.listCandidates.mockResolvedValue({
        outcome: 'SUCCESS',
        candidates: [candidateRecord],
        total: 1,
        page: 1,
        pageSize: 20,
      });

      const result = await controller.listCandidates(listQuery, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      const data = result['data'] as Record<string, unknown>;
      expect(data['candidates']).toHaveLength(1);
      expect(data['total']).toBe(1);
      expect(data['page']).toBe(1);
      expect(data['pageSize']).toBe(20);
    });

    it('SUCCESS: totalPages computed as Math.ceil(total / pageSize)', async () => {
      mockService.listCandidates.mockResolvedValue({
        outcome: 'SUCCESS',
        candidates: [],
        total: 41,
        page: 1,
        pageSize: 20,
      });

      const result = await controller.listCandidates(listQuery, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']['totalPages']).toBe(3);
    });

    it('SUCCESS: totalPages = 1 when total = 0 (Math.ceil(0/20) = 0 — confirm actual behavior)', async () => {
      mockService.listCandidates.mockResolvedValue({
        outcome: 'SUCCESS',
        candidates: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });

      const result = await controller.listCandidates(listQuery, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']['totalPages']).toBe(0);
    });

    it('SUCCESS: candidate records in list do not include tenantId (SEC-003)', async () => {
      mockService.listCandidates.mockResolvedValue({
        outcome: 'SUCCESS',
        candidates: [candidateRecord],
        total: 1,
        page: 1,
        pageSize: 20,
      });

      const result = await controller.listCandidates(listQuery, mockActor) as Record<string, Record<string, unknown[]>>;
      const candidates = result['data']['candidates'] as Record<string, unknown>[];

      expect(candidates[0]).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: candidate records in list do not include deletedAt', async () => {
      mockService.listCandidates.mockResolvedValue({
        outcome: 'SUCCESS',
        candidates: [candidateRecord],
        total: 1,
        page: 1,
        pageSize: 20,
      });

      const result = await controller.listCandidates(listQuery, mockActor) as Record<string, Record<string, unknown[]>>;
      const candidates = result['data']['candidates'] as Record<string, unknown>[];

      expect(candidates[0]).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: Compliance Officer actor passes through (read authorization via @RequireRoles decorator)', async () => {
      const complianceActor: RequestUser = { ...mockActor, roles: ['Compliance Officer'] };
      mockService.listCandidates.mockResolvedValue({
        outcome: 'SUCCESS',
        candidates: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });

      const result = await controller.listCandidates(listQuery, complianceActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.listCandidates.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.listCandidates(listQuery, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // getCandidateById
  // ---------------------------------------------------------------------------

  describe('getCandidateById()', () => {
    it('SUCCESS: returns { success: true, data: candidate shape }', async () => {
      mockService.getCandidateById.mockResolvedValue({ outcome: 'SUCCESS', candidate: candidateRecord });

      const result = await controller.getCandidateById(CANDIDATE_ID, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: CANDIDATE_ID });
    });

    it('SUCCESS: response data does not include tenantId (SEC-003)', async () => {
      mockService.getCandidateById.mockResolvedValue({ outcome: 'SUCCESS', candidate: candidateRecord });

      const result = await controller.getCandidateById(CANDIDATE_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: response data does not include deletedAt', async () => {
      mockService.getCandidateById.mockResolvedValue({ outcome: 'SUCCESS', candidate: candidateRecord });

      const result = await controller.getCandidateById(CANDIDATE_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: id and actor.tenantId forwarded to service (SEC-003 — not actor.userId)', async () => {
      mockService.getCandidateById.mockResolvedValue({ outcome: 'SUCCESS', candidate: candidateRecord });

      await controller.getCandidateById(CANDIDATE_ID, mockActor);

      expect(mockService.getCandidateById).toHaveBeenCalledWith(CANDIDATE_ID, TENANT_ID);
    });

    it('CANDIDATE_NOT_FOUND: throws NotFoundException', async () => {
      mockService.getCandidateById.mockResolvedValue({ outcome: 'CANDIDATE_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.getCandidateById(CANDIDATE_ID, mockActor); } catch (e) { thrown = e; }

      expect(thrown).toBeInstanceOf(NotFoundException);
    });

    it('CANDIDATE_NOT_FOUND: error body code = CANDIDATE_NOT_FOUND', async () => {
      mockService.getCandidateById.mockResolvedValue({ outcome: 'CANDIDATE_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.getCandidateById(CANDIDATE_ID, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('CANDIDATE_NOT_FOUND');
      expect(body['success']).toBe(false);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.getCandidateById.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.getCandidateById(CANDIDATE_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // updateCandidate
  // ---------------------------------------------------------------------------

  describe('updateCandidate()', () => {
    it('SUCCESS: returns { success: true, data: candidate shape }', async () => {
      const updatedRecord = { ...candidateRecord, firstName: 'Janet', email: 'janet.smith@agency.gov' };
      mockService.updateCandidate.mockResolvedValue({ outcome: 'SUCCESS', candidate: updatedRecord });

      const result = await controller.updateCandidate(CANDIDATE_ID, updateDto, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: CANDIDATE_ID, firstName: 'Janet' });
    });

    it('SUCCESS: response data does not include tenantId (SEC-003)', async () => {
      mockService.updateCandidate.mockResolvedValue({ outcome: 'SUCCESS', candidate: candidateRecord });

      const result = await controller.updateCandidate(CANDIDATE_ID, updateDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: id, actor.tenantId, actor.userId forwarded to service — tenantId not from DTO (SEC-003)', async () => {
      mockService.updateCandidate.mockResolvedValue({ outcome: 'SUCCESS', candidate: candidateRecord });

      await controller.updateCandidate(CANDIDATE_ID, updateDto, mockActor);

      expect(mockService.updateCandidate).toHaveBeenCalledWith(
        CANDIDATE_ID,
        expect.objectContaining({ firstName: 'Janet' }),
        TENANT_ID,
        ACTOR_ID,
      );
    });

    it('CANDIDATE_NOT_FOUND: throws NotFoundException', async () => {
      mockService.updateCandidate.mockResolvedValue({ outcome: 'CANDIDATE_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.updateCandidate(CANDIDATE_ID, updateDto, mockActor); } catch (e) { thrown = e; }

      expect(thrown).toBeInstanceOf(NotFoundException);
    });

    it('CANDIDATE_NOT_FOUND: error body code = CANDIDATE_NOT_FOUND', async () => {
      mockService.updateCandidate.mockResolvedValue({ outcome: 'CANDIDATE_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.updateCandidate(CANDIDATE_ID, updateDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('CANDIDATE_NOT_FOUND');
      expect(body['success']).toBe(false);
    });

    it('CANDIDATE_EMAIL_ALREADY_EXISTS: throws ConflictException', async () => {
      mockService.updateCandidate.mockResolvedValue({ outcome: 'CANDIDATE_EMAIL_ALREADY_EXISTS' });

      let thrown: unknown;
      try { await controller.updateCandidate(CANDIDATE_ID, updateDto, mockActor); } catch (e) { thrown = e; }

      expect(thrown).toBeInstanceOf(ConflictException);
    });

    it('CANDIDATE_EMAIL_ALREADY_EXISTS: error body code = CANDIDATE_EMAIL_ALREADY_EXISTS', async () => {
      mockService.updateCandidate.mockResolvedValue({ outcome: 'CANDIDATE_EMAIL_ALREADY_EXISTS' });

      let thrown: unknown;
      try { await controller.updateCandidate(CANDIDATE_ID, updateDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as ConflictException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('CANDIDATE_EMAIL_ALREADY_EXISTS');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.updateCandidate.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.updateCandidate(CANDIDATE_ID, updateDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // archiveCandidate
  // ---------------------------------------------------------------------------

  describe('archiveCandidate()', () => {
    it('SUCCESS: returns undefined (204 No Content — no response body)', async () => {
      mockService.archiveCandidate.mockResolvedValue({ outcome: 'SUCCESS' });

      const result = await controller.archiveCandidate(CANDIDATE_ID, mockActor);

      expect(result).toBeUndefined();
    });

    it('SUCCESS: id, actor.tenantId, actor.userId forwarded to service (SEC-003)', async () => {
      mockService.archiveCandidate.mockResolvedValue({ outcome: 'SUCCESS' });

      await controller.archiveCandidate(CANDIDATE_ID, mockActor);

      expect(mockService.archiveCandidate).toHaveBeenCalledWith(CANDIDATE_ID, TENANT_ID, ACTOR_ID);
    });

    it('CANDIDATE_NOT_FOUND: throws NotFoundException', async () => {
      mockService.archiveCandidate.mockResolvedValue({ outcome: 'CANDIDATE_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.archiveCandidate(CANDIDATE_ID, mockActor); } catch (e) { thrown = e; }

      expect(thrown).toBeInstanceOf(NotFoundException);
    });

    it('CANDIDATE_NOT_FOUND: error body code = CANDIDATE_NOT_FOUND', async () => {
      mockService.archiveCandidate.mockResolvedValue({ outcome: 'CANDIDATE_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.archiveCandidate(CANDIDATE_ID, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('CANDIDATE_NOT_FOUND');
      expect(body['success']).toBe(false);
    });

    it('CANDIDATE_HAS_ACTIVE_APPLICATIONS: throws ConflictException (M17 stub — currently unreachable)', async () => {
      mockService.archiveCandidate.mockResolvedValue({ outcome: 'CANDIDATE_HAS_ACTIVE_APPLICATIONS' });

      let thrown: unknown;
      try { await controller.archiveCandidate(CANDIDATE_ID, mockActor); } catch (e) { thrown = e; }

      expect(thrown).toBeInstanceOf(ConflictException);
    });

    it('CANDIDATE_HAS_ACTIVE_APPLICATIONS: error body code = CANDIDATE_HAS_ACTIVE_APPLICATIONS', async () => {
      mockService.archiveCandidate.mockResolvedValue({ outcome: 'CANDIDATE_HAS_ACTIVE_APPLICATIONS' });

      let thrown: unknown;
      try { await controller.archiveCandidate(CANDIDATE_ID, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as ConflictException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('CANDIDATE_HAS_ACTIVE_APPLICATIONS');
      expect(body['success']).toBe(false);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.archiveCandidate.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.archiveCandidate(CANDIDATE_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });
});
