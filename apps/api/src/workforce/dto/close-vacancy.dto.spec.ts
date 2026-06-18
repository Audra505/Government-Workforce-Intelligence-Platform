import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CloseVacancyDto } from './close-vacancy.dto';

function make(payload: Record<string, unknown>): CloseVacancyDto {
  return plainToInstance(CloseVacancyDto, payload);
}

async function errorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(make(payload));
  return errors.map((e) => e.property);
}

describe('CloseVacancyDto', () => {
  it('accepts closureType FILLED', async () => {
    const errors = await validate(make({ closureType: 'FILLED' }));
    expect(errors.length).toBe(0);
  });

  it('accepts closureType CANCELLED', async () => {
    const errors = await validate(make({ closureType: 'CANCELLED' }));
    expect(errors.length).toBe(0);
  });

  it('rejects when closureType is missing', async () => {
    const props = await errorsFor({});
    expect(props).toContain('closureType');
  });

  it('rejects CLOSED — this is the resulting status, not the closure type', async () => {
    const props = await errorsFor({ closureType: 'CLOSED' });
    expect(props).toContain('closureType');
  });

  it('rejects lowercase filled (case-sensitive)', async () => {
    const props = await errorsFor({ closureType: 'filled' });
    expect(props).toContain('closureType');
  });

  it('rejects lowercase cancelled (case-sensitive)', async () => {
    const props = await errorsFor({ closureType: 'cancelled' });
    expect(props).toContain('closureType');
  });

  it('rejects an arbitrary string', async () => {
    const props = await errorsFor({ closureType: 'VOID' });
    expect(props).toContain('closureType');
  });
});
