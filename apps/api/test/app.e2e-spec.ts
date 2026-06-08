import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';

// Milestone 1 validation: confirms NestJS application bootstraps without errors.
// No database connection required — AppModule has no DB dependency at this stage.
// Additional e2e tests added in Milestone 5 Step 10 (auth.e2e-spec.ts) and beyond.
describe('Application bootstrap', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should bootstrap successfully', () => {
    expect(app).toBeDefined();
  });
});
