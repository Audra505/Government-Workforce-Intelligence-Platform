// Reference: governance/GD-M19-1.md — Decisions 4, 6, 7, 8, 9, 11, 12, 15
//
// Pure unit tests — no database.
// PrismaService and AuditService replaced with jest.fn() mocks.
// Verifies all discriminated-union outcomes for HireService.hire().
//
// SEC-003 tenant isolation: tenantId always in where clauses; cross-tenant = NOT_FOUND.
// Idempotency: APPLICATION_ALREADY_HIRED fires before APPLICATION_NOT_AT_OFFER_STATUS.
// Transaction: $transaction mock executes callback with mockTx and returns emp.
// P2002 on employee.create → EMPLOYEE_NUMBER_GENERATION_FAILED; no audit emitted.
// PII safety: candidate name, email must not appear in any audit metadata object.
// Vacancy hireable states: OPEN, IN_RECRUITMENT, CLOSED all allow hire; FILLED/CANCELLED block.

import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { HireService, type HireEmployeeRecord } from './hire.service';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const TENANT_ID  = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID   = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const APP_ID     = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OFFER_ID   = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const CAND_ID    = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const VAC_ID     = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const POS_ID     = '11111111-1111-1111-1111-111111111111';
const DEPT_ID    = '22222222-2222-2222-2222-222222222222';
const EMP_ID     = '33333333-3333-3333-3333-333333333333';

// Candidate PII — used only for PII-exclusion assertions; must not appear in audit metadata.
const CAND_FIRST  = 'Jane';
const CAND_LAST   = 'Smith';
const CAND_EMAIL  = 'jane.smith@example.gov';

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeAppRow(overrides: Record<string, unknown> = {}) {
  return {
    id: APP_ID,
    status: 'OFFER',
    candidateId: CAND_ID,
    vacancyId: VAC_ID,
    ...overrides,
  };
}

function makeVacancyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VAC_ID,
    status: 'IN_RECRUITMENT',
    positionId: POS_ID,
    ...overrides,
  };
}

function makeCandidateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CAND_ID,
    status: 'ACTIVE',
    firstName: CAND_FIRST,
    lastName: CAND_LAST,
    email: CAND_EMAIL,
    ...overrides,
  };
}

const MOCK_OFFER_ROW = { id: OFFER_ID };
const MOCK_POSITION_ROW = { id: POS_ID, departmentId: DEPT_ID };

const MOCK_EMPLOYEE_RECORD: HireEmployeeRecord = {
  id: EMP_ID,
  tenantId: TENANT_ID,
  departmentId: DEPT_ID,
  positionId: POS_ID,
  employeeNumber: 'EMP-001',
  firstName: CAND_FIRST,
  lastName: CAND_LAST,
  email: CAND_EMAIL,
  employmentStatus: 'PENDING_ONBOARDING',
  appointmentAuthority: 'COMPETITIVE_APPOINTMENT',
  hireDate: new Date('2026-06-30'),
  terminationDate: null,
  createdAt: new Date('2026-06-30'),
  updatedAt: new Date('2026-06-30'),
};

// ---------------------------------------------------------------------------
// Mocks — defined outside describe() so they persist across module compiles.
// ---------------------------------------------------------------------------

const mockTx = {
  employee:    { create: jest.fn() },
  application: { update: jest.fn(), updateMany: jest.fn() },
  vacancy:     { update: jest.fn() },
};

const mockPrisma = {
  application: { findFirst: jest.fn() },
  offer:       { findFirst: jest.fn() },
  candidate:   { findFirst: jest.fn() },
  vacancy:     { findFirst: jest.fn() },
  position:    { findFirst: jest.fn() },
  employee:    { findFirst: jest.fn(), count: jest.fn() },
  $transaction: jest.fn(),
};

