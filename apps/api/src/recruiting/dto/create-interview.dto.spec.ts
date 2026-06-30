import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateInterviewDto } from './create-interview.dto';
import { UpdateInterviewDto } from './update-interview.dto';
import { InterviewFeedbackDto } from './interview-feedback.dto';
import { ListInterviewsQueryDto } from './list-interviews-query.dto';

const VALID_UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const OTHER_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_ISO = '2026-07-15T10:00:00.000Z';

// ─── CreateInterviewDto ──────────────────────────────────────────────────────

const validCreatePayload = {
  applicationId: VALID_UUID,
  interviewType: 'PHONE_SCREEN',
};

function makeCreate(overrides: Record<string, unknown> = {}): CreateInterviewDto {
  return plainToInstance(CreateInterviewDto, { ...validCreatePayload, ...overrides });
}

async function createErrorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateInterviewDto, payload);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('CreateInterviewDto', () => {
  describe('valid payload', () => {
    it('accepts a minimal valid payload (required fields only)', async () => {
      const errors = await validate(makeCreate());
      expect(errors.length).toBe(0);
    });

    it('accepts a fully populated payload', async () => {
      const errors = await validate(
        makeCreate({
          scheduledAt: VALID_ISO,
          interviewerName: 'Jane Smith',
          interviewerUserId: OTHER_UUID,
        }),
      );
      expect(errors.length).toBe(0);
    });

    it('accepts payload with neither interviewerName nor interviewerUserId — service enforces INTERVIEWER_REQUIRED', async () => {
      const errors = await validate(makeCreate());
      expect(errors.length).toBe(0);
    });
  });

  describe('applicationId', () => {
    it('rejects when applicationId is missing', async () => {
      const props = await createErrorsFor({ interviewType: 'PHONE_SCREEN' });
      expect(props).toContain('applicationId');
    });

    it('rejects an invalid UUID for applicationId', async () => {
      const props = await createErrorsFor({ ...validCreatePayload, applicationId: 'not-a-uuid' });
      expect(props).toContain('applicationId');
    });

    it('accepts a valid UUID for applicationId', async () => {
      const errors = await validate(makeCreate());
      expect(errors.length).toBe(0);
    });
  });

  describe('interviewType', () => {
    it.each(['PHONE_SCREEN', 'PANEL', 'TECHNICAL', 'FINAL'])(
      'accepts governed value %s',
      async (value) => {
        const errors = await validate(makeCreate({ interviewType: value }));
        expect(errors.length).toBe(0);
      },
    );

    it('rejects when interviewType is missing', async () => {
      const props = await createErrorsFor({ applicationId: VALID_UUID });
      expect(props).toContain('interviewType');
    });

    it('rejects an ungoverned value', async () => {
      const props = await createErrorsFor({ ...validCreatePayload, interviewType: 'BEHAVIORAL' });
      expect(props).toContain('interviewType');
    });

    it('rejects an empty string', async () => {
      const props = await createErrorsFor({ ...validCreatePayload, interviewType: '' });
      expect(props).toContain('interviewType');
    });
  });

  describe('scheduledAt', () => {
    it('accepts when scheduledAt is absent — optional field', async () => {
      const errors = await validate(makeCreate());
      expect(errors.length).toBe(0);
    });

    it('accepts a valid ISO 8601 datetime string', async () => {
      const errors = await validate(makeCreate({ scheduledAt: VALID_ISO }));
      expect(errors.length).toBe(0);
    });

    it('rejects a non-ISO string', async () => {
      const props = await createErrorsFor({ ...validCreatePayload, scheduledAt: 'not-a-date' });
      expect(props).toContain('scheduledAt');
    });
  });

  describe('interviewerName', () => {
    it('accepts when interviewerName is absent — optional field', async () => {
      const errors = await validate(makeCreate());
      expect(errors.length).toBe(0);
    });

    it('accepts at exactly 255 characters', async () => {
      const errors = await validate(makeCreate({ interviewerName: 'A'.repeat(255) }));
      expect(errors.length).toBe(0);
    });

    it('rejects longer than 255 characters', async () => {
      const props = await createErrorsFor({ ...validCreatePayload, interviewerName: 'A'.repeat(256) });
      expect(props).toContain('interviewerName');
    });
  });

  describe('interviewerUserId', () => {
    it('accepts when interviewerUserId is absent — optional field', async () => {
      const errors = await validate(makeCreate());
      expect(errors.length).toBe(0);
    });

    it('accepts a valid UUID for interviewerUserId', async () => {
      const errors = await validate(makeCreate({ interviewerUserId: OTHER_UUID }));
      expect(errors.length).toBe(0);
    });

    it('rejects an invalid UUID for interviewerUserId', async () => {
      const props = await createErrorsFor({ ...validCreatePayload, interviewerUserId: 'not-a-uuid' });
      expect(props).toContain('interviewerUserId');
    });
  });

  describe('forbidden fields — tenantId, status, feedback', () => {
    // These fields are not declared on CreateInterviewDto.
    // The global ValidationPipe (whitelist: true, forbidNonWhitelisted: true) rejects
    // HTTP request bodies containing them with 400 Bad Request.
    // At the class-validator unit-test level, undeclared properties produce no constraint
    // errors — rejection is handled at the NestJS layer.
    it('validate() produces no constraint error when tenantId is present — NestJS layer handles rejection', async () => {
      const errors = await validate(makeCreate({ tenantId: VALID_UUID }));
      expect(errors.length).toBe(0);
    });

    it('validate() produces no constraint error when status is present — NestJS layer handles rejection', async () => {
      const errors = await validate(makeCreate({ status: 'SCHEDULED' }));
      expect(errors.length).toBe(0);
    });

    it('validate() produces no constraint error when feedback is present — NestJS layer handles rejection', async () => {
      const errors = await validate(makeCreate({ feedback: 'Some feedback' }));
      expect(errors.length).toBe(0);
    });
  });
});

