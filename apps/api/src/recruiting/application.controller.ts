// Reference: spec/01_requirements.md — FR-301 through FR-306 Application Management
// Reference: spec/06_api_contracts.md — Application API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: governance/GD-M17-1.md — Decisions 10, 12, 13, 14, 15, 16
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (tenant isolation)
// Reference: governance/GD-PRE-PHASE3-003.md — RBAC authority
//
// ApplicationController is the sole HTTP transport layer for the application management domain.
// It maps ApplicationService result types → HTTP status codes + response envelopes.
// tenantId is never accepted from the request — always derived from the validated JWT (SEC-003).
//
// Authorization (GD-PRE-PHASE3-003; GD-M17-1 D13):
//   POST  /applications                 — System Administrator, HR Director, Recruiter
//   GET   /applications                 — System Administrator, HR Director, Recruiter, Compliance Officer
//   GET   /applications/:id             — System Administrator, HR Director, Recruiter, Compliance Officer
//   PUT   /applications/:id             — System Administrator, HR Director, Recruiter
//   POST  /applications/:id/advance     — System Administrator, HR Director, Recruiter
//   POST  /applications/:id/reject      — System Administrator, HR Director, Recruiter
//   POST  /applications/:id/withdraw    — System Administrator, HR Director, Recruiter
//
// Compliance Officer: read-only (list + detail only).
// Hiring Manager: denied for all M17 application endpoints (scoped model deferred — GD-M17-1 D13).
// Workforce Planner, Executive User: denied all M17 application endpoints.
// No PATCH, hire, offer, interview, or resume endpoints in M17.

import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UnprocessableEntityException,
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
import { ApplicationService, ApplicationRecord } from './application.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';
import { AdvanceApplicationDto } from './dto/advance-application.dto';
import { ListApplicationsQueryDto } from './dto/list-applications-query.dto';

