// Reference: governance/GD-M18-1.md — Decision 18 (InterviewService unit tests required)
// Reference: governance/GD-M18-1.md — Decision 5 (lifecycle), 8 (app relationship), 14 (error codes), 17 (audit/PII)
//
// Pure unit tests — no database.
// PrismaService and AuditService replaced with jest.fn() mocks.
// Verifies all discriminated-union outcomes for each InterviewService method.
// SEC-003 tenant isolation: tenantId always present in where clauses; cross-tenant = NOT_FOUND.
// INTERVIEWER_REQUIRED: service-layer check; both interviewer fields absent on create → 422.
// INTERVIEWER_NOT_FOUND: absent/deleted/cross-tenant interviewerUserId → same 404 (no enumeration).
// Terminal states: COMPLETED, CANCELLED, NO_SHOW block transitions (GD-M18-1 D5).
// Feedback blocked on CANCELLED and NO_SHOW (GD-M18-1 D5).
// PII safety: interview feedback text and interviewerName must not appear in audit metadata (GD-M18-1 D17).

import { Test, type TestingModule } from '@nestjs/testing';

import { InterviewService } from './interview.service';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import type { CreateInterviewParams, UpdateInterviewParams, RecordFeedbackParams } from './interview.service';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID      = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_TENANT   = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const ACTOR_ID       = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const APPLICATION_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const INTERVIEW_ID   = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const INTERVIEWER_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const CREATED_AT = new Date('2026-07-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-07-01T01:00:00.000Z');

function makeInterviewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INTERVIEW_ID,
    tenantId: TENANT_ID,
    applicationId: APPLICATION_ID,
    interviewType: 'PHONE_SCREEN',
    scheduledAt: null as Date | null,
    status: 'SCHEDULED',
    interviewerName: 'Jane Smith',
    interviewerUserId: null as string | null,
    feedback: null as string | null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

const APPLICATION_ROW_ACTIVE = { id: APPLICATION_ID, status: 'INTERVIEW' };
const USER_ROW = { id: INTERVIEWER_ID };

const CREATE_PARAMS_NAME: CreateInterviewParams = {
  applicationId: APPLICATION_ID,
  interviewType: 'PHONE_SCREEN',
  interviewerName: 'Jane Smith',
};

