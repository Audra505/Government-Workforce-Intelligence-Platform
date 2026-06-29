// Reference: spec/01_requirements.md — FR-301 through FR-306 Application Management
// Reference: governance/GD-M17-1.md — Decisions 6–16
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (SEC-003 tenant isolation)
//
// Pure unit tests — no database.
// PrismaService and AuditService replaced with jest.fn() mocks.
// Verifies all discriminated-union outcomes for each ApplicationService method.
// SEC-003 tenant isolation: tenantId always present in where clauses; cross-tenant = NOT_FOUND.
// Duplicate prevention: pre-check + partial unique index (P2002) (GD-M17-1 D7).
// VAC-301: OPEN vacancy transitions to IN_RECRUITMENT on first application (GD-M17-1 D8).
// Status machine (GD-M17-1 D10, Option B): APPLIED→SCREENING→INTERVIEW→EVALUATION→OFFER.
// Terminal states: REJECTED and WITHDRAWN block further transitions.
// HIRED unreachable in M17 — reserved for M19.
// PII safety: notes text, vacancy descriptions, candidate names must not appear in audit metadata.

import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { ApplicationService } from './application.service';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import type { CreateApplicationParams, UpdateApplicationParams } from './application.service';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID      = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_TENANT   = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const ACTOR_ID       = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CANDIDATE_ID   = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const VACANCY_ID     = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const APPLICATION_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const SUBMITTED_AT = new Date('2026-06-29T00:00:00.000Z');
const CREATED_AT   = new Date('2026-06-29T00:00:00.000Z');
const UPDATED_AT   = new Date('2026-06-29T01:00:00.000Z');

const CANDIDATE_ROW_ACTIVE = {
  id: CANDIDATE_ID,
  status: 'ACTIVE',
  deletedAt: null as Date | null,
};

const VACANCY_ROW_OPEN = { id: VACANCY_ID, status: 'OPEN' };
const VACANCY_ROW_IN_RECRUITMENT = { id: VACANCY_ID, status: 'IN_RECRUITMENT' };

function makeApplicationRow(statusOverride = 'APPLIED') {
  return {
    id: APPLICATION_ID,
    tenantId: TENANT_ID,
    candidateId: CANDIDATE_ID,
    vacancyId: VACANCY_ID,
    status: statusOverride,
    submittedAt: SUBMITTED_AT,
    currentStage: null as string | null,
    notes: null as string | null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  };
}

