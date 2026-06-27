// Reference: spec/01_requirements.md — FR-300 through FR-304 Candidate Management
// Reference: governance/GD-M16-1.md — Decisions 4, 5, 9, 10, 11, 12
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (SEC-003 tenant isolation)
//
// Pure unit tests — no database.
// PrismaService and AuditService replaced with jest.fn() mocks.
// Verifies all discriminated-union outcomes for each CandidateService method.
// SEC-003 tenant isolation: tenantId and deletedAt: null always present in where clauses.
// Archived/deleted candidates: findFirst returns null due to deletedAt: null filter → CANDIDATE_NOT_FOUND.
// PII safety: audit metadata must not contain firstName, lastName, email, phone, or notes values.
// GD-M16-1 D9: absent status filter in listCandidates defaults to ACTIVE-only.
// GD-M16-1 D5: email uniqueness checked against (tenantId, email, deletedAt=null); self-excluded on update.
// M17 stub: CANDIDATE_HAS_ACTIVE_APPLICATIONS in return type but unreachable in M16.

import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { CandidateService } from './candidate.service';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import type { CreateCandidateParams, UpdateCandidateParams } from './candidate.service';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID    = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_TENANT = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const ACTOR_ID     = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CANDIDATE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const CREATED_AT = new Date('2026-06-27T00:00:00.000Z');
const UPDATED_AT = new Date('2026-06-27T01:00:00.000Z');

