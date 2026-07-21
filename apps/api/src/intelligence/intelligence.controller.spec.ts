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
import { DepartmentGapService } from './services/department-gap.service';
import type { DepartmentGapResult } from './services/department-gap.service';
import { ExecutiveMetricsService } from './services/executive-metrics.service';
import type { ExecutiveMetricsResult } from './services/executive-metrics.service';
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

// GD-M33-1: DepartmentGapService returns a fully-orchestrated, suppression-applied
// result — the controller does no shaping of its own beyond passing it through.
const mockDepartmentGapResult: DepartmentGapResult = {
  departments: [
    {
      departmentId: 'dept-1',
      departmentName: 'Field Operations',
      suppressed: false,
      suppressionReason: null,
      readiness: {
        score: 68, level: 'DEVELOPING', confidence: 90,
        reasoning: 'Workforce readiness is DEVELOPING, driven primarily by strong staffing coverage.',
        factors: [{ name: 'staffingCoverage', contribution: 27, detail: '90% of current workforce active' }],
        formulaVersion: 'readiness-deterministic-v1',
      },
      attrition: {
        score: 30, level: 'LOW', confidence: 85,
        reasoning: 'Attrition risk is LOW, driven primarily by a low separation rate.',
        factors: [{ name: 'separationRate', contribution: 5, detail: '2% trailing 12-month separation rate' }],
        formulaVersion: 'attrition-deterministic-v1',
      },
      vacancyContext: { openCount: 2, criticalCount: 0, avgDaysOpen: 14 },
    },
    {
      departmentId: 'dept-2',
      departmentName: 'Tiny Unit',
      suppressed: true,
      suppressionReason: 'Department population below minimum reporting threshold (5).',
      readiness: null,
      attrition: null,
      vacancyContext: { openCount: 1, criticalCount: 1, avgDaysOpen: 20 },
    },
  ],
  minimumHeadcountThreshold: 5,
  computedAt: '2026-07-18T12:00:00.000Z',
  formulaVersion: 'department-gap-deterministic-v1',
};

// GD-M34-1: ExecutiveMetricsService returns four independent metric values —
// the controller does no shaping of its own beyond passing them through.
const mockExecutiveMetricsResult: ExecutiveMetricsResult = {
  vacancyRate: { value: 12.0, unit: 'PERCENT', confidence: 100, detail: '6 of 50 active positions are currently vacant.', windowDays: null },
  coverageRate: { value: 82.0, unit: 'PERCENT', confidence: 100, detail: '41 of 50 active positions are filled by an active employee.', windowDays: null },
  timeToFill: { value: 34.2, unit: 'DAYS', confidence: 70, detail: 'Average 34.2 days to fill, based on 8 vacancies filled in the last 365 days.', windowDays: 365 },
  hiringVelocity: { value: 7, unit: 'COUNT', confidence: 100, detail: '7 employees hired in the last 90 days.', windowDays: 90 },
  computedAt: '2026-07-19T12:00:00.000Z',
  formulaVersion: 'executive-metrics-deterministic-v1',
};

// ===========================================================================
// 1. Controller unit tests — guards mocked, direct method calls
// ===========================================================================

