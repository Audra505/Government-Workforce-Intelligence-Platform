// Reference: spec/01_requirements.md — FR-400 Vacancy Management
// Reference: directives/03_vacancy_management_rules.md — VAC-001 through VAC-702
// Reference: directives/08_audit_rules.md — AUD-400
//
// Pure unit tests — no database.
// PrismaService and AuditService replaced with jest.fn() mocks.
// Verifies all discriminated-union outcomes for each VacancyService method.
// SEC-003 tenant isolation: tenantId and deletedAt: null always present in where clauses.
// Lifecycle state machine: all invalid transitions verified to return correct outcomes.
// Audit events: correct event type, order, and entity verified per AUD-400.

import { Test, type TestingModule } from '@nestjs/testing';

import { VacancyService } from './vacancy.service';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import type { CreateVacancyParams, UpdateVacancyParams } from './vacancy.service';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID    = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const POSITION_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const DEPT_ID     = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const VACANCY_ID  = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-01-02T00:00:00.000Z');

const VACANCY_ROW = {
  id: VACANCY_ID,
  tenantId: TENANT_ID,
  positionId: POSITION_ID,
  priority: null as string | null,
  reason: null as string | null,
  status: 'DRAFT',
  expectedFillDate: null as Date | null,
  filledAt: null as Date | null,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  position: {
    title: 'HR Specialist',
    department: {
      id: DEPT_ID,
      name: 'Human Resources',
    },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VacancyService', () => {
  let service: VacancyService;

  const mockPrisma = {
    position: {
      findFirst: jest.fn(),
    },
    vacancy: {
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
        VacancyService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<VacancyService>(VacancyService);
  });

  // ---------------------------------------------------------------------------
  // createVacancy
  // ---------------------------------------------------------------------------

  describe('createVacancy()', () => {
    it('valid ACTIVE position → outcome SUCCESS with VacancyRecord', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID });
      mockPrisma.vacancy.create.mockResolvedValue(VACANCY_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.createVacancy(
        { positionId: POSITION_ID } as CreateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.vacancy.id).toBe(VACANCY_ID);
        expect(result.vacancy.status).toBe('DRAFT');
        expect(result.vacancy.positionTitle).toBe('HR Specialist');
        expect(result.vacancy.departmentId).toBe(DEPT_ID);
        expect(result.vacancy.departmentName).toBe('Human Resources');
      }
    });

    it('create data always sets status: "DRAFT" (VAC-001)', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID });
      mockPrisma.vacancy.create.mockResolvedValue(VACANCY_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createVacancy(
        { positionId: POSITION_ID } as CreateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockPrisma.vacancy.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DRAFT' }),
        }),
      );
    });

    it('create data always includes tenantId from auth context, never from params (SEC-003)', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID });
      mockPrisma.vacancy.create.mockResolvedValue(VACANCY_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createVacancy(
        { positionId: POSITION_ID } as CreateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockPrisma.vacancy.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: TENANT_ID }),
        }),
      );
    });

    it('position not found or cross-tenant → outcome POSITION_NOT_ELIGIBLE (SEC-003)', async () => {
      mockPrisma.position.findFirst.mockResolvedValue(null);

      const result = await service.createVacancy(
        { positionId: POSITION_ID } as CreateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('POSITION_NOT_ELIGIBLE');
    });

    it('position validation applies tenantId, deletedAt: null, and status: "ACTIVE" (VAC-101/VAC-102/SEC-003)', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID });
      mockPrisma.vacancy.create.mockResolvedValue(VACANCY_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createVacancy(
        { positionId: POSITION_ID } as CreateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockPrisma.position.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: POSITION_ID,
            tenantId: TENANT_ID,
            deletedAt: null,
            status: 'ACTIVE',
          }),
        }),
      );
    });

    it('position Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.position.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await service.createVacancy(
        { positionId: POSITION_ID } as CreateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('vacancy create Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID });
      mockPrisma.vacancy.create.mockRejectedValue(new Error('DB error'));

      const result = await service.createVacancy(
        { positionId: POSITION_ID } as CreateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('WORKFORCE_VACANCY_CREATED audit event emitted after successful create (AUD-400)', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID });
      mockPrisma.vacancy.create.mockResolvedValue(VACANCY_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createVacancy(
        { positionId: POSITION_ID } as CreateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.WORKFORCE_VACANCY_CREATED,
          tenantId: TENANT_ID,
          userId: ACTOR_ID,
          entityType: 'VACANCY',
          entityId: VACANCY_ID,
        }),
      );
    });

    it('audit event NOT emitted when outcome is POSITION_NOT_ELIGIBLE', async () => {
      mockPrisma.position.findFirst.mockResolvedValue(null);

      await service.createVacancy(
        { positionId: POSITION_ID } as CreateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('VacancyRecord includes computed ageInDays = 0 for vacancy created today', async () => {
      const nowRow = { ...VACANCY_ROW, createdAt: new Date() };
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID });
      mockPrisma.vacancy.create.mockResolvedValue(nowRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.createVacancy(
        { positionId: POSITION_ID } as CreateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      if (result.outcome === 'SUCCESS') {
        expect(result.vacancy.ageInDays).toBe(0);
        expect(result.vacancy.agingStatus).toBe('OK');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // listVacancies
  // ---------------------------------------------------------------------------

  describe('listVacancies()', () => {
    it('returns SUCCESS with vacancies array and correct pagination metadata', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([VACANCY_ROW]);
      mockPrisma.vacancy.count.mockResolvedValue(1);

      const result = await service.listVacancies(TENANT_ID, { page: 1, pageSize: 20 });

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.vacancies).toHaveLength(1);
        expect(result.total).toBe(1);
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(20);
      }
    });

    it('returns SUCCESS with empty array when no vacancies match', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([]);
      mockPrisma.vacancy.count.mockResolvedValue(0);

      const result = await service.listVacancies(TENANT_ID, {});

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.vacancies).toHaveLength(0);
        expect(result.total).toBe(0);
      }
    });

    it('skip = (page - 1) * pageSize', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([]);
      mockPrisma.vacancy.count.mockResolvedValue(0);

      await service.listVacancies(TENANT_ID, { page: 3, pageSize: 10 });

      expect(mockPrisma.vacancy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('where clause always includes tenantId and deletedAt: null (SEC-003)', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([]);
      mockPrisma.vacancy.count.mockResolvedValue(0);

      await service.listVacancies(TENANT_ID, {});

      expect(mockPrisma.vacancy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_ID, deletedAt: null }),
        }),
      );
    });

    it('status filter included in where clause when provided', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([]);
      mockPrisma.vacancy.count.mockResolvedValue(0);

      await service.listVacancies(TENANT_ID, { status: 'OPEN' });

      expect(mockPrisma.vacancy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'OPEN' }),
        }),
      );
    });

    it('priority filter included in where clause when provided', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([]);
      mockPrisma.vacancy.count.mockResolvedValue(0);

      await service.listVacancies(TENANT_ID, { priority: 'CRITICAL' });

      expect(mockPrisma.vacancy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ priority: 'CRITICAL' }),
        }),
      );
    });

    it('departmentId filter uses nested position relation — not a direct vacancy column', async () => {
      mockPrisma.vacancy.findMany.mockResolvedValue([]);
      mockPrisma.vacancy.count.mockResolvedValue(0);

      await service.listVacancies(TENANT_ID, { departmentId: DEPT_ID });

      expect(mockPrisma.vacancy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            position: { departmentId: DEPT_ID },
          }),
        }),
      );
    });

    it('Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.vacancy.findMany.mockRejectedValue(new Error('DB error'));

      const result = await service.listVacancies(TENANT_ID, {});

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // getVacancyById
  // ---------------------------------------------------------------------------

  describe('getVacancyById()', () => {
    it('vacancy found → outcome SUCCESS with VacancyRecord', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue(VACANCY_ROW);

      const result = await service.getVacancyById(VACANCY_ID, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.vacancy.id).toBe(VACANCY_ID);
        expect(result.vacancy.positionTitle).toBe('HR Specialist');
        expect(result.vacancy.departmentName).toBe('Human Resources');
      }
    });

    it('findFirst returns null (absent or cross-tenant) → outcome NOT_FOUND (SEC-003)', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue(null);

      const result = await service.getVacancyById(VACANCY_ID, TENANT_ID);

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('findFirst where clause includes id, tenantId, and deletedAt: null (SEC-003)', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue(VACANCY_ROW);

      await service.getVacancyById(VACANCY_ID, TENANT_ID);

      expect(mockPrisma.vacancy.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: VACANCY_ID,
            tenantId: TENANT_ID,
            deletedAt: null,
          }),
        }),
      );
    });

    it('Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.vacancy.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await service.getVacancyById(VACANCY_ID, TENANT_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // updateVacancy
  // ---------------------------------------------------------------------------

  describe('updateVacancy()', () => {
    it('vacancy found → outcome SUCCESS with updated VacancyRecord', async () => {
      const updatedRow = { ...VACANCY_ROW, priority: 'HIGH' };
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'DRAFT' });
      mockPrisma.vacancy.update.mockResolvedValue(updatedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.updateVacancy(
        VACANCY_ID,
        { priority: 'HIGH' } as UpdateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.vacancy.priority).toBe('HIGH');
      }
    });

    it('findFirst returns null → outcome NOT_FOUND', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue(null);

      const result = await service.updateVacancy(
        VACANCY_ID,
        { priority: 'HIGH' } as UpdateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('existing.status === "CLOSED" → outcome VACANCY_CLOSED (VAC-501)', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'CLOSED' });

      const result = await service.updateVacancy(
        VACANCY_ID,
        { priority: 'HIGH' } as UpdateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('VACANCY_CLOSED');
    });

    it('reason included in update data when status is DRAFT', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'DRAFT' });
      mockPrisma.vacancy.update.mockResolvedValue(VACANCY_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateVacancy(
        VACANCY_ID,
        { reason: 'Retirement' } as UpdateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      const callData = (mockPrisma.vacancy.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
      expect(callData).toHaveProperty('reason', 'Retirement');
    });

    it('reason excluded from update data when status is OPEN (locked after DRAFT)', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'OPEN' });
      mockPrisma.vacancy.update.mockResolvedValue({ ...VACANCY_ROW, status: 'OPEN' });
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateVacancy(
        VACANCY_ID,
        { reason: 'Should be ignored' } as UpdateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      const callData = (mockPrisma.vacancy.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
      expect(callData).not.toHaveProperty('reason');
    });

    it('reason excluded from update data when status is IN_RECRUITMENT', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'IN_RECRUITMENT' });
      mockPrisma.vacancy.update.mockResolvedValue({ ...VACANCY_ROW, status: 'IN_RECRUITMENT' });
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateVacancy(
        VACANCY_ID,
        { reason: 'Should be ignored' } as UpdateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      const callData = (mockPrisma.vacancy.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
      expect(callData).not.toHaveProperty('reason');
    });

    it('WORKFORCE_VACANCY_UPDATED audit event emitted after successful update (AUD-400)', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'DRAFT' });
      mockPrisma.vacancy.update.mockResolvedValue(VACANCY_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateVacancy(
        VACANCY_ID,
        { priority: 'LOW' } as UpdateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.WORKFORCE_VACANCY_UPDATED,
          tenantId: TENANT_ID,
          userId: ACTOR_ID,
          entityType: 'VACANCY',
          entityId: VACANCY_ID,
        }),
      );
    });

    it('audit event NOT emitted when outcome is NOT_FOUND', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue(null);

      await service.updateVacancy(
        VACANCY_ID,
        { priority: 'HIGH' } as UpdateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('audit event NOT emitted when outcome is VACANCY_CLOSED', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'CLOSED' });

      await service.updateVacancy(
        VACANCY_ID,
        { priority: 'HIGH' } as UpdateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('Prisma update throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'DRAFT' });
      mockPrisma.vacancy.update.mockRejectedValue(new Error('DB error'));

      const result = await service.updateVacancy(
        VACANCY_ID,
        { priority: 'HIGH' } as UpdateVacancyParams,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // openVacancy
  // ---------------------------------------------------------------------------

  describe('openVacancy()', () => {
    it('DRAFT vacancy → outcome SUCCESS with status OPEN', async () => {
      const openedRow = { ...VACANCY_ROW, status: 'OPEN' };
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'DRAFT' });
      mockPrisma.vacancy.update.mockResolvedValue(openedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.openVacancy(VACANCY_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.vacancy.status).toBe('OPEN');
      }
    });

    it('findFirst returns null → outcome NOT_FOUND', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue(null);

      const result = await service.openVacancy(VACANCY_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('status === "CLOSED" → outcome VACANCY_CLOSED', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'CLOSED' });

      const result = await service.openVacancy(VACANCY_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('VACANCY_CLOSED');
    });

    it('status === "OPEN" → outcome INVALID_TRANSITION (already open)', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'OPEN' });

      const result = await service.openVacancy(VACANCY_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INVALID_TRANSITION');
    });

    it('status === "IN_RECRUITMENT" → outcome INVALID_TRANSITION', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'IN_RECRUITMENT' });

      const result = await service.openVacancy(VACANCY_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INVALID_TRANSITION');
    });

    it('update data sets status: "OPEN"', async () => {
      const openedRow = { ...VACANCY_ROW, status: 'OPEN' };
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'DRAFT' });
      mockPrisma.vacancy.update.mockResolvedValue(openedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.openVacancy(VACANCY_ID, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.vacancy.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'OPEN' }),
        }),
      );
    });

    it('WORKFORCE_VACANCY_OPENED audit event emitted after successful open (AUD-400)', async () => {
      const openedRow = { ...VACANCY_ROW, status: 'OPEN' };
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'DRAFT' });
      mockPrisma.vacancy.update.mockResolvedValue(openedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.openVacancy(VACANCY_ID, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.WORKFORCE_VACANCY_OPENED,
          tenantId: TENANT_ID,
          userId: ACTOR_ID,
          entityType: 'VACANCY',
          entityId: VACANCY_ID,
        }),
      );
    });

    it('Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'DRAFT' });
      mockPrisma.vacancy.update.mockRejectedValue(new Error('DB error'));

      const result = await service.openVacancy(VACANCY_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // closeVacancy — FILLED path
  // ---------------------------------------------------------------------------

  describe('closeVacancy(FILLED)', () => {
    it('OPEN vacancy → outcome SUCCESS with status CLOSED and filledAt set', async () => {
      const closedRow = { ...VACANCY_ROW, status: 'CLOSED', filledAt: new Date() };
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'OPEN' });
      mockPrisma.vacancy.update.mockResolvedValue(closedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.closeVacancy(VACANCY_ID, 'FILLED', TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.vacancy.status).toBe('CLOSED');
        expect(result.vacancy.filledAt).not.toBeNull();
      }
    });

    it('IN_RECRUITMENT vacancy → outcome SUCCESS (valid FILLED source state)', async () => {
      const closedRow = { ...VACANCY_ROW, status: 'CLOSED', filledAt: new Date() };
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'IN_RECRUITMENT' });
      mockPrisma.vacancy.update.mockResolvedValue(closedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.closeVacancy(VACANCY_ID, 'FILLED', TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('DRAFT vacancy → outcome INVALID_TRANSITION (no hire from unopened vacancy, VAC-300)', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'DRAFT' });

      const result = await service.closeVacancy(VACANCY_ID, 'FILLED', TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INVALID_TRANSITION');
    });

    it('CLOSED vacancy → outcome VACANCY_CLOSED (VAC-501)', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'CLOSED' });

      const result = await service.closeVacancy(VACANCY_ID, 'FILLED', TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('VACANCY_CLOSED');
    });

    it('findFirst returns null → outcome NOT_FOUND', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue(null);

      const result = await service.closeVacancy(VACANCY_ID, 'FILLED', TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('update data includes status: "CLOSED" and filledAt: Date when closureType is FILLED', async () => {
      const closedRow = { ...VACANCY_ROW, status: 'CLOSED', filledAt: new Date() };
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'OPEN' });
      mockPrisma.vacancy.update.mockResolvedValue(closedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.closeVacancy(VACANCY_ID, 'FILLED', TENANT_ID, ACTOR_ID);

      const callData = (mockPrisma.vacancy.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
      expect(callData).toHaveProperty('status', 'CLOSED');
      expect(callData).toHaveProperty('filledAt');
      expect(callData['filledAt']).toBeInstanceOf(Date);
    });

    it('WORKFORCE_VACANCY_FILLED emitted before WORKFORCE_VACANCY_CLOSED — two total emits (AUD-400)', async () => {
      const closedRow = { ...VACANCY_ROW, status: 'CLOSED', filledAt: new Date() };
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'OPEN' });
      mockPrisma.vacancy.update.mockResolvedValue(closedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.closeVacancy(VACANCY_ID, 'FILLED', TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledTimes(2);
      const calls = mockAuditService.logEvent.mock.calls as [[{ action: AuditEventType }], [{ action: AuditEventType }]];
      expect(calls[0][0].action).toBe(AuditEventType.WORKFORCE_VACANCY_FILLED);
      expect(calls[1][0].action).toBe(AuditEventType.WORKFORCE_VACANCY_CLOSED);
    });

    it('Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'OPEN' });
      mockPrisma.vacancy.update.mockRejectedValue(new Error('DB error'));

      const result = await service.closeVacancy(VACANCY_ID, 'FILLED', TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // closeVacancy — CANCELLED path
  // ---------------------------------------------------------------------------

  describe('closeVacancy(CANCELLED)', () => {
    it('DRAFT vacancy → outcome SUCCESS (cancellation from DRAFT is valid)', async () => {
      const closedRow = { ...VACANCY_ROW, status: 'CLOSED', filledAt: null };
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'DRAFT' });
      mockPrisma.vacancy.update.mockResolvedValue(closedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.closeVacancy(VACANCY_ID, 'CANCELLED', TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.vacancy.status).toBe('CLOSED');
        expect(result.vacancy.filledAt).toBeNull();
      }
    });

    it('OPEN vacancy → outcome SUCCESS', async () => {
      const closedRow = { ...VACANCY_ROW, status: 'CLOSED', filledAt: null };
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'OPEN' });
      mockPrisma.vacancy.update.mockResolvedValue(closedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.closeVacancy(VACANCY_ID, 'CANCELLED', TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('IN_RECRUITMENT vacancy → outcome SUCCESS', async () => {
      const closedRow = { ...VACANCY_ROW, status: 'CLOSED', filledAt: null };
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'IN_RECRUITMENT' });
      mockPrisma.vacancy.update.mockResolvedValue(closedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.closeVacancy(VACANCY_ID, 'CANCELLED', TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('CLOSED vacancy → outcome VACANCY_CLOSED (VAC-501)', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'CLOSED' });

      const result = await service.closeVacancy(VACANCY_ID, 'CANCELLED', TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('VACANCY_CLOSED');
    });

    it('update data includes status: "CLOSED" but NOT filledAt when closureType is CANCELLED', async () => {
      const closedRow = { ...VACANCY_ROW, status: 'CLOSED', filledAt: null };
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'OPEN' });
      mockPrisma.vacancy.update.mockResolvedValue(closedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.closeVacancy(VACANCY_ID, 'CANCELLED', TENANT_ID, ACTOR_ID);

      const callData = (mockPrisma.vacancy.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
      expect(callData).toHaveProperty('status', 'CLOSED');
      expect(callData).not.toHaveProperty('filledAt');
    });

    it('WORKFORCE_VACANCY_CANCELLED emitted before WORKFORCE_VACANCY_CLOSED — two total emits (AUD-400)', async () => {
      const closedRow = { ...VACANCY_ROW, status: 'CLOSED', filledAt: null };
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'OPEN' });
      mockPrisma.vacancy.update.mockResolvedValue(closedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.closeVacancy(VACANCY_ID, 'CANCELLED', TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledTimes(2);
      const calls = mockAuditService.logEvent.mock.calls as [[{ action: AuditEventType }], [{ action: AuditEventType }]];
      expect(calls[0][0].action).toBe(AuditEventType.WORKFORCE_VACANCY_CANCELLED);
      expect(calls[1][0].action).toBe(AuditEventType.WORKFORCE_VACANCY_CLOSED);
    });

    it('findFirst returns null → outcome NOT_FOUND', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue(null);

      const result = await service.closeVacancy(VACANCY_ID, 'CANCELLED', TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: 'OPEN' });
      mockPrisma.vacancy.update.mockRejectedValue(new Error('DB error'));

      const result = await service.closeVacancy(VACANCY_ID, 'CANCELLED', TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // Computed field tests (VAC-701/VAC-702 aging thresholds, VAC-201 review flag)
  // ---------------------------------------------------------------------------

  describe('computed fields', () => {
    it('ageInDays = 0 for vacancy created today', async () => {
      const nowRow = { ...VACANCY_ROW, createdAt: new Date() };
      mockPrisma.vacancy.findFirst.mockResolvedValue(nowRow);

      const result = await service.getVacancyById(VACANCY_ID, TENANT_ID);

      if (result.outcome === 'SUCCESS') {
        expect(result.vacancy.ageInDays).toBe(0);
      }
    });

    it('agingStatus = "OK" when ageInDays < 30 (VAC-701)', async () => {
      const recentDate = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
      mockPrisma.vacancy.findFirst.mockResolvedValue({ ...VACANCY_ROW, createdAt: recentDate });

      const result = await service.getVacancyById(VACANCY_ID, TENANT_ID);

      if (result.outcome === 'SUCCESS') {
        expect(result.vacancy.agingStatus).toBe('OK');
      }
    });

    it('agingStatus = "WARNING" when ageInDays >= 30 and < 90 (VAC-701)', async () => {
      const warningDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
      mockPrisma.vacancy.findFirst.mockResolvedValue({ ...VACANCY_ROW, createdAt: warningDate });

      const result = await service.getVacancyById(VACANCY_ID, TENANT_ID);

      if (result.outcome === 'SUCCESS') {
        expect(result.vacancy.agingStatus).toBe('WARNING');
      }
    });

    it('agingStatus = "HIGH_RISK" when ageInDays >= 90 (VAC-702)', async () => {
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      mockPrisma.vacancy.findFirst.mockResolvedValue({ ...VACANCY_ROW, createdAt: oldDate });

      const result = await service.getVacancyById(VACANCY_ID, TENANT_ID);

      if (result.outcome === 'SUCCESS') {
        expect(result.vacancy.agingStatus).toBe('HIGH_RISK');
      }
    });

    it('requiresReview = true when priority = "CRITICAL" and status = "OPEN" (VAC-201)', async () => {
      const criticalOpenRow = { ...VACANCY_ROW, priority: 'CRITICAL', status: 'OPEN' };
      mockPrisma.vacancy.findFirst.mockResolvedValue(criticalOpenRow);

      const result = await service.getVacancyById(VACANCY_ID, TENANT_ID);

      if (result.outcome === 'SUCCESS') {
        expect(result.vacancy.requiresReview).toBe(true);
      }
    });

    it('requiresReview = false when priority = "CRITICAL" but status is not "OPEN"', async () => {
      const criticalDraftRow = { ...VACANCY_ROW, priority: 'CRITICAL', status: 'DRAFT' };
      mockPrisma.vacancy.findFirst.mockResolvedValue(criticalDraftRow);

      const result = await service.getVacancyById(VACANCY_ID, TENANT_ID);

      if (result.outcome === 'SUCCESS') {
        expect(result.vacancy.requiresReview).toBe(false);
      }
    });

    it('requiresReview = false when status = "OPEN" but priority is not "CRITICAL"', async () => {
      const openLowRow = { ...VACANCY_ROW, priority: 'LOW', status: 'OPEN' };
      mockPrisma.vacancy.findFirst.mockResolvedValue(openLowRow);

      const result = await service.getVacancyById(VACANCY_ID, TENANT_ID);

      if (result.outcome === 'SUCCESS') {
        expect(result.vacancy.requiresReview).toBe(false);
      }
    });
  });
});
