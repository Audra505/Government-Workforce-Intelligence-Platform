// InterviewController unit tests
// Reference: governance/GD-M18-1.md — D5 (lifecycle), D13 (RBAC), D14 (error codes), D16 (tenant isolation)
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
//
// Pattern: mirrors apps/api/src/recruiting/application.controller.spec.ts
// Guards overridden with { canActivate: () => true } — RBAC enforcement tested separately
// by confirming @RequireRoles metadata via Reflect.getMetadata on each method.
// tenantId comes from actor.tenantId (JWT), never from body/params — SEC-003 verified
// by asserting the exact call signature passed to the mock service.
//
// HTTP code verification uses Reflect.getMetadata('__httpCode__', handler) — NestJS's
// @HttpCode decorator sets this key on the handler function (descriptor.value).
// Action endpoints (complete, feedback, cancel, no-show) must return 200, not the
// NestJS POST default of 201.
//
// Hiring Manager is denied for all M18A interview endpoints — confirmed by checking
// that 'Hiring Manager' does not appear in the @RequireRoles metadata for any method.

import { Test, type TestingModule } from '@nestjs/testing';
import {
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import { ROLES_KEY } from '../identity/decorators/require-roles.decorator';
import type { RequestUser } from '../identity/jwt.strategy';
import { InterviewController } from './interview.controller';
import { InterviewService, type InterviewRecord } from './interview.service';
import type { CreateInterviewDto } from './dto/create-interview.dto';
import type { UpdateInterviewDto } from './dto/update-interview.dto';
import type { InterviewFeedbackDto } from './dto/interview-feedback.dto';
import type { ListInterviewsQueryDto } from './dto/list-interviews-query.dto';

// ---------------------------------------------------------------------------
// Constants used in metadata reflections
// NestJS @HttpCode sets '__httpCode__' on descriptor.value (the handler function).
// ---------------------------------------------------------------------------
const HTTP_CODE_METADATA = '__httpCode__';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const INTERVIEW_ID   = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_ID      = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTOR_ID       = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const APPLICATION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const NOW = new Date('2026-07-01T00:00:00.000Z');

const interviewRecord: InterviewRecord = {
  id:                INTERVIEW_ID,
  tenantId:          TENANT_ID,
  applicationId:     APPLICATION_ID,
  interviewType:     'PHONE_SCREEN',
  scheduledAt:       null,
  status:            'SCHEDULED',
  interviewerName:   'Jane Smith',
  interviewerUserId: null,
  feedback:          null,
  createdAt:         NOW,
  updatedAt:         NOW,
};

const createDto: CreateInterviewDto = {
  applicationId:   APPLICATION_ID,
  interviewType:   'PHONE_SCREEN',
  interviewerName: 'Jane Smith',
};

const updateDto: UpdateInterviewDto = {
  interviewerName: 'Bob Jones',
};

const feedbackDto: InterviewFeedbackDto = {
  feedback: 'Strong candidate, clear communicator.',
};

const listQuery: ListInterviewsQueryDto = {
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

const complianceActor: RequestUser = {
  ...mockActor,
  roles: ['Compliance Officer'],
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe('InterviewController', () => {
  let controller: InterviewController;
  let mockService: {
    createInterview:    jest.Mock;
    listInterviews:     jest.Mock;
    getInterviewById:   jest.Mock;
    updateInterview:    jest.Mock;
    completeInterview:  jest.Mock;
    recordFeedback:     jest.Mock;
    cancelInterview:    jest.Mock;
    noShowInterview:    jest.Mock;
  };

  beforeEach(async () => {
    mockService = {
      createInterview:    jest.fn(),
      listInterviews:     jest.fn(),
      getInterviewById:   jest.fn(),
      updateInterview:    jest.fn(),
      completeInterview:  jest.fn(),
      recordFeedback:     jest.fn(),
      cancelInterview:    jest.fn(),
      noShowInterview:    jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InterviewController],
      providers: [
        { provide: InterviewService, useValue: mockService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<InterviewController>(InterviewController);
  });

  afterEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------------------
  // createInterview
  // ---------------------------------------------------------------------------

  describe('createInterview()', () => {
    it('SUCCESS: returns { success: true, data: interview shape }', async () => {
      mockService.createInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      const result = await controller.createInterview(createDto, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({
        id:            INTERVIEW_ID,
        applicationId: APPLICATION_ID,
        interviewType: 'PHONE_SCREEN',
        status:        'SCHEDULED',
      });
    });

    it('SUCCESS: response data does not include tenantId (SEC-003)', async () => {
      mockService.createInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      const result = await controller.createInterview(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: response data does not include deletedAt', async () => {
      mockService.createInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      const result = await controller.createInterview(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: createdAt and updatedAt are ISO 8601 strings', async () => {
      mockService.createInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      const result = await controller.createInterview(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(typeof result['data']['createdAt']).toBe('string');
      expect(typeof result['data']['updatedAt']).toBe('string');
      expect(result['data']['createdAt']).toBe(NOW.toISOString());
    });

    it('SUCCESS: scheduledAt is null when not set', async () => {
      mockService.createInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      const result = await controller.createInterview(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']['scheduledAt']).toBeNull();
    });

    it('SUCCESS: scheduledAt serialized as ISO 8601 string when set', async () => {
      const scheduledAt = new Date('2026-07-15T10:00:00.000Z');
      const recordWithScheduledAt = { ...interviewRecord, scheduledAt };
      mockService.createInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: recordWithScheduledAt });

      const result = await controller.createInterview(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']['scheduledAt']).toBe(scheduledAt.toISOString());
    });

    it('SUCCESS: actor.tenantId and actor.userId forwarded to service — not from DTO (SEC-003)', async () => {
      mockService.createInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      await controller.createInterview(createDto, mockActor);

      expect(mockService.createInterview).toHaveBeenCalledWith(
        expect.objectContaining({ applicationId: APPLICATION_ID, interviewType: 'PHONE_SCREEN' }),
        TENANT_ID,
        ACTOR_ID,
      );
    });

    it('APPLICATION_NOT_FOUND: throws NotFoundException', async () => {
      mockService.createInterview.mockResolvedValue({ outcome: 'APPLICATION_NOT_FOUND' });

      await expect(controller.createInterview(createDto, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('APPLICATION_NOT_FOUND: error body code = APPLICATION_NOT_FOUND', async () => {
      mockService.createInterview.mockResolvedValue({ outcome: 'APPLICATION_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.createInterview(createDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('APPLICATION_NOT_FOUND');
      expect(body['success']).toBe(false);
    });

    it('APPLICATION_IN_TERMINAL_STATE: throws UnprocessableEntityException', async () => {
      mockService.createInterview.mockResolvedValue({ outcome: 'APPLICATION_IN_TERMINAL_STATE' });

      await expect(controller.createInterview(createDto, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('APPLICATION_IN_TERMINAL_STATE: error body code = APPLICATION_IN_TERMINAL_STATE', async () => {
      mockService.createInterview.mockResolvedValue({ outcome: 'APPLICATION_IN_TERMINAL_STATE' });

      let thrown: unknown;
      try { await controller.createInterview(createDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('APPLICATION_IN_TERMINAL_STATE');
      expect(body['success']).toBe(false);
    });

    it('INTERVIEWER_REQUIRED: throws UnprocessableEntityException', async () => {
      mockService.createInterview.mockResolvedValue({ outcome: 'INTERVIEWER_REQUIRED' });

      await expect(controller.createInterview(createDto, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('INTERVIEWER_REQUIRED: error body code = INTERVIEWER_REQUIRED', async () => {
      mockService.createInterview.mockResolvedValue({ outcome: 'INTERVIEWER_REQUIRED' });

      let thrown: unknown;
      try { await controller.createInterview(createDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INTERVIEWER_REQUIRED');
      expect(body['success']).toBe(false);
    });

    it('INTERVIEWER_NOT_FOUND: throws NotFoundException', async () => {
      mockService.createInterview.mockResolvedValue({ outcome: 'INTERVIEWER_NOT_FOUND' });

      await expect(controller.createInterview(createDto, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('INTERVIEWER_NOT_FOUND: error body code = INTERVIEWER_NOT_FOUND', async () => {
      mockService.createInterview.mockResolvedValue({ outcome: 'INTERVIEWER_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.createInterview(createDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INTERVIEWER_NOT_FOUND');
      expect(body['success']).toBe(false);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.createInterview.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.createInterview(createDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // listInterviews
  // ---------------------------------------------------------------------------

  describe('listInterviews()', () => {
    it('SUCCESS: returns { success: true, data: paginated envelope }', async () => {
      mockService.listInterviews.mockResolvedValue({
        outcome:    'SUCCESS',
        interviews: [interviewRecord],
        total:      1,
        page:       1,
        pageSize:   20,
      });

      const result = await controller.listInterviews(listQuery, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      const data = result['data'] as Record<string, unknown>;
      expect(data['interviews']).toHaveLength(1);
      expect(data['total']).toBe(1);
      expect(data['page']).toBe(1);
      expect(data['pageSize']).toBe(20);
    });

    it('SUCCESS: totalPages computed as Math.ceil(total / pageSize)', async () => {
      mockService.listInterviews.mockResolvedValue({
        outcome: 'SUCCESS', interviews: [], total: 41, page: 1, pageSize: 20,
      });

      const result = await controller.listInterviews(listQuery, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']['totalPages']).toBe(3);
    });

    it('SUCCESS: interview records in list do not include tenantId (SEC-003)', async () => {
      mockService.listInterviews.mockResolvedValue({
        outcome: 'SUCCESS', interviews: [interviewRecord], total: 1, page: 1, pageSize: 20,
      });

      const result = await controller.listInterviews(listQuery, mockActor) as Record<string, Record<string, unknown[]>>;
      const interviews = result['data']['interviews'] as Record<string, unknown>[];

      expect(interviews[0]).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: interview records in list do not include deletedAt', async () => {
      mockService.listInterviews.mockResolvedValue({
        outcome: 'SUCCESS', interviews: [interviewRecord], total: 1, page: 1, pageSize: 20,
      });

      const result = await controller.listInterviews(listQuery, mockActor) as Record<string, Record<string, unknown[]>>;
      const interviews = result['data']['interviews'] as Record<string, unknown>[];

      expect(interviews[0]).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: actor.tenantId forwarded to service — not from query (SEC-003)', async () => {
      mockService.listInterviews.mockResolvedValue({
        outcome: 'SUCCESS', interviews: [], total: 0, page: 1, pageSize: 20,
      });

      await controller.listInterviews(listQuery, mockActor);

      expect(mockService.listInterviews).toHaveBeenCalledWith(
        expect.any(Object),
        TENANT_ID,
      );
    });

    it('SUCCESS: Compliance Officer actor passes through list (read authorization via @RequireRoles)', async () => {
      mockService.listInterviews.mockResolvedValue({
        outcome: 'SUCCESS', interviews: [], total: 0, page: 1, pageSize: 20,
      });

      const result = await controller.listInterviews(listQuery, complianceActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.listInterviews.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.listInterviews(listQuery, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // getInterviewById
  // ---------------------------------------------------------------------------

  describe('getInterviewById()', () => {
    it('SUCCESS: returns { success: true, data: interview shape }', async () => {
      mockService.getInterviewById.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      const result = await controller.getInterviewById(INTERVIEW_ID, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: INTERVIEW_ID, status: 'SCHEDULED' });
    });

    it('SUCCESS: response data does not include tenantId (SEC-003)', async () => {
      mockService.getInterviewById.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      const result = await controller.getInterviewById(INTERVIEW_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: response data does not include deletedAt', async () => {
      mockService.getInterviewById.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      const result = await controller.getInterviewById(INTERVIEW_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: id and actor.tenantId forwarded to service (SEC-003)', async () => {
      mockService.getInterviewById.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      await controller.getInterviewById(INTERVIEW_ID, mockActor);

      expect(mockService.getInterviewById).toHaveBeenCalledWith(INTERVIEW_ID, TENANT_ID);
    });

    it('SUCCESS: Compliance Officer actor passes through detail (read authorization via @RequireRoles)', async () => {
      mockService.getInterviewById.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      const result = await controller.getInterviewById(INTERVIEW_ID, complianceActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
    });

    it('INTERVIEW_NOT_FOUND: throws NotFoundException', async () => {
      mockService.getInterviewById.mockResolvedValue({ outcome: 'INTERVIEW_NOT_FOUND' });

      await expect(controller.getInterviewById(INTERVIEW_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('INTERVIEW_NOT_FOUND: error body code = INTERVIEW_NOT_FOUND', async () => {
      mockService.getInterviewById.mockResolvedValue({ outcome: 'INTERVIEW_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.getInterviewById(INTERVIEW_ID, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INTERVIEW_NOT_FOUND');
      expect(body['success']).toBe(false);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.getInterviewById.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.getInterviewById(INTERVIEW_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // updateInterview
  // ---------------------------------------------------------------------------

  describe('updateInterview()', () => {
    it('SUCCESS: returns { success: true, data: interview shape }', async () => {
      const updatedRecord = { ...interviewRecord, interviewerName: 'Bob Jones' };
      mockService.updateInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: updatedRecord });

      const result = await controller.updateInterview(INTERVIEW_ID, updateDto, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: INTERVIEW_ID });
    });

    it('SUCCESS: response data does not include tenantId (SEC-003)', async () => {
      mockService.updateInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      const result = await controller.updateInterview(INTERVIEW_ID, updateDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: response data does not include deletedAt', async () => {
      mockService.updateInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      const result = await controller.updateInterview(INTERVIEW_ID, updateDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: id, params, actor.tenantId, actor.userId forwarded to service (SEC-003)', async () => {
      mockService.updateInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      await controller.updateInterview(INTERVIEW_ID, updateDto, mockActor);

      expect(mockService.updateInterview).toHaveBeenCalledWith(
        INTERVIEW_ID,
        expect.objectContaining({ interviewerName: 'Bob Jones' }),
        TENANT_ID,
        ACTOR_ID,
      );
    });

    it('INTERVIEW_NOT_FOUND: throws NotFoundException', async () => {
      mockService.updateInterview.mockResolvedValue({ outcome: 'INTERVIEW_NOT_FOUND' });

      await expect(controller.updateInterview(INTERVIEW_ID, updateDto, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('INTERVIEW_NOT_FOUND: error body code = INTERVIEW_NOT_FOUND', async () => {
      mockService.updateInterview.mockResolvedValue({ outcome: 'INTERVIEW_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.updateInterview(INTERVIEW_ID, updateDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INTERVIEW_NOT_FOUND');
      expect(body['success']).toBe(false);
    });

    it('INTERVIEW_IN_TERMINAL_STATE: throws UnprocessableEntityException', async () => {
      mockService.updateInterview.mockResolvedValue({ outcome: 'INTERVIEW_IN_TERMINAL_STATE' });

      await expect(controller.updateInterview(INTERVIEW_ID, updateDto, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('INTERVIEW_IN_TERMINAL_STATE: error body code = INTERVIEW_IN_TERMINAL_STATE', async () => {
      mockService.updateInterview.mockResolvedValue({ outcome: 'INTERVIEW_IN_TERMINAL_STATE' });

      let thrown: unknown;
      try { await controller.updateInterview(INTERVIEW_ID, updateDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INTERVIEW_IN_TERMINAL_STATE');
      expect(body['success']).toBe(false);
    });

    it('INTERVIEWER_REQUIRED: throws UnprocessableEntityException', async () => {
      mockService.updateInterview.mockResolvedValue({ outcome: 'INTERVIEWER_REQUIRED' });

      await expect(controller.updateInterview(INTERVIEW_ID, updateDto, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('INTERVIEWER_REQUIRED: error body code = INTERVIEWER_REQUIRED', async () => {
      mockService.updateInterview.mockResolvedValue({ outcome: 'INTERVIEWER_REQUIRED' });

      let thrown: unknown;
      try { await controller.updateInterview(INTERVIEW_ID, updateDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INTERVIEWER_REQUIRED');
      expect(body['success']).toBe(false);
    });

    it('INTERVIEWER_NOT_FOUND: throws NotFoundException', async () => {
      mockService.updateInterview.mockResolvedValue({ outcome: 'INTERVIEWER_NOT_FOUND' });

      await expect(controller.updateInterview(INTERVIEW_ID, updateDto, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('INTERVIEWER_NOT_FOUND: error body code = INTERVIEWER_NOT_FOUND', async () => {
      mockService.updateInterview.mockResolvedValue({ outcome: 'INTERVIEWER_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.updateInterview(INTERVIEW_ID, updateDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INTERVIEWER_NOT_FOUND');
      expect(body['success']).toBe(false);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.updateInterview.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.updateInterview(INTERVIEW_ID, updateDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // completeInterview
  // ---------------------------------------------------------------------------

  describe('completeInterview()', () => {
    it('SUCCESS: returns { success: true, data: interview shape with status COMPLETED }', async () => {
      const completedRecord = { ...interviewRecord, status: 'COMPLETED' };
      mockService.completeInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: completedRecord });

      const result = await controller.completeInterview(INTERVIEW_ID, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: INTERVIEW_ID, status: 'COMPLETED' });
    });

    it('SUCCESS: response data does not include tenantId or deletedAt', async () => {
      mockService.completeInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      const result = await controller.completeInterview(INTERVIEW_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: id, actor.tenantId, actor.userId forwarded to service (SEC-003)', async () => {
      mockService.completeInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      await controller.completeInterview(INTERVIEW_ID, mockActor);

      expect(mockService.completeInterview).toHaveBeenCalledWith(INTERVIEW_ID, TENANT_ID, ACTOR_ID);
    });

    it('INTERVIEW_NOT_FOUND: throws NotFoundException', async () => {
      mockService.completeInterview.mockResolvedValue({ outcome: 'INTERVIEW_NOT_FOUND' });

      await expect(controller.completeInterview(INTERVIEW_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('INTERVIEW_NOT_FOUND: error body code = INTERVIEW_NOT_FOUND', async () => {
      mockService.completeInterview.mockResolvedValue({ outcome: 'INTERVIEW_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.completeInterview(INTERVIEW_ID, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INTERVIEW_NOT_FOUND');
      expect(body['success']).toBe(false);
    });

    it('INTERVIEW_IN_TERMINAL_STATE: throws UnprocessableEntityException', async () => {
      mockService.completeInterview.mockResolvedValue({ outcome: 'INTERVIEW_IN_TERMINAL_STATE' });

      await expect(controller.completeInterview(INTERVIEW_ID, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('INTERVIEW_IN_TERMINAL_STATE: error body code = INTERVIEW_IN_TERMINAL_STATE', async () => {
      mockService.completeInterview.mockResolvedValue({ outcome: 'INTERVIEW_IN_TERMINAL_STATE' });

      let thrown: unknown;
      try { await controller.completeInterview(INTERVIEW_ID, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INTERVIEW_IN_TERMINAL_STATE');
      expect(body['success']).toBe(false);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.completeInterview.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.completeInterview(INTERVIEW_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // recordFeedback
  // ---------------------------------------------------------------------------

  describe('recordFeedback()', () => {
    it('SUCCESS: returns { success: true, data: interview shape }', async () => {
      const feedbackRecord = { ...interviewRecord, feedback: 'Strong candidate.' };
      mockService.recordFeedback.mockResolvedValue({ outcome: 'SUCCESS', interview: feedbackRecord });

      const result = await controller.recordFeedback(INTERVIEW_ID, feedbackDto, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: INTERVIEW_ID });
    });

    it('SUCCESS: response data does not include tenantId or deletedAt', async () => {
      mockService.recordFeedback.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      const result = await controller.recordFeedback(INTERVIEW_ID, feedbackDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: id, feedback, actor.tenantId, actor.userId forwarded to service', async () => {
      mockService.recordFeedback.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      await controller.recordFeedback(INTERVIEW_ID, feedbackDto, mockActor);

      expect(mockService.recordFeedback).toHaveBeenCalledWith(
        INTERVIEW_ID,
        { feedback: feedbackDto.feedback },
        TENANT_ID,
        ACTOR_ID,
      );
    });

    it('INTERVIEW_NOT_FOUND: throws NotFoundException', async () => {
      mockService.recordFeedback.mockResolvedValue({ outcome: 'INTERVIEW_NOT_FOUND' });

      await expect(controller.recordFeedback(INTERVIEW_ID, feedbackDto, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('INTERVIEW_NOT_FOUND: error body code = INTERVIEW_NOT_FOUND', async () => {
      mockService.recordFeedback.mockResolvedValue({ outcome: 'INTERVIEW_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.recordFeedback(INTERVIEW_ID, feedbackDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INTERVIEW_NOT_FOUND');
      expect(body['success']).toBe(false);
    });

    it('INTERVIEW_FEEDBACK_NOT_ALLOWED: throws UnprocessableEntityException', async () => {
      mockService.recordFeedback.mockResolvedValue({ outcome: 'INTERVIEW_FEEDBACK_NOT_ALLOWED' });

      await expect(controller.recordFeedback(INTERVIEW_ID, feedbackDto, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('INTERVIEW_FEEDBACK_NOT_ALLOWED: error body code = INTERVIEW_FEEDBACK_NOT_ALLOWED', async () => {
      mockService.recordFeedback.mockResolvedValue({ outcome: 'INTERVIEW_FEEDBACK_NOT_ALLOWED' });

      let thrown: unknown;
      try { await controller.recordFeedback(INTERVIEW_ID, feedbackDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INTERVIEW_FEEDBACK_NOT_ALLOWED');
      expect(body['success']).toBe(false);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.recordFeedback.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.recordFeedback(INTERVIEW_ID, feedbackDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // cancelInterview
  // ---------------------------------------------------------------------------

  describe('cancelInterview()', () => {
    it('SUCCESS: returns { success: true, data: interview shape with status CANCELLED }', async () => {
      const cancelledRecord = { ...interviewRecord, status: 'CANCELLED' };
      mockService.cancelInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: cancelledRecord });

      const result = await controller.cancelInterview(INTERVIEW_ID, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: INTERVIEW_ID, status: 'CANCELLED' });
    });

    it('SUCCESS: response data does not include tenantId or deletedAt', async () => {
      mockService.cancelInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      const result = await controller.cancelInterview(INTERVIEW_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: id, actor.tenantId, actor.userId forwarded to service (SEC-003)', async () => {
      mockService.cancelInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      await controller.cancelInterview(INTERVIEW_ID, mockActor);

      expect(mockService.cancelInterview).toHaveBeenCalledWith(INTERVIEW_ID, TENANT_ID, ACTOR_ID);
    });

    it('INTERVIEW_NOT_FOUND: throws NotFoundException', async () => {
      mockService.cancelInterview.mockResolvedValue({ outcome: 'INTERVIEW_NOT_FOUND' });

      await expect(controller.cancelInterview(INTERVIEW_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('INTERVIEW_NOT_FOUND: error body code = INTERVIEW_NOT_FOUND', async () => {
      mockService.cancelInterview.mockResolvedValue({ outcome: 'INTERVIEW_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.cancelInterview(INTERVIEW_ID, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INTERVIEW_NOT_FOUND');
      expect(body['success']).toBe(false);
    });

    it('INTERVIEW_IN_TERMINAL_STATE: throws UnprocessableEntityException with code', async () => {
      mockService.cancelInterview.mockResolvedValue({ outcome: 'INTERVIEW_IN_TERMINAL_STATE' });

      let thrown: unknown;
      try { await controller.cancelInterview(INTERVIEW_ID, mockActor); } catch (e) { thrown = e; }

      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INTERVIEW_IN_TERMINAL_STATE');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.cancelInterview.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.cancelInterview(INTERVIEW_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // noShowInterview
  // ---------------------------------------------------------------------------

  describe('noShowInterview()', () => {
    it('SUCCESS: returns { success: true, data: interview shape with status NO_SHOW }', async () => {
      const noShowRecord = { ...interviewRecord, status: 'NO_SHOW' };
      mockService.noShowInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: noShowRecord });

      const result = await controller.noShowInterview(INTERVIEW_ID, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: INTERVIEW_ID, status: 'NO_SHOW' });
    });

    it('SUCCESS: response data does not include tenantId or deletedAt', async () => {
      mockService.noShowInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      const result = await controller.noShowInterview(INTERVIEW_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: id, actor.tenantId, actor.userId forwarded to service (SEC-003)', async () => {
      mockService.noShowInterview.mockResolvedValue({ outcome: 'SUCCESS', interview: interviewRecord });

      await controller.noShowInterview(INTERVIEW_ID, mockActor);

      expect(mockService.noShowInterview).toHaveBeenCalledWith(INTERVIEW_ID, TENANT_ID, ACTOR_ID);
    });

    it('INTERVIEW_NOT_FOUND: throws NotFoundException', async () => {
      mockService.noShowInterview.mockResolvedValue({ outcome: 'INTERVIEW_NOT_FOUND' });

      await expect(controller.noShowInterview(INTERVIEW_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('INTERVIEW_NOT_FOUND: error body code = INTERVIEW_NOT_FOUND', async () => {
      mockService.noShowInterview.mockResolvedValue({ outcome: 'INTERVIEW_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.noShowInterview(INTERVIEW_ID, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INTERVIEW_NOT_FOUND');
      expect(body['success']).toBe(false);
    });

    it('INTERVIEW_IN_TERMINAL_STATE: throws UnprocessableEntityException with code', async () => {
      mockService.noShowInterview.mockResolvedValue({ outcome: 'INTERVIEW_IN_TERMINAL_STATE' });

      let thrown: unknown;
      try { await controller.noShowInterview(INTERVIEW_ID, mockActor); } catch (e) { thrown = e; }

      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('INTERVIEW_IN_TERMINAL_STATE');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.noShowInterview.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.noShowInterview(INTERVIEW_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // RBAC metadata (GD-M18-1 D16)
  // Verified by reading @RequireRoles decorator metadata from each handler.
  // NestJS SetMetadata places roles on descriptor.value (the handler function itself).
  // ---------------------------------------------------------------------------

  describe('RBAC metadata', () => {
    it('createInterview requires System Administrator, HR Director, Recruiter', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.createInterview);
      expect(roles).toContain('System Administrator');
      expect(roles).toContain('HR Director');
      expect(roles).toContain('Recruiter');
    });

    it('createInterview does not include Hiring Manager (GD-M18-1 D16)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.createInterview);
      expect(roles).not.toContain('Hiring Manager');
    });

    it('createInterview does not include Compliance Officer — write endpoint', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.createInterview);
      expect(roles).not.toContain('Compliance Officer');
    });

    it('listInterviews includes Compliance Officer — read endpoint', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.listInterviews);
      expect(roles).toContain('Compliance Officer');
    });

    it('listInterviews does not include Hiring Manager', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.listInterviews);
      expect(roles).not.toContain('Hiring Manager');
    });

    it('getInterviewById includes Compliance Officer — read endpoint', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.getInterviewById);
      expect(roles).toContain('Compliance Officer');
    });

    it('getInterviewById does not include Hiring Manager', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.getInterviewById);
      expect(roles).not.toContain('Hiring Manager');
    });

    it('updateInterview does not include Compliance Officer — write endpoint', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.updateInterview);
      expect(roles).not.toContain('Compliance Officer');
    });

    it('updateInterview does not include Hiring Manager', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.updateInterview);
      expect(roles).not.toContain('Hiring Manager');
    });

    it('completeInterview does not include Hiring Manager', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.completeInterview);
      expect(roles).not.toContain('Hiring Manager');
    });

    it('recordFeedback does not include Hiring Manager', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.recordFeedback);
      expect(roles).not.toContain('Hiring Manager');
    });

    it('cancelInterview does not include Hiring Manager', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.cancelInterview);
      expect(roles).not.toContain('Hiring Manager');
    });

    it('noShowInterview does not include Hiring Manager', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.noShowInterview);
      expect(roles).not.toContain('Hiring Manager');
    });
  });

  // ---------------------------------------------------------------------------
  // HTTP code metadata
  // Verifies that action endpoints override the NestJS POST default of 201 to 200.
  // ---------------------------------------------------------------------------

  describe('HTTP code metadata', () => {
    it('createInterview uses 201', () => {
      const code = Reflect.getMetadata(HTTP_CODE_METADATA, controller.createInterview);
      expect(code).toBe(201);
    });

    it('completeInterview uses 200 — not the NestJS POST default of 201', () => {
      const code = Reflect.getMetadata(HTTP_CODE_METADATA, controller.completeInterview);
      expect(code).toBe(200);
    });

    it('recordFeedback uses 200 — not the NestJS POST default of 201', () => {
      const code = Reflect.getMetadata(HTTP_CODE_METADATA, controller.recordFeedback);
      expect(code).toBe(200);
    });

    it('cancelInterview uses 200 — not the NestJS POST default of 201', () => {
      const code = Reflect.getMetadata(HTTP_CODE_METADATA, controller.cancelInterview);
      expect(code).toBe(200);
    });

    it('noShowInterview uses 200 — not the NestJS POST default of 201', () => {
      const code = Reflect.getMetadata(HTTP_CODE_METADATA, controller.noShowInterview);
      expect(code).toBe(200);
    });
  });
});
