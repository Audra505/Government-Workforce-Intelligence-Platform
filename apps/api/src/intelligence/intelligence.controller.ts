// Reference: governance/GD-M30-1.md — Decisions 3, 4, 9
// Reference: spec/01_requirements.md — FR-401, FR-900, FR-904
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
//
// RBAC (GD-M30-1 Decision 4):
//   Allowed in M30: System Administrator, HR Director, Workforce Planner
//   Forbidden in M30: Recruiter, Hiring Manager, Compliance Officer, Executive User
//
// Tenant isolation (GD-M30-1 Decision 3):
//   tenantId comes exclusively from req.user (JWT) — never from query, body, or path params.
//
// Audit (GD-M30-1 Decision 9):
//   INTELLIGENCE_VACANCY_RISK_QUERIED emitted on every successful call.
//   Audit metadata must be PII-safe: no individual riskScore values, no employee data.
//
// GET /department-gap (GD-M33-1 Decisions 3, 4, 10):
//   RBAC: System Administrator, HR Director, Workforce Planner only — Executive User,
//   Recruiter, Hiring Manager, Compliance Officer all forbidden.
//   No query parameters accepted — every department is returned in one response, never
//   a caller-selectable single-department filter (see GD-M33-1 Decision 3 rationale).
//   INTELLIGENCE_DEPARTMENT_GAP_QUERIED emitted on every successful call.
//
// GET /executive-metrics (GD-M34-1 Decisions 3, 4, 11):
//   RBAC: System Administrator, HR Director, Workforce Planner, Executive User —
//   Recruiter, Hiring Manager, Compliance Officer all forbidden.
//   No query parameters accepted, same rationale as every other Phase 4 endpoint.
//   INTELLIGENCE_EXECUTIVE_METRICS_QUERIED emitted on every successful call; audit
//   metadata is formulaVersion only (GD-M34-1 Decision 11).

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import { RequireRoles } from '../identity/decorators/require-roles.decorator';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { RequestUser } from '../identity/jwt.strategy';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import { VacancyRiskService } from './services/vacancy-risk.service';
import { VacancyRiskQueryDto } from './dto/vacancy-risk-query.dto';
import { VacancyRiskResponseDto } from './dto/vacancy-risk-response.dto';
import { WorkforceReadinessService } from './services/workforce-readiness.service';
import { WorkforceReadinessResponseDto } from './dto/workforce-readiness-response.dto';
import { AttritionRiskService } from './services/attrition-risk.service';
import { AttritionRiskResponseDto } from './dto/attrition-risk-response.dto';
import { DepartmentGapService } from './services/department-gap.service';
import { DepartmentGapResponseDto } from './dto/department-gap-response.dto';
import { ExecutiveMetricsService } from './services/executive-metrics.service';
import { ExecutiveMetricsResponseDto } from './dto/executive-metrics-response.dto';