// ─── UpdateInterviewDto ──────────────────────────────────────────────────────

function makeUpdate(overrides: Record<string, unknown> = {}): UpdateInterviewDto {
  return plainToInstance(UpdateInterviewDto, overrides);
}

async function updateErrorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(UpdateInterviewDto, payload);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('UpdateInterviewDto', () => {
  it('accepts an empty payload — all fields optional', async () => {
    const errors = await validate(makeUpdate());
    expect(errors.length).toBe(0);
  });

  describe('scheduledAt', () => {
    it('accepts a valid ISO 8601 datetime string', async () => {
      const errors = await validate(makeUpdate({ scheduledAt: VALID_ISO }));
      expect(errors.length).toBe(0);
    });

    it('rejects a non-ISO string', async () => {
      const props = await updateErrorsFor({ scheduledAt: 'not-a-date' });
      expect(props).toContain('scheduledAt');
    });
  });

  describe('interviewerName', () => {
    it('accepts at exactly 255 characters', async () => {
      const errors = await validate(makeUpdate({ interviewerName: 'A'.repeat(255) }));
      expect(errors.length).toBe(0);
    });

    it('rejects longer than 255 characters', async () => {
      const props = await updateErrorsFor({ interviewerName: 'A'.repeat(256) });
      expect(props).toContain('interviewerName');
    });
  });

  describe('interviewerUserId', () => {
    it('accepts a valid UUID', async () => {
      const errors = await validate(makeUpdate({ interviewerUserId: VALID_UUID }));
      expect(errors.length).toBe(0);
    });

    it('rejects an invalid UUID', async () => {
      const props = await updateErrorsFor({ interviewerUserId: 'not-a-uuid' });
      expect(props).toContain('interviewerUserId');
    });
  });

  describe('forbidden fields — status, applicationId, interviewType, feedback, tenantId', () => {
    it('validate() produces no constraint error when status is present — NestJS layer handles rejection', async () => {
      const errors = await validate(makeUpdate({ status: 'SCHEDULED' }));
      expect(errors.length).toBe(0);
    });

    it('validate() produces no constraint error when applicationId is present — NestJS layer handles rejection', async () => {
      const errors = await validate(makeUpdate({ applicationId: VALID_UUID }));
      expect(errors.length).toBe(0);
    });

    it('validate() produces no constraint error when interviewType is present — NestJS layer handles rejection', async () => {
      const errors = await validate(makeUpdate({ interviewType: 'PANEL' }));
      expect(errors.length).toBe(0);
    });
  });
});

