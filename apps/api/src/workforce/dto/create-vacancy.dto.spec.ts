import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateVacancyDto } from './create-vacancy.dto';

const VALID_UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

const validPayload = {
  positionId: VALID_UUID,
  priority: 'HIGH',
  reason: 'RETIREMENT',
  expectedFillDate: '2027-06-01',
};

function make(overrides: Record<string, unknown> = {}): CreateVacancyDto {
  return plainToInstance(CreateVacancyDto, { ...validPayload, ...overrides });
}

async function errorsFor(overrides: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateVacancyDto, overrides);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('CreateVacancyDto', () => {
  describe('valid payload', () => {
    it('accepts a fully valid payload with no errors', async () => {
      const errors = await validate(make());
      expect(errors.length).toBe(0);
    });
  });

  describe('positionId', () => {
    it('accepts a valid UUID', async () => {
      const errors = await validate(make({ positionId: VALID_UUID }));
      expect(errors.length).toBe(0);
    });

    it('rejects when positionId is missing', async () => {
      const props = await errorsFor({ priority: 'HIGH', reason: 'RETIREMENT', expectedFillDate: '2027-06-01' });
      expect(props).toContain('positionId');
    });

    it('rejects a non-UUID string', async () => {
      const props = await errorsFor({ ...validPayload, positionId: 'not-a-uuid' });
      expect(props).toContain('positionId');
    });

    it('rejects an empty string', async () => {
      const props = await errorsFor({ ...validPayload, positionId: '' });
      expect(props).toContain('positionId');
    });
  });

  describe('priority', () => {
    it.each(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])('accepts priority "%s"', async (priority) => {
      const errors = await validate(make({ priority }));
      expect(errors.length).toBe(0);
    });

    it('rejects when priority is missing', async () => {
      const props = await errorsFor({ positionId: VALID_UUID, reason: 'RETIREMENT', expectedFillDate: '2027-06-01' });
      expect(props).toContain('priority');
    });

    it('rejects an unrecognised priority value', async () => {
      const props = await errorsFor({ ...validPayload, priority: 'URGENT' });
      expect(props).toContain('priority');
    });

    it('rejects lowercase priority (case-sensitive)', async () => {
      const props = await errorsFor({ ...validPayload, priority: 'high' });
      expect(props).toContain('priority');
    });
  });

  describe('reason', () => {
    it.each([
      'NEW_POSITION',
      'RETIREMENT',
      'RESIGNATION',
      'TRANSFER',
      'TERMINATION',
      'EXPANSION',
      'TEMPORARY_COVERAGE',
    ])('accepts reason "%s"', async (reason) => {
      const errors = await validate(make({ reason }));
      expect(errors.length).toBe(0);
    });

    it('rejects when reason is missing', async () => {
      const props = await errorsFor({ positionId: VALID_UUID, priority: 'HIGH', expectedFillDate: '2027-06-01' });
      expect(props).toContain('reason');
    });

    it('rejects an unrecognised reason value', async () => {
      const props = await errorsFor({ ...validPayload, reason: 'RESTRUCTURING' });
      expect(props).toContain('reason');
    });

    it('rejects TEMPORARY_NEED — predecessor label replaced by TEMPORARY_COVERAGE', async () => {
      const props = await errorsFor({ ...validPayload, reason: 'TEMPORARY_NEED' });
      expect(props).toContain('reason');
    });
  });

  describe('expectedFillDate', () => {
    it('accepts a date-only ISO 8601 string', async () => {
      const errors = await validate(make({ expectedFillDate: '2027-06-01' }));
      expect(errors.length).toBe(0);
    });

    it('accepts a full ISO 8601 datetime string', async () => {
      const errors = await validate(make({ expectedFillDate: '2027-06-01T00:00:00.000Z' }));
      expect(errors.length).toBe(0);
    });

    it('rejects when expectedFillDate is missing', async () => {
      const props = await errorsFor({ positionId: VALID_UUID, priority: 'HIGH', reason: 'RETIREMENT' });
      expect(props).toContain('expectedFillDate');
    });

    it('rejects a non-date string', async () => {
      const props = await errorsFor({ ...validPayload, expectedFillDate: 'tomorrow' });
      expect(props).toContain('expectedFillDate');
    });
  });
});
