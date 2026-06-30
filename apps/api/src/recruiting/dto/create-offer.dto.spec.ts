import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateOfferDto } from './create-offer.dto';
import { UpdateOfferDto } from './update-offer.dto';
import { RecordOfferResponseDto } from './record-offer-response.dto';
import { ListOffersQueryDto } from './list-offers-query.dto';

const VALID_UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const VALID_ISO  = '2026-08-01T00:00:00.000Z';

// ─── CreateOfferDto ──────────────────────────────────────────────────────────

const validCreatePayload = { applicationId: VALID_UUID };

function makeCreate(overrides: Record<string, unknown> = {}): CreateOfferDto {
  return plainToInstance(CreateOfferDto, { ...validCreatePayload, ...overrides });
}

async function createErrorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateOfferDto, payload);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('CreateOfferDto', () => {
  describe('valid payload', () => {
    it('accepts a minimal valid payload — applicationId only', async () => {
      const errors = await validate(makeCreate());
      expect(errors.length).toBe(0);
    });

    it('accepts a fully populated payload', async () => {
      const errors = await validate(
        makeCreate({ offerDate: VALID_ISO, notes: 'Standard benefits included.' }),
      );
      expect(errors.length).toBe(0);
    });
  });

  describe('applicationId', () => {
    it('rejects when applicationId is missing', async () => {
      const props = await createErrorsFor({});
      expect(props).toContain('applicationId');
    });

    it('rejects an invalid UUID for applicationId', async () => {
      const props = await createErrorsFor({ applicationId: 'not-a-uuid' });
      expect(props).toContain('applicationId');
    });

    it('rejects an empty string for applicationId', async () => {
      const props = await createErrorsFor({ applicationId: '' });
      expect(props).toContain('applicationId');
    });

    it('accepts a valid UUID for applicationId', async () => {
      const errors = await validate(makeCreate());
      expect(errors.length).toBe(0);
    });
  });

  describe('offerDate', () => {
    it('accepts when offerDate is absent — optional field', async () => {
      const errors = await validate(makeCreate());
      expect(errors.length).toBe(0);
    });

    it('accepts a valid ISO 8601 datetime string', async () => {
      const errors = await validate(makeCreate({ offerDate: VALID_ISO }));
      expect(errors.length).toBe(0);
    });

    it('rejects a non-ISO string for offerDate', async () => {
      const props = await createErrorsFor({ ...validCreatePayload, offerDate: 'not-a-date' });
      expect(props).toContain('offerDate');
    });
  });

  describe('notes', () => {
    it('accepts when notes is absent — optional field', async () => {
      const errors = await validate(makeCreate());
      expect(errors.length).toBe(0);
    });

    it('accepts notes at exactly 5000 characters', async () => {
      const errors = await validate(makeCreate({ notes: 'A'.repeat(5000) }));
      expect(errors.length).toBe(0);
    });

    it('rejects notes longer than 5000 characters (GD-M18-1 D13 explicit limit)', async () => {
      const props = await createErrorsFor({ ...validCreatePayload, notes: 'A'.repeat(5001) });
      expect(props).toContain('notes');
    });
  });

  describe('forbidden fields — tenantId, status', () => {
    // These fields are not declared on CreateOfferDto.
    // The global ValidationPipe (whitelist: true, forbidNonWhitelisted: true) rejects
    // HTTP request bodies containing them with 400 Bad Request.
    // At the class-validator unit-test level, undeclared properties produce no constraint
    // errors — rejection is handled at the NestJS layer.
    it('validate() produces no constraint error when tenantId is present — NestJS layer handles rejection', async () => {
      const errors = await validate(makeCreate({ tenantId: VALID_UUID }));
      expect(errors.length).toBe(0);
    });

    it('validate() produces no constraint error when status is present — NestJS layer handles rejection', async () => {
      const errors = await validate(makeCreate({ status: 'DRAFT' }));
      expect(errors.length).toBe(0);
    });
  });
});

// ─── UpdateOfferDto ──────────────────────────────────────────────────────────

function makeUpdate(overrides: Record<string, unknown> = {}): UpdateOfferDto {
  return plainToInstance(UpdateOfferDto, overrides);
}