const CREATE_PARAMS: CreateApplicationParams = {
  candidateId: CANDIDATE_ID,
  vacancyId: VACANCY_ID,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ApplicationService', () => {
  let service: ApplicationService;

  const mockPrisma = {
    candidate: {
      findFirst: jest.fn(),
    },
    vacancy: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    application: {
      create:    jest.fn(),
      findFirst: jest.fn(),
      findMany:  jest.fn(),
      count:     jest.fn(),
      update:    jest.fn(),
    },
  };
  const mockAuditService = { logEvent: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApplicationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<ApplicationService>(ApplicationService);
  });

  // ---------------------------------------------------------------------------
  // createApplication
  // ---------------------------------------------------------------------------

  describe('createApplication()', () => {
    function setupHappyPath(vacancyRow = VACANCY_ROW_OPEN) {
      mockPrisma.candidate.findFirst.mockResolvedValue(CANDIDATE_ROW_ACTIVE);
      mockPrisma.vacancy.findFirst.mockResolvedValue(vacancyRow);
      mockPrisma.application.findFirst.mockResolvedValue(null);   // no duplicate
      mockPrisma.application.create.mockResolvedValue(makeApplicationRow());
      mockPrisma.vacancy.updateMany.mockResolvedValue({ count: 1 });
      mockAuditService.logEvent.mockResolvedValue(undefined);
    }

    it('success with OPEN vacancy → outcome SUCCESS, status APPLIED, VAC-301 transitions vacancy', async () => {
      setupHappyPath();

      const result = await service.createApplication(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.application.status).toBe('APPLIED');
        expect(result.application.candidateId).toBe(CANDIDATE_ID);
        expect(result.application.vacancyId).toBe(VACANCY_ID);
      }
    });

    it('create data always sets status: "APPLIED" — never from caller (GD-PRE-PHASE3-002 D2)', async () => {
      setupHappyPath();

      await service.createApplication(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.application.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APPLIED' }),
        }),
      );
    });

    it('create data includes tenantId from caller — never from params (SEC-003)', async () => {
      setupHappyPath();

      await service.createApplication(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.application.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: TENANT_ID }),
        }),
      );
    });

    it('candidate not found (absent or cross-tenant) → CANDIDATE_NOT_FOUND, no write', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(null);

      const result = await service.createApplication(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('CANDIDATE_NOT_FOUND');
      expect(mockPrisma.application.create).not.toHaveBeenCalled();
    });

    it('cross-tenant candidate (findFirst null via tenantId filter) → CANDIDATE_NOT_FOUND (SEC-003)', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(null);

      const result = await service.createApplication(CREATE_PARAMS, OTHER_TENANT, ACTOR_ID);

      expect(result.outcome).toBe('CANDIDATE_NOT_FOUND');
    });

    it('candidate with status ARCHIVED → CANDIDATE_ARCHIVED, no write', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue({ ...CANDIDATE_ROW_ACTIVE, status: 'ARCHIVED' });

      const result = await service.createApplication(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('CANDIDATE_ARCHIVED');
      expect(mockPrisma.application.create).not.toHaveBeenCalled();
    });

    it('candidate with deletedAt set (soft-deleted) → CANDIDATE_ARCHIVED, no write', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue({
        ...CANDIDATE_ROW_ACTIVE,
        deletedAt: new Date(),
      });

      const result = await service.createApplication(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('CANDIDATE_ARCHIVED');
      expect(mockPrisma.application.create).not.toHaveBeenCalled();
    });

    it('vacancy not found → VACANCY_NOT_FOUND, no write', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(CANDIDATE_ROW_ACTIVE);
      mockPrisma.vacancy.findFirst.mockResolvedValue(null);

      const result = await service.createApplication(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('VACANCY_NOT_FOUND');
      expect(mockPrisma.application.create).not.toHaveBeenCalled();
    });

    it('cross-tenant vacancy (findFirst null via tenantId filter) → VACANCY_NOT_FOUND (SEC-003)', async () => {
      // Scenario: candidate exists in TENANT_ID; vacancyId belongs to another tenant so
      // findFirst(WHERE id=vacancyId AND tenantId=TENANT_ID) returns null → VACANCY_NOT_FOUND.
      mockPrisma.candidate.findFirst.mockResolvedValue(CANDIDATE_ROW_ACTIVE);
      mockPrisma.vacancy.findFirst.mockResolvedValue(null);
      mockPrisma.application.findFirst.mockResolvedValue(null);

      const result = await service.createApplication(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('VACANCY_NOT_FOUND');
    });

    it.each(['DRAFT', 'CLOSED', 'CANCELLED', 'FILLED'])(
      'vacancy with status %s → VACANCY_NOT_OPEN',
      async (closedStatus) => {
        mockPrisma.candidate.findFirst.mockResolvedValue(CANDIDATE_ROW_ACTIVE);
        mockPrisma.vacancy.findFirst.mockResolvedValue({ id: VACANCY_ID, status: closedStatus });

        const result = await service.createApplication(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

        expect(result.outcome).toBe('VACANCY_NOT_OPEN');
        expect(mockPrisma.application.create).not.toHaveBeenCalled();
      },
    );

    it('vacancy IN_RECRUITMENT is accepted (GD-M17-1 D6)', async () => {
      setupHappyPath(VACANCY_ROW_IN_RECRUITMENT);

      const result = await service.createApplication(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('active duplicate application for same tenant/candidate/vacancy → APPLICATION_ALREADY_EXISTS', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(CANDIDATE_ROW_ACTIVE);
      mockPrisma.vacancy.findFirst.mockResolvedValue(VACANCY_ROW_OPEN);
      mockPrisma.application.findFirst.mockResolvedValue({ id: 'existing-app' });

      const result = await service.createApplication(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('APPLICATION_ALREADY_EXISTS');
      expect(mockPrisma.application.create).not.toHaveBeenCalled();
    });

    it('duplicate check where clause includes tenantId, candidateId, vacancyId, deletedAt: null, status notIn REJECTED/WITHDRAWN', async () => {
      setupHappyPath();

      await service.createApplication(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.application.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_ID,
            candidateId: CANDIDATE_ID,
            vacancyId: VACANCY_ID,
            deletedAt: null,
            status: { notIn: ['REJECTED', 'WITHDRAWN'] },
          }),
        }),
      );
    });

    it('P2002 on create (race condition duplicate) → APPLICATION_ALREADY_EXISTS', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(CANDIDATE_ROW_ACTIVE);
      mockPrisma.vacancy.findFirst.mockResolvedValue(VACANCY_ROW_OPEN);
      mockPrisma.application.findFirst.mockResolvedValue(null);
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint violated', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['tenant_id', 'candidate_id', 'vacancy_id'] },
      });
      mockPrisma.application.create.mockRejectedValue(p2002);

      const result = await service.createApplication(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('APPLICATION_ALREADY_EXISTS');
    });

    it('VAC-301: OPEN vacancy → updateMany called with WHERE status=OPEN (idempotent)', async () => {
      setupHappyPath(VACANCY_ROW_OPEN);

      await service.createApplication(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.vacancy.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: VACANCY_ID, status: 'OPEN' }),
          data: { status: 'IN_RECRUITMENT' },
        }),
      );
    });

    it('VAC-301: WORKFORCE_VACANCY_UPDATED audit emitted when transition actually occurs (count > 0)', async () => {
      setupHappyPath(VACANCY_ROW_OPEN);
      mockPrisma.vacancy.updateMany.mockResolvedValue({ count: 1 });

      await service.createApplication(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      const auditCalls = mockAuditService.logEvent.mock.calls as [Record<string, unknown>][];
      const vac301Audit = auditCalls.find(
        ([arg]) => arg['action'] === AuditEventType.WORKFORCE_VACANCY_UPDATED,
      );
      expect(vac301Audit).toBeDefined();
    });

    it('VAC-301: WORKFORCE_VACANCY_UPDATED audit NOT emitted when updateMany count = 0 (already transitioned)', async () => {
      setupHappyPath(VACANCY_ROW_OPEN);
      mockPrisma.vacancy.updateMany.mockResolvedValue({ count: 0 });

      await service.createApplication(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      const auditCalls = mockAuditService.logEvent.mock.calls as [Record<string, unknown>][];
      const vac301Audit = auditCalls.find(
        ([arg]) => arg['action'] === AuditEventType.WORKFORCE_VACANCY_UPDATED,
      );
      expect(vac301Audit).toBeUndefined();
    });

    it('VAC-301 not triggered when vacancy is already IN_RECRUITMENT', async () => {
      setupHappyPath(VACANCY_ROW_IN_RECRUITMENT);

      await service.createApplication(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.vacancy.updateMany).not.toHaveBeenCalled();
    });

    it('RECRUITING_APPLICATION_SUBMITTED audit emitted after successful create', async () => {
      setupHappyPath();

      await service.createApplication(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.RECRUITING_APPLICATION_SUBMITTED,
          tenantId: TENANT_ID,
          userId: ACTOR_ID,
          entityType: 'APPLICATION',
          entityId: APPLICATION_ID,
        }),
      );
    });

    it('RECRUITING_APPLICATION_SUBMITTED audit metadata is PII-safe (no notes text)', async () => {
      const paramsWithNotes: CreateApplicationParams = {
        ...CREATE_PARAMS,
        notes: 'Confidential note — candidate is recommended by the director',
        currentStage: 'Phone Screen',
      };
      setupHappyPath();
      mockPrisma.application.create.mockResolvedValue({
        ...makeApplicationRow(),
        notes: paramsWithNotes.notes,
      });

      await service.createApplication(paramsWithNotes, TENANT_ID, ACTOR_ID);

      const auditCalls = mockAuditService.logEvent.mock.calls as [Record<string, unknown>][];
      const submittedAudit = auditCalls.find(
        ([arg]) => arg['action'] === AuditEventType.RECRUITING_APPLICATION_SUBMITTED,
      );
      expect(submittedAudit).toBeDefined();
      const metadataStr = JSON.stringify((submittedAudit![0] as Record<string, unknown>)['metadata']);
      expect(metadataStr).not.toContain('Confidential');
      expect(metadataStr).not.toContain('director');
    });
  });

  // ---------------------------------------------------------------------------
  // listApplications
  // ---------------------------------------------------------------------------

  describe('listApplications()', () => {
    it('returns SUCCESS with applications array and pagination metadata', async () => {
      mockPrisma.application.findMany.mockResolvedValue([makeApplicationRow()]);
      mockPrisma.application.count.mockResolvedValue(1);

      const result = await service.listApplications({ page: 1, pageSize: 20 }, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.applications).toHaveLength(1);
        expect(result.total).toBe(1);
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(20);
      }
    });

    it('where clause always includes tenantId and deletedAt: null (SEC-003)', async () => {
      mockPrisma.application.findMany.mockResolvedValue([]);
      mockPrisma.application.count.mockResolvedValue(0);

      await service.listApplications({}, TENANT_ID);

      expect(mockPrisma.application.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_ID, deletedAt: null }),
        }),
      );
    });

    it('status filter included when supplied', async () => {
      mockPrisma.application.findMany.mockResolvedValue([]);
      mockPrisma.application.count.mockResolvedValue(0);

      await service.listApplications({ status: 'SCREENING' }, TENANT_ID);

      expect(mockPrisma.application.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'SCREENING' }),
        }),
      );
    });

    it('candidateId filter included when supplied', async () => {
      mockPrisma.application.findMany.mockResolvedValue([]);
      mockPrisma.application.count.mockResolvedValue(0);

      await service.listApplications({ candidateId: CANDIDATE_ID }, TENANT_ID);

      expect(mockPrisma.application.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ candidateId: CANDIDATE_ID }),
        }),
      );
    });

    it('vacancyId filter included when supplied', async () => {
      mockPrisma.application.findMany.mockResolvedValue([]);
      mockPrisma.application.count.mockResolvedValue(0);

      await service.listApplications({ vacancyId: VACANCY_ID }, TENANT_ID);

      expect(mockPrisma.application.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ vacancyId: VACANCY_ID }),
        }),
      );
    });

    it('skip = (page - 1) * pageSize', async () => {
      mockPrisma.application.findMany.mockResolvedValue([]);
      mockPrisma.application.count.mockResolvedValue(0);

      await service.listApplications({ page: 3, pageSize: 10 }, TENANT_ID);

      expect(mockPrisma.application.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('Prisma throws → INTERNAL_ERROR', async () => {
      mockPrisma.application.findMany.mockRejectedValue(new Error('DB error'));

      const result = await service.listApplications({}, TENANT_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // getApplicationById
  // ---------------------------------------------------------------------------

  describe('getApplicationById()', () => {
    it('application found → outcome SUCCESS with ApplicationRecord', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(makeApplicationRow());

      const result = await service.getApplicationById(APPLICATION_ID, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.application.id).toBe(APPLICATION_ID);
        expect(result.application.status).toBe('APPLIED');
      }
    });

    it('not found (absent or soft-deleted) → APPLICATION_NOT_FOUND', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(null);

      const result = await service.getApplicationById(APPLICATION_ID, TENANT_ID);

      expect(result.outcome).toBe('APPLICATION_NOT_FOUND');
    });

    it('cross-tenant application (findFirst null via tenantId filter) → APPLICATION_NOT_FOUND (SEC-003)', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(null);

      const result = await service.getApplicationById(APPLICATION_ID, OTHER_TENANT);

      expect(result.outcome).toBe('APPLICATION_NOT_FOUND');
    });

    it('deleted application (findFirst null via deletedAt: null filter) → APPLICATION_NOT_FOUND', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(null);

      const result = await service.getApplicationById(APPLICATION_ID, TENANT_ID);

      expect(result.outcome).toBe('APPLICATION_NOT_FOUND');
    });

    it('findFirst where clause includes id, tenantId, and deletedAt: null (SEC-003)', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(makeApplicationRow());

      await service.getApplicationById(APPLICATION_ID, TENANT_ID);

      expect(mockPrisma.application.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: APPLICATION_ID,
            tenantId: TENANT_ID,
            deletedAt: null,
          }),
        }),
      );
    });

    it('Prisma throws → INTERNAL_ERROR', async () => {
      mockPrisma.application.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await service.getApplicationById(APPLICATION_ID, TENANT_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // updateApplication
  // ---------------------------------------------------------------------------

  describe('updateApplication()', () => {
    it('updates notes and currentStage → outcome SUCCESS', async () => {
      const updatedRow = { ...makeApplicationRow(), notes: 'Updated note', currentStage: 'Screen' };
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'APPLIED' });
      mockPrisma.application.update.mockResolvedValue(updatedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const params: UpdateApplicationParams = { notes: 'Updated note', currentStage: 'Screen' };
      const result = await service.updateApplication(APPLICATION_ID, params, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('application not found → APPLICATION_NOT_FOUND, no write', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(null);

      const result = await service.updateApplication(APPLICATION_ID, { notes: 'x' }, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('APPLICATION_NOT_FOUND');
      expect(mockPrisma.application.update).not.toHaveBeenCalled();
    });

    it.each(['REJECTED', 'WITHDRAWN'])(
      'terminal application (%s) → APPLICATION_IN_TERMINAL_STATE, no write',
      async (terminalStatus) => {
        mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: terminalStatus });

        const result = await service.updateApplication(APPLICATION_ID, { notes: 'x' }, TENANT_ID, ACTOR_ID);

        expect(result.outcome).toBe('APPLICATION_IN_TERMINAL_STATE');
        expect(mockPrisma.application.update).not.toHaveBeenCalled();
      },
    );

    it('update data contains only notes and currentStage — status/candidateId/vacancyId not editable', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'APPLIED' });
      mockPrisma.application.update.mockResolvedValue(makeApplicationRow());
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateApplication(
        APPLICATION_ID,
        { notes: 'note', currentStage: 'Screen' },
        TENANT_ID,
        ACTOR_ID,
      );

      const updateData = (
        mockPrisma.application.update.mock.calls[0] as [{ data: Record<string, unknown> }]
      )[0].data;
      expect(updateData).toHaveProperty('notes');
      expect(updateData).toHaveProperty('currentStage');
      expect(updateData).not.toHaveProperty('status');
      expect(updateData).not.toHaveProperty('candidateId');
      expect(updateData).not.toHaveProperty('vacancyId');
    });

    it('audit metadata contains updatedFields (field names only) — no notes text (PII safety)', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'APPLIED' });
      mockPrisma.application.update.mockResolvedValue(makeApplicationRow());
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateApplication(
        APPLICATION_ID,
        { notes: 'Confidential screening notes for this applicant' },
        TENANT_ID,
        ACTOR_ID,
      );

      const callArg = (mockAuditService.logEvent.mock.calls[0] as [Record<string, unknown>])[0];
      const metadata = callArg['metadata'] as Record<string, unknown>;
      expect(metadata['updatedFields']).toContain('notes');
      expect(JSON.stringify(metadata)).not.toContain('Confidential');
      expect(JSON.stringify(metadata)).not.toContain('applicant');
    });

    it('partial update: only supplied fields present in Prisma update data', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'APPLIED' });
      mockPrisma.application.update.mockResolvedValue(makeApplicationRow());
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateApplication(APPLICATION_ID, { notes: 'note' }, TENANT_ID, ACTOR_ID);

      const updateData = (
        mockPrisma.application.update.mock.calls[0] as [{ data: Record<string, unknown> }]
      )[0].data;
      expect(updateData).toHaveProperty('notes');
      expect(updateData).not.toHaveProperty('currentStage');
    });

    it('Prisma throws → INTERNAL_ERROR', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'APPLIED' });
      mockPrisma.application.update.mockRejectedValue(new Error('DB error'));

      const result = await service.updateApplication(APPLICATION_ID, { notes: 'x' }, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // advanceApplication
  // ---------------------------------------------------------------------------

  describe('advanceApplication()', () => {
    it('APPLIED → SCREENING succeeds', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'APPLIED' });
      mockPrisma.application.update.mockResolvedValue(makeApplicationRow('SCREENING'));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.advanceApplication(APPLICATION_ID, { targetStatus: 'SCREENING' }, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') expect(result.application.status).toBe('SCREENING');
    });

    it('SCREENING → INTERVIEW succeeds', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'SCREENING' });
      mockPrisma.application.update.mockResolvedValue(makeApplicationRow('INTERVIEW'));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.advanceApplication(APPLICATION_ID, { targetStatus: 'INTERVIEW' }, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('INTERVIEW → EVALUATION succeeds', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'INTERVIEW' });
      mockPrisma.application.update.mockResolvedValue(makeApplicationRow('EVALUATION'));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.advanceApplication(APPLICATION_ID, { targetStatus: 'EVALUATION' }, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('EVALUATION → OFFER succeeds', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'EVALUATION' });
      mockPrisma.application.update.mockResolvedValue(makeApplicationRow('OFFER'));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.advanceApplication(APPLICATION_ID, { targetStatus: 'OFFER' }, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('advance from OFFER → APPLICATION_AWAITING_HIRE (M19 scope — HIRED unreachable in M17)', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'OFFER' });

      const result = await service.advanceApplication(APPLICATION_ID, { targetStatus: 'OFFER' }, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('APPLICATION_AWAITING_HIRE');
      expect(mockPrisma.application.update).not.toHaveBeenCalled();
    });

    it('skipping stage (APPLIED → INTERVIEW) → INVALID_APPLICATION_TRANSITION', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'APPLIED' });

      const result = await service.advanceApplication(APPLICATION_ID, { targetStatus: 'INTERVIEW' }, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INVALID_APPLICATION_TRANSITION');
      expect(mockPrisma.application.update).not.toHaveBeenCalled();
    });

    it('going backwards (SCREENING → APPLIED) → INVALID_APPLICATION_TRANSITION', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'SCREENING' });

      const result = await service.advanceApplication(APPLICATION_ID, { targetStatus: 'APPLIED' }, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INVALID_APPLICATION_TRANSITION');
    });

    it.each(['REJECTED', 'WITHDRAWN'])(
      'terminal application (%s) → APPLICATION_IN_TERMINAL_STATE',
      async (terminalStatus) => {
        mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: terminalStatus });

        const result = await service.advanceApplication(APPLICATION_ID, { targetStatus: 'SCREENING' }, TENANT_ID, ACTOR_ID);

        expect(result.outcome).toBe('APPLICATION_IN_TERMINAL_STATE');
        expect(mockPrisma.application.update).not.toHaveBeenCalled();
      },
    );

    it('application not found → APPLICATION_NOT_FOUND', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(null);

      const result = await service.advanceApplication(APPLICATION_ID, { targetStatus: 'SCREENING' }, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('APPLICATION_NOT_FOUND');
    });

    it('RECRUITING_APPLICATION_ADVANCED audit emitted with previousStatus and newStatus', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'APPLIED' });
      mockPrisma.application.update.mockResolvedValue(makeApplicationRow('SCREENING'));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.advanceApplication(APPLICATION_ID, { targetStatus: 'SCREENING' }, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.RECRUITING_APPLICATION_ADVANCED,
          entityId: APPLICATION_ID,
          metadata: expect.objectContaining({
            previousStatus: 'APPLIED',
            newStatus: 'SCREENING',
          }),
        }),
      );
    });

    it('only RECRUITING_APPLICATION_ADVANCED emitted — STATUS_CHANGED not also emitted (no duplicate noise)', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'APPLIED' });
      mockPrisma.application.update.mockResolvedValue(makeApplicationRow('SCREENING'));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.advanceApplication(APPLICATION_ID, { targetStatus: 'SCREENING' }, TENANT_ID, ACTOR_ID);

      const auditCalls = mockAuditService.logEvent.mock.calls as [Record<string, unknown>][];
      const statusChangedCall = auditCalls.find(
        ([arg]) => arg['action'] === AuditEventType.RECRUITING_APPLICATION_STATUS_CHANGED,
      );
      expect(statusChangedCall).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // rejectApplication
  // ---------------------------------------------------------------------------

  describe('rejectApplication()', () => {
    it('active application (APPLIED) → outcome SUCCESS', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'APPLIED' });
      mockPrisma.application.update.mockResolvedValue(undefined);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.rejectApplication(APPLICATION_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('active application at any stage (OFFER) can be rejected', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'OFFER' });
      mockPrisma.application.update.mockResolvedValue(undefined);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.rejectApplication(APPLICATION_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
    });

    it.each(['REJECTED', 'WITHDRAWN'])(
      'terminal application (%s) → APPLICATION_IN_TERMINAL_STATE',
      async (terminalStatus) => {
        mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: terminalStatus });

        const result = await service.rejectApplication(APPLICATION_ID, TENANT_ID, ACTOR_ID);

        expect(result.outcome).toBe('APPLICATION_IN_TERMINAL_STATE');
        expect(mockPrisma.application.update).not.toHaveBeenCalled();
      },
    );

    it('application not found → APPLICATION_NOT_FOUND', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(null);

      const result = await service.rejectApplication(APPLICATION_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('APPLICATION_NOT_FOUND');
    });

    it('RECRUITING_APPLICATION_REJECTED audit emitted with previousStatus', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'SCREENING' });
      mockPrisma.application.update.mockResolvedValue(undefined);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.rejectApplication(APPLICATION_ID, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.RECRUITING_APPLICATION_REJECTED,
          entityId: APPLICATION_ID,
          metadata: expect.objectContaining({ previousStatus: 'SCREENING' }),
        }),
      );
    });

    it('Prisma throws → INTERNAL_ERROR', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'APPLIED' });
      mockPrisma.application.update.mockRejectedValue(new Error('DB error'));

      const result = await service.rejectApplication(APPLICATION_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // withdrawApplication
  // ---------------------------------------------------------------------------

  describe('withdrawApplication()', () => {
    it('active application (APPLIED) → outcome SUCCESS', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'APPLIED' });
      mockPrisma.application.update.mockResolvedValue(undefined);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.withdrawApplication(APPLICATION_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('active application at any stage (EVALUATION) can be withdrawn', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'EVALUATION' });
      mockPrisma.application.update.mockResolvedValue(undefined);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.withdrawApplication(APPLICATION_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
    });

    it.each(['REJECTED', 'WITHDRAWN'])(
      'terminal application (%s) → APPLICATION_IN_TERMINAL_STATE',
      async (terminalStatus) => {
        mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: terminalStatus });

        const result = await service.withdrawApplication(APPLICATION_ID, TENANT_ID, ACTOR_ID);

        expect(result.outcome).toBe('APPLICATION_IN_TERMINAL_STATE');
        expect(mockPrisma.application.update).not.toHaveBeenCalled();
      },
    );

    it('application not found → APPLICATION_NOT_FOUND', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(null);

      const result = await service.withdrawApplication(APPLICATION_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('APPLICATION_NOT_FOUND');
    });

    it('RECRUITING_APPLICATION_WITHDRAWN audit emitted with previousStatus', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'EVALUATION' });
      mockPrisma.application.update.mockResolvedValue(undefined);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.withdrawApplication(APPLICATION_ID, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.RECRUITING_APPLICATION_WITHDRAWN,
          entityId: APPLICATION_ID,
          metadata: expect.objectContaining({ previousStatus: 'EVALUATION' }),
        }),
      );
    });

    it('Prisma throws → INTERNAL_ERROR', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ id: APPLICATION_ID, status: 'APPLIED' });
      mockPrisma.application.update.mockRejectedValue(new Error('DB error'));

      const result = await service.withdrawApplication(APPLICATION_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });
});