// ─── InterviewFeedbackDto ────────────────────────────────────────────────────

function makeFeedback(overrides: Record<string, unknown> = {}): InterviewFeedbackDto {
  return plainToInstance(InterviewFeedbackDto, { feedback: 'Strong candidate.', ...overrides });
}

async function feedbackErrorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(InterviewFeedbackDto, payload);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('InterviewFeedbackDto', () => {
  it('accepts valid feedback text', async () => {
    const errors = await validate(makeFeedback());
    expect(errors.length).toBe(0);
  });

  it('rejects when feedback is missing', async () => {
    const props = await feedbackErrorsFor({});
    expect(props).toContain('feedback');
  });

  it('rejects an empty string for feedback', async () => {
    const props = await feedbackErrorsFor({ feedback: '' });
    expect(props).toContain('feedback');
  });

  it('accepts at exactly 10000 characters', async () => {
    const errors = await validate(makeFeedback({ feedback: 'A'.repeat(10000) }));
    expect(errors.length).toBe(0);
  });

  it('rejects longer than 10000 characters', async () => {
    const props = await feedbackErrorsFor({ feedback: 'A'.repeat(10001) });
    expect(props).toContain('feedback');
  });
});

// ─── ListInterviewsQueryDto ──────────────────────────────────────────────────

function makeQuery(overrides: Record<string, unknown> = {}): ListInterviewsQueryDto {
  return plainToInstance(ListInterviewsQueryDto, overrides);
}

async function queryErrorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(ListInterviewsQueryDto, payload);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('ListInterviewsQueryDto', () => {
  it('accepts an empty query — all fields optional', async () => {
    const errors = await validate(makeQuery());
    expect(errors.length).toBe(0);
  });

  describe('page', () => {
    it('accepts page = 1', async () => {
      const errors = await validate(makeQuery({ page: '1' }));
      expect(errors.length).toBe(0);
    });

    it('rejects page = 0', async () => {
      const props = await queryErrorsFor({ page: '0' });
      expect(props).toContain('page');
    });
  });

  describe('pageSize', () => {
    it('accepts pageSize = 100', async () => {
      const errors = await validate(makeQuery({ pageSize: '100' }));
      expect(errors.length).toBe(0);
    });

    it('rejects pageSize = 101', async () => {
      const props = await queryErrorsFor({ pageSize: '101' });
      expect(props).toContain('pageSize');
    });

    it('rejects pageSize = 0', async () => {
      const props = await queryErrorsFor({ pageSize: '0' });
      expect(props).toContain('pageSize');
    });
  });

  describe('applicationId', () => {
    it('accepts a valid UUID', async () => {
      const errors = await validate(makeQuery({ applicationId: VALID_UUID }));
      expect(errors.length).toBe(0);
    });

    it('rejects an invalid UUID', async () => {
      const props = await queryErrorsFor({ applicationId: 'not-a-uuid' });
      expect(props).toContain('applicationId');
    });
  });

  describe('status', () => {
    it.each(['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])(
      'accepts governed status %s',
      async (value) => {
        const errors = await validate(makeQuery({ status: value }));
        expect(errors.length).toBe(0);
      },
    );

    it('rejects an ungoverned status value', async () => {
      const props = await queryErrorsFor({ status: 'PENDING' });
      expect(props).toContain('status');
    });
  });

  describe('interviewType', () => {
    it.each(['PHONE_SCREEN', 'PANEL', 'TECHNICAL', 'FINAL'])(
      'accepts governed interviewType %s',
      async (value) => {
        const errors = await validate(makeQuery({ interviewType: value }));
        expect(errors.length).toBe(0);
      },
    );

    it('rejects an ungoverned interviewType value', async () => {
      const props = await queryErrorsFor({ interviewType: 'BEHAVIORAL' });
      expect(props).toContain('interviewType');
    });
  });
});
