import { HealthCheckError, HealthCheckService } from '@nestjs/terminus';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma-health.indicator';

// Reference: spec/10_backend_architecture.md — Health Checks
// Reference: spec/07_security_architecture.md — SEC-007: sensitive data must not appear in responses
//
// Two concerns are tested here:
//   1. PrismaHealthIndicator — verifies connectivity logic and error sanitization
//   2. HealthController — verifies delegation to HealthCheckService
// All tests are pure — no database, no HTTP server, no NestJS application bootstrap.

// ---------------------------------------------------------------------------
// PrismaHealthIndicator
// ---------------------------------------------------------------------------

describe('PrismaHealthIndicator', () => {
  let indicator: PrismaHealthIndicator;
  let mockPrisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    mockPrisma = { $queryRaw: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaHealthIndicator,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    indicator = module.get<PrismaHealthIndicator>(PrismaHealthIndicator);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(indicator).toBeDefined();
  });

  it('returns up status when database is reachable', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const result = await indicator.isHealthy('database');
    expect(result).toEqual({ database: { status: 'up' } });
  });

  it('throws HealthCheckError when database is unreachable', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    await expect(indicator.isHealthy('database')).rejects.toBeInstanceOf(HealthCheckError);
  });

  it('error response contains only the sanitized message — not the raw Prisma error', async () => {
    // Simulate a Prisma connection error that includes the full DATABASE_URL
    const rawPrismaError =
      "Can't reach database server at `localhost:5432`. " +
      'Please make sure your database server is running at ' +
      "'postgresql://govplatform:devpassword@localhost:5432/gov_workforce_dev'.";

    mockPrisma.$queryRaw.mockRejectedValue(new Error(rawPrismaError));

    try {
      await indicator.isHealthy('database');
      throw new Error('Expected HealthCheckError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HealthCheckError);
      const causesJson = JSON.stringify((err as HealthCheckError).causes);
      // Must NOT contain the raw error or any connection detail
      expect(causesJson).not.toContain('postgresql://');
      expect(causesJson).not.toContain('devpassword');
      expect(causesJson).not.toContain('govplatform');
      expect(causesJson).not.toContain("Can't reach");
      // Must contain only the sanitized message
      expect(causesJson).toContain('database unavailable');
    }
  });

  it('error response status is down', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

    try {
      await indicator.isHealthy('database');
      throw new Error('Expected HealthCheckError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HealthCheckError);
      const causes = (err as HealthCheckError).causes as Record<string, unknown>;
      expect((causes['database'] as Record<string, unknown>)['status']).toBe('down');
    }
  });
});

// ---------------------------------------------------------------------------
// HealthController
// ---------------------------------------------------------------------------

describe('HealthController', () => {
  let controller: HealthController;
  let mockHealthService: { check: jest.Mock };
  let mockIndicator: { isHealthy: jest.Mock };

  beforeEach(async () => {
    mockHealthService = { check: jest.fn() };
    mockIndicator = { isHealthy: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: mockHealthService },
        { provide: PrismaHealthIndicator, useValue: mockIndicator },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates to HealthCheckService.check() and returns its result', async () => {
    const expected = {
      status: 'ok',
      info: { database: { status: 'up' } },
      error: {},
      details: { database: { status: 'up' } },
    };
    mockHealthService.check.mockResolvedValue(expected);

    const result = await controller.check();

    expect(mockHealthService.check).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expected);
  });
});
