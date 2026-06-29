import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateApplicationDto } from './create-application.dto';
import { AdvanceApplicationDto } from './advance-application.dto';

// ─── CreateApplicationDto ────────────────────────────────────────────────────

const VALID_UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const OTHER_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const validPayload = {
  candidateId: VALID_UUID,
  vacancyId: OTHER_UUID,
};

function makeCreate(overrides: Record<string, unknown> = {}): CreateApplicationDto {
  return plainToInstance(CreateApplicationDto, { ...validPayload, ...overrides });
}

async function errorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateApplicationDto, payload);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('CreateApplicationDto', () => {
  describe('valid payload', () => {
    it('accepts a minimal valid payload (required fields only)', async () => {
      const errors = await validate(makeCreate());
      expect(errors.length).toBe(0);
    });

    it('accepts a fully populated payload', async () => {
      const errors = await validate(
        makeCreate({ notes: 'Referred by department head', currentStage: 'Phone Screening' }),
      );
      expect(errors.length).toBe(0);
    });
  });

  describe('candidateId', () => {
    it('rejects when candidateId is missing', async () => {
      const props = await errorsFor({ vacancyId: OTHER_UUID });
      expect(props).toContain('candidateId');
    });

    it('rejects an invalid UUID for candidateId', async () => {
      const props = await errorsFor({ ...validPayload, candidateId: 'not-a-uuid' });
      expect(props).toContain('candidateId');
    });

    it('accepts a valid UUID for candidateId', async () => {
      const errors = await validate(makeCreate());
      expect(errors.length).toBe(0);
    });
  });

  describe('vacancyId', () => {
    it('rejects when vacancyId is missing', async () => {
      const props = await errorsFor({ candidateId: VALID_UUID });
      expect(props).toContain('vacancyId');
    });

    it('rejects an invalid UUID for vacancyId', async () => {
      const props = await errorsFor({ ...validPayload, vacancyId: 'not-a-uuid' });
      expect(props).toContain('vacancyId');
    });

    it('accepts a valid UUID for vacancyId', async () => {
      const errors = await validate(makeCreate());
      expect(errors.length).toBe(0);
    });
  });

  describe('notes', () => {
    it('accepts when notes is absent — optional field', async () => {
      const errors = await validate(makeCreate());
      expect(errors.length).toBe(0);
    });

    it('rejects notes longer than 5000 characters', async () => {
      const props = await errorsFor({ ...validPayload, notes: 'a'.repeat(5001) });
      expect(props).toContain('notes');
    });

    it('accepts notes at exactly 5000 characters', async () => {
      const errors = await validate(makeCreate({ notes: 'a'.repeat(5000) }));
      expect(errors.length).toBe(0);
    });
  });

  describe('currentStage', () => {
    it('accepts when currentStage is absent — optional field', async () => {
      const errors = await validate(makeCreate());
      expect(errors.length).toBe(0);
    });

    it('rejects currentStage longer than 100 characters', async () => {
      const props = await errorsFor({ ...validPayload, currentStage: 'A'.repeat(101) });
      expect(props).toContain('currentStage');
    });

    it('accepts currentStage at exactly 100 characters', async () => {
      const errors = await validate(makeCreate({ currentStage: 'A'.repeat(100) }));
      expect(errors.length).toBe(0);
    });
  });

  describe('forbidden fields — tenantId and status', () => {
    // tenantId and status are not declared on CreateApplicationDto.
    // The global ValidationPipe in main.ts (whitelist: true, forbidNonWhitelisted: true)
    // rejects any HTTP request body containing these fields with 400 Bad Request.
    // At the class-validator unit-test level, undeclared properties produce no
    // constraint errors — they are handled at the NestJS layer, not by class-validator.
    it('validate() produces no constraint error when tenantId is present — NestJS layer handles rejection', async () => {
      const errors = await validate(makeCreate({ tenantId: VALID_UUID }));
      expect(errors.length).toBe(0);
    });

    it('validate() produces no constraint error when status is present — NestJS layer handles rejection', async () => {
      const errors = await validate(makeCreate({ status: 'APPLIED' }));
      expect(errors.length).toBe(0);
    });
  });
});

// ─── AdvanceApplicationDto ───────────────────────────────────────────────────

function makeAdvance(overrides: Record<string, unknown> = {}): AdvanceApplicationDto {
  return plainToInstance(AdvanceApplicationDto, { targetStatus: 'SCREENING', ...overrides });
}

async function advanceErrorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(AdvanceApplicationDto, payload);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('AdvanceApplicationDto', () => {
  describe('valid targetStatus values', () => {
    it.each(['SCREENING', 'INTERVIEW', 'EVALUATION', 'OFFER'])(
      'accepts targetStatus = %s',
      async (value) => {
        const errors = await validate(makeAdvance({ targetStatus: value }));
        expect(errors.length).toBe(0);
      },
    );
  });

  describe('rejected targetStatus values', () => {
    it.each(['APPLIED', 'HIRED', 'REJECTED', 'WITHDRAWN'])(
      'rejects targetStatus = %s',
      async (value) => {
        const props = await advanceErrorsFor({ targetStatus: value });
        expect(props).toContain('targetStatus');
      },
    );
  });

  it('rejects when targetStatus is missing', async () => {
    const props = await advanceErrorsFor({});
    expect(props).toContain('targetStatus');
  });

  it('rejects an arbitrary string that is not a valid status', async () => {
    const props = await advanceErrorsFor({ targetStatus: 'INVALID_STATUS' });
    expect(props).toContain('targetStatus');
  });
});
