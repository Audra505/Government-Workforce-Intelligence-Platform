// Reference: spec/01_requirements.md — FR-114, FR-151 Certifications Management
// Reference: directives/15_certification_management_rules.md — CRT-100 through CRT-103
//
// CertificationController is the sole HTTP transport layer for the certifications catalog domain.
// Maps CertificationService discriminated-union result types → HTTP status codes + response envelopes.
//
// SEC-003 (GD-M13-1 Decision 3, CRT-002):
//   tenantId is NEVER accepted from request body, query params, or route params.
//   tenantId is always derived from actor.tenantId (validated JWT via @CurrentUser()).
//
// RBAC (GD-M13-2 Decision 12, CRT-100):
//   POST  /certifications     — System Administrator, HR Director
//   PATCH /certifications/:id — System Administrator, HR Director
//   GET   /certifications     — SA, HR Director, Workforce Planner, Compliance Officer
//   GET   /certifications/:id — SA, HR Director, Workforce Planner, Compliance Officer
//   Recruiter and Executive User: HTTP 403 on all certification catalog endpoints.
//
// @RequireRoles() at method level (not class level) — read and write role sets differ.
//
// Response shape: { success: true, data: ... } or { success: false, error: { code, message } }.
// tenantId excluded from all responses per SEC-003.
// Dates serialized as ISO 8601 strings.

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  ConflictException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import { RequireRoles } from '../identity/decorators/require-roles.decorator';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { RequestUser } from '../identity/jwt.strategy';
import { CertificationService, CertificationRecord } from './certification.service';
import { CreateCertificationDto } from './dto/create-certification.dto';
import { UpdateCertificationDto } from './dto/update-certification.dto';
import { ListCertificationsQueryDto } from './dto/list-certifications-query.dto';

// ---------------------------------------------------------------------------
// toCertificationShape — maps CertificationRecord (service layer) to HTTP response shape.
// tenantId excluded per SEC-003 — clients must not derive tenantId from responses.
// Dates serialized to ISO 8601 strings.
// ---------------------------------------------------------------------------
function toCertificationShape(cert: CertificationRecord): object {
  return {
    id:                 cert.id,
    name:               cert.name,
    issuer:             cert.issuer,
    expirationRequired: cert.expirationRequired,
    createdAt:          cert.createdAt.toISOString(),
    updatedAt:          cert.updatedAt.toISOString(),
  };
}

@ApiTags('workforce')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class CertificationController {
  constructor(private readonly certificationService: CertificationService) {}

  // --------------------------------------------------------------------------
  // POST /api/v1/certifications
  // --------------------------------------------------------------------------

  @Post('certifications')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles('System Administrator', 'HR Director')
  @ApiOperation({ summary: 'Create a new certification in the tenant catalog (CRT-100, GD-M13-2 Decision 5)' })
  @ApiResponse({ status: 201, description: 'Certification created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — Recruiter and Executive User forbidden (GD-M13-2 Decision 12)' })
  @ApiResponse({ status: 409, description: 'Certification name already exists in this tenant (CRT-003, GD-M13-2 Decision 9)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async createCertification(
    @Body() dto: CreateCertificationDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.certificationService.createCertification(
      {
        name: dto.name,
        expirationRequired: dto.expirationRequired,
        issuer: dto.issuer,
      },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toCertificationShape(result.certification) };

      case 'CERTIFICATION_NAME_CONFLICT':
        throw new ConflictException({
          success: false,
          error: {
            code: 'CERTIFICATION_NAME_CONFLICT',
            message: 'certification name already exists in this tenant',
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'an unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/certifications
  // --------------------------------------------------------------------------

  @Get('certifications')
  @RequireRoles('System Administrator', 'HR Director', 'Workforce Planner', 'Compliance Officer')
  @ApiOperation({ summary: 'List all certifications in the tenant catalog (CRT-100, GD-M13-2 Decision 2)' })
  @ApiResponse({ status: 200, description: 'Paginated certification list' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async listCertifications(
    @Query() query: ListCertificationsQueryDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.certificationService.listCertifications(actor.tenantId, {
      page: query.page,
      pageSize: query.pageSize,
    });

    switch (result.outcome) {
      case 'SUCCESS': {
        const totalPages = Math.ceil(result.total / result.pageSize);
        return {
          success: true,
          data: {
            certifications: result.certifications.map(toCertificationShape),
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
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

  // --------------------------------------------------------------------------
  // GET /api/v1/certifications/:id
  // --------------------------------------------------------------------------

  @Get('certifications/:id')
  @RequireRoles('System Administrator', 'HR Director', 'Workforce Planner', 'Compliance Officer')
  @ApiOperation({ summary: 'Get a single certification by ID (tenant-scoped — SEC-003, CRT-002)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Certification found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Certification not found (absent, soft-deleted, or cross-tenant — SEC-003)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getCertificationById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.certificationService.getCertificationById(id, actor.tenantId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toCertificationShape(result.certification) };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'certification not found' },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'an unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // PATCH /api/v1/certifications/:id
  // --------------------------------------------------------------------------

  @Patch('certifications/:id')
  @RequireRoles('System Administrator', 'HR Director')
  @ApiOperation({ summary: 'Partially update a certification in the tenant catalog (CRT-102)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Certification updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Certification not found' })
  @ApiResponse({ status: 409, description: 'Certification name already exists in this tenant' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async updateCertification(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCertificationDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.certificationService.updateCertification(
      id,
      {
        name: dto.name,
        expirationRequired: dto.expirationRequired,
        issuer: dto.issuer,
      },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toCertificationShape(result.certification) };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'certification not found' },
        });

      case 'CERTIFICATION_NAME_CONFLICT':
        throw new ConflictException({
          success: false,
          error: {
            code: 'CERTIFICATION_NAME_CONFLICT',
            message: 'certification name already exists in this tenant',
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'an unexpected error occurred' },
        });
    }
  }
}