async function updateErrorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(UpdateOfferDto, payload);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('UpdateOfferDto', () => {
  it('accepts an empty payload — all fields optional', async () => {
    const errors = await validate(makeUpdate());
    expect(errors.length).toBe(0);
  });

  describe('offerDate', () => {
    it('accepts a valid ISO 8601 datetime string', async () => {
      const errors = await validate(makeUpdate({ offerDate: VALID_ISO }));
      expect(errors.length).toBe(0);
    });

    it('rejects a non-ISO string for offerDate', async () => {
      const props = await updateErrorsFor({ offerDate: 'not-a-date' });
      expect(props).toContain('offerDate');
    });
  });

  describe('notes', () => {
    it('accepts notes at exactly 5000 characters', async () => {
      const errors = await validate(makeUpdate({ notes: 'A'.repeat(5000) }));
      expect(errors.length).toBe(0);
    });

    it('rejects notes longer than 5000 characters', async () => {
      const props = await updateErrorsFor({ notes: 'A'.repeat(5001) });
      expect(props).toContain('notes');
    });
  });

  describe('forbidden fields — status, applicationId, tenantId', () => {
    it('validate() produces no constraint error when status is present — NestJS layer handles rejection', async () => {
      const errors = await validate(makeUpdate({ status: 'DRAFT' }));
      expect(errors.length).toBe(0);
    });

    it('validate() produces no constraint error when applicationId is present — NestJS layer handles rejection', async () => {
      const errors = await validate(makeUpdate({ applicationId: VALID_UUID }));
      expect(errors.length).toBe(0);
    });

    it('validate() produces no constraint error when tenantId is present — NestJS layer handles rejection', async () => {
      const errors = await validate(makeUpdate({ tenantId: VALID_UUID }));
      expect(errors.length).toBe(0);
    });
  });
});

// ─── RecordOfferResponseDto ──────────────────────────────────────────────────

function makeResponse(overrides: Record<string, unknown> = {}): RecordOfferResponseDto {
  return plainToInstance(RecordOfferResponseDto, { response: 'ACCEPTED', ...overrides });
}

async function responseErrorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(RecordOfferResponseDto, payload);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('RecordOfferResponseDto', () => {
  it('accepts response = ACCEPTED', async () => {
    const errors = await validate(makeResponse({ response: 'ACCEPTED' }));
    expect(errors.length).toBe(0);
  });

  it('accepts response = DECLINED', async () => {
    const errors = await validate(makeResponse({ response: 'DECLINED' }));
    expect(errors.length).toBe(0);
  });

  it('rejects when response is missing', async () => {
    const props = await responseErrorsFor({});
    expect(props).toContain('response');
  });

  it('rejects an empty string for response', async () => {
    const props = await responseErrorsFor({ response: '' });
    expect(props).toContain('response');
  });

  it('rejects an ungoverned value — HIRED is not a valid candidate response', async () => {
    const props = await responseErrorsFor({ response: 'HIRED' });
    expect(props).toContain('response');
  });

  it('rejects WITHDRAWN — only candidate responses ACCEPTED and DECLINED are valid here', async () => {
    const props = await responseErrorsFor({ response: 'WITHDRAWN' });
    expect(props).toContain('response');
  });

  it('rejects PENDING — not a governed response value', async () => {
    const props = await responseErrorsFor({ response: 'PENDING' });
    expect(props).toContain('response');
  });
});

// ─── ListOffersQueryDto ──────────────────────────────────────────────────────

function makeQuery(overrides: Record<string, unknown> = {}): ListOffersQueryDto {
  return plainToInstance(ListOffersQueryDto, overrides);
}

async function queryErrorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(ListOffersQueryDto, payload);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('ListOffersQueryDto', () => {
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
    // GD-M18-1 D13 specifies status as 'string' only — no @IsIn() constraint.
    // Any string value passes validation; an unrecognised status returns zero results.
    it.each(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN'])(
      'accepts governed status value %s',
      async (value) => {
        const errors = await validate(makeQuery({ status: value }));
        expect(errors.length).toBe(0);
      },
    );

    it('accepts an unrecognised status string — filter is permissive per GD-M18-1 D13', async () => {
      const errors = await validate(makeQuery({ status: 'UNKNOWN_STATUS' }));
      expect(errors.length).toBe(0);
    });
  });
});