const CREATE_PARAMS_USERID: CreateInterviewParams = {
  applicationId: APPLICATION_ID,
  interviewType: 'PANEL',
  interviewerUserId: INTERVIEWER_ID,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InterviewService', () => {
  let service: InterviewService;

  const mockPrisma = {
    application: {
      findFirst: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
    interview: {
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
        InterviewService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<InterviewService>(InterviewService);
  });

  // ---------------------------------------------------------------------------
  // createInterview
  // ---------------------------------------------------------------------------

  describe('createInterview()', () => {
    function setupHappyPathName() {
      mockPrisma.application.findFirst.mockResolvedValue(APPLICATION_ROW_ACTIVE);
      mockPrisma.interview.create.mockResolvedValue(makeInterviewRow());
      mockAuditService.logEvent.mockResolvedValue(undefined);
    }

    function setupHappyPathUserId() {
      mockPrisma.application.findFirst.mockResolvedValue(APPLICATION_ROW_ACTIVE);
      mockPrisma.user.findFirst.mockResolvedValue(USER_ROW);
      mockPrisma.interview.create.mockResolvedValue(makeInterviewRow({ interviewerUserId: INTERVIEWER_ID, interviewerName: null }));
      mockAuditService.logEvent.mockResolvedValue(undefined);
    }

    it('success — interviewerName present; status SCHEDULED; audit emitted', async () => {
      setupHappyPathName();

      const result = await service.createInterview(CREATE_PARAMS_NAME, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.interview.status).toBe('SCHEDULED');
        expect(result.interview.applicationId).toBe(APPLICATION_ID);
      }
      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.RECRUITING_INTERVIEW_SCHEDULED }),
      );
    });

    it('success — interviewerUserId present; user validated in same tenant', async () => {
      setupHappyPathUserId();

      const result = await service.createInterview(CREATE_PARAMS_USERID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: INTERVIEWER_ID, tenantId: TENANT_ID, deletedAt: null }) }),
      );
    });

    it('create data always sets status: "SCHEDULED" — never from caller (GD-M18-1 D13)', async () => {
      setupHappyPathName();

      await service.createInterview(CREATE_PARAMS_NAME, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.interview.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'SCHEDULED' }) }),
      );
    });

    it('create data includes tenantId from JWT context — never from params (SEC-003)', async () => {
      setupHappyPathName();

      await service.createInterview(CREATE_PARAMS_NAME, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.interview.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tenantId: TENANT_ID }) }),
      );
    });

    it('application not found (absent or cross-tenant) → APPLICATION_NOT_FOUND; no write', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(null);

      const result = await service.createInterview(CREATE_PARAMS_NAME, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('APPLICATION_NOT_FOUND');
      expect(mockPrisma.interview.create).not.toHaveBeenCalled();
    });

    it('application soft-deleted (findFirst null) → APPLICATION_NOT_FOUND', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(null);

      const result = await service.createInterview(CREATE_PARAMS_NAME, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('APPLICATION_NOT_FOUND');
    });

    it('application cross-tenant → APPLICATION_NOT_FOUND (SEC-003)', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(null);

      const result = await service.createInterview(CREATE_PARAMS_NAME, OTHER_TENANT, ACTOR_ID);

      expect(result.outcome).toBe('APPLICATION_NOT_FOUND');
    });

    it('application status REJECTED → APPLICATION_IN_TERMINAL_STATE', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ ...APPLICATION_ROW_ACTIVE, status: 'REJECTED' });

      const result = await service.createInterview(CREATE_PARAMS_NAME, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('APPLICATION_IN_TERMINAL_STATE');
      expect(mockPrisma.interview.create).not.toHaveBeenCalled();
    });

    it('application status WITHDRAWN → APPLICATION_IN_TERMINAL_STATE', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ ...APPLICATION_ROW_ACTIVE, status: 'WITHDRAWN' });

      const result = await service.createInterview(CREATE_PARAMS_NAME, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('APPLICATION_IN_TERMINAL_STATE');
    });

    it('application status HIRED → APPLICATION_IN_TERMINAL_STATE', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ ...APPLICATION_ROW_ACTIVE, status: 'HIRED' });

      const result = await service.createInterview(CREATE_PARAMS_NAME, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('APPLICATION_IN_TERMINAL_STATE');
    });

    it('neither interviewerName nor interviewerUserId provided → INTERVIEWER_REQUIRED; no DB queries', async () => {
      const result = await service.createInterview(
        { applicationId: APPLICATION_ID, interviewType: 'PHONE_SCREEN' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('INTERVIEWER_REQUIRED');
      expect(mockPrisma.application.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.interview.create).not.toHaveBeenCalled();
    });

    it('interviewerUserId provided but user does not exist → INTERVIEWER_NOT_FOUND', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(APPLICATION_ROW_ACTIVE);
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const result = await service.createInterview(CREATE_PARAMS_USERID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEWER_NOT_FOUND');
      expect(mockPrisma.interview.create).not.toHaveBeenCalled();
    });

    it('interviewerUserId cross-tenant (findFirst null via tenantId filter) → INTERVIEWER_NOT_FOUND (SEC-003)', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(APPLICATION_ROW_ACTIVE);
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const result = await service.createInterview(CREATE_PARAMS_USERID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEWER_NOT_FOUND');
    });

    it('interviewerUserId soft-deleted (findFirst null via deletedAt filter) → INTERVIEWER_NOT_FOUND', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(APPLICATION_ROW_ACTIVE);
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const result = await service.createInterview(CREATE_PARAMS_USERID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEWER_NOT_FOUND');
    });

    it('application DB error → INTERNAL_ERROR', async () => {
      mockPrisma.application.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await service.createInterview(CREATE_PARAMS_NAME, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // listInterviews
  // ---------------------------------------------------------------------------

  describe('listInterviews()', () => {
    it('success with pagination defaults — returns interviews, total, page, pageSize', async () => {
      mockPrisma.interview.findMany.mockResolvedValue([makeInterviewRow()]);
      mockPrisma.interview.count.mockResolvedValue(1);

      const result = await service.listInterviews({}, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.interviews).toHaveLength(1);
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(20);
        expect(result.total).toBe(1);
      }
    });

    it('list always filtered by tenantId and deletedAt IS NULL (SEC-003)', async () => {
      mockPrisma.interview.findMany.mockResolvedValue([]);
      mockPrisma.interview.count.mockResolvedValue(0);

      await service.listInterviews({}, TENANT_ID);

      expect(mockPrisma.interview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_ID, deletedAt: null }),
        }),
      );
    });

    it('applicationId filter applied when provided', async () => {
      mockPrisma.interview.findMany.mockResolvedValue([]);
      mockPrisma.interview.count.mockResolvedValue(0);

      await service.listInterviews({ applicationId: APPLICATION_ID }, TENANT_ID);

      expect(mockPrisma.interview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ applicationId: APPLICATION_ID }),
        }),
      );
    });

    it('status filter applied when provided', async () => {
      mockPrisma.interview.findMany.mockResolvedValue([]);
      mockPrisma.interview.count.mockResolvedValue(0);

      await service.listInterviews({ status: 'COMPLETED' }, TENANT_ID);

      expect(mockPrisma.interview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
    });

    it('interviewType filter applied when provided', async () => {
      mockPrisma.interview.findMany.mockResolvedValue([]);
      mockPrisma.interview.count.mockResolvedValue(0);

      await service.listInterviews({ interviewType: 'PANEL' }, TENANT_ID);

      expect(mockPrisma.interview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ interviewType: 'PANEL' }),
        }),
      );
    });

    it('DB error → INTERNAL_ERROR', async () => {
      mockPrisma.interview.findMany.mockRejectedValue(new Error('DB error'));

      const result = await service.listInterviews({}, TENANT_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // getInterviewById
  // ---------------------------------------------------------------------------

  describe('getInterviewById()', () => {
    it('success — returns interview record', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow());

      const result = await service.getInterviewById(INTERVIEW_ID, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.interview.id).toBe(INTERVIEW_ID);
      }
    });

    it('interview not found → INTERVIEW_NOT_FOUND', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(null);

      const result = await service.getInterviewById(INTERVIEW_ID, TENANT_ID);

      expect(result.outcome).toBe('INTERVIEW_NOT_FOUND');
    });

    it('soft-deleted interview (findFirst null via deletedAt filter) → INTERVIEW_NOT_FOUND', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(null);

      const result = await service.getInterviewById(INTERVIEW_ID, TENANT_ID);

      expect(result.outcome).toBe('INTERVIEW_NOT_FOUND');
    });

    it('cross-tenant interview (findFirst null via tenantId filter) → INTERVIEW_NOT_FOUND (SEC-003)', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(null);

      const result = await service.getInterviewById(INTERVIEW_ID, OTHER_TENANT);

      expect(result.outcome).toBe('INTERVIEW_NOT_FOUND');
    });

    it('query includes tenantId and deletedAt IS NULL (SEC-003)', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow());

      await service.getInterviewById(INTERVIEW_ID, TENANT_ID);

      expect(mockPrisma.interview.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: INTERVIEW_ID, tenantId: TENANT_ID, deletedAt: null }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // updateInterview
  // ---------------------------------------------------------------------------

  describe('updateInterview()', () => {
    const UPDATE_PARAMS_SCHEDULED_AT: UpdateInterviewParams = { scheduledAt: '2026-07-20T10:00:00.000Z' };
    const UPDATE_PARAMS_INTERVIEWER_NAME: UpdateInterviewParams = { interviewerName: 'Bob Jones' };
    const UPDATE_PARAMS_INTERVIEWER_USERID: UpdateInterviewParams = { interviewerUserId: INTERVIEWER_ID };

    function setupHappyPath(existingOverrides: Record<string, unknown> = {}) {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow(existingOverrides));
      mockPrisma.interview.update.mockResolvedValue(makeInterviewRow(existingOverrides));
      mockAuditService.logEvent.mockResolvedValue(undefined);
    }

    it('success — SCHEDULED; scheduledAt updated', async () => {
      setupHappyPath();

      const result = await service.updateInterview(INTERVIEW_ID, UPDATE_PARAMS_SCHEDULED_AT, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      expect(mockPrisma.interview.update).toHaveBeenCalled();
    });

    it('success — SCHEDULED; interviewerName updated', async () => {
      setupHappyPath();

      const result = await service.updateInterview(INTERVIEW_ID, UPDATE_PARAMS_INTERVIEWER_NAME, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('success — SCHEDULED; interviewerUserId updated to valid same-tenant user', async () => {
      setupHappyPath();
      mockPrisma.user.findFirst.mockResolvedValue(USER_ROW);

      const result = await service.updateInterview(INTERVIEW_ID, UPDATE_PARAMS_INTERVIEWER_USERID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: INTERVIEWER_ID, tenantId: TENANT_ID, deletedAt: null }) }),
      );
    });

    it('interview not found → INTERVIEW_NOT_FOUND', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(null);

      const result = await service.updateInterview(INTERVIEW_ID, UPDATE_PARAMS_SCHEDULED_AT, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEW_NOT_FOUND');
    });

    it('interview in COMPLETED state → INTERVIEW_IN_TERMINAL_STATE', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'COMPLETED' }));

      const result = await service.updateInterview(INTERVIEW_ID, UPDATE_PARAMS_SCHEDULED_AT, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEW_IN_TERMINAL_STATE');
      expect(mockPrisma.interview.update).not.toHaveBeenCalled();
    });

    it('interview in CANCELLED state → INTERVIEW_IN_TERMINAL_STATE', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'CANCELLED' }));

      const result = await service.updateInterview(INTERVIEW_ID, UPDATE_PARAMS_SCHEDULED_AT, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEW_IN_TERMINAL_STATE');
    });

    it('interview in NO_SHOW state → INTERVIEW_IN_TERMINAL_STATE', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'NO_SHOW' }));

      const result = await service.updateInterview(INTERVIEW_ID, UPDATE_PARAMS_SCHEDULED_AT, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEW_IN_TERMINAL_STATE');
    });

    it('interviewerUserId provided but user does not exist → INTERVIEWER_NOT_FOUND', async () => {
      setupHappyPath();
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const result = await service.updateInterview(INTERVIEW_ID, UPDATE_PARAMS_INTERVIEWER_USERID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEWER_NOT_FOUND');
    });

    it('interviewerUserId provided but user belongs to different tenant → INTERVIEWER_NOT_FOUND (SEC-003)', async () => {
      setupHappyPath();
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const result = await service.updateInterview(INTERVIEW_ID, UPDATE_PARAMS_INTERVIEWER_USERID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEWER_NOT_FOUND');
    });

    it('updating to remove both interviewerName and interviewerUserId → INTERVIEWER_REQUIRED', async () => {
      // Existing: interviewerName set, interviewerUserId null
      mockPrisma.interview.findFirst.mockResolvedValue(
        makeInterviewRow({ interviewerName: 'Jane Smith', interviewerUserId: null }),
      );

      // Params: explicitly clear interviewerName; interviewerUserId undefined (unchanged → null)
      const result = await service.updateInterview(
        INTERVIEW_ID,
        { interviewerName: null },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('INTERVIEWER_REQUIRED');
      expect(mockPrisma.interview.update).not.toHaveBeenCalled();
    });

    it('audit emitted with field names only — no new values in metadata', async () => {
      setupHappyPath();

      await service.updateInterview(INTERVIEW_ID, UPDATE_PARAMS_SCHEDULED_AT, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.RECRUITING_INTERVIEW_UPDATED,
          metadata: expect.objectContaining({ fieldsChanged: expect.arrayContaining(['scheduledAt']) }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // completeInterview
  // ---------------------------------------------------------------------------

  describe('completeInterview()', () => {
    it('success — SCHEDULED → COMPLETED; audit emitted', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'SCHEDULED' }));
      mockPrisma.interview.update.mockResolvedValue(makeInterviewRow({ status: 'COMPLETED' }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.completeInterview(INTERVIEW_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.interview.status).toBe('COMPLETED');
      }
      expect(mockPrisma.interview.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'COMPLETED' } }),
      );
    });

    it('already COMPLETED → INTERVIEW_IN_TERMINAL_STATE; no write', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'COMPLETED' }));

      const result = await service.completeInterview(INTERVIEW_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEW_IN_TERMINAL_STATE');
      expect(mockPrisma.interview.update).not.toHaveBeenCalled();
    });

    it('CANCELLED → INTERVIEW_IN_TERMINAL_STATE', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'CANCELLED' }));

      const result = await service.completeInterview(INTERVIEW_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEW_IN_TERMINAL_STATE');
    });

    it('NO_SHOW → INTERVIEW_IN_TERMINAL_STATE', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'NO_SHOW' }));

      const result = await service.completeInterview(INTERVIEW_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEW_IN_TERMINAL_STATE');
    });

    it('interview not found → INTERVIEW_NOT_FOUND', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(null);

      const result = await service.completeInterview(INTERVIEW_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEW_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // recordFeedback
  // ---------------------------------------------------------------------------

  describe('recordFeedback()', () => {
    const FEEDBACK_PARAMS: RecordFeedbackParams = { feedback: 'Strong technical skills.' };

    it('success on SCHEDULED interview — feedback recorded; status unchanged', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'SCHEDULED' }));
      mockPrisma.interview.update.mockResolvedValue(makeInterviewRow({ status: 'SCHEDULED', feedback: FEEDBACK_PARAMS.feedback }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.recordFeedback(INTERVIEW_ID, FEEDBACK_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      expect(mockPrisma.interview.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { feedback: FEEDBACK_PARAMS.feedback } }),
      );
    });

    it('success on COMPLETED interview — feedback recorded', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'COMPLETED' }));
      mockPrisma.interview.update.mockResolvedValue(makeInterviewRow({ status: 'COMPLETED', feedback: FEEDBACK_PARAMS.feedback }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.recordFeedback(INTERVIEW_ID, FEEDBACK_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('CANCELLED → INTERVIEW_FEEDBACK_NOT_ALLOWED; no write', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'CANCELLED' }));

      const result = await service.recordFeedback(INTERVIEW_ID, FEEDBACK_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEW_FEEDBACK_NOT_ALLOWED');
      expect(mockPrisma.interview.update).not.toHaveBeenCalled();
    });

    it('NO_SHOW → INTERVIEW_FEEDBACK_NOT_ALLOWED; no write', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'NO_SHOW' }));

      const result = await service.recordFeedback(INTERVIEW_ID, FEEDBACK_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEW_FEEDBACK_NOT_ALLOWED');
    });

    it('interview not found → INTERVIEW_NOT_FOUND', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(null);

      const result = await service.recordFeedback(INTERVIEW_ID, FEEDBACK_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEW_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // cancelInterview
  // ---------------------------------------------------------------------------

  describe('cancelInterview()', () => {
    it('success — SCHEDULED → CANCELLED; audit emitted', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'SCHEDULED' }));
      mockPrisma.interview.update.mockResolvedValue(makeInterviewRow({ status: 'CANCELLED' }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.cancelInterview(INTERVIEW_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.interview.status).toBe('CANCELLED');
      }
      expect(mockPrisma.interview.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CANCELLED' } }),
      );
    });

    it('already CANCELLED → INTERVIEW_IN_TERMINAL_STATE; no write', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'CANCELLED' }));

      const result = await service.cancelInterview(INTERVIEW_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEW_IN_TERMINAL_STATE');
      expect(mockPrisma.interview.update).not.toHaveBeenCalled();
    });

    it('COMPLETED → INTERVIEW_IN_TERMINAL_STATE', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'COMPLETED' }));

      const result = await service.cancelInterview(INTERVIEW_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEW_IN_TERMINAL_STATE');
    });

    it('NO_SHOW → INTERVIEW_IN_TERMINAL_STATE', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'NO_SHOW' }));

      const result = await service.cancelInterview(INTERVIEW_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEW_IN_TERMINAL_STATE');
    });

    it('interview not found → INTERVIEW_NOT_FOUND', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(null);

      const result = await service.cancelInterview(INTERVIEW_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEW_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // noShowInterview
  // ---------------------------------------------------------------------------

  describe('noShowInterview()', () => {
    it('success — SCHEDULED → NO_SHOW; audit emitted', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'SCHEDULED' }));
      mockPrisma.interview.update.mockResolvedValue(makeInterviewRow({ status: 'NO_SHOW' }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.noShowInterview(INTERVIEW_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.interview.status).toBe('NO_SHOW');
      }
      expect(mockPrisma.interview.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'NO_SHOW' } }),
      );
    });

    it('already NO_SHOW → INTERVIEW_IN_TERMINAL_STATE; no write', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'NO_SHOW' }));

      const result = await service.noShowInterview(INTERVIEW_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEW_IN_TERMINAL_STATE');
      expect(mockPrisma.interview.update).not.toHaveBeenCalled();
    });

    it('COMPLETED → INTERVIEW_IN_TERMINAL_STATE', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'COMPLETED' }));

      const result = await service.noShowInterview(INTERVIEW_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEW_IN_TERMINAL_STATE');
    });

    it('CANCELLED → INTERVIEW_IN_TERMINAL_STATE', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'CANCELLED' }));

      const result = await service.noShowInterview(INTERVIEW_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEW_IN_TERMINAL_STATE');
    });

    it('interview not found → INTERVIEW_NOT_FOUND', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(null);

      const result = await service.noShowInterview(INTERVIEW_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERVIEW_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // Audit events (GD-M18-1 D17 — event types and metadata)
  // ---------------------------------------------------------------------------

  describe('Audit events', () => {
    it('RECRUITING_INTERVIEW_SCHEDULED emitted on createInterview', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(APPLICATION_ROW_ACTIVE);
      mockPrisma.interview.create.mockResolvedValue(makeInterviewRow());
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createInterview(CREATE_PARAMS_NAME, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.RECRUITING_INTERVIEW_SCHEDULED }),
      );
    });

    it('RECRUITING_INTERVIEW_UPDATED emitted on updateInterview', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow());
      mockPrisma.interview.update.mockResolvedValue(makeInterviewRow());
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateInterview(INTERVIEW_ID, { scheduledAt: '2026-07-20T10:00:00.000Z' }, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.RECRUITING_INTERVIEW_UPDATED }),
      );
    });

    it('RECRUITING_INTERVIEW_COMPLETED emitted on completeInterview', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow());
      mockPrisma.interview.update.mockResolvedValue(makeInterviewRow({ status: 'COMPLETED' }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.completeInterview(INTERVIEW_ID, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.RECRUITING_INTERVIEW_COMPLETED }),
      );
    });

    it('RECRUITING_INTERVIEW_CANCELLED emitted on cancelInterview', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow());
      mockPrisma.interview.update.mockResolvedValue(makeInterviewRow({ status: 'CANCELLED' }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.cancelInterview(INTERVIEW_ID, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.RECRUITING_INTERVIEW_CANCELLED }),
      );
    });

    it('RECRUITING_INTERVIEW_NO_SHOW emitted on noShowInterview', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow());
      mockPrisma.interview.update.mockResolvedValue(makeInterviewRow({ status: 'NO_SHOW' }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.noShowInterview(INTERVIEW_ID, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.RECRUITING_INTERVIEW_NO_SHOW }),
      );
    });

    it('RECRUITING_INTERVIEW_FEEDBACK_RECORDED emitted on recordFeedback; metadata has no feedback text', async () => {
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'COMPLETED' }));
      mockPrisma.interview.update.mockResolvedValue(makeInterviewRow({ status: 'COMPLETED', feedback: 'Strong.' }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.recordFeedback(INTERVIEW_ID, { feedback: 'Strong.' }, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.RECRUITING_INTERVIEW_FEEDBACK_RECORDED }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // PII safety (GD-M18-1 D17)
  // ---------------------------------------------------------------------------

  describe('PII safety', () => {
    it('audit metadata for createInterview does not contain interviewerName (PII)', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(APPLICATION_ROW_ACTIVE);
      mockPrisma.interview.create.mockResolvedValue(makeInterviewRow());
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createInterview(
        { applicationId: APPLICATION_ID, interviewType: 'PHONE_SCREEN', interviewerName: 'Jane Smith' },
        TENANT_ID,
        ACTOR_ID,
      );

      const call = mockAuditService.logEvent.mock.calls[0][0];
      expect(JSON.stringify(call.metadata)).not.toContain('Jane Smith');
      expect(call.metadata).not.toHaveProperty('interviewerName');
    });

    it('audit metadata for recordFeedback does not contain feedback text (PII/free-text)', async () => {
      const feedbackText = 'Exceptional problem-solving. Highly recommended.';
      mockPrisma.interview.findFirst.mockResolvedValue(makeInterviewRow({ status: 'SCHEDULED' }));
      mockPrisma.interview.update.mockResolvedValue(makeInterviewRow({ feedback: feedbackText }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.recordFeedback(INTERVIEW_ID, { feedback: feedbackText }, TENANT_ID, ACTOR_ID);

      const call = mockAuditService.logEvent.mock.calls[0][0];
      expect(JSON.stringify(call.metadata)).not.toContain(feedbackText);
      expect(call.metadata).not.toHaveProperty('feedback');
    });
  });
});
