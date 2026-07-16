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

@ApiTags('intelligence')
@Controller({ version: '1', path: 'intelligence' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class IntelligenceController {
  constructor(
    private readonly vacancyRiskService: VacancyRiskService,
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
}
