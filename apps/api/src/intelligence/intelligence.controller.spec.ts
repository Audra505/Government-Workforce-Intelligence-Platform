// Reference: governance/GD-M30-1.md — Decisions 3, 4, 9, 14 (validation gate)
// Reference: spec/01_requirements.md — FR-401, FR-904
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
//
// Test sections:
//   1. Controller unit tests — guards mocked; verify response shape, service call, audit event
//   2. RBAC enforcement — JwtAuthGuard mocked to inject user; RolesGuard runs for real via supertest
//   3. Tenant isolation — confirm tenantId flows from JWT only, not from query params
//
// RBAC test approach (governance D14 requires allowed/forbidden role results):
//   JwtAuthGuard is mocked to set req.user with specific roles.
//   RolesGuard is NOT overridden — it evaluates @RequireRoles against req.user.roles.
//   Tests use supertest so the full HTTP stack (guards, pipes, controller) is exercised.

import { type ExecutionContext, UnauthorizedException, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import { Reflector } from '@nestjs/core';
import { IntelligenceController } from './intelligence.controller';
import { VacancyRiskService } from './services/vacancy-risk.service';
import { WorkforceReadinessService } from './services/workforce-readiness.service';
import { AttritionRiskService } from './services/attrition-risk.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import type { RequestUser } from '../identity/jwt.strategy';
import type { VacancyRiskItem } from './services/vacancy-risk.service';
import type { IntelligenceExplainabilityOutput } from './interfaces/intelligence-explainability.interface';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_ID   = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const mockActor: RequestUser = {
  userId:   USER_ID,
  tenantId: TENANT_ID,
  email:    'admin@dev.gov',
  firstName: '',
  lastName:  '',
  roles:    ['System Administrator'],
};

const mockRiskItem: VacancyRiskItem = {
  vacancyId:      'vvvvvvvv-vvvv-vvvv-vvvv-vvvvvvvvvvvv',
  positionTitle:  'HR Specialist',
  departmentName: 'Human Resources',
  status:         'OPEN',
  daysOpen:       45,
  priority:       'HIGH',
  riskScore:      50,
  riskLevel:      'HIGH',
  confidence:     70,
  reasoning:      'HIGH priority vacancy open 30–59 days with no expected fill date set.',
  factors: [
    { name: 'vacancyAge', contribution: 20, detail: 'Open 30–59 days' },
    { name: 'priority',   contribution: 25, detail: 'Priority: HIGH' },
    { name: 'vacancyStatus', contribution: 5, detail: 'Status OPEN — not yet in active recruitment' },
  ],
  computedAt:     '2026-07-15T12:00:00.000Z',
  formulaVersion: 'deterministic-v1',
};

// GD-M31-1: WorkforceReadinessService returns the shared IntelligenceExplainabilityOutput
// shape (riskScore/riskLevel field names) — the controller maps these onto
// readinessScore/readinessLevel at the HTTP response boundary (Decision 8 naming note).
const mockReadinessOutput: IntelligenceExplainabilityOutput = {
  riskScore:      76,
  riskLevel:      'READY',
  confidence:     90,
  reasoning:      'Workforce readiness is READY, driven primarily by strong staffing coverage.',
  factors: [
    { name: 'staffingCoverage', contribution: 27, detail: '90% of current workforce active' },
    { name: 'positionCapacity', contribution: 18, detail: '90% of active positions filled' },
    { name: 'vacancyPressure', contribution: 21, detail: 'Moderate vacancy risk across open positions' },
    { name: 'certificationCompliance', contribution: 10, detail: '50% of certifications active' },
  ],
  computedAt:     '2026-07-16T12:00:00.000Z',
  formulaVersion: 'readiness-deterministic-v1',
};

// GD-M32-1: AttritionRiskService returns the shared IntelligenceExplainabilityOutput
// shape (riskScore/riskLevel field names) — the controller maps these onto
// attritionScore/attritionRiskLevel at the HTTP response boundary (Decision 8 naming note).
const mockAttritionOutput: IntelligenceExplainabilityOutput = {
  riskScore:      26,
  riskLevel:      'MEDIUM',
  confidence:     85,
  reasoning:      'Attrition risk is MEDIUM, driven primarily by a large share of recently hired staff.',
  factors: [
    { name: 'separationRate', contribution: 12, detail: '7% trailing 12-month separation rate' },
    { name: 'tenureComposition', contribution: 9, detail: '30% of current workforce hired within the last 12 months' },
    { name: 'positionRecurrence', contribution: 5, detail: '1 of 4 filled positions refilled more than once in the last 12 months' },
  ],
  computedAt:     '2026-07-17T12:00:00.000Z',
  formulaVersion: 'attrition-deterministic-v1',
};

// ===========================================================================
// 1. Controller unit tests — guards mocked, direct method calls
// ===========================================================================

describe('IntelligenceController — unit', () => {
  let controller: IntelligenceController;
  let mockVacancyRiskService: { score: jest.Mock };
  let mockWorkforceReadinessService: { score: jest.Mock };
  let mockAttritionRiskService: { score: jest.Mock };
  let mockAuditService: { logEvent: jest.Mock };

  beforeEach(async () => {
    mockVacancyRiskService = { score: jest.fn() };
    mockWorkforceReadinessService = { score: jest.fn() };
    mockAttritionRiskService = { score: jest.fn() };
    mockAuditService = { logEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntelligenceController],
      providers: [
        { provide: VacancyRiskService, useValue: mockVacancyRiskService },
        { provide: WorkforceReadinessService, useValue: mockWorkforceReadinessService },
        { provide: AttritionRiskService, useValue: mockAttritionRiskService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<IntelligenceController>(IntelligenceController);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns success:true with data.items, data.total, data.formulaVersion, data.scoredAt', async () => {
    mockVacancyRiskService.score.mockResolvedValue({ items: [mockRiskItem], total: 1 });

    const result = await controller.getVacancyRisk({}, mockActor) as {
      success: boolean;
      data: { items: VacancyRiskItem[]; total: number; scoredAt: string; formulaVersion: string };
    };

    expect(result.success).toBe(true);
    expect(result.data.items).toHaveLength(1);
    expect(result.data.items[0]).toMatchObject({ vacancyId: mockRiskItem.vacancyId });
    expect(result.data.total).toBe(1);
    expect(result.data.formulaVersion).toBe('deterministic-v1');
    expect(result.data.scoredAt).toBeTruthy();
  });

  it('passes actor.tenantId (from JWT) to VacancyRiskService.score — never from query', async () => {
    mockVacancyRiskService.score.mockResolvedValue({ items: [], total: 0 });

    await controller.getVacancyRisk({}, mockActor);

    expect(mockVacancyRiskService.score).toHaveBeenCalledWith(
      TENANT_ID,
      expect.anything(),
    );
    expect(mockVacancyRiskService.score).not.toHaveBeenCalledWith(
      expect.anything(), // any tenantId other than from actor
      expect.objectContaining({ tenantId: expect.anything() }),
    );
  });

  it('passes query object to VacancyRiskService.score', async () => {
    mockVacancyRiskService.score.mockResolvedValue({ items: [], total: 0 });
    const query = { pageSize: 5, status: 'OPEN' };

    await controller.getVacancyRisk(query, mockActor);

    expect(mockVacancyRiskService.score).toHaveBeenCalledWith(TENANT_ID, query);
  });

  it('creates INTELLIGENCE_VACANCY_RISK_QUERIED audit event on every successful call', async () => {
    mockVacancyRiskService.score.mockResolvedValue({ items: [mockRiskItem], total: 1 });

    await controller.getVacancyRisk({}, mockActor);

    expect(mockAuditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditEventType.INTELLIGENCE_VACANCY_RISK_QUERIED,
        result: 'SUCCESS',
        tenantId: TENANT_ID,
        userId: USER_ID,
      }),
    );
  });

  it('audit metadata includes formulaVersion, itemsReturned, pageSize, statusFilter', async () => {
    mockVacancyRiskService.score.mockResolvedValue({ items: [mockRiskItem, mockRiskItem], total: 5 });

    await controller.getVacancyRisk({ pageSize: 3, status: 'OPEN' }, mockActor);

    expect(mockAuditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          formulaVersion: 'deterministic-v1',
          itemsReturned:  2,
          pageSize:       3,
          statusFilter:   'OPEN',
        }),
      }),
    );
  });

  it('audit metadata statusFilter defaults to ALL when no status filter applied', async () => {
    mockVacancyRiskService.score.mockResolvedValue({ items: [], total: 0 });

    await controller.getVacancyRisk({}, mockActor);

    expect(mockAuditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ statusFilter: 'ALL' }),
      }),
    );
  });

  it('audit metadata does not include individual riskScore values (PII-safe)', async () => {
    mockVacancyRiskService.score.mockResolvedValue({ items: [mockRiskItem], total: 1 });

    await controller.getVacancyRisk({}, mockActor);

    const auditCall = mockAuditService.logEvent.mock.calls[0]![0];
    expect(auditCall.metadata).not.toHaveProperty('riskScore');
    expect(auditCall.metadata).not.toHaveProperty('items');
    expect(auditCall.entityType).toBe('intelligence');
  });

  it('returns empty items array and total:0 when no eligible vacancies exist', async () => {
    mockVacancyRiskService.score.mockResolvedValue({ items: [], total: 0 });

    const result = await controller.getVacancyRisk({}, mockActor) as {
      success: boolean;
      data: { items: VacancyRiskItem[]; total: number };
    };

    expect(result.success).toBe(true);
    expect(result.data.items).toHaveLength(0);
    expect(result.data.total).toBe(0);
  });
});