const CANDIDATE_ROW = {
  id: CANDIDATE_ID,
  tenantId: TENANT_ID,
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane.smith@agency.gov',
  phone: null as string | null,
  status: 'ACTIVE',
  source: null as string | null,
  notes: null as string | null,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

const CREATE_PARAMS: CreateCandidateParams = {
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane.smith@agency.gov',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CandidateService', () => {
  let service: CandidateService;

  const mockPrisma = {
    candidate: {
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
        CandidateService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<CandidateService>(CandidateService);
  });

  // ---------------------------------------------------------------------------
  // createCandidate
  // ---------------------------------------------------------------------------

  describe('createCandidate()', () => {
    it('valid params → outcome SUCCESS with CandidateRecord and ACTIVE status (GD-PRE-PHASE3-002 D2)', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(null);
      mockPrisma.candidate.create.mockResolvedValue(CANDIDATE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.createCandidate(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.candidate.id).toBe(CANDIDATE_ID);
        expect(result.candidate.status).toBe('ACTIVE');
        expect(result.candidate.tenantId).toBe(TENANT_ID);
      }
    });

    it('create data always sets status: "ACTIVE" — never from caller (GD-PRE-PHASE3-002 D2)', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(null);
      mockPrisma.candidate.create.mockResolvedValue(CANDIDATE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createCandidate(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.candidate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
    });

    it('create data includes tenantId from auth context — never from params (SEC-003)', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(null);
      mockPrisma.candidate.create.mockResolvedValue(CANDIDATE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createCandidate(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.candidate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: TENANT_ID }),
        }),
      );
    });

    it('duplicate email within same tenant (deletedAt null) → outcome CANDIDATE_EMAIL_ALREADY_EXISTS (GD-M16-1 D5)', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue({ id: 'other-candidate-id' });

      const result = await service.createCandidate(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('CANDIDATE_EMAIL_ALREADY_EXISTS');
      expect(mockPrisma.candidate.create).not.toHaveBeenCalled();
    });

    it('email check where clause includes tenantId, email, and deletedAt: null (GD-M16-1 D5; SEC-003)', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(null);
      mockPrisma.candidate.create.mockResolvedValue(CANDIDATE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createCandidate(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.candidate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_ID,
            email: 'jane.smith@agency.gov',
            deletedAt: null,
          }),
        }),
      );
    });

    it('Prisma P2002 on create (race condition) → outcome CANDIDATE_EMAIL_ALREADY_EXISTS', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(null);
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint violated', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['tenant_id', 'email'] },
      });
      mockPrisma.candidate.create.mockRejectedValue(p2002);

      const result = await service.createCandidate(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('CANDIDATE_EMAIL_ALREADY_EXISTS');
    });

    it('RECRUITING_CANDIDATE_CREATED audit event emitted after successful create', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(null);
      mockPrisma.candidate.create.mockResolvedValue(CANDIDATE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createCandidate(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.RECRUITING_CANDIDATE_CREATED,
          tenantId: TENANT_ID,
          userId: ACTOR_ID,
          entityType: 'CANDIDATE',
          entityId: CANDIDATE_ID,
        }),
      );
    });

    it('audit metadata does not contain firstName, lastName, email, phone, or notes values (PII safety)', async () => {
      const fullParams: CreateCandidateParams = {
        ...CREATE_PARAMS,
        phone: '202-555-0001',
        source: 'USAJOBS',
        notes: 'Confidential note about Jane Smith',
      };
      mockPrisma.candidate.findFirst.mockResolvedValue(null);
      mockPrisma.candidate.create.mockResolvedValue({
        ...CANDIDATE_ROW,
        phone: '202-555-0001',
        notes: 'Confidential note about Jane Smith',
      });
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createCandidate(fullParams, TENANT_ID, ACTOR_ID);

      const callArg = (mockAuditService.logEvent.mock.calls[0] as [Record<string, unknown>])[0];
      const metadataStr = JSON.stringify(callArg.metadata);
      expect(metadataStr).not.toContain('Jane');
      expect(metadataStr).not.toContain('Smith');
      expect(metadataStr).not.toContain('jane.smith@agency.gov');
      expect(metadataStr).not.toContain('202-555-0001');
      expect(metadataStr).not.toContain('Confidential note');
    });

    it('no audit event emitted on CANDIDATE_EMAIL_ALREADY_EXISTS', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue({ id: 'other-candidate-id' });

      await service.createCandidate(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('Prisma unknown error → outcome INTERNAL_ERROR', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(null);
      mockPrisma.candidate.create.mockRejectedValue(new Error('DB connection lost'));

      const result = await service.createCandidate(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // listCandidates
  // ---------------------------------------------------------------------------

  describe('listCandidates()', () => {
    it('returns SUCCESS with candidates array and pagination metadata', async () => {
      mockPrisma.candidate.findMany.mockResolvedValue([CANDIDATE_ROW]);
      mockPrisma.candidate.count.mockResolvedValue(1);

      const result = await service.listCandidates({ page: 1, pageSize: 20 }, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.candidates).toHaveLength(1);
        expect(result.total).toBe(1);
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(20);
      }
    });

    it('returns SUCCESS with empty array when no candidates match', async () => {
      mockPrisma.candidate.findMany.mockResolvedValue([]);
      mockPrisma.candidate.count.mockResolvedValue(0);

      const result = await service.listCandidates({}, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.candidates).toHaveLength(0);
        expect(result.total).toBe(0);
      }
    });

    it('where clause always includes tenantId and deletedAt: null (SEC-003)', async () => {
      mockPrisma.candidate.findMany.mockResolvedValue([]);
      mockPrisma.candidate.count.mockResolvedValue(0);

      await service.listCandidates({}, TENANT_ID);

      expect(mockPrisma.candidate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_ID, deletedAt: null }),
        }),
      );
    });

    it('absent status filter defaults to ACTIVE-only in where clause (GD-M16-1 D9)', async () => {
      mockPrisma.candidate.findMany.mockResolvedValue([]);
      mockPrisma.candidate.count.mockResolvedValue(0);

      await service.listCandidates({}, TENANT_ID);

      expect(mockPrisma.candidate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
    });

    it('explicit ARCHIVED status filter included in where clause', async () => {
      mockPrisma.candidate.findMany.mockResolvedValue([]);
      mockPrisma.candidate.count.mockResolvedValue(0);

      await service.listCandidates({ status: 'ARCHIVED' }, TENANT_ID);

      expect(mockPrisma.candidate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ARCHIVED' }),
        }),
      );
    });

    it('skip = (page - 1) * pageSize', async () => {
      mockPrisma.candidate.findMany.mockResolvedValue([]);
      mockPrisma.candidate.count.mockResolvedValue(0);

      await service.listCandidates({ page: 3, pageSize: 10 }, TENANT_ID);

      expect(mockPrisma.candidate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.candidate.findMany.mockRejectedValue(new Error('DB error'));

      const result = await service.listCandidates({}, TENANT_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // getCandidateById
  // ---------------------------------------------------------------------------

  describe('getCandidateById()', () => {
    it('candidate found → outcome SUCCESS with CandidateRecord', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(CANDIDATE_ROW);

      const result = await service.getCandidateById(CANDIDATE_ID, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.candidate.id).toBe(CANDIDATE_ID);
        expect(result.candidate.status).toBe('ACTIVE');
      }
    });

    it('findFirst returns null (absent or soft-deleted) → outcome CANDIDATE_NOT_FOUND', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(null);

      const result = await service.getCandidateById(CANDIDATE_ID, TENANT_ID);

      expect(result.outcome).toBe('CANDIDATE_NOT_FOUND');
    });

    it('cross-tenant candidate (findFirst null due to tenantId filter) → CANDIDATE_NOT_FOUND (SEC-003)', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(null);

      const result = await service.getCandidateById(CANDIDATE_ID, OTHER_TENANT);

      expect(result.outcome).toBe('CANDIDATE_NOT_FOUND');
    });

    it('archived/deleted candidate (findFirst null due to deletedAt: null filter) → CANDIDATE_NOT_FOUND', async () => {
      // An archived candidate has deletedAt set; the filter excludes it so findFirst returns null.
      mockPrisma.candidate.findFirst.mockResolvedValue(null);

      const result = await service.getCandidateById(CANDIDATE_ID, TENANT_ID);

      expect(result.outcome).toBe('CANDIDATE_NOT_FOUND');
    });

    it('findFirst where clause includes id, tenantId, and deletedAt: null (SEC-003)', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(CANDIDATE_ROW);

      await service.getCandidateById(CANDIDATE_ID, TENANT_ID);

      expect(mockPrisma.candidate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: CANDIDATE_ID,
            tenantId: TENANT_ID,
            deletedAt: null,
          }),
        }),
      );
    });

    it('Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.candidate.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await service.getCandidateById(CANDIDATE_ID, TENANT_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // updateCandidate
  // ---------------------------------------------------------------------------

  describe('updateCandidate()', () => {
    it('valid update → outcome SUCCESS with updated CandidateRecord', async () => {
      const updatedRow = { ...CANDIDATE_ROW, firstName: 'Janet' };
      mockPrisma.candidate.findFirst.mockResolvedValue({ id: CANDIDATE_ID }); // existence check
      mockPrisma.candidate.update.mockResolvedValue(updatedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.updateCandidate(
        CANDIDATE_ID,
        { firstName: 'Janet' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.candidate.firstName).toBe('Janet');
      }
    });

    it('candidate not found (absent or soft-deleted) → outcome CANDIDATE_NOT_FOUND', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(null);

      const result = await service.updateCandidate(
        CANDIDATE_ID,
        { firstName: 'Janet' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('CANDIDATE_NOT_FOUND');
      expect(mockPrisma.candidate.update).not.toHaveBeenCalled();
    });

    it('email change to address already used by another active candidate → CANDIDATE_EMAIL_ALREADY_EXISTS (GD-M16-1 D5)', async () => {
      mockPrisma.candidate.findFirst
        .mockResolvedValueOnce({ id: CANDIDATE_ID })     // existence check
        .mockResolvedValueOnce({ id: 'other-id' });      // duplicate email check

      const result = await service.updateCandidate(
        CANDIDATE_ID,
        { email: 'taken@agency.gov' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('CANDIDATE_EMAIL_ALREADY_EXISTS');
      expect(mockPrisma.candidate.update).not.toHaveBeenCalled();
    });

    it('email change duplicate check excludes self via NOT: { id } (same-email re-submit is safe)', async () => {
      mockPrisma.candidate.findFirst
        .mockResolvedValueOnce({ id: CANDIDATE_ID })
        .mockResolvedValueOnce(null);  // no OTHER candidate with this email
      mockPrisma.candidate.update.mockResolvedValue(CANDIDATE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateCandidate(
        CANDIDATE_ID,
        { email: 'jane.smith@agency.gov' },
        TENANT_ID,
        ACTOR_ID,
      );

      // Second findFirst call is the email duplicate check — confirm NOT: { id } present.
      const emailCheckCall = mockPrisma.candidate.findFirst.mock.calls[1] as unknown[];
      const where = (emailCheckCall[0] as { where: Record<string, unknown> }).where;
      expect(where['NOT']).toEqual({ id: CANDIDATE_ID });
    });

    it('RECRUITING_CANDIDATE_UPDATED audit event emitted after successful update', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue({ id: CANDIDATE_ID });
      mockPrisma.candidate.update.mockResolvedValue(CANDIDATE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateCandidate(
        CANDIDATE_ID,
        { firstName: 'Janet' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.RECRUITING_CANDIDATE_UPDATED,
          tenantId: TENANT_ID,
          userId: ACTOR_ID,
          entityType: 'CANDIDATE',
          entityId: CANDIDATE_ID,
        }),
      );
    });

    it('audit metadata contains updatedFields (field names only) — no PII values (EMP-401 pattern)', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue({ id: CANDIDATE_ID });
      mockPrisma.candidate.update.mockResolvedValue(CANDIDATE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateCandidate(
        CANDIDATE_ID,
        { firstName: 'Janet', lastName: 'Johnson' } as UpdateCandidateParams,
        TENANT_ID,
        ACTOR_ID,
      );

      const callArg = (mockAuditService.logEvent.mock.calls[0] as [Record<string, unknown>])[0];
      const metadata = callArg.metadata as Record<string, unknown>;
      // Field names present in updatedFields.
      expect(metadata['updatedFields']).toEqual(expect.arrayContaining(['firstName', 'lastName']));
      // Field values absent from metadata.
      expect(JSON.stringify(metadata)).not.toContain('Janet');
      expect(JSON.stringify(metadata)).not.toContain('Johnson');
    });

    it('partial update: only supplied fields present in Prisma update data', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue({ id: CANDIDATE_ID });
      mockPrisma.candidate.update.mockResolvedValue(CANDIDATE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateCandidate(
        CANDIDATE_ID,
        { firstName: 'Janet' },
        TENANT_ID,
        ACTOR_ID,
      );

      const callData = (
        mockPrisma.candidate.update.mock.calls[0] as [{ data: Record<string, unknown> }]
      )[0].data;
      expect(callData).toHaveProperty('firstName', 'Janet');
      expect(callData).not.toHaveProperty('lastName');
      expect(callData).not.toHaveProperty('email');
      expect(callData).not.toHaveProperty('phone');
    });

    it('no audit event emitted on CANDIDATE_NOT_FOUND', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(null);

      await service.updateCandidate(
        CANDIDATE_ID,
        { firstName: 'Janet' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('no email duplicate check performed when email is not in params', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue({ id: CANDIDATE_ID });
      mockPrisma.candidate.update.mockResolvedValue(CANDIDATE_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateCandidate(
        CANDIDATE_ID,
        { firstName: 'Janet' },  // no email field
        TENANT_ID,
        ACTOR_ID,
      );

      // findFirst called exactly once (existence check only — no email duplicate check).
      expect(mockPrisma.candidate.findFirst).toHaveBeenCalledTimes(1);
    });

    it('Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue({ id: CANDIDATE_ID });
      mockPrisma.candidate.update.mockRejectedValue(new Error('DB error'));

      const result = await service.updateCandidate(
        CANDIDATE_ID,
        { firstName: 'Janet' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // archiveCandidate
  // ---------------------------------------------------------------------------

  describe('archiveCandidate()', () => {
    it('active candidate → outcome SUCCESS', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue({ id: CANDIDATE_ID });
      mockPrisma.candidate.update.mockResolvedValue(undefined);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.archiveCandidate(CANDIDATE_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('candidate not found (absent or cross-tenant) → outcome CANDIDATE_NOT_FOUND', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(null);

      const result = await service.archiveCandidate(CANDIDATE_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('CANDIDATE_NOT_FOUND');
      expect(mockPrisma.candidate.update).not.toHaveBeenCalled();
    });

    it('already archived candidate (deletedAt set → findFirst null) → outcome CANDIDATE_NOT_FOUND', async () => {
      // Archived candidate has deletedAt set; filter WHERE deletedAt IS NULL excludes it.
      mockPrisma.candidate.findFirst.mockResolvedValue(null);

      const result = await service.archiveCandidate(CANDIDATE_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('CANDIDATE_NOT_FOUND');
      expect(mockPrisma.candidate.update).not.toHaveBeenCalled();
    });

    it('archive sets status to ARCHIVED in Prisma update data (GD-PRE-PHASE3-002 D2)', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue({ id: CANDIDATE_ID });
      mockPrisma.candidate.update.mockResolvedValue(undefined);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.archiveCandidate(CANDIDATE_ID, TENANT_ID, ACTOR_ID);

      const callData = (
        mockPrisma.candidate.update.mock.calls[0] as [{ data: Record<string, unknown> }]
      )[0].data;
      expect(callData['status']).toBe('ARCHIVED');
    });

    it('archive sets deletedAt to a Date in Prisma update data (soft-delete)', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue({ id: CANDIDATE_ID });
      mockPrisma.candidate.update.mockResolvedValue(undefined);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.archiveCandidate(CANDIDATE_ID, TENANT_ID, ACTOR_ID);

      const callData = (
        mockPrisma.candidate.update.mock.calls[0] as [{ data: Record<string, unknown> }]
      )[0].data;
      expect(callData['deletedAt']).toBeInstanceOf(Date);
    });

    it('RECRUITING_CANDIDATE_ARCHIVED audit event emitted after successful archive', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue({ id: CANDIDATE_ID });
      mockPrisma.candidate.update.mockResolvedValue(undefined);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.archiveCandidate(CANDIDATE_ID, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.RECRUITING_CANDIDATE_ARCHIVED,
          tenantId: TENANT_ID,
          userId: ACTOR_ID,
          entityType: 'CANDIDATE',
          entityId: CANDIDATE_ID,
        }),
      );
    });

    it('archive audit metadata does not contain PII values (PII safety)', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue({ id: CANDIDATE_ID });
      mockPrisma.candidate.update.mockResolvedValue(undefined);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.archiveCandidate(CANDIDATE_ID, TENANT_ID, ACTOR_ID);

      const callArg = (mockAuditService.logEvent.mock.calls[0] as [Record<string, unknown>])[0];
      const metadataStr = JSON.stringify(callArg.metadata);
      // CANDIDATE_ROW contains 'Jane', 'Smith', 'jane.smith@agency.gov' — must not appear.
      expect(metadataStr).not.toContain('Jane');
      expect(metadataStr).not.toContain('Smith');
      expect(metadataStr).not.toContain('agency.gov');
    });

    it('no audit event emitted on CANDIDATE_NOT_FOUND', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue(null);

      await service.archiveCandidate(CANDIDATE_ID, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.candidate.findFirst.mockResolvedValue({ id: CANDIDATE_ID });
      mockPrisma.candidate.update.mockRejectedValue(new Error('DB error'));

      const result = await service.archiveCandidate(CANDIDATE_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });
});
