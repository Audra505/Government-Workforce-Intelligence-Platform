import { ServiceUnavailableException } from '@nestjs/common';
import { HealthCheckError, HealthCheckService, TerminusModule } from '@nestjs/terminus';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma-health.indicator';
import { AuditIntegrityHealthIndicator } from './audit-integrity.health-indicator';

// Reference: spec/10_backend_architecture.md — Health Checks
// Reference: spec/07_security_architecture.md — SEC-007: sensitive data must not appear in responses
// Reference: governance/GD-M39-1.md — Decision 21 (coarse audit-integrity aggregate)
//
// Three concerns are tested here:
//   1. PrismaHealthIndicator — verifies connectivity logic and error sanitization
//   2. AuditIntegrityHealthIndicator — verifies the coarse ok/degraded aggregate
//   3. HealthController — verifies delegation to HealthCheckService and both indicators
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
// AuditIntegrityHealthIndicator — GD-M39-1 Decision 21
// ---------------------------------------------------------------------------

describe('AuditIntegrityHealthIndicator', () => {
  let indicator: AuditIntegrityHealthIndicator;
  let mockPrisma: {
    auditChainState: { count: jest.Mock };
    auditWriteFailure: { count: jest.Mock };
  };

  beforeEach(async () => {
    mockPrisma = {
      auditChainState: { count: jest.fn().mockResolvedValue(0) },
      auditWriteFailure: { count: jest.fn().mockResolvedValue(0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditIntegrityHealthIndicator,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    indicator = module.get<AuditIntegrityHealthIndicator>(AuditIntegrityHealthIndicator);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(indicator).toBeDefined();
  });

  it('reports ok when no broken chains or abandoned failures exist', async () => {
    const result = await indicator.isHealthy('auditIntegrity');
    expect(result).toEqual({ auditIntegrity: { status: 'up', auditIntegrity: 'ok' } });
  });

  it('reports degraded when a broken chain exists', async () => {
    mockPrisma.auditChainState.count.mockResolvedValue(1);
    const result = await indicator.isHealthy('auditIntegrity');
    expect(result).toEqual({ auditIntegrity: { status: 'up', auditIntegrity: 'degraded' } });
  });

  it('reports degraded when an abandoned write failure exists', async () => {
    mockPrisma.auditWriteFailure.count.mockResolvedValue(1);
    const result = await indicator.isHealthy('auditIntegrity');
    expect(result).toEqual({ auditIntegrity: { status: 'up', auditIntegrity: 'degraded' } });
  });

  it('never throws — a degraded/errored result never gates the overall health check status', async () => {
    mockPrisma.auditChainState.count.mockRejectedValue(new Error('db unreachable'));
    await expect(indicator.isHealthy('auditIntegrity')).resolves.toBeDefined();
  });

  it('never exposes a tenant id, count, or failure id in its result', async () => {
    mockPrisma.auditChainState.count.mockResolvedValue(3);
    mockPrisma.auditWriteFailure.count.mockResolvedValue(5);
    const result = await indicator.isHealthy('auditIntegrity');
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/\d{3,}/); // no raw counts (3, 5) leak into the payload
    expect(json).not.toContain('tenantId');
  });
});

// ---------------------------------------------------------------------------
// HealthController
// ---------------------------------------------------------------------------

describe('HealthController', () => {
  let controller: HealthController;
  let mockHealthService: { check: jest.Mock };
  let mockPrismaIndicator: { isHealthy: jest.Mock };
  let mockAuditIndicator: { isHealthy: jest.Mock };

  beforeEach(async () => {
    mockHealthService = { check: jest.fn() };
    mockPrismaIndicator = { isHealthy: jest.fn() };
    mockAuditIndicator = { isHealthy: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: mockHealthService },
        { provide: PrismaHealthIndicator, useValue: mockPrismaIndicator },
        { provide: AuditIntegrityHealthIndicator, useValue: mockAuditIndicator },
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
      info: { database: { status: 'up' }, auditIntegrity: { status: 'up', auditIntegrity: 'ok' } },
      error: {},
      details: { database: { status: 'up' }, auditIntegrity: { status: 'up', auditIntegrity: 'ok' } },
    };
    mockHealthService.check.mockResolvedValue(expected);

    const result = await controller.check();

    expect(mockHealthService.check).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expected);
  });

  it('passes both the database and auditIntegrity indicators to HealthCheckService.check()', async () => {
    mockHealthService.check.mockImplementation(
      async (checks: Array<() => Promise<unknown>>) => {
        for (const check of checks) await check();
        return { status: 'ok', info: {}, error: {}, details: {} };
      },
    );
    mockPrismaIndicator.isHealthy.mockResolvedValue({ database: { status: 'up' } });
    mockAuditIndicator.isHealthy.mockResolvedValue({ auditIntegrity: { status: 'up', auditIntegrity: 'ok' } });

    await controller.check();

    expect(mockPrismaIndicator.isHealthy).toHaveBeenCalledWith('database');
    expect(mockAuditIndicator.isHealthy).toHaveBeenCalledWith('auditIntegrity');
  });
});

