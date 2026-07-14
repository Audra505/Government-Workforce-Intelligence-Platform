// Reference: spec/01_requirements.md — FR-103 Vacancy Management
// Reference: spec/06_api_contracts.md — Vacancy API contracts + RBAC matrix
// Reference: directives/03_vacancy_management_rules.md — VAC-001 through VAC-702
//
// Pure unit tests — no HTTP server, no database.
// VacancyService replaced with jest.fn() mocks.
// JwtAuthGuard and RolesGuard overridden to always pass.
// Controller methods called directly with mock RequestUser actor.
// Verifies: HTTP exception types, response envelope shapes, date serialization,
//           internal PUT routing, SEC-003 call signatures, error codes.

import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import { VacancyController } from './vacancy.controller';
import { VacancyService } from './vacancy.service';
import type { VacancyRecord } from './vacancy.service';
import type { RequestUser } from '../identity/jwt.strategy';
import type { CreateVacancyDto } from './dto/create-vacancy.dto';
import type { UpdateVacancyDto } from './dto/update-vacancy.dto';
import type { ListVacanciesQueryDto } from './dto/list-vacancies-query.dto';
import type { CloseVacancyDto } from './dto/close-vacancy.dto';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID    = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const VACANCY_ID  = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const POSITION_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const DEPT_ID     = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const CREATED_AT  = new Date('2026-06-17T00:00:00.000Z');
const UPDATED_AT  = new Date('2026-06-17T12:00:00.000Z');
const FILL_DATE   = new Date('2027-06-01T00:00:00.000Z');
const FILLED_AT   = new Date('2027-05-15T10:30:00.000Z');

const mockActor: RequestUser = {
  userId:    ACTOR_ID,
  tenantId:  TENANT_ID,
  email:     'admin@dev.gov',
  firstName: '',
  lastName:  '',
  roles:     ['System Administrator'],
};

const vacancyRecord: VacancyRecord = {
  id:               VACANCY_ID,
  tenantId:         TENANT_ID,
  positionId:       POSITION_ID,
  positionTitle:    'HR Specialist',
  departmentId:     DEPT_ID,
  departmentName:   'Human Resources',
  priority:         'HIGH',
  reason:           'RETIREMENT',
  status:           'DRAFT',
  expectedFillDate: FILL_DATE,
  filledAt:         null,
  createdAt:        CREATED_AT,
  updatedAt:        UPDATED_AT,
  ageInDays:        0,
  agingStatus:      'OK',
  requiresReview:   false,
};

const createDto: CreateVacancyDto = {
  positionId:       POSITION_ID,
  priority:         'HIGH',
  reason:           'RETIREMENT',
  expectedFillDate: '2027-06-01',
};