// ===========================================================================
// 1B. Workforce Readiness — unit tests (GD-M31-1)
// ===========================================================================

describe('IntelligenceController — Workforce Readiness — unit', () => {
  let controller: IntelligenceController;
  let mockVacancyRiskService: { score: jest.Mock };
  let mockWorkforceReadinessService: { score: jest.Mock };
  let mockAttritionRiskService: { score: jest.Mock };
  let mockAuditService: { logEvent: jest.Mock };

  beforeEach(async () => {
    mockVacancyRiskService = { score: jest.fn() };
    mockWorkforceReadinessService = { score: jest.fn() };
    mockAttritionRiskService = { score: jest.fn() };
    mockAuditService = { logEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntelligenceController],
      providers: [
        { provide: VacancyRiskService, useValue: mockVacancyRiskService },
        { provide: WorkforceReadinessService, useValue: mockWorkforceReadinessService },
        { provide: AttritionRiskService, useValue: mockAttritionRiskService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<IntelligenceController>(IntelligenceController);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns success:true with readinessScore, readinessLevel, confidence, reasoning, factors, computedAt, formulaVersion', async () => {
    mockWorkforceReadinessService.score.mockResolvedValue(mockReadinessOutput);

    const result = await controller.getWorkforceReadiness(mockActor) as {
      success: boolean;
      data: {
        readinessScore: number; readinessLevel: string; confidence: number;
        reasoning: string; factors: unknown[]; computedAt: string; formulaVersion: string;
      };
    };

    expect(result.success).toBe(true);
    expect(result.data.readinessScore).toBe(76);
    expect(result.data.readinessLevel).toBe('READY');
    expect(result.data.confidence).toBe(90);
    expect(result.data.reasoning).toBe(mockReadinessOutput.reasoning);
    expect(result.data.factors).toHaveLength(4);
    expect(result.data.computedAt).toBe(mockReadinessOutput.computedAt);
    expect(result.data.formulaVersion).toBe('readiness-deterministic-v1');
  });

  it('maps service riskScore/riskLevel onto readinessScore/readinessLevel field names', async () => {
    mockWorkforceReadinessService.score.mockResolvedValue(mockReadinessOutput);

    const result = await controller.getWorkforceReadiness(mockActor);
    const data = result.data as unknown as Record<string, unknown>;

    expect(data).not.toHaveProperty('riskScore');
    expect(data).not.toHaveProperty('riskLevel');
    expect(data['readinessScore']).toBe(mockReadinessOutput.riskScore);
    expect(data['readinessLevel']).toBe(mockReadinessOutput.riskLevel);
  });

  it('passes actor.tenantId (from JWT) to WorkforceReadinessService.score — no other argument', async () => {
    mockWorkforceReadinessService.score.mockResolvedValue(mockReadinessOutput);

    await controller.getWorkforceReadiness(mockActor);

    expect(mockWorkforceReadinessService.score).toHaveBeenCalledWith(TENANT_ID);
    expect(mockWorkforceReadinessService.score).toHaveBeenCalledTimes(1);
  });

  it('creates INTELLIGENCE_WORKFORCE_READINESS_QUERIED audit event on every successful call', async () => {
    mockWorkforceReadinessService.score.mockResolvedValue(mockReadinessOutput);

    await controller.getWorkforceReadiness(mockActor);

    expect(mockAuditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditEventType.INTELLIGENCE_WORKFORCE_READINESS_QUERIED,
        result: 'SUCCESS',
        tenantId: TENANT_ID,
        userId: USER_ID,
        entityType: 'intelligence',
      }),
    );
  });

  it('audit metadata includes formulaVersion, readinessLevel, confidence', async () => {
    mockWorkforceReadinessService.score.mockResolvedValue(mockReadinessOutput);

    await controller.getWorkforceReadiness(mockActor);

    expect(mockAuditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          formulaVersion: 'readiness-deterministic-v1',
          readinessLevel: 'READY',
          confidence: 90,
        }),
      }),
    );
  });

  it('audit metadata is PII-safe and aggregate-only — no individual employee/vacancy/certification data', async () => {
    mockWorkforceReadinessService.score.mockResolvedValue(mockReadinessOutput);

    await controller.getWorkforceReadiness(mockActor);

    const auditCall = mockAuditService.logEvent.mock.calls[0]![0] as { metadata: Record<string, unknown> };
    expect(auditCall.metadata).not.toHaveProperty('factors');
    expect(auditCall.metadata).not.toHaveProperty('reasoning');
    expect(auditCall.metadata).not.toHaveProperty('readinessScore');
    expect(Object.keys(auditCall.metadata)).toEqual(['formulaVersion', 'readinessLevel', 'confidence']);
  });

  it('Executive User receives a response byte-identical in shape to System Administrator (aggregation guarantee)', async () => {
    mockWorkforceReadinessService.score.mockResolvedValue(mockReadinessOutput);

    const saActor: RequestUser = { ...mockActor, roles: ['System Administrator'] };
    const euActor: RequestUser = { ...mockActor, roles: ['Executive User'] };

    const saResult = await controller.getWorkforceReadiness(saActor);
    const euResult = await controller.getWorkforceReadiness(euActor);

    expect(euResult).toEqual(saResult);
  });
});

