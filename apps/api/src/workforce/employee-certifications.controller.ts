// Reference: spec/01_requirements.md — FR-153 Certification Expiration Tracking
// Reference: governance/GD-M14-1.md — Decisions 3–5 (namespace; endpoint; RBAC)
// Reference: directives/15_certification_management_rules.md — CRT-400 (expiration tracking)
//
// EmployeeCertificationsController is the sole HTTP transport layer for cross-employee
// employee-certification assignment queries (GD-M14-1 D3).
// Maps EmployeeCertificationService.listExpiringCertifications result → HTTP response.
//
// SEC-003 (GD-M14-1 D4):
//   tenantId is NEVER accepted from request body, query params, or route params.
//   tenantId is always derived from actor.tenantId (validated JWT via @CurrentUser()).
//
// RBAC (GD-M14-1 Decision 5):
//   GET /employee-certifications/expiring:
//     Authorized:   System Administrator, HR Director, Workforce Planner, Compliance Officer
//     Unauthorized: Recruiter, Executive User → HTTP 403 (RBAC-952)
//
// Response shape: { success: true, data: { expiringCertifications, total, page, pageSize, totalPages } }
// tenantId excluded from all responses per SEC-003.
// issueDate serialized as YYYY-MM-DD string or null (@db.Date convention).
// expirationDate serialized as YYYY-MM-DD string — always non-null (CRT-400 WHERE filter guarantee).
//
// query.withinDays / page / pageSize: DTO class defaults (30 / 1 / 20) are applied by class-transformer
// at binding time. The ?? fallbacks below satisfy TypeScript's optional-property type widening only —
// they do not fire at runtime when the DTO default is in effect.

import {
  Controller,
  Get,
  InternalServerErrorException,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import { RequireRoles } from '../identity/decorators/require-roles.decorator';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { RequestUser } from '../identity/jwt.strategy';
import { EmployeeCertificationService, ExpiringCertificationRecord } from './employee-certification.service';
import { ListExpiringCertificationsQueryDto } from './dto/list-expiring-certifications-query.dto';

@ApiTags('workforce')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class EmployeeCertificationsController {
  constructor(
    private readonly employeeCertificationService: EmployeeCertificationService,
  ) {}

  // --------------------------------------------------------------------------
  // GET /api/v1/employee-certifications/expiring
  // --------------------------------------------------------------------------

  @Get('employee-certifications/expiring')
  @RequireRoles('System Administrator', 'HR Director', 'Workforce Planner', 'Compliance Officer')
  @ApiOperation({
    summary:
      'List ACTIVE certifications expiring within the caller-supplied window across all employees ' +
      '(FR-153; CRT-400; GD-M14-1 D4). Past-due ACTIVE certifications are included as compliance risks.',
  })
  @ApiResponse({ status: 200, description: 'Paginated expiring certification list' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — Recruiter and Executive User forbidden (GD-M14-1 D5; RBAC-952)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async listExpiringCertifications(
    @Query() query: ListExpiringCertificationsQueryDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.employeeCertificationService.listExpiringCertifications(
      actor.tenantId,
      query.withinDays ?? 30,
      query.page       ?? 1,
      query.pageSize   ?? 20,
    );

    switch (result.outcome) {
      case 'SUCCESS': {
        const totalPages = Math.ceil(result.total / result.pageSize);
        return {
          success: true,
          data: {
            expiringCertifications: result.items.map(toExpiringCertificationShape),
            total:      result.total,
            page:       result.page,
            pageSize:   result.pageSize,
            totalPages,
          },
        };
      }

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'an unexpected error occurred' },
        });
    }
  }
}

// ---------------------------------------------------------------------------
// toExpiringCertificationShape — maps ExpiringCertificationRecord → HTTP response shape.
// tenantId excluded per SEC-003. employeeId included — cross-employee list; callers
// need it to navigate to the employee resource.
// issueDate / expirationDate: @db.Date objects serialized as YYYY-MM-DD strings.
//   .toISOString().substring(0, 10) is timezone-safe for date-only fields (GD-M13-2 D16 convention).
// expirationDate is always non-null (WHERE filter guarantee, CRT-400) — no optional chain.
// ---------------------------------------------------------------------------
function toExpiringCertificationShape(record: ExpiringCertificationRecord): object {
  return {
    employeeId:        record.employeeId,
    employeeNumber:    record.employeeNumber,
    firstName:         record.firstName,
    lastName:          record.lastName,
    certificationId:   record.certificationId,
    certificationName: record.certificationName,
    issuer:            record.issuer,
    status:            record.status,
    issueDate:         record.issueDate?.toISOString().substring(0, 10) ?? null,
    expirationDate:    record.expirationDate.toISOString().substring(0, 10),
  };
}