const updateDto: UpdateVacancyDto = { priority: 'CRITICAL' };
const openDto: UpdateVacancyDto   = { status: 'OPEN' };
const listQuery: ListVacanciesQueryDto = { page: 1, pageSize: 20 };
const closeDto: CloseVacancyDto   = { closureType: 'FILLED' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VacancyController', () => {
  let controller: VacancyController;
  let mockService: {
    createVacancy:  jest.Mock;
    listVacancies:  jest.Mock;
    getVacancyById: jest.Mock;
    updateVacancy:  jest.Mock;
    openVacancy:    jest.Mock;
    closeVacancy:   jest.Mock;
  };

  beforeEach(async () => {
    mockService = {
      createVacancy:  jest.fn(),
      listVacancies:  jest.fn(),
      getVacancyById: jest.fn(),
      updateVacancy:  jest.fn(),
      openVacancy:    jest.fn(),
      closeVacancy:   jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VacancyController],
      providers: [
        { provide: VacancyService, useValue: mockService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<VacancyController>(VacancyController);
  });

  afterEach(() => jest.clearAllMocks());

  // --------------------------------------------------------------------------
  // createVacancy()
  // --------------------------------------------------------------------------

  describe('createVacancy()', () => {
    it('SUCCESS: returns { success: true, data: vacancy shape }', async () => {
      mockService.createVacancy.mockResolvedValue({ outcome: 'SUCCESS', vacancy: vacancyRecord });

      const result = await controller.createVacancy(createDto, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect((result['data'] as Record<string, unknown>)['id']).toBe(VACANCY_ID);
    });

    it('SUCCESS: Date fields serialized as ISO 8601 strings', async () => {
      mockService.createVacancy.mockResolvedValue({ outcome: 'SUCCESS', vacancy: vacancyRecord });

      const result = await controller.createVacancy(createDto, mockActor) as Record<string, Record<string, unknown>>;
      const data = result['data']!;

      expect(data['createdAt']).toBe(CREATED_AT.toISOString());
      expect(data['updatedAt']).toBe(UPDATED_AT.toISOString());
      expect(data['expectedFillDate']).toBe(FILL_DATE.toISOString());
      expect(data['filledAt']).toBeNull();
    });

    it('SUCCESS: SEC-003 — params + tenantId + actorId passed from JWT, not from DTO', async () => {
      mockService.createVacancy.mockResolvedValue({ outcome: 'SUCCESS', vacancy: vacancyRecord });

      await controller.createVacancy(createDto, mockActor);

      expect(mockService.createVacancy).toHaveBeenCalledWith(
        expect.objectContaining({ positionId: POSITION_ID }),
        TENANT_ID,
        ACTOR_ID,
      );
    });

    it('POSITION_NOT_ELIGIBLE: throws UnprocessableEntityException (422)', async () => {
      mockService.createVacancy.mockResolvedValue({ outcome: 'POSITION_NOT_ELIGIBLE' });

      await expect(controller.createVacancy(createDto, mockActor))
        .rejects.toThrow(UnprocessableEntityException);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException (500)', async () => {
      mockService.createVacancy.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.createVacancy(createDto, mockActor))
        .rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // listVacancies()
  // --------------------------------------------------------------------------

  describe('listVacancies()', () => {
    it('SUCCESS: returns { success: true, data: { vacancies, total, page, pageSize, totalPages } }', async () => {
      mockService.listVacancies.mockResolvedValue({
        outcome:   'SUCCESS',
        vacancies: [vacancyRecord],
        total:     1,
        page:      1,
        pageSize:  20,
      });

      const result = await controller.listVacancies(listQuery, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']!['total']).toBe(1);
      expect(result['data']!['page']).toBe(1);
      expect(result['data']!['pageSize']).toBe(20);
      expect((result['data']!['vacancies'] as unknown[]).length).toBe(1);
    });

    it('SUCCESS: totalPages = Math.ceil(total / pageSize)', async () => {
      mockService.listVacancies.mockResolvedValue({
        outcome:   'SUCCESS',
        vacancies: [],
        total:     25,
        page:      1,
        pageSize:  10,
      });

      const result = await controller.listVacancies(listQuery, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']!['totalPages']).toBe(3);
    });

    it('SUCCESS: vacancies array items are mapped through toVacancyShape', async () => {
      mockService.listVacancies.mockResolvedValue({
        outcome:   'SUCCESS',
        vacancies: [vacancyRecord],
        total:     1,
        page:      1,
        pageSize:  20,
      });

      const result = await controller.listVacancies(listQuery, mockActor) as Record<string, Record<string, unknown>>;
      const first = (result['data']!['vacancies'] as Record<string, unknown>[])[0]!;

      expect(first['id']).toBe(VACANCY_ID);
      expect(first['ageInDays']).toBe(0);
      expect(first['agingStatus']).toBe('OK');
      expect(first['requiresReview']).toBe(false);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException (500)', async () => {
      mockService.listVacancies.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.listVacancies(listQuery, mockActor))
        .rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // getVacancyById()
  // --------------------------------------------------------------------------

  describe('getVacancyById()', () => {
    it('SUCCESS: returns { success: true, data: vacancy shape }', async () => {
      mockService.getVacancyById.mockResolvedValue({ outcome: 'SUCCESS', vacancy: vacancyRecord });

      const result = await controller.getVacancyById(VACANCY_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']!['id']).toBe(VACANCY_ID);
    });

    it('SUCCESS: SEC-003 — id and actor.tenantId from JWT passed to service', async () => {
      mockService.getVacancyById.mockResolvedValue({ outcome: 'SUCCESS', vacancy: vacancyRecord });

      await controller.getVacancyById(VACANCY_ID, mockActor);

      expect(mockService.getVacancyById).toHaveBeenCalledWith(VACANCY_ID, TENANT_ID);
    });

    it('NOT_FOUND: throws NotFoundException (404)', async () => {
      mockService.getVacancyById.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(controller.getVacancyById(VACANCY_ID, mockActor))
        .rejects.toThrow(NotFoundException);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException (500)', async () => {
      mockService.getVacancyById.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.getVacancyById(VACANCY_ID, mockActor))
        .rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // updateVacancy() — updateVacancy() service path (no status field in dto)
  // --------------------------------------------------------------------------

  describe('updateVacancy() — updateVacancy service path', () => {
    it('SUCCESS: returns updated vacancy shape', async () => {
      const updated = { ...vacancyRecord, priority: 'CRITICAL' };
      mockService.updateVacancy.mockResolvedValue({ outcome: 'SUCCESS', vacancy: updated });

      const result = await controller.updateVacancy(VACANCY_ID, updateDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']!['id']).toBe(VACANCY_ID);
    });

    it('NOT_FOUND: throws NotFoundException (404)', async () => {
      mockService.updateVacancy.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(controller.updateVacancy(VACANCY_ID, updateDto, mockActor))
        .rejects.toThrow(NotFoundException);
    });

    it('VACANCY_CLOSED: throws ConflictException (409)', async () => {
      mockService.updateVacancy.mockResolvedValue({ outcome: 'VACANCY_CLOSED' });

      await expect(controller.updateVacancy(VACANCY_ID, updateDto, mockActor))
        .rejects.toThrow(ConflictException);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException (500)', async () => {
      mockService.updateVacancy.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.updateVacancy(VACANCY_ID, updateDto, mockActor))
        .rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // updateVacancy() — openVacancy() service path (dto.status === 'OPEN')
  // --------------------------------------------------------------------------

  describe('updateVacancy() — openVacancy service path', () => {
    it('SUCCESS: returns opened vacancy shape', async () => {
      const opened = { ...vacancyRecord, status: 'OPEN' };
      mockService.openVacancy.mockResolvedValue({ outcome: 'SUCCESS', vacancy: opened });

      const result = await controller.updateVacancy(VACANCY_ID, openDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']!['id']).toBe(VACANCY_ID);
    });

    it('NOT_FOUND: throws NotFoundException (404)', async () => {
      mockService.openVacancy.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(controller.updateVacancy(VACANCY_ID, openDto, mockActor))
        .rejects.toThrow(NotFoundException);
    });

    it('VACANCY_CLOSED: throws ConflictException (409)', async () => {
      mockService.openVacancy.mockResolvedValue({ outcome: 'VACANCY_CLOSED' });

      await expect(controller.updateVacancy(VACANCY_ID, openDto, mockActor))
        .rejects.toThrow(ConflictException);
    });

    it('INVALID_TRANSITION: throws ConflictException (409)', async () => {
      mockService.openVacancy.mockResolvedValue({ outcome: 'INVALID_TRANSITION' });

      await expect(controller.updateVacancy(VACANCY_ID, openDto, mockActor))
        .rejects.toThrow(ConflictException);
    });
  });

  // --------------------------------------------------------------------------
  // updateVacancy() — internal routing
  // --------------------------------------------------------------------------

  describe('updateVacancy() — PUT internal routing', () => {
    it('dto.status === "OPEN" routes to openVacancy(), not updateVacancy()', async () => {
      mockService.openVacancy.mockResolvedValue({ outcome: 'SUCCESS', vacancy: vacancyRecord });

      await controller.updateVacancy(VACANCY_ID, openDto, mockActor);

      expect(mockService.openVacancy).toHaveBeenCalledWith(VACANCY_ID, TENANT_ID, ACTOR_ID);
      expect(mockService.updateVacancy).not.toHaveBeenCalled();
    });

    it('dto without status routes to updateVacancy(), not openVacancy()', async () => {
      mockService.updateVacancy.mockResolvedValue({ outcome: 'SUCCESS', vacancy: vacancyRecord });

      await controller.updateVacancy(VACANCY_ID, updateDto, mockActor);

      expect(mockService.updateVacancy).toHaveBeenCalled();
      expect(mockService.openVacancy).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // closeVacancy()
  // --------------------------------------------------------------------------

  describe('closeVacancy()', () => {
    it('SUCCESS (FILLED): filledAt serialized as ISO 8601 string', async () => {
      const filled = { ...vacancyRecord, status: 'CLOSED', filledAt: FILLED_AT };
      mockService.closeVacancy.mockResolvedValue({ outcome: 'SUCCESS', vacancy: filled });

      const result = await controller.closeVacancy(VACANCY_ID, closeDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']!['filledAt']).toBe(FILLED_AT.toISOString());
      expect(result['data']!['status']).toBe('CLOSED');
    });

    it('SUCCESS (CANCELLED): filledAt is null', async () => {
      const cancelled = { ...vacancyRecord, status: 'CLOSED', filledAt: null };
      mockService.closeVacancy.mockResolvedValue({ outcome: 'SUCCESS', vacancy: cancelled });
      const cancelDto: CloseVacancyDto = { closureType: 'CANCELLED' };

      const result = await controller.closeVacancy(VACANCY_ID, cancelDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']!['filledAt']).toBeNull();
    });

    it('SUCCESS: SEC-003 — id, closureType, tenantId, actorId passed to service from JWT', async () => {
      mockService.closeVacancy.mockResolvedValue({ outcome: 'SUCCESS', vacancy: vacancyRecord });

      await controller.closeVacancy(VACANCY_ID, closeDto, mockActor);

      expect(mockService.closeVacancy).toHaveBeenCalledWith(VACANCY_ID, 'FILLED', TENANT_ID, ACTOR_ID);
    });

    it('NOT_FOUND: throws NotFoundException (404)', async () => {
      mockService.closeVacancy.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(controller.closeVacancy(VACANCY_ID, closeDto, mockActor))
        .rejects.toThrow(NotFoundException);
    });

    it('VACANCY_CLOSED: throws ConflictException (409)', async () => {
      mockService.closeVacancy.mockResolvedValue({ outcome: 'VACANCY_CLOSED' });

      await expect(controller.closeVacancy(VACANCY_ID, closeDto, mockActor))
        .rejects.toThrow(ConflictException);
    });

    it('INVALID_TRANSITION: throws ConflictException (409)', async () => {
      mockService.closeVacancy.mockResolvedValue({ outcome: 'INVALID_TRANSITION' });

      await expect(controller.closeVacancy(VACANCY_ID, closeDto, mockActor))
        .rejects.toThrow(ConflictException);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException (500)', async () => {
      mockService.closeVacancy.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.closeVacancy(VACANCY_ID, closeDto, mockActor))
        .rejects.toThrow(InternalServerErrorException);
    });
  });
});