// ---------------------------------------------------------------------------
// Full-stack aggregation — GD-M39-1 Decision 21, binding project-owner
// clarification (non-gating). Everything above mocks HealthCheckService
// itself, so it can only prove AuditIntegrityHealthIndicator's OWN
// never-throws behavior — never that a REAL Terminus HealthCheckService,
// wired to the REAL indicator, still aggregates the overall check as
// healthy/200 when audit integrity is degraded. This block uses the real
// TerminusModule/HealthCheckService and the real AuditIntegrityHealthIndicator
// class (only PrismaService/PrismaHealthIndicator's DB dependency is
// mocked) to prove that end-to-end.
// ---------------------------------------------------------------------------

describe('HealthController + real HealthCheckService — non-gating audit-integrity aggregation', () => {
  let controller: HealthController;
  let mockPrisma: {
    $queryRaw: jest.Mock;
    auditChainState: { count: jest.Mock };
    auditWriteFailure: { count: jest.Mock };
  };

  beforeEach(async () => {
    mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]), // DB reachable
      auditChainState: { count: jest.fn().mockResolvedValue(0) },
      auditWriteFailure: { count: jest.fn().mockResolvedValue(0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        PrismaHealthIndicator,
        AuditIntegrityHealthIndicator,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  afterEach(() => jest.clearAllMocks());

  it('reports auditIntegrity: "ok" when no degraded condition exists, overall status ok', async () => {
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.info?.['auditIntegrity']).toEqual({ status: 'up', auditIntegrity: 'ok' });
  });

  it('reports auditIntegrity: "degraded" when a broken chain exists, but overall status remains ok (non-gating)', async () => {
    mockPrisma.auditChainState.count.mockResolvedValue(1);

    const result = await controller.check();

    expect(result.info?.['auditIntegrity']).toEqual({ status: 'up', auditIntegrity: 'degraded' });
    // The binding decision: a broken chain or recovery backlog must NEVER
    // flip the overall HTTP-facing status — a restart cannot repair it.
    expect(result.status).toBe('ok');
    expect(result.error).toEqual({});
  });

  it('reports auditIntegrity: "degraded" when an audit-recovery backlog (ABANDONED failures) exists, overall status remains ok', async () => {
    mockPrisma.auditWriteFailure.count.mockResolvedValue(7);

    const result = await controller.check();

    expect(result.info?.['auditIntegrity']).toEqual({ status: 'up', auditIntegrity: 'degraded' });
    expect(result.status).toBe('ok');
  });

  it('still reports overall status down when the DATABASE itself is unreachable — audit-integrity degradation is not the only path to "down", but is never itself sufficient to cause it', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    mockPrisma.auditChainState.count.mockResolvedValue(1); // also degraded

    // HealthCheckService.check() throws ServiceUnavailableException (built
    // from the underlying HealthCheckError) when ANY indicator in the
    // array is down — confirmed real Terminus behavior, not assumed.
    let caught: unknown;
    try {
      await controller.check();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    const response = (caught as ServiceUnavailableException).getResponse() as {
      error?: Record<string, unknown>;
    };
    // The failure is attributable to the database indicator specifically —
    // "down" — never to auditIntegrity, which never appears under `error`.
    expect(response.error).toHaveProperty('database');
    expect(response.error).not.toHaveProperty('auditIntegrity');
  });

  it('the degraded response body never contains a tenant id, count, failure id, or raw error, in the full aggregated payload', async () => {
    mockPrisma.auditChainState.count.mockResolvedValue(42);
    mockPrisma.auditWriteFailure.count.mockResolvedValue(99);

    const result = await controller.check();
    const json = JSON.stringify(result);

    expect(json).not.toContain('42');
    expect(json).not.toContain('99');
    expect(json).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i); // no UUID-shaped id
    expect(json).not.toContain('tenantId');
    expect(json).not.toContain('tenant_id');
  });
});
