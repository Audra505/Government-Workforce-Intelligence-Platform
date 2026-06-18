import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateVacancyDto } from './update-vacancy.dto';

function make(payload: Record<string, unknown>): UpdateVacancyDto {
  return plainToInstance(UpdateVacancyDto, payload);
}

async function errorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(make(payload));
  return errors.map((e) => e.property);
}

describe('UpdateVacancyDto', () => {
  describe('empty body', () => {
    it('accepts an empty body — all fields are optional', async () => {
      const errors = await validate(make({}));
      expect(errors.length).toBe(0);
    });
  });

  describe('priority', () => {
    it('accepts a valid priority', async () => {
      const errors = await validate(make({ priority: 'HIGH' }));
      expect(errors.length).toBe(0);
    });

    it('rejects an unrecognised priority value', async () => {
      const props = await errorsFor({ priority: 'URGENT' });
      expect(props).toContain('priority');
    });

    it('rejects lowercase priority (case-sensitive)', async () => {
      const props = await errorsFor({ priority: 'high' });
      expect(props).toContain('priority');
    });
  });

  describe('reason', () => {
    it('accepts a valid reason', async () => {
      const errors = await validate(make({ reason: 'RETIREMENT' }));
      expect(errors.length).toBe(0);
    });

    it('accepts TERMINATION — directives/03 approved value', async () => {
      const errors = await validate(make({ reason: 'TERMINATION' }));
      expect(errors.length).toBe(0);
    });

    it('rejects TEMPORARY_NEED — predecessor label not accepted', async () => {
      const props = await errorsFor({ reason: 'TEMPORARY_NEED' });
      expect(props).toContain('reason');
    });

    it('rejects an unrecognised reason', async () => {
      const props = await errorsFor({ reason: 'RESTRUCTURING' });
      expect(props).toContain('reason');
    });
  });

  describe('expectedFillDate', () => {
    it('accepts a valid ISO 8601 date string', async () => {
      const errors = await validate(make({ expectedFillDate: '2027-12-01' }));
      expect(errors.length).toBe(0);
    });

    it('rejects a non-date string', async () => {
      const props = await errorsFor({ expectedFillDate: 'tomorrow' });
      expect(props).toContain('expectedFillDate');
    });
  });

  describe('status', () => {
    it('accepts status OPEN — only valid PUT transition', async () => {
      const errors = await validate(make({ status: 'OPEN' }));
      expect(errors.length).toBe(0);
    });

    it('rejects status CLOSED — use POST /vacancies/:id/close instead', async () => {
      const props = await errorsFor({ status: 'CLOSED' });
      expect(props).toContain('status');
    });

    it('rejects status DRAFT — not a valid PUT transition target', async () => {
      const props = await errorsFor({ status: 'DRAFT' });
      expect(props).toContain('status');
    });

    it('rejects status IN_RECRUITMENT — triggered by application receipt, not caller', async () => {
      const props = await errorsFor({ status: 'IN_RECRUITMENT' });
      expect(props).toContain('status');
    });

    it('rejects lowercase open (case-sensitive)', async () => {
      const props = await errorsFor({ status: 'open' });
      expect(props).toContain('status');
    });
  });

  describe('combined fields', () => {
    it('accepts all valid fields together', async () => {
      const errors = await validate(
        make({ priority: 'CRITICAL', reason: 'EXPANSION', expectedFillDate: '2027-09-01', status: 'OPEN' }),
      );
      expect(errors.length).toBe(0);
    });
  });
});