// ===========================================================================
// 1C. Attrition Risk — unit tests (GD-M32-1)
// ===========================================================================

describe('IntelligenceController — Attrition Risk — unit', () => {
  let controller: IntelligenceController;
  let mockVacancyRiskService: { score: jest.Mock };
  let mockWorkforceReadinessService: { score: jest.Mock };
  let mockAttritionRiskService: { score: jest.Mock };
  let mockAuditService: { logEvent: jest.Mock };

  beforeEach(async () => {
    mockVacancyRiskService = { score: jest.fn() };
    mockWorkforceReadinessService = { score: jest.fn() };
    mockAttritionRiskService = { score: jest.fn() };
    mockAuditService = { logEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntelligenceController],
      providers: [
        { provide: VacancyRiskService, useValue: mockVacancyRiskService },
        { provide: WorkforceReadinessService, useValue: mockWorkforceReadinessService },
        { provide: AttritionRiskService, useValue: mockAttritionRiskService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<IntelligenceController>(IntelligenceController);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns success:true with attritionScore, attritionRiskLevel, confidence, reasoning, factors, computedAt, formulaVersion', async () => {
    mockAttritionRiskService.score.mockResolvedValue(mockAttritionOutput);

    const result = await controller.getAttritionRisk(mockActor) as {
      success: boolean;
      data: {
        attritionScore: number; attritionRiskLevel: string; confidence: number;
        reasoning: string; factors: unknown[]; computedAt: string; formulaVersion: string;
      };
    };

    expect(result.success).toBe(true);
    expect(result.data.attritionScore).toBe(26);
    expect(result.data.attritionRiskLevel).toBe('MEDIUM');
    expect(result.data.confidence).toBe(85);
    expect(result.data.reasoning).toBe(mockAttritionOutput.reasoning);
    expect(result.data.factors).toHaveLength(3);
    expect(result.data.computedAt).toBe(mockAttritionOutput.computedAt);
    expect(result.data.formulaVersion).toBe('attrition-deterministic-v1');
  });

  it('maps service riskScore/riskLevel onto attritionScore/attritionRiskLevel field names', async () => {
    mockAttritionRiskService.score.mockResolvedValue(mockAttritionOutput);

    const result = await controller.getAttritionRisk(mockActor);
    const data = result.data as unknown as Record<string, unknown>;

    expect(data).not.toHaveProperty('riskScore');
    expect(data).not.toHaveProperty('riskLevel');
    expect(data['attritionScore']).toBe(mockAttritionOutput.riskScore);
    expect(data['attritionRiskLevel']).toBe(mockAttritionOutput.riskLevel);
  });

  it('passes actor.tenantId (from JWT) to AttritionRiskService.score — no other argument', async () => {
    mockAttritionRiskService.score.mockResolvedValue(mockAttritionOutput);

    await controller.getAttritionRisk(mockActor);

    expect(mockAttritionRiskService.score).toHaveBeenCalledWith(TENANT_ID);
    expect(mockAttritionRiskService.score).toHaveBeenCalledTimes(1);
  });

  it('creates INTELLIGENCE_ATTRITION_RISK_QUERIED audit event on every successful call', async () => {
    mockAttritionRiskService.score.mockResolvedValue(mockAttritionOutput);

    await controller.getAttritionRisk(mockActor);

    expect(mockAuditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditEventType.INTELLIGENCE_ATTRITION_RISK_QUERIED,
        result: 'SUCCESS',
        tenantId: TENANT_ID,
        userId: USER_ID,
        entityType: 'intelligence',
      }),
    );
  });

  it('audit metadata includes formulaVersion, attritionRiskLevel, confidence', async () => {
    mockAttritionRiskService.score.mockResolvedValue(mockAttritionOutput);

    await controller.getAttritionRisk(mockActor);

    expect(mockAuditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          formulaVersion: 'attrition-deterministic-v1',
          attritionRiskLevel: 'MEDIUM',
          confidence: 85,
        }),
      }),
    );
  });

  it('audit metadata key-set is exactly formulaVersion/attritionRiskLevel/confidence — PII-safe and aggregate-only', async () => {
    mockAttritionRiskService.score.mockResolvedValue(mockAttritionOutput);

    await controller.getAttritionRisk(mockActor);

    const auditCall = mockAuditService.logEvent.mock.calls[0]![0] as { metadata: Record<string, unknown> };
    expect(auditCall.metadata).not.toHaveProperty('factors');
    expect(auditCall.metadata).not.toHaveProperty('reasoning');
    expect(auditCall.metadata).not.toHaveProperty('attritionScore');
    expect(auditCall.metadata).not.toHaveProperty('employeeId');
    expect(auditCall.metadata).not.toHaveProperty('employeeIds');
    expect(auditCall.metadata).not.toHaveProperty('vacancyId');
    expect(Object.keys(auditCall.metadata)).toEqual(['formulaVersion', 'attritionRiskLevel', 'confidence']);
  });

  it('response contains no individual employee row, identifier, ranking, or list of any kind', async () => {
    mockAttritionRiskService.score.mockResolvedValue(mockAttritionOutput);

    const result = await controller.getAttritionRisk(mockActor);
    const json = JSON.stringify(result);

    expect(json).not.toMatch(/employeeId|employeeNumber|firstName|lastName|"email"/i);
    expect(result.data).not.toHaveProperty('employees');
    expect(result.data).not.toHaveProperty('rankings');
    expect(result.data).not.toHaveProperty('rows');
    expect(result.data).not.toHaveProperty('items');
  });

  it('Executive User receives a response byte-identical in shape to System Administrator (aggregate-only guarantee, GD-M32-1 Decision 11)', async () => {
    mockAttritionRiskService.score.mockResolvedValue(mockAttritionOutput);

    const saActor: RequestUser = { ...mockActor, roles: ['System Administrator'] };
    const euActor: RequestUser = { ...mockActor, roles: ['Executive User'] };

    const saResult = await controller.getAttritionRisk(saActor);
    const euResult = await controller.getAttritionRisk(euActor);

    expect(euResult).toEqual(saResult);
  });
});