describe('IntelligenceController — unit', () => {
  let controller: IntelligenceController;
  let mockVacancyRiskService: { score: jest.Mock };
  let mockWorkforceReadinessService: { score: jest.Mock };
  let mockAttritionRiskService: { score: jest.Mock };
  let mockDepartmentGapService: { getByTenant: jest.Mock };
  let mockExecutiveMetricsService: { getByTenant: jest.Mock };
  let mockAuditService: { logEvent: jest.Mock };

  beforeEach(async () => {
    mockVacancyRiskService = { score: jest.fn() };
    mockWorkforceReadinessService = { score: jest.fn() };
    mockAttritionRiskService = { score: jest.fn() };
    mockDepartmentGapService = { getByTenant: jest.fn() };
    mockExecutiveMetricsService = { getByTenant: jest.fn() };
    mockAuditService = { logEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntelligenceController],
      providers: [
        { provide: VacancyRiskService, useValue: mockVacancyRiskService },
        { provide: WorkforceReadinessService, useValue: mockWorkforceReadinessService },
        { provide: AttritionRiskService, useValue: mockAttritionRiskService },
        { provide: DepartmentGapService, useValue: mockDepartmentGapService },
        { provide: ExecutiveMetricsService, useValue: mockExecutiveMetricsService },
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
  let mockDepartmentGapService: { getByTenant: jest.Mock };
  let mockExecutiveMetricsService: { getByTenant: jest.Mock };
  let mockAuditService: { logEvent: jest.Mock };

  beforeEach(async () => {
    mockVacancyRiskService = { score: jest.fn() };
    mockWorkforceReadinessService = { score: jest.fn() };
    mockAttritionRiskService = { score: jest.fn() };
    mockDepartmentGapService = { getByTenant: jest.fn() };
    mockExecutiveMetricsService = { getByTenant: jest.fn() };
    mockAuditService = { logEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntelligenceController],
      providers: [
        { provide: VacancyRiskService, useValue: mockVacancyRiskService },
        { provide: WorkforceReadinessService, useValue: mockWorkforceReadinessService },
        { provide: AttritionRiskService, useValue: mockAttritionRiskService },
        { provide: DepartmentGapService, useValue: mockDepartmentGapService },
        { provide: ExecutiveMetricsService, useValue: mockExecutiveMetricsService },
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
  let mockDepartmentGapService: { getByTenant: jest.Mock };
  let mockExecutiveMetricsService: { getByTenant: jest.Mock };
  let mockAuditService: { logEvent: jest.Mock };

  beforeEach(async () => {
    mockVacancyRiskService = { score: jest.fn() };
    mockWorkforceReadinessService = { score: jest.fn() };
    mockAttritionRiskService = { score: jest.fn() };
    mockDepartmentGapService = { getByTenant: jest.fn() };
    mockExecutiveMetricsService = { getByTenant: jest.fn() };
    mockAuditService = { logEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntelligenceController],
      providers: [
        { provide: VacancyRiskService, useValue: mockVacancyRiskService },
        { provide: WorkforceReadinessService, useValue: mockWorkforceReadinessService },
        { provide: AttritionRiskService, useValue: mockAttritionRiskService },
        { provide: DepartmentGapService, useValue: mockDepartmentGapService },
        { provide: ExecutiveMetricsService, useValue: mockExecutiveMetricsService },
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
// 1d. Department Gap — unit — GD-M33-1
// ===========================================================================

describe('IntelligenceController — Department Gap — unit', () => {
  let controller: IntelligenceController;
  let mockVacancyRiskService: { score: jest.Mock };
  let mockWorkforceReadinessService: { score: jest.Mock };
  let mockAttritionRiskService: { score: jest.Mock };
  let mockDepartmentGapService: { getByTenant: jest.Mock };
  let mockExecutiveMetricsService: { getByTenant: jest.Mock };
  let mockAuditService: { logEvent: jest.Mock };

  beforeEach(async () => {
    mockVacancyRiskService = { score: jest.fn() };
    mockWorkforceReadinessService = { score: jest.fn() };
    mockAttritionRiskService = { score: jest.fn() };
    mockDepartmentGapService = { getByTenant: jest.fn() };
    mockExecutiveMetricsService = { getByTenant: jest.fn() };
    mockAuditService = { logEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntelligenceController],
      providers: [
        { provide: VacancyRiskService, useValue: mockVacancyRiskService },
        { provide: WorkforceReadinessService, useValue: mockWorkforceReadinessService },
        { provide: AttritionRiskService, useValue: mockAttritionRiskService },
        { provide: DepartmentGapService, useValue: mockDepartmentGapService },
        { provide: ExecutiveMetricsService, useValue: mockExecutiveMetricsService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<IntelligenceController>(IntelligenceController);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns success:true with data.departments, data.minimumHeadcountThreshold, data.computedAt, data.formulaVersion', async () => {
    mockDepartmentGapService.getByTenant.mockResolvedValue(mockDepartmentGapResult);

    const result = await controller.getDepartmentGap(mockActor);

    expect(result.success).toBe(true);
    expect(result.data.departments).toHaveLength(2);
    expect(result.data.minimumHeadcountThreshold).toBe(5);
    expect(result.data.formulaVersion).toBe('department-gap-deterministic-v1');
  });

  it('passes actor.tenantId (from JWT) to DepartmentGapService.getByTenant — no other argument', async () => {
    mockDepartmentGapService.getByTenant.mockResolvedValue(mockDepartmentGapResult);

    await controller.getDepartmentGap(mockActor);

    expect(mockDepartmentGapService.getByTenant).toHaveBeenCalledWith(TENANT_ID);
    expect(mockDepartmentGapService.getByTenant).toHaveBeenCalledTimes(1);
  });

  it('creates INTELLIGENCE_DEPARTMENT_GAP_QUERIED audit event on every successful call', async () => {
    mockDepartmentGapService.getByTenant.mockResolvedValue(mockDepartmentGapResult);

    await controller.getDepartmentGap(mockActor);

    expect(mockAuditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditEventType.INTELLIGENCE_DEPARTMENT_GAP_QUERIED,
        result: 'SUCCESS',
        tenantId: TENANT_ID,
        userId: USER_ID,
        entityType: 'intelligence',
      }),
    );
  });

  it('audit metadata key-set is exactly formulaVersion/departmentCount/suppressedDepartmentCount — PII-safe, no department detail', async () => {
    mockDepartmentGapService.getByTenant.mockResolvedValue(mockDepartmentGapResult);

    await controller.getDepartmentGap(mockActor);

    const auditCall = mockAuditService.logEvent.mock.calls[0]![0] as { metadata: Record<string, unknown> };
    expect(auditCall.metadata['formulaVersion']).toBe('department-gap-deterministic-v1');
    expect(auditCall.metadata['departmentCount']).toBe(2);
    expect(auditCall.metadata['suppressedDepartmentCount']).toBe(1);
    expect(auditCall.metadata).not.toHaveProperty('departmentId');
    expect(auditCall.metadata).not.toHaveProperty('departmentName');
    expect(auditCall.metadata).not.toHaveProperty('departments');
    expect(Object.keys(auditCall.metadata)).toEqual(['formulaVersion', 'departmentCount', 'suppressedDepartmentCount']);
  });

  it('response contains no individual employee row, identifier, ranking, or list of any kind', async () => {
    mockDepartmentGapService.getByTenant.mockResolvedValue(mockDepartmentGapResult);

    const result = await controller.getDepartmentGap(mockActor);
    const json = JSON.stringify(result);

    expect(json).not.toMatch(/employeeId|employeeNumber|firstName|lastName|"email"/i);
    expect(result.data).not.toHaveProperty('employees');
    expect(result.data).not.toHaveProperty('rankings');
    expect(result.data).not.toHaveProperty('rows');
  });

  it('a suppressed department in the response never includes its actual headcount/population', async () => {
    mockDepartmentGapService.getByTenant.mockResolvedValue(mockDepartmentGapResult);

    const result = await controller.getDepartmentGap(mockActor);
    const suppressedEntry = result.data.departments.find(d => d.suppressed)!;

    expect(suppressedEntry.readiness).toBeNull();
    expect(suppressedEntry.attrition).toBeNull();
    expect(JSON.stringify(suppressedEntry)).not.toContain('"population"');
    expect(JSON.stringify(suppressedEntry)).not.toContain('"headcount"');
  });
});

// ===========================================================================
// 1E. Executive Metrics — unit — GD-M34-1
// ===========================================================================

describe('IntelligenceController — Executive Metrics — unit', () => {
  let controller: IntelligenceController;
  let mockVacancyRiskService: { score: jest.Mock };
  let mockWorkforceReadinessService: { score: jest.Mock };
  let mockAttritionRiskService: { score: jest.Mock };
  let mockDepartmentGapService: { getByTenant: jest.Mock };
  let mockExecutiveMetricsService: { getByTenant: jest.Mock };
  let mockAuditService: { logEvent: jest.Mock };

  beforeEach(async () => {
    mockVacancyRiskService = { score: jest.fn() };
    mockWorkforceReadinessService = { score: jest.fn() };
    mockAttritionRiskService = { score: jest.fn() };
    mockDepartmentGapService = { getByTenant: jest.fn() };
    mockExecutiveMetricsService = { getByTenant: jest.fn() };
    mockAuditService = { logEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntelligenceController],
      providers: [
        { provide: VacancyRiskService, useValue: mockVacancyRiskService },
        { provide: WorkforceReadinessService, useValue: mockWorkforceReadinessService },
        { provide: AttritionRiskService, useValue: mockAttritionRiskService },
        { provide: DepartmentGapService, useValue: mockDepartmentGapService },
        { provide: ExecutiveMetricsService, useValue: mockExecutiveMetricsService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<IntelligenceController>(IntelligenceController);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns success:true with vacancyRate, coverageRate, timeToFill, hiringVelocity, computedAt, formulaVersion', async () => {
    mockExecutiveMetricsService.getByTenant.mockResolvedValue(mockExecutiveMetricsResult);

    const result = await controller.getExecutiveMetrics(mockActor);

    expect(result.success).toBe(true);
    expect(result.data.vacancyRate).toEqual(mockExecutiveMetricsResult.vacancyRate);
    expect(result.data.coverageRate).toEqual(mockExecutiveMetricsResult.coverageRate);
    expect(result.data.timeToFill).toEqual(mockExecutiveMetricsResult.timeToFill);
    expect(result.data.hiringVelocity).toEqual(mockExecutiveMetricsResult.hiringVelocity);
    expect(result.data.formulaVersion).toBe('executive-metrics-deterministic-v1');
  });

  it('passes actor.tenantId (from JWT) to ExecutiveMetricsService.getByTenant — no other argument', async () => {
    mockExecutiveMetricsService.getByTenant.mockResolvedValue(mockExecutiveMetricsResult);

    await controller.getExecutiveMetrics(mockActor);

    expect(mockExecutiveMetricsService.getByTenant).toHaveBeenCalledWith(TENANT_ID);
    expect(mockExecutiveMetricsService.getByTenant).toHaveBeenCalledTimes(1);
  });

  it('creates INTELLIGENCE_EXECUTIVE_METRICS_QUERIED audit event on every successful call', async () => {
    mockExecutiveMetricsService.getByTenant.mockResolvedValue(mockExecutiveMetricsResult);

    await controller.getExecutiveMetrics(mockActor);

    expect(mockAuditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditEventType.INTELLIGENCE_EXECUTIVE_METRICS_QUERIED,
        result: 'SUCCESS',
        tenantId: TENANT_ID,
        userId: USER_ID,
        entityType: 'intelligence',
      }),
    );
  });

  it('audit metadata key-set is exactly formulaVersion — PII-safe, no metric value or count included', async () => {
    mockExecutiveMetricsService.getByTenant.mockResolvedValue(mockExecutiveMetricsResult);

    await controller.getExecutiveMetrics(mockActor);

    const auditCall = mockAuditService.logEvent.mock.calls[0]![0] as { metadata: Record<string, unknown> };
    expect(auditCall.metadata['formulaVersion']).toBe('executive-metrics-deterministic-v1');
    expect(Object.keys(auditCall.metadata)).toEqual(['formulaVersion']);
  });

  it('response contains no individual employee, position, or vacancy identifier of any kind', async () => {
    mockExecutiveMetricsService.getByTenant.mockResolvedValue(mockExecutiveMetricsResult);

    const result = await controller.getExecutiveMetrics(mockActor);
    const json = JSON.stringify(result);

    expect(json).not.toMatch(/employeeId|employeeNumber|firstName|lastName|"email"|vacancyId|positionId/i);
    expect(result.data).not.toHaveProperty('employees');
    expect(result.data).not.toHaveProperty('items');
    expect(result.data).not.toHaveProperty('rows');
  });

  it('Executive User receives a response byte-identical in shape to System Administrator (aggregate-only guarantee)', async () => {
    mockExecutiveMetricsService.getByTenant.mockResolvedValue(mockExecutiveMetricsResult);

    const saActor: RequestUser = { ...mockActor, roles: ['System Administrator'] };
    const euActor: RequestUser = { ...mockActor, roles: ['Executive User'] };

    const saResult = await controller.getExecutiveMetrics(saActor);
    const euResult = await controller.getExecutiveMetrics(euActor);

    expect(euResult).toEqual(saResult);
  });
});

// ===========================================================================
// 1F. No snapshot read path — GD-M34-1 Decision 18 (structural proof at the
// routing/controller-surface level, not just by convention)
// ===========================================================================

describe('IntelligenceController — no snapshot/trend/forecast read path', () => {
  it('exposes exactly the five governed Phase 4 handlers — no snapshot, trend, or forecast method exists', () => {
    const methodNames = Object.getOwnPropertyNames(IntelligenceController.prototype)
      .filter(name => name !== 'constructor');

    expect(methodNames.sort()).toEqual(
      [
        'getVacancyRisk',
        'getWorkforceReadiness',
        'getAttritionRisk',
        'getDepartmentGap',
        'getExecutiveMetrics',
      ].sort(),
    );
    for (const name of methodNames) {
      expect(name.toLowerCase()).not.toMatch(/snapshot|trend|forecast/);
    }
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

  // GD-M33-1 Decision 4: Executive User is explicitly NOT allowed for department-gap
  const DEPARTMENT_GAP_ALLOWED_ROLES = ['System Administrator', 'HR Director', 'Workforce Planner'];
  const DEPARTMENT_GAP_FORBIDDEN_ROLES = ['Recruiter', 'Hiring Manager', 'Compliance Officer', 'Executive User'];

  // GD-M34-1 Decision 4: Executive User IS allowed for executive-metrics (aggregate-only)
  const EXECUTIVE_METRICS_ALLOWED_ROLES = ['System Administrator', 'HR Director', 'Workforce Planner', 'Executive User'];
  const EXECUTIVE_METRICS_FORBIDDEN_ROLES = ['Recruiter', 'Hiring Manager', 'Compliance Officer'];

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
        {
          provide: DepartmentGapService,
          useValue: { getByTenant: jest.fn().mockResolvedValue(mockDepartmentGapResult) },
        },
        {
          provide: ExecutiveMetricsService,
          useValue: { getByTenant: jest.fn().mockResolvedValue(mockExecutiveMetricsResult) },
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

  // GD-M33-1 Decision 4 + 17 validation gate — department-gap endpoint
  it.each(DEPARTMENT_GAP_ALLOWED_ROLES)('department-gap: %s → 200 OK', async (role) => {
    const app = await buildApp([role]);
    await request(app.getHttpServer())
      .get('/api/v1/intelligence/department-gap')
      .expect(200);
    await app.close();
  });

  it.each(DEPARTMENT_GAP_FORBIDDEN_ROLES)('department-gap: %s → 403 Forbidden', async (role) => {
    const app = await buildApp([role]);
    await request(app.getHttpServer())
      .get('/api/v1/intelligence/department-gap')
      .expect(403);
    await app.close();
  });

  it('department-gap: no JWT → 401 Unauthorized', async () => {
    const app = await buildApp('no-auth');
    await request(app.getHttpServer())
      .get('/api/v1/intelligence/department-gap')
      .expect(401);
    await app.close();
  });

  // GD-M33-1 Decision 3 — no caller-supplied department filter of any kind
  it('department-gap: a query string (e.g. ?departmentId=x) is silently ignored — same 200 response as no query string', async () => {
    const app = await buildApp(['System Administrator']);

    const withoutQuery = await request(app.getHttpServer())
      .get('/api/v1/intelligence/department-gap')
      .expect(200);
    const withQuery = await request(app.getHttpServer())
      .get('/api/v1/intelligence/department-gap?departmentId=some-dept-id&department=x')
      .expect(200);

    expect(withQuery.body).toEqual(withoutQuery.body);
    await app.close();
  });

  // GD-M34-1 Decision 4 + 21 validation gate — executive-metrics endpoint
  it.each(EXECUTIVE_METRICS_ALLOWED_ROLES)('executive-metrics: %s → 200 OK', async (role) => {
    const app = await buildApp([role]);
    await request(app.getHttpServer())
      .get('/api/v1/intelligence/executive-metrics')
      .expect(200);
    await app.close();
  });

  it.each(EXECUTIVE_METRICS_FORBIDDEN_ROLES)('executive-metrics: %s → 403 Forbidden', async (role) => {
    const app = await buildApp([role]);
    await request(app.getHttpServer())
      .get('/api/v1/intelligence/executive-metrics')
      .expect(403);
    await app.close();
  });

  it('executive-metrics: no JWT → 401 Unauthorized', async () => {
    const app = await buildApp('no-auth');
    await request(app.getHttpServer())
      .get('/api/v1/intelligence/executive-metrics')
      .expect(401);
    await app.close();
  });

  // GD-M34-1 Decision 3 — no caller-supplied parameter of any kind
  it('executive-metrics: a query string is silently ignored — same 200 response as no query string', async () => {
    const app = await buildApp(['System Administrator']);

    const withoutQuery = await request(app.getHttpServer())
      .get('/api/v1/intelligence/executive-metrics')
      .expect(200);
    const withQuery = await request(app.getHttpServer())
      .get('/api/v1/intelligence/executive-metrics?window=30&metric=vacancyRate')
      .expect(200);

    expect(withQuery.body).toEqual(withoutQuery.body);
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
  let mockDepartmentGapService: { getByTenant: jest.Mock };
  let mockExecutiveMetricsService: { getByTenant: jest.Mock };

  beforeEach(async () => {
    mockVacancyRiskService = { score: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
    mockWorkforceReadinessService = { score: jest.fn().mockResolvedValue(mockReadinessOutput) };
    mockAttritionRiskService = { score: jest.fn().mockResolvedValue(mockAttritionOutput) };
    mockDepartmentGapService = { getByTenant: jest.fn().mockResolvedValue(mockDepartmentGapResult) };
    mockExecutiveMetricsService = { getByTenant: jest.fn().mockResolvedValue(mockExecutiveMetricsResult) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntelligenceController],
      providers: [
        { provide: VacancyRiskService, useValue: mockVacancyRiskService },
        { provide: WorkforceReadinessService, useValue: mockWorkforceReadinessService },
        { provide: AttritionRiskService, useValue: mockAttritionRiskService },
        { provide: DepartmentGapService, useValue: mockDepartmentGapService },
        { provide: ExecutiveMetricsService, useValue: mockExecutiveMetricsService },
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

  // GD-M33-1 Decision 3 — department-gap endpoint
  it('department-gap: tenantId for service call comes from JWT actor.tenantId, not from query string', async () => {
    const actorTenantA: RequestUser = { ...mockActor, tenantId: 'tenant-a' };

    await controller.getDepartmentGap(actorTenantA);

    expect(mockDepartmentGapService.getByTenant).toHaveBeenCalledWith('tenant-a');
  });

  it('department-gap: two actors with different tenantIds produce separate service calls with their own tenantId', async () => {
    const actorA: RequestUser = { ...mockActor, tenantId: 'tenant-a' };
    const actorB: RequestUser = { ...mockActor, tenantId: 'tenant-b' };

    await controller.getDepartmentGap(actorA);
    await controller.getDepartmentGap(actorB);

    expect(mockDepartmentGapService.getByTenant).toHaveBeenNthCalledWith(1, 'tenant-a');
    expect(mockDepartmentGapService.getByTenant).toHaveBeenNthCalledWith(2, 'tenant-b');
  });

  // GD-M34-1 Decision 3 — executive-metrics endpoint
  it('executive-metrics: tenantId for service call comes from JWT actor.tenantId, not from query string', async () => {
    const actorTenantA: RequestUser = { ...mockActor, tenantId: 'tenant-a' };

    await controller.getExecutiveMetrics(actorTenantA);

    expect(mockExecutiveMetricsService.getByTenant).toHaveBeenCalledWith('tenant-a');
  });

  it('executive-metrics: two actors with different tenantIds produce separate service calls with their own tenantId', async () => {
    const actorA: RequestUser = { ...mockActor, tenantId: 'tenant-a' };
    const actorB: RequestUser = { ...mockActor, tenantId: 'tenant-b' };

    await controller.getExecutiveMetrics(actorA);
    await controller.getExecutiveMetrics(actorB);

    expect(mockExecutiveMetricsService.getByTenant).toHaveBeenNthCalledWith(1, 'tenant-a');
    expect(mockExecutiveMetricsService.getByTenant).toHaveBeenNthCalledWith(2, 'tenant-b');
  });
});
