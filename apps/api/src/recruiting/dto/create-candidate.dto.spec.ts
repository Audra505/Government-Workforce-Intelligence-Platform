import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateCandidateDto } from './create-candidate.dto';

const validPayload = {
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane.smith@agency.gov',
};

function make(overrides: Record<string, unknown> = {}): CreateCandidateDto {
  return plainToInstance(CreateCandidateDto, { ...validPayload, ...overrides });
}

async function errorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateCandidateDto, payload);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('CreateCandidateDto', () => {
  describe('valid payload', () => {
    it('accepts a minimal valid payload (required fields only)', async () => {
      const errors = await validate(make());
      expect(errors.length).toBe(0);
    });

    it('accepts a fully populated payload', async () => {
      const errors = await validate(
        make({ phone: '202-555-0001', source: 'USAJOBS', notes: 'Referred by department head' }),
      );
      expect(errors.length).toBe(0);
    });
  });

  describe('firstName', () => {
    it('rejects when firstName is missing', async () => {
      const props = await errorsFor({ lastName: 'Smith', email: 'jane.smith@agency.gov' });
      expect(props).toContain('firstName');
    });

    it('rejects an empty string', async () => {
      const props = await errorsFor({ ...validPayload, firstName: '' });
      expect(props).toContain('firstName');
    });

    it('rejects firstName longer than 100 characters', async () => {
      const props = await errorsFor({ ...validPayload, firstName: 'A'.repeat(101) });
      expect(props).toContain('firstName');
    });

    it('accepts firstName at exactly 100 characters', async () => {
      const errors = await validate(make({ firstName: 'A'.repeat(100) }));
      expect(errors.length).toBe(0);
    });
  });

  describe('lastName', () => {
    it('rejects when lastName is missing', async () => {
      const props = await errorsFor({ firstName: 'Jane', email: 'jane.smith@agency.gov' });
      expect(props).toContain('lastName');
    });

    it('rejects an empty string', async () => {
      const props = await errorsFor({ ...validPayload, lastName: '' });
      expect(props).toContain('lastName');
    });

    it('rejects lastName longer than 100 characters', async () => {
      const props = await errorsFor({ ...validPayload, lastName: 'A'.repeat(101) });
      expect(props).toContain('lastName');
    });

    it('accepts lastName at exactly 100 characters', async () => {
      const errors = await validate(make({ lastName: 'A'.repeat(100) }));
      expect(errors.length).toBe(0);
    });
  });

  describe('email', () => {
    it('rejects when email is missing', async () => {
      const props = await errorsFor({ firstName: 'Jane', lastName: 'Smith' });
      expect(props).toContain('email');
    });

    it('rejects an invalid email format', async () => {
      const props = await errorsFor({ ...validPayload, email: 'not-an-email' });
      expect(props).toContain('email');
    });

    it('rejects email longer than 255 characters', async () => {
      // 252-char local part + @a.co (5) = 257 chars — exceeds @MaxLength(255)
      const props = await errorsFor({ ...validPayload, email: 'a'.repeat(252) + '@a.co' });
      expect(props).toContain('email');
    });
  });

  describe('phone', () => {
    it('accepts when phone is absent — optional field', async () => {
      const errors = await validate(make());
      expect(errors.length).toBe(0);
    });

    it('rejects phone longer than 50 characters', async () => {
      const props = await errorsFor({ ...validPayload, phone: '1'.repeat(51) });
      expect(props).toContain('phone');
    });

    it('accepts phone at exactly 50 characters', async () => {
      const errors = await validate(make({ phone: '1'.repeat(50) }));
      expect(errors.length).toBe(0);
    });
  });

  describe('source', () => {
    it('accepts when source is absent — optional field', async () => {
      const errors = await validate(make());
      expect(errors.length).toBe(0);
    });

    it('rejects source longer than 100 characters', async () => {
      const props = await errorsFor({ ...validPayload, source: 'A'.repeat(101) });
      expect(props).toContain('source');
    });

    it('accepts source at exactly 100 characters', async () => {
      const errors = await validate(make({ source: 'A'.repeat(100) }));
      expect(errors.length).toBe(0);
    });
  });

  describe('forbidden fields — tenantId and status', () => {
    // tenantId and status are not declared on CreateCandidateDto.
    // The global ValidationPipe in main.ts (whitelist: true, forbidNonWhitelisted: true)
    // rejects any HTTP request body containing these fields with 400 Bad Request.
    // At the class-validator unit-test level, undeclared properties produce no
    // constraint errors — they are handled at the NestJS layer, not by class-validator.
    it('validate() produces no constraint error when tenantId is present — NestJS layer handles rejection', async () => {
      const errors = await validate(make({ tenantId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }));
      expect(errors.length).toBe(0);
    });

    it('validate() produces no constraint error when status is present — NestJS layer handles rejection', async () => {
      const errors = await validate(make({ status: 'ACTIVE' }));
      expect(errors.length).toBe(0);
    });
  });
});