// ===========================================================================
// 2. RBAC enforcement — RolesGuard live, JwtAuthGuard mocked to inject user
// GD-M30-1 Decision 4 + 14 validation gate
// ===========================================================================

describe('IntelligenceController — RBAC enforcement', () => {
  const ALLOWED_ROLES = ['System Administrator', 'HR Director', 'Workforce Planner'];
  const FORBIDDEN_ROLES = ['Recruiter', 'Hiring Manager', 'Compliance Officer', 'Executive User'];

  // GD-M31-1 Decision 4: Executive User is allowed for workforce-readiness only
  const READINESS_ALLOWED_ROLES = ['System Administrator', 'HR Director', 'Workforce Planner', 'Executive User'];
  const READINESS_FORBIDDEN_ROLES = ['Recruiter', 'Hiring Manager', 'Compliance Officer'];

  // GD-M32-1 Decision 4: Executive User is allowed for attrition-risk (aggregate-only)
  const ATTRITION_ALLOWED_ROLES = ['System Administrator', 'HR Director', 'Workforce Planner', 'Executive User'];
  const ATTRITION_FORBIDDEN_ROLES = ['Recruiter', 'Hiring Manager', 'Compliance Officer'];

  async function buildApp(roles: string[] | 'no-auth'): Promise<INestApplication> {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntelligenceController],
      providers: [
        {
          provide: VacancyRiskService,
          useValue: { score: jest.fn().mockResolvedValue({ items: [], total: 0 }) },
        },
        {
          provide: WorkforceReadinessService,
          useValue: { score: jest.fn().mockResolvedValue(mockReadinessOutput) },
        },
        {
          provide: AttritionRiskService,
          useValue: { score: jest.fn().mockResolvedValue(mockAttritionOutput) },
        },
        { provide: AuditService, useValue: { logEvent: jest.fn() } },
        RolesGuard,
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(ctx: ExecutionContext): boolean {
          if (roles === 'no-auth') throw new UnauthorizedException();
          const req = ctx.switchToHttp().getRequest<{ user: RequestUser }>();
          req.user = {
            userId: USER_ID,
            tenantId: TENANT_ID,
            email: 'test@test.gov',
            firstName: '',
            lastName: '',
            roles: roles as string[],
          };
          return true;
        },
      })
      // RolesGuard is NOT overridden — it evaluates @RequireRoles for real
      .compile();

    const app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();
    return app;
  }

  it.each(ALLOWED_ROLES)('%s → 200 OK', async (role) => {
    const app = await buildApp([role]);
    await request(app.getHttpServer())
      .get('/api/v1/intelligence/vacancy-risk')
      .expect(200);
    await app.close();
  });

  it.each(FORBIDDEN_ROLES)('%s → 403 Forbidden', async (role) => {
    const app = await buildApp([role]);
    await request(app.getHttpServer())
      .get('/api/v1/intelligence/vacancy-risk')
      .expect(403);
    await app.close();
  });

  it('no JWT → 401 Unauthorized', async () => {
    const app = await buildApp('no-auth');
    await request(app.getHttpServer())
      .get('/api/v1/intelligence/vacancy-risk')
      .expect(401);
    await app.close();
  });

  // GD-M31-1 Decision 4 + 14 validation gate — workforce-readiness endpoint
  it.each(READINESS_ALLOWED_ROLES)('workforce-readiness: %s → 200 OK', async (role) => {
    const app = await buildApp([role]);
    await request(app.getHttpServer())
      .get('/api/v1/intelligence/workforce-readiness')
      .expect(200);
    await app.close();
  });

  it.each(READINESS_FORBIDDEN_ROLES)('workforce-readiness: %s → 403 Forbidden', async (role) => {
    const app = await buildApp([role]);
    await request(app.getHttpServer())
      .get('/api/v1/intelligence/workforce-readiness')
      .expect(403);
    await app.close();
  });

  it('workforce-readiness: no JWT → 401 Unauthorized', async () => {
    const app = await buildApp('no-auth');
    await request(app.getHttpServer())
      .get('/api/v1/intelligence/workforce-readiness')
      .expect(401);
    await app.close();
  });

  // GD-M32-1 Decision 4 + 14 validation gate — attrition-risk endpoint
  it.each(ATTRITION_ALLOWED_ROLES)('attrition-risk: %s → 200 OK', async (role) => {
    const app = await buildApp([role]);
    await request(app.getHttpServer())
      .get('/api/v1/intelligence/attrition-risk')
      .expect(200);
    await app.close();
  });

  it.each(ATTRITION_FORBIDDEN_ROLES)('attrition-risk: %s → 403 Forbidden', async (role) => {
    const app = await buildApp([role]);
    await request(app.getHttpServer())
      .get('/api/v1/intelligence/attrition-risk')
      .expect(403);
    await app.close();
  });

  it('attrition-risk: no JWT → 401 Unauthorized', async () => {
    const app = await buildApp('no-auth');
    await request(app.getHttpServer())
      .get('/api/v1/intelligence/attrition-risk')
      .expect(401);
    await app.close();
  });
});