@ApiTags('recruiting')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ApplicationController {
  constructor(private readonly applicationService: ApplicationService) {}

  // --------------------------------------------------------------------------
  // POST /api/v1/applications
  // --------------------------------------------------------------------------

  @Post('applications')
  @HttpCode(201)
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter')
  @ApiOperation({ summary: 'Submit a new application for a candidate to a vacancy (GD-M17-1 D6)' })
  @ApiResponse({ status: 201, description: 'Application created — status = APPLIED' })
  @ApiResponse({ status: 400, description: 'Validation error — missing or invalid fields' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — Compliance Officer, Hiring Manager, Workforce Planner, Executive User forbidden' })
  @ApiResponse({ status: 404, description: 'Candidate or vacancy not found in this tenant' })
  @ApiResponse({ status: 409, description: 'Active application already exists for this candidate+vacancy pair (GD-M17-1 D7)' })
  @ApiResponse({ status: 422, description: 'Candidate is archived, or vacancy is not in OPEN/IN_RECRUITMENT status (GD-M17-1 D6)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async createApplication(
    @Body() dto: CreateApplicationDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.applicationService.createApplication(
      {
        candidateId:  dto.candidateId,
        vacancyId:    dto.vacancyId,
        notes:        dto.notes,
        currentStage: dto.currentStage,
      },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toApplicationShape(result.application) };

      case 'CANDIDATE_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'CANDIDATE_NOT_FOUND', message: 'candidate not found' },
        });

      case 'CANDIDATE_ARCHIVED':
        throw new UnprocessableEntityException({
          success: false,
          error: { code: 'CANDIDATE_ARCHIVED', message: 'candidate is archived and cannot apply to new vacancies' },
        });

      case 'VACANCY_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'VACANCY_NOT_FOUND', message: 'vacancy not found' },
        });

      case 'VACANCY_NOT_OPEN':
        throw new UnprocessableEntityException({
          success: false,
          error: { code: 'VACANCY_NOT_OPEN', message: 'vacancy is not open for applications' },
        });

      case 'APPLICATION_ALREADY_EXISTS':
        throw new ConflictException({
          success: false,
          error: {
            code: 'APPLICATION_ALREADY_EXISTS',
            message: 'an active application already exists for this candidate and vacancy (GD-M17-1 D7)',
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/applications
  // --------------------------------------------------------------------------

  @Get('applications')
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter', 'Compliance Officer')
  @ApiOperation({ summary: 'List applications within the authenticated tenant (GD-M17-1 D13) — paginated with optional filters' })
  @ApiResponse({ status: 200, description: 'Paginated application list' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — Hiring Manager, Workforce Planner, Executive User forbidden' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async listApplications(
    @Query() query: ListApplicationsQueryDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.applicationService.listApplications(
      {
        page:        query.page,
        pageSize:    query.pageSize,
        status:      query.status,
        candidateId: query.candidateId,
        vacancyId:   query.vacancyId,
      },
      actor.tenantId,
    );

    switch (result.outcome) {
      case 'SUCCESS': {
        const totalPages = Math.ceil(result.total / result.pageSize);
        return {
          success: true,
          data: {
            applications: result.applications.map(toApplicationShape),
            total:        result.total,
            page:         result.page,
            pageSize:     result.pageSize,
            totalPages,
          },
        };
      }

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/applications/:id
  // --------------------------------------------------------------------------

  @Get('applications/:id')
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter', 'Compliance Officer')
  @ApiOperation({ summary: 'Get an application by ID — cross-tenant and deleted applications return 404 (SEC-003)' })
  @ApiParam({ name: 'id', description: 'Application UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Application found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Application not found — absent, deleted, and cross-tenant return identical response (SEC-003)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getApplicationById(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.applicationService.getApplicationById(id, actor.tenantId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toApplicationShape(result.application) };

      case 'APPLICATION_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'APPLICATION_NOT_FOUND', message: 'application not found' },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // PUT /api/v1/applications/:id
  // --------------------------------------------------------------------------

  @Put('applications/:id')
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter')
  @ApiOperation({ summary: 'Update application notes and currentStage — status not updatable here; use advance/reject/withdraw endpoints (GD-M17-1 D15)' })
  @ApiParam({ name: 'id', description: 'Application UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Application updated' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid fields' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — Compliance Officer, Hiring Manager, Workforce Planner, Executive User forbidden' })
  @ApiResponse({ status: 404, description: 'Application not found' })
  @ApiResponse({ status: 422, description: 'Application is in a terminal state (REJECTED or WITHDRAWN) — no further updates permitted (GD-M17-1 D10)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async updateApplication(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateApplicationDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.applicationService.updateApplication(
      id,
      {
        notes:        dto.notes,
        currentStage: dto.currentStage,
      },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toApplicationShape(result.application) };

      case 'APPLICATION_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'APPLICATION_NOT_FOUND', message: 'application not found' },
        });

      case 'APPLICATION_IN_TERMINAL_STATE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'APPLICATION_IN_TERMINAL_STATE',
            message: 'application is in a terminal state and cannot be modified (GD-M17-1 D10)',
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/applications/:id/advance
  // --------------------------------------------------------------------------

  @Post('applications/:id/advance')
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter')
  @ApiOperation({ summary: 'Advance application to the next status stage (GD-M17-1 D10 Option B — explicit targetStatus required)' })
  @ApiParam({ name: 'id', description: 'Application UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Application advanced to targetStatus' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid or disallowed targetStatus' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Application not found' })
  @ApiResponse({ status: 422, description: 'Terminal state, awaiting hire (M19), or invalid transition' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async advanceApplication(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AdvanceApplicationDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.applicationService.advanceApplication(
      id,
      { targetStatus: dto.targetStatus },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toApplicationShape(result.application) };

      case 'APPLICATION_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'APPLICATION_NOT_FOUND', message: 'application not found' },
        });

      case 'APPLICATION_IN_TERMINAL_STATE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'APPLICATION_IN_TERMINAL_STATE',
            message: 'application is in a terminal state and cannot be advanced (GD-M17-1 D10)',
          },
        });

      case 'APPLICATION_AWAITING_HIRE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'APPLICATION_AWAITING_HIRE',
            message: 'application is at OFFER stage — hire is managed in M19; no advance target beyond OFFER in M17 (GD-M17-1 D10)',
          },
        });

      case 'INVALID_APPLICATION_TRANSITION':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'INVALID_APPLICATION_TRANSITION',
            message: 'targetStatus is not the next sequential stage for this application (GD-M17-1 D10)',
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/applications/:id/reject
  // --------------------------------------------------------------------------

  @Post('applications/:id/reject')
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter')
  @ApiOperation({ summary: 'Reject an application — sets status to REJECTED (terminal); cannot be undone (GD-M17-1 D11)' })
  @ApiParam({ name: 'id', description: 'Application UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Application rejected' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Application not found' })
  @ApiResponse({ status: 422, description: 'Application already in terminal state (GD-M17-1 D10)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async rejectApplication(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.applicationService.rejectApplication(id, actor.tenantId, actor.userId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toApplicationShape(result.application) };

      case 'APPLICATION_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'APPLICATION_NOT_FOUND', message: 'application not found' },
        });

      case 'APPLICATION_IN_TERMINAL_STATE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'APPLICATION_IN_TERMINAL_STATE',
            message: 'application is already in a terminal state (GD-M17-1 D10)',
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/applications/:id/withdraw
  // --------------------------------------------------------------------------

  @Post('applications/:id/withdraw')
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter')
  @ApiOperation({ summary: 'Withdraw an application — sets status to WITHDRAWN (terminal); cannot be undone (GD-M17-1 D12)' })
  @ApiParam({ name: 'id', description: 'Application UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Application withdrawn' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Application not found' })
  @ApiResponse({ status: 422, description: 'Application already in terminal state (GD-M17-1 D10)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async withdrawApplication(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.applicationService.withdrawApplication(id, actor.tenantId, actor.userId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toApplicationShape(result.application) };

      case 'APPLICATION_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'APPLICATION_NOT_FOUND', message: 'application not found' },
        });

      case 'APPLICATION_IN_TERMINAL_STATE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'APPLICATION_IN_TERMINAL_STATE',
            message: 'application is already in a terminal state (GD-M17-1 D10)',
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }
}

// ---------------------------------------------------------------------------
// toApplicationShape — maps ApplicationRecord (service layer) to HTTP response shape.
// tenantId excluded per SEC-003 — clients must not derive tenantId from responses.
// deletedAt excluded — deleted applications are invisible (NOT_FOUND); no caller sees deletedAt.
// Date objects serialized to ISO 8601 strings.
// ---------------------------------------------------------------------------
function toApplicationShape(record: ApplicationRecord): object {
  return {
    id:           record.id,
    candidateId:  record.candidateId,
    vacancyId:    record.vacancyId,
    status:       record.status,
    submittedAt:  record.submittedAt.toISOString(),
    currentStage: record.currentStage,
    notes:        record.notes,
    createdAt:    record.createdAt.toISOString(),
    updatedAt:    record.updatedAt.toISOString(),
  };
}
