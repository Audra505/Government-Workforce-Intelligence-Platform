import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ListVacanciesQueryDto } from './list-vacancies-query.dto';

const VALID_UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

function make(payload: Record<string, unknown>): ListVacanciesQueryDto {
  return plainToInstance(ListVacanciesQueryDto, payload);
}

async function errorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(make(payload));
  return errors.map((e) => e.property);
}

describe('ListVacanciesQueryDto', () => {
  describe('defaults', () => {
    it('accepts an empty query with defaults page=1 and pageSize=20', async () => {
      const dto = make({});
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.page).toBe(1);
      expect(dto.pageSize).toBe(20);
    });
  });

  describe('status', () => {
    it.each(['DRAFT', 'OPEN', 'IN_RECRUITMENT', 'CLOSED'])('accepts stored state "%s"', async (status) => {
      const errors = await validate(make({ status }));
      expect(errors.length).toBe(0);
    });

    it('rejects FILLED — not a stored state (closure type discriminator)', async () => {
      const props = await errorsFor({ status: 'FILLED' });
      expect(props).toContain('status');
    });

    it('rejects CANCELLED — not a stored state (closure type discriminator)', async () => {
      const props = await errorsFor({ status: 'CANCELLED' });
      expect(props).toContain('status');
    });
  });

  describe('priority', () => {
    it('accepts a valid priority filter', async () => {
      const errors = await validate(make({ priority: 'CRITICAL' }));
      expect(errors.length).toBe(0);
    });

    it('rejects an unrecognised priority', async () => {
      const props = await errorsFor({ priority: 'UNKNOWN' });
      expect(props).toContain('priority');
    });
  });

  describe('departmentId', () => {
    it('accepts a valid UUID', async () => {
      const errors = await validate(make({ departmentId: VALID_UUID }));
      expect(errors.length).toBe(0);
    });

    it('rejects a non-UUID string', async () => {
      const props = await errorsFor({ departmentId: 'not-a-uuid' });
      expect(props).toContain('departmentId');
    });
  });

  describe('page — type coercion and range', () => {
    it('coerces string "2" to number 2 and passes validation', async () => {
      const dto = make({ page: '2' });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.page).toBe(2);
    });

    it('rejects "abc" — coerces to NaN which fails @IsInt', async () => {
      const props = await errorsFor({ page: 'abc' });
      expect(props).toContain('page');
    });

    it('rejects page=0 — below @Min(1)', async () => {
      const props = await errorsFor({ page: 0 });
      expect(props).toContain('page');
    });
  });

  describe('pageSize — type coercion and range', () => {
    it('accepts pageSize=1 — lower boundary', async () => {
      const errors = await validate(make({ pageSize: 1 }));
      expect(errors.length).toBe(0);
    });

    it('accepts pageSize=100 — upper boundary', async () => {
      const errors = await validate(make({ pageSize: 100 }));
      expect(errors.length).toBe(0);
    });

    it('rejects pageSize=101 — exceeds @Max(100)', async () => {
      const props = await errorsFor({ pageSize: 101 });
      expect(props).toContain('pageSize');
    });
  });

  describe('combined filters', () => {
    it('accepts all valid filter params together', async () => {
      const errors = await validate(
        make({ status: 'OPEN', priority: 'HIGH', departmentId: VALID_UUID, page: 2, pageSize: 50 }),
      );
      expect(errors.length).toBe(0);
    });
  });
});