// ===========================================================================
// 3. Tenant isolation — GD-M30-1 Decision 3
// ===========================================================================

describe('IntelligenceController — tenant isolation', () => {
  let controller: IntelligenceController;
  let mockVacancyRiskService: { score: jest.Mock };
  let mockWorkforceReadinessService: { score: jest.Mock };
  let mockAttritionRiskService: { score: jest.Mock };

  beforeEach(async () => {
    mockVacancyRiskService = { score: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
    mockWorkforceReadinessService = { score: jest.fn().mockResolvedValue(mockReadinessOutput) };
    mockAttritionRiskService = { score: jest.fn().mockResolvedValue(mockAttritionOutput) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntelligenceController],
      providers: [
        { provide: VacancyRiskService, useValue: mockVacancyRiskService },
        { provide: WorkforceReadinessService, useValue: mockWorkforceReadinessService },
        { provide: AttritionRiskService, useValue: mockAttritionRiskService },
        { provide: AuditService, useValue: { logEvent: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<IntelligenceController>(IntelligenceController);
  });

  it('tenantId for service call comes from JWT actor.tenantId, not from query string', async () => {
    const actorTenantA: RequestUser = { ...mockActor, tenantId: 'tenant-a' };

    await controller.getVacancyRisk({}, actorTenantA);

    expect(mockVacancyRiskService.score).toHaveBeenCalledWith('tenant-a', expect.anything());
  });

  it('two actors with different tenantIds produce separate service calls with their own tenantId', async () => {
    const actorA: RequestUser = { ...mockActor, tenantId: 'tenant-a' };
    const actorB: RequestUser = { ...mockActor, tenantId: 'tenant-b' };

    await controller.getVacancyRisk({}, actorA);
    await controller.getVacancyRisk({}, actorB);

    expect(mockVacancyRiskService.score).toHaveBeenNthCalledWith(1, 'tenant-a', expect.anything());
    expect(mockVacancyRiskService.score).toHaveBeenNthCalledWith(2, 'tenant-b', expect.anything());
  });

  // GD-M31-1 Decision 3 — workforce-readiness endpoint
  it('workforce-readiness: tenantId for service call comes from JWT actor.tenantId, not from query string', async () => {
    const actorTenantA: RequestUser = { ...mockActor, tenantId: 'tenant-a' };

    await controller.getWorkforceReadiness(actorTenantA);

    expect(mockWorkforceReadinessService.score).toHaveBeenCalledWith('tenant-a');
  });

  it('workforce-readiness: two actors with different tenantIds produce separate service calls with their own tenantId', async () => {
    const actorA: RequestUser = { ...mockActor, tenantId: 'tenant-a' };
    const actorB: RequestUser = { ...mockActor, tenantId: 'tenant-b' };

    await controller.getWorkforceReadiness(actorA);
    await controller.getWorkforceReadiness(actorB);

    expect(mockWorkforceReadinessService.score).toHaveBeenNthCalledWith(1, 'tenant-a');
    expect(mockWorkforceReadinessService.score).toHaveBeenNthCalledWith(2, 'tenant-b');
  });

  // GD-M32-1 Decision 3 — attrition-risk endpoint
  it('attrition-risk: tenantId for service call comes from JWT actor.tenantId, not from query string', async () => {
    const actorTenantA: RequestUser = { ...mockActor, tenantId: 'tenant-a' };

    await controller.getAttritionRisk(actorTenantA);

    expect(mockAttritionRiskService.score).toHaveBeenCalledWith('tenant-a');
  });

  it('attrition-risk: two actors with different tenantIds produce separate service calls with their own tenantId', async () => {
    const actorA: RequestUser = { ...mockActor, tenantId: 'tenant-a' };
    const actorB: RequestUser = { ...mockActor, tenantId: 'tenant-b' };

    await controller.getAttritionRisk(actorA);
    await controller.getAttritionRisk(actorB);

    expect(mockAttritionRiskService.score).toHaveBeenNthCalledWith(1, 'tenant-a');
    expect(mockAttritionRiskService.score).toHaveBeenNthCalledWith(2, 'tenant-b');
  });
});