@ApiTags('intelligence')
@Controller({ version: '1', path: 'intelligence' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class IntelligenceController {
  constructor(
    private readonly vacancyRiskService: VacancyRiskService,
    private readonly workforceReadinessService: WorkforceReadinessService,
    private readonly attritionRiskService: AttritionRiskService,
    private readonly departmentGapService: DepartmentGapService,
    private readonly executiveMetricsService: ExecutiveMetricsService,
    private readonly auditService: AuditService,
  ) {}

  // --------------------------------------------------------------------------
  // GET /api/v1/intelligence/vacancy-risk
  // --------------------------------------------------------------------------

  @Get('vacancy-risk')
  @RequireRoles('System Administrator', 'HR Director', 'Workforce Planner')
  @ApiOperation({
    summary: 'Get deterministic vacancy risk scores for this tenant (FR-401)',
    description:
      'Returns top-N open/in-recruitment vacancies ranked by deterministic-v1 risk score. ' +
      'Allowed roles: System Administrator, HR Director, Workforce Planner. ' +
      'All scores are fully deterministic and reproducible — no external AI is called.',
  })
  @ApiResponse({ status: 200, type: VacancyRiskResponseDto, description: 'Vacancy risk scores returned' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getVacancyRisk(
    @Query() query: VacancyRiskQueryDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<VacancyRiskResponseDto> {
    const scoredAt = new Date().toISOString();

    const result = await this.vacancyRiskService.score(actor.tenantId, query);

    // GD-M30-1 Decision 9: audit every intelligence query from day one (FR-904)
    // Metadata must not include individual riskScore values or PII
    await this.auditService.logEvent({
      tenantId:   actor.tenantId,
      userId:     actor.userId,
      entityType: 'intelligence',
      entityId:   undefined,
      action:     AuditEventType.INTELLIGENCE_VACANCY_RISK_QUERIED,
      result:     'SUCCESS',
      metadata: {
        formulaVersion: VacancyRiskService.FORMULA_VERSION,
        itemsReturned:  result.items.length,
        pageSize:       query.pageSize ?? 10,
        statusFilter:   query.status ?? 'ALL',
      },
    });

    return {
      success: true,
      data: {
        items:          result.items,
        total:          result.total,
        scoredAt,
        formulaVersion: VacancyRiskService.FORMULA_VERSION,
      },
    };
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/intelligence/workforce-readiness
  // --------------------------------------------------------------------------

  @Get('workforce-readiness')
  @RequireRoles('System Administrator', 'HR Director', 'Workforce Planner', 'Executive User')
  @ApiOperation({
    summary: 'Get deterministic workforce readiness score for this tenant (FR-410)',
    description:
      'Returns a single tenant-wide readiness score composed from staffing coverage, ' +
      'position capacity, vacancy pressure (reusing VacancyRiskService), and certification ' +
      'compliance. Allowed roles: System Administrator, HR Director, Workforce Planner, ' +
      'Executive User. Executive User receives the identical aggregate response — no ' +
      'individual-level data exists in this endpoint for any role. ' +
      'Fully deterministic and reproducible — no external AI is called.',
  })
  @ApiResponse({ status: 200, type: WorkforceReadinessResponseDto, description: 'Workforce readiness score returned' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getWorkforceReadiness(
    @CurrentUser() actor: RequestUser,
  ): Promise<WorkforceReadinessResponseDto> {
    const result = await this.workforceReadinessService.score(actor.tenantId);

    // GD-M31-1 Decision 9: audit every readiness query
    // Metadata must be PII-safe and aggregate-only — no individual employee/vacancy/cert data
    await this.auditService.logEvent({
      tenantId:   actor.tenantId,
      userId:     actor.userId,
      entityType: 'intelligence',
      entityId:   undefined,
      action:     AuditEventType.INTELLIGENCE_WORKFORCE_READINESS_QUERIED,
      result:     'SUCCESS',
      metadata: {
        formulaVersion: WorkforceReadinessService.FORMULA_VERSION,
        readinessLevel: result.riskLevel,
        confidence:     result.confidence,
      },
    });

    return {
      success: true,
      data: {
        readinessScore: result.riskScore,
        readinessLevel: result.riskLevel,
        confidence:     result.confidence,
        reasoning:      result.reasoning,
        factors:        result.factors,
        computedAt:     result.computedAt,
        formulaVersion: result.formulaVersion,
      },
    };
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/intelligence/attrition-risk
  // --------------------------------------------------------------------------

  @Get('attrition-risk')
  @RequireRoles('System Administrator', 'HR Director', 'Workforce Planner', 'Executive User')
  @ApiOperation({
    summary: 'Get deterministic aggregate attrition risk score for this tenant (FR-402)',
    description:
      'Returns a single tenant-wide aggregate attrition risk score composed from ' +
      'separation rate, tenure composition, and position/vacancy recurrence over a ' +
      'governed 365-day trailing window. Allowed roles: System Administrator, HR ' +
      'Director, Workforce Planner, Executive User. Executive User receives the ' +
      'identical aggregate response — this endpoint never returns individual employee ' +
      'data, rankings, lists, or identifiers, for any role. ' +
      'Fully deterministic and reproducible — no external AI is called.',
  })
  @ApiResponse({ status: 200, type: AttritionRiskResponseDto, description: 'Attrition risk score returned' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getAttritionRisk(
    @CurrentUser() actor: RequestUser,
  ): Promise<AttritionRiskResponseDto> {
    const result = await this.attritionRiskService.score(actor.tenantId);

    // GD-M32-1 Decision 9: audit every attrition risk query
    // Metadata must be PII-safe and aggregate-only — no employee IDs, names, candidate
    // data, vacancy IDs, department-level detail, individual scores, raw rows, factors,
    // or reasoning.
    await this.auditService.logEvent({
      tenantId:   actor.tenantId,
      userId:     actor.userId,
      entityType: 'intelligence',
      entityId:   undefined,
      action:     AuditEventType.INTELLIGENCE_ATTRITION_RISK_QUERIED,
      result:     'SUCCESS',
      metadata: {
        formulaVersion:     AttritionRiskService.FORMULA_VERSION,
        attritionRiskLevel: result.riskLevel,
        confidence:         result.confidence,
      },
    });

    return {
      success: true,
      data: {
        attritionScore:     result.riskScore,
        attritionRiskLevel: result.riskLevel,
        confidence:         result.confidence,
        reasoning:          result.reasoning,
        factors:            result.factors,
        computedAt:         result.computedAt,
        formulaVersion:     result.formulaVersion,
      },
    };
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/intelligence/department-gap
  // --------------------------------------------------------------------------

  @Get('department-gap')
  @RequireRoles('System Administrator', 'HR Director', 'Workforce Planner')
  @ApiOperation({
    summary: 'Get department-level workforce readiness, attrition risk, and vacancy context for this tenant (FR-411)',
    description:
      'Returns every department in the tenant with its readiness and attrition scores ' +
      '(reusing the exact GD-M31-1/GD-M32-1 formulas, re-scoped by department) plus ' +
      'vacancy context. Departments below the governed minimum headcount (GD-M33-1 ' +
      'Decision 6) are suppressed — no score, no headcount disclosed. Allowed roles: ' +
      'System Administrator, HR Director, Workforce Planner. No query parameters are ' +
      'accepted; the endpoint always returns every department in one response. ' +
      'Fully deterministic and reproducible — no external AI is called.',
  })
  @ApiResponse({ status: 200, type: DepartmentGapResponseDto, description: 'Department gap data returned' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getDepartmentGap(
    @CurrentUser() actor: RequestUser,
  ): Promise<DepartmentGapResponseDto> {
    const result = await this.departmentGapService.getByTenant(actor.tenantId);

    // GD-M33-1 Decision 10: audit every department-gap query. Metadata must be
    // PII-safe and department-detail-free — only aggregate counts, never a
    // department's name, id, score, or actual headcount.
    await this.auditService.logEvent({
      tenantId:   actor.tenantId,
      userId:     actor.userId,
      entityType: 'intelligence',
      entityId:   undefined,
      action:     AuditEventType.INTELLIGENCE_DEPARTMENT_GAP_QUERIED,
      result:     'SUCCESS',
      metadata: {
        formulaVersion:            DepartmentGapService.FORMULA_VERSION,
        departmentCount:           result.departments.length,
        suppressedDepartmentCount: result.departments.filter(d => d.suppressed).length,
      },
    });

    return {
      success: true,
      data: {
        departments:              result.departments,
        minimumHeadcountThreshold: result.minimumHeadcountThreshold,
        computedAt:                result.computedAt,
        formulaVersion:            result.formulaVersion,
      },
    };
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/intelligence/executive-metrics
  // --------------------------------------------------------------------------

  @Get('executive-metrics')
  @RequireRoles('System Administrator', 'HR Director', 'Workforce Planner', 'Executive User')
  @ApiOperation({
    summary: 'Get executive-safe aggregate workforce metrics for this tenant (FR-404)',
    description:
      'Returns four deterministic, tenant-wide aggregate metrics: Vacancy Rate %, ' +
      'Coverage Rate %, Time To Fill, and Hiring Velocity. Allowed roles: System ' +
      'Administrator, HR Director, Workforce Planner, Executive User. Every value is a ' +
      'tenant-wide aggregate ratio or count — no individual-level data exists in this ' +
      'endpoint for any role. Fully deterministic and reproducible — no external AI is ' +
      'called.',
  })
  @ApiResponse({ status: 200, type: ExecutiveMetricsResponseDto, description: 'Executive metrics returned' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getExecutiveMetrics(
    @CurrentUser() actor: RequestUser,
  ): Promise<ExecutiveMetricsResponseDto> {
    const result = await this.executiveMetricsService.getByTenant(actor.tenantId);

    // GD-M34-1 Decision 11: audit every executive-metrics query. Metadata is
    // formulaVersion only — no metric value, confidence, or count is PII-
    // adjacent, but the minimal-metadata doctrine established by every prior
    // Phase 4 endpoint is restated unchanged here.
    await this.auditService.logEvent({
      tenantId:   actor.tenantId,
      userId:     actor.userId,
      entityType: 'intelligence',
      entityId:   undefined,
      action:     AuditEventType.INTELLIGENCE_EXECUTIVE_METRICS_QUERIED,
      result:     'SUCCESS',
      metadata: {
        formulaVersion: ExecutiveMetricsService.FORMULA_VERSION,
      },
    });

    return {
      success: true,
      data: {
        vacancyRate:     result.vacancyRate,
        coverageRate:    result.coverageRate,
        timeToFill:      result.timeToFill,
        hiringVelocity:  result.hiringVelocity,
        computedAt:      result.computedAt,
        formulaVersion:  result.formulaVersion,
      },
    };
  }
}