const mockAuditService = { logEvent: jest.fn() };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupHappyPath(): void {
  (mockPrisma.application.findFirst as jest.Mock).mockResolvedValue(makeAppRow());
  (mockPrisma.offer.findFirst as jest.Mock).mockResolvedValue(MOCK_OFFER_ROW);
  (mockPrisma.candidate.findFirst as jest.Mock).mockResolvedValue(makeCandidateRow());
  (mockPrisma.vacancy.findFirst as jest.Mock).mockResolvedValue(makeVacancyRow());
  (mockPrisma.position.findFirst as jest.Mock).mockResolvedValue(MOCK_POSITION_ROW);
  (mockPrisma.employee.findFirst as jest.Mock).mockResolvedValue(null); // no incumbent
  (mockPrisma.employee.count as jest.Mock).mockResolvedValue(0);
  mockTx.employee.create.mockResolvedValue(MOCK_EMPLOYEE_RECORD);
  mockTx.application.update.mockResolvedValue({ id: APP_ID, status: 'HIRED' });
  mockTx.vacancy.update.mockResolvedValue({ id: VAC_ID, status: 'FILLED' });
  mockTx.application.updateMany.mockResolvedValue({ count: 0 });
  (mockAuditService.logEvent as jest.Mock).mockResolvedValue(undefined);
}

function makePrismaP2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the constraint: `idx_employee_number_tenant`',
    { code: 'P2002', clientVersion: '5.0.0', meta: {} },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HireService', () => {
  let service: HireService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HireService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();
    service = module.get<HireService>(HireService);

    // Default $transaction: execute callback with mockTx and forward result.
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    );

    setupHappyPath();
  });

  // -------------------------------------------------------------------------
  // Success path
  // -------------------------------------------------------------------------

  describe('hire() — SUCCESS', () => {
    it('returns SUCCESS outcome with the created employee record', async () => {
      const result = await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.employee.id).toBe(EMP_ID);
        expect(result.employee.employmentStatus).toBe('PENDING_ONBOARDING');
        expect(result.employee.appointmentAuthority).toBe('COMPETITIVE_APPOINTMENT');
        expect(result.employee.departmentId).toBe(DEPT_ID);
      }
    });

    it('creates employee with correct system-assigned and derived field values', async () => {
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(mockTx.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            departmentId: DEPT_ID,      // derived from position (GD-M19-1 D5)
            positionId: POS_ID,
            firstName: CAND_FIRST,
            lastName: CAND_LAST,
            email: CAND_EMAIL,
            employmentStatus: 'PENDING_ONBOARDING',
            appointmentAuthority: 'COMPETITIVE_APPOINTMENT',
            hireDate: expect.any(Date),
          }),
        }),
      );
    });

    it('passes generated employeeNumber to employee.create', async () => {
      (mockPrisma.employee.count as jest.Mock).mockResolvedValue(0);
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(mockTx.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ employeeNumber: 'EMP-001' }),
        }),
      );
    });

    it('sets selected application to HIRED inside the transaction', async () => {
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(mockTx.application.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: APP_ID },
          data: { status: 'HIRED' },
        }),
      );
    });

    it('sets vacancy to FILLED with filledAt timestamp inside the transaction', async () => {
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(mockTx.vacancy.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: VAC_ID },
          data: expect.objectContaining({ status: 'FILLED', filledAt: expect.any(Date) }),
        }),
      );
    });

    it('displaces other non-terminal applications to REJECTED, excluding the hired application', async () => {
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(mockTx.application.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            vacancyId: VAC_ID,
            id: { not: APP_ID },
            tenantId: TENANT_ID,
            deletedAt: null,
            status: { notIn: ['HIRED', 'REJECTED', 'WITHDRAWN'] },
          }),
          data: { status: 'REJECTED' },
        }),
      );
    });

    it('emits exactly 4 audit events after the transaction commits', async () => {
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(mockAuditService.logEvent).toHaveBeenCalledTimes(4);
    });

    it('emits audit events in correct order with correct action types', async () => {
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      const calls = (mockAuditService.logEvent as jest.Mock).mock.calls;
      expect(calls[0][0].action).toBe(AuditEventType.RECRUITING_CANDIDATE_HIRED);
      expect(calls[1][0].action).toBe(AuditEventType.WORKFORCE_EMPLOYEE_CREATED_FROM_HIRE);
      expect(calls[2][0].action).toBe(AuditEventType.WORKFORCE_VACANCY_FILLED_FROM_HIRE);
      expect(calls[3][0].action).toBe(AuditEventType.WORKFORCE_EMPLOYEE_POSITION_ASSIGNED_FROM_HIRE);
    });

    it('RECRUITING_CANDIDATE_HIRED metadata contains candidateId, vacancyId, trigger', async () => {
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      const [[dto]] = (mockAuditService.logEvent as jest.Mock).mock.calls;
      expect(dto.entityType).toBe('Application');
      expect(dto.entityId).toBe(APP_ID);
      expect(dto.metadata).toMatchObject({
        candidateId: CAND_ID,
        vacancyId: VAC_ID,
        trigger: 'M19_HIRE',
      });
    });

    it('WORKFORCE_VACANCY_FILLED_FROM_HIRE metadata contains previousStatus, newStatus, applicationId', async () => {
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      const calls = (mockAuditService.logEvent as jest.Mock).mock.calls;
      expect(calls[2][0].metadata).toMatchObject({
        previousStatus: 'IN_RECRUITMENT',
        newStatus: 'FILLED',
        applicationId: APP_ID,
        trigger: 'M19_HIRE',
      });
    });

    it('audit metadata excludes candidate name, email, and other PII (GD-M19-1 D12)', async () => {
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      for (const [dto] of (mockAuditService.logEvent as jest.Mock).mock.calls) {
        const metaStr = JSON.stringify(dto.metadata ?? {});
        expect(metaStr).not.toContain(CAND_FIRST);
        expect(metaStr).not.toContain(CAND_LAST);
        expect(metaStr).not.toContain(CAND_EMAIL);
      }
    });

    it('does not emit audit events when the transaction fails', async () => {
      (mockPrisma.$transaction as jest.Mock).mockRejectedValue(new Error('DB unavailable'));
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('does not mutate offer records — only offer.findFirst is called', async () => {
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(mockPrisma.offer.findFirst).toHaveBeenCalledTimes(1); // precondition 4 only
    });
  });

  // -------------------------------------------------------------------------
  // Precondition 1: APPLICATION_NOT_FOUND
  // -------------------------------------------------------------------------

  describe('hire() — APPLICATION_NOT_FOUND', () => {
    it('returns APPLICATION_NOT_FOUND when application is absent', async () => {
      (mockPrisma.application.findFirst as jest.Mock).mockResolvedValue(null);
      const result = await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('APPLICATION_NOT_FOUND');
    });

    it('returns APPLICATION_NOT_FOUND for cross-tenant application (SEC-003)', async () => {
      (mockPrisma.application.findFirst as jest.Mock).mockResolvedValue(null);
      const result = await service.hire(APP_ID, 'other-tenant-uuid', ACTOR_ID);
      expect(result.outcome).toBe('APPLICATION_NOT_FOUND');
    });

    it('does not call downstream lookups when application is not found', async () => {
      (mockPrisma.application.findFirst as jest.Mock).mockResolvedValue(null);
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(mockPrisma.offer.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Precondition 2: APPLICATION_ALREADY_HIRED (idempotency guard)
  // -------------------------------------------------------------------------

  describe('hire() — APPLICATION_ALREADY_HIRED', () => {
    it('returns APPLICATION_ALREADY_HIRED when application.status is HIRED', async () => {
      (mockPrisma.application.findFirst as jest.Mock).mockResolvedValue(
        makeAppRow({ status: 'HIRED' }),
      );
      const result = await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('APPLICATION_ALREADY_HIRED');
    });

    it('HIRED check fires before OFFER check — no offer lookup or transaction (GD-M19-1 D4 rule ordering)', async () => {
      (mockPrisma.application.findFirst as jest.Mock).mockResolvedValue(
        makeAppRow({ status: 'HIRED' }),
      );
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(mockPrisma.offer.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Precondition 3: APPLICATION_NOT_AT_OFFER_STATUS
  // -------------------------------------------------------------------------

  describe('hire() — APPLICATION_NOT_AT_OFFER_STATUS', () => {
    it.each([
      ['APPLIED'],
      ['SCREENING'],
      ['INTERVIEW'],
      ['EVALUATION'],
      ['REJECTED'],
      ['WITHDRAWN'],
    ])('returns APPLICATION_NOT_AT_OFFER_STATUS for application.status = %s', async (status) => {
      (mockPrisma.application.findFirst as jest.Mock).mockResolvedValue(
        makeAppRow({ status }),
      );
      const result = await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('APPLICATION_NOT_AT_OFFER_STATUS');
    });
  });

  // -------------------------------------------------------------------------
  // Precondition 4: ACCEPTED_OFFER_NOT_FOUND
  // -------------------------------------------------------------------------

  describe('hire() — ACCEPTED_OFFER_NOT_FOUND', () => {
    it('returns ACCEPTED_OFFER_NOT_FOUND when no ACCEPTED offer exists', async () => {
      (mockPrisma.offer.findFirst as jest.Mock).mockResolvedValue(null);
      const result = await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('ACCEPTED_OFFER_NOT_FOUND');
    });

    it('does not start the transaction when accepted offer is absent', async () => {
      (mockPrisma.offer.findFirst as jest.Mock).mockResolvedValue(null);
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Precondition 5: CANDIDATE_NOT_FOUND / CANDIDATE_ARCHIVED
  // -------------------------------------------------------------------------

  describe('hire() — CANDIDATE_NOT_FOUND', () => {
    it('returns CANDIDATE_NOT_FOUND when candidate is absent or deleted', async () => {
      (mockPrisma.candidate.findFirst as jest.Mock).mockResolvedValue(null);
      const result = await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('CANDIDATE_NOT_FOUND');
    });
  });

  describe('hire() — CANDIDATE_ARCHIVED', () => {
    it('returns CANDIDATE_ARCHIVED when candidate.status is ARCHIVED', async () => {
      (mockPrisma.candidate.findFirst as jest.Mock).mockResolvedValue(
        makeCandidateRow({ status: 'ARCHIVED' }),
      );
      const result = await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('CANDIDATE_ARCHIVED');
    });
  });

  // -------------------------------------------------------------------------
  // Precondition 6: VACANCY_NOT_FOUND / VACANCY_NOT_AVAILABLE
  // -------------------------------------------------------------------------

  describe('hire() — VACANCY_NOT_FOUND', () => {
    it('returns VACANCY_NOT_FOUND when vacancy is absent or deleted', async () => {
      (mockPrisma.vacancy.findFirst as jest.Mock).mockResolvedValue(null);
      const result = await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('VACANCY_NOT_FOUND');
    });
  });

  describe('hire() — VACANCY_NOT_AVAILABLE', () => {
    it('returns VACANCY_NOT_AVAILABLE when vacancy.status is FILLED', async () => {
      (mockPrisma.vacancy.findFirst as jest.Mock).mockResolvedValue(
        makeVacancyRow({ status: 'FILLED' }),
      );
      const result = await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('VACANCY_NOT_AVAILABLE');
    });

    it('returns VACANCY_NOT_AVAILABLE when vacancy.status is CANCELLED', async () => {
      (mockPrisma.vacancy.findFirst as jest.Mock).mockResolvedValue(
        makeVacancyRow({ status: 'CANCELLED' }),
      );
      const result = await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('VACANCY_NOT_AVAILABLE');
    });

    it.each(['OPEN', 'IN_RECRUITMENT', 'CLOSED'])(
      'allows hire when vacancy.status is %s (hireable by GD-M19-1 D4 rule 6)',
      async (status) => {
        (mockPrisma.vacancy.findFirst as jest.Mock).mockResolvedValue(
          makeVacancyRow({ status }),
        );
        const result = await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
        expect(result.outcome).toBe('SUCCESS');
      },
    );
  });

  // -------------------------------------------------------------------------
  // Precondition 7: POSITION_NOT_FOUND
  // -------------------------------------------------------------------------

  describe('hire() — POSITION_NOT_FOUND', () => {
    it('returns POSITION_NOT_FOUND when position is absent or soft-deleted', async () => {
      (mockPrisma.position.findFirst as jest.Mock).mockResolvedValue(null);
      const result = await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('POSITION_NOT_FOUND');
    });
  });

  // -------------------------------------------------------------------------
  // Precondition 8: POSITION_NOT_AVAILABLE
  // -------------------------------------------------------------------------

  describe('hire() — POSITION_NOT_AVAILABLE', () => {
    it('returns POSITION_NOT_AVAILABLE when an active incumbent holds the position', async () => {
      (mockPrisma.employee.findFirst as jest.Mock).mockResolvedValue({ id: 'incumbent-uuid' });
      const result = await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('POSITION_NOT_AVAILABLE');
    });

    it('occupancy check uses the correct employment status list', async () => {
      (mockPrisma.employee.findFirst as jest.Mock).mockResolvedValue({ id: 'incumbent-uuid' });
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(mockPrisma.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            positionId: POS_ID,
            employmentStatus: {
              in: ['PENDING_ONBOARDING', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED'],
            },
            deletedAt: null,
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Employee number generation
  // -------------------------------------------------------------------------

  describe('hire() — employee number generation', () => {
    it.each([
      [0, 'EMP-001'],
      [1, 'EMP-002'],
      [41, 'EMP-042'],
      [99, 'EMP-100'],
      [999, 'EMP-1000'],
    ])('with count=%d generates employeeNumber=%s', async (count, expected) => {
      (mockPrisma.employee.count as jest.Mock).mockResolvedValue(count);
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(mockTx.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ employeeNumber: expected }),
        }),
      );
    });

    it('counts only non-deleted employees in this tenant for Phase A', async () => {
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(mockPrisma.employee.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID, deletedAt: null },
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // EMPLOYEE_NUMBER_GENERATION_FAILED (P2002)
  // -------------------------------------------------------------------------

  describe('hire() — EMPLOYEE_NUMBER_GENERATION_FAILED', () => {
    it('returns EMPLOYEE_NUMBER_GENERATION_FAILED on P2002 from employee.create', async () => {
      (mockPrisma.$transaction as jest.Mock).mockRejectedValue(makePrismaP2002());
      const result = await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('EMPLOYEE_NUMBER_GENERATION_FAILED');
    });

    it('does not emit audit events on P2002 collision', async () => {
      (mockPrisma.$transaction as jest.Mock).mockRejectedValue(makePrismaP2002());
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // INTERNAL_ERROR
  // -------------------------------------------------------------------------

  describe('hire() — INTERNAL_ERROR', () => {
    it('returns INTERNAL_ERROR on unexpected transaction failure', async () => {
      (mockPrisma.$transaction as jest.Mock).mockRejectedValue(new Error('DB crash'));
      const result = await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('returns INTERNAL_ERROR on application lookup failure', async () => {
      (mockPrisma.application.findFirst as jest.Mock).mockRejectedValue(
        new Error('connection lost'),
      );
      const result = await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('returns INTERNAL_ERROR on candidate lookup failure', async () => {
      (mockPrisma.candidate.findFirst as jest.Mock).mockRejectedValue(new Error('timeout'));
      const result = await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('returns INTERNAL_ERROR on employee count failure', async () => {
      (mockPrisma.employee.count as jest.Mock).mockRejectedValue(new Error('count failed'));
      const result = await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('does not emit audit events on INTERNAL_ERROR', async () => {
      (mockPrisma.$transaction as jest.Mock).mockRejectedValue(new Error('DB crash'));
      await service.hire(APP_ID, TENANT_ID, ACTOR_ID);
      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });
  });
});
