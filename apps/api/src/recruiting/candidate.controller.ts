// Reference: spec/01_requirements.md — FR-300 through FR-304 Candidate Management
// Reference: spec/06_api_contracts.md — Candidate API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: governance/GD-M16-1.md — Decisions 9, 11, 13
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (tenant isolation)
// Reference: governance/GD-PRE-PHASE3-003.md — RBAC authority
//
// CandidateController is the sole HTTP transport layer for the recruiting/candidate domain.
// It maps CandidateService result types → HTTP status codes + response envelopes.
// tenantId is never accepted from the request — always derived from the validated JWT (SEC-003).
//
// Authorization (GD-PRE-PHASE3-003; GD-M16-1 D11):
//   POST  /candidates          — System Administrator, HR Director, Recruiter
//   GET   /candidates          — System Administrator, HR Director, Recruiter, Compliance Officer
//   GET   /candidates/:id      — System Administrator, HR Director, Recruiter, Compliance Officer
//   PUT   /candidates/:id      — System Administrator, HR Director, Recruiter
//   POST  /candidates/:id/archive — System Administrator, HR Director, Recruiter
//
// Hiring Manager, Workforce Planner, and Executive User have no M16 candidate access.
// Compliance Officer is read-only (list + detail only).
// Route-level @RequireRoles() is used (not class-level) because read and write endpoints
// have different authorized role sets.

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
import { CandidateService, CandidateRecord } from './candidate.service';
import { CreateCandidateDto } from './dto/create-candidate.dto';
import { UpdateCandidateDto } from './dto/update-candidate.dto';
import { ListCandidatesQueryDto } from './dto/list-candidates-query.dto';

@ApiTags('recruiting')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class CandidateController {
  constructor(private readonly candidateService: CandidateService) {}

  // --------------------------------------------------------------------------
  // POST /api/v1/candidates
  // --------------------------------------------------------------------------

  @Post('candidates')
  @HttpCode(201)
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter')
  @ApiOperation({ summary: 'Create a new candidate record (GD-M16-1 D9) — status set to ACTIVE by service (GD-PRE-PHASE3-002 D2)' })
  @ApiResponse({ status: 201, description: 'Candidate created — status = ACTIVE' })
  @ApiResponse({ status: 400, description: 'Validation error — missing or invalid fields' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — Compliance Officer, Hiring Manager, Workforce Planner, Executive User forbidden' })
  @ApiResponse({ status: 409, description: 'Email already in use within this tenant (GD-M16-1 D5)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async createCandidate(
    @Body() dto: CreateCandidateDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.candidateService.createCandidate(
      {
        firstName: dto.firstName,
        lastName:  dto.lastName,
        email:     dto.email,
        phone:     dto.phone,
        source:    dto.source,
        notes:     dto.notes,
      },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toCandidateShape(result.candidate) };

      case 'CANDIDATE_EMAIL_ALREADY_EXISTS':
        throw new ConflictException({
          success: false,
          error: {
            code: 'CANDIDATE_EMAIL_ALREADY_EXISTS',
            message: 'a candidate with this email already exists in this tenant (GD-M16-1 D5)',
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
  // GET /api/v1/candidates
  // --------------------------------------------------------------------------

  @Get('candidates')
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter', 'Compliance Officer')
  @ApiOperation({ summary: 'List candidates within the authenticated tenant (GD-M16-1 D9) — defaults to ACTIVE-only; absent status defaults in service' })
  @ApiResponse({ status: 200, description: 'Paginated candidate list' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — Hiring Manager, Workforce Planner, Executive User forbidden' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async listCandidates(
    @Query() query: ListCandidatesQueryDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.candidateService.listCandidates(
      {
        page:     query.page,
        pageSize: query.pageSize,
        status:   query.status,
      },
      actor.tenantId,
    );

    switch (result.outcome) {
      case 'SUCCESS': {
        const totalPages = Math.ceil(result.total / result.pageSize);
        return {
          success: true,
          data: {
            candidates: result.candidates.map(toCandidateShape),
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
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/candidates/:id
  // --------------------------------------------------------------------------

  @Get('candidates/:id')
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter', 'Compliance Officer')
  @ApiOperation({ summary: 'Get a candidate by ID (GD-M16-1 D9) — cross-tenant and archived candidates return 404 (SEC-003)' })
  @ApiParam({ name: 'id', description: 'Candidate UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Candidate found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Candidate not found — absent, archived, and cross-tenant return identical response (SEC-003)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getCandidateById(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.candidateService.getCandidateById(id, actor.tenantId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toCandidateShape(result.candidate) };

      case 'CANDIDATE_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'CANDIDATE_NOT_FOUND', message: 'candidate not found' },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // PUT /api/v1/candidates/:id
  // --------------------------------------------------------------------------

  @Put('candidates/:id')
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter')
  @ApiOperation({ summary: 'Update candidate profile fields (GD-M16-1 D9) — status not updatable here; use archive endpoint for ACTIVE→ARCHIVED' })
  @ApiParam({ name: 'id', description: 'Candidate UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Candidate updated' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid fields' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — Compliance Officer, Hiring Manager, Workforce Planner, Executive User forbidden' })
  @ApiResponse({ status: 404, description: 'Candidate not found in this tenant' })
  @ApiResponse({ status: 409, description: 'Email already in use within this tenant (GD-M16-1 D5)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async updateCandidate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateCandidateDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.candidateService.updateCandidate(
      id,
      {
        firstName: dto.firstName,
        lastName:  dto.lastName,
        email:     dto.email,
        phone:     dto.phone,
        source:    dto.source,
        notes:     dto.notes,
      },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toCandidateShape(result.candidate) };

      case 'CANDIDATE_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'CANDIDATE_NOT_FOUND', message: 'candidate not found' },
        });

      case 'CANDIDATE_EMAIL_ALREADY_EXISTS':
        throw new ConflictException({
          success: false,
          error: {
            code: 'CANDIDATE_EMAIL_ALREADY_EXISTS',
            message: 'a candidate with this email already exists in this tenant (GD-M16-1 D5)',
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
  // POST /api/v1/candidates/:id/archive
  // --------------------------------------------------------------------------

  @Post('candidates/:id/archive')
  @HttpCode(204)
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter')
  @ApiOperation({ summary: 'Archive a candidate (GD-M16-1 D9) — sets status=ARCHIVED and deletedAt; CANDIDATE_HAS_ACTIVE_APPLICATIONS guard is M17 stub' })
  @ApiParam({ name: 'id', description: 'Candidate UUID v4', type: 'string' })
  @ApiResponse({ status: 204, description: 'Candidate archived — no response body' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Candidate not found or already archived' })
  @ApiResponse({ status: 409, description: 'CANDIDATE_HAS_ACTIVE_APPLICATIONS — M17 stub; unreachable until applications table exists' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async archiveCandidate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<void> {
    const result = await this.candidateService.archiveCandidate(id, actor.tenantId, actor.userId);

    switch (result.outcome) {
      case 'SUCCESS':
        return;

      case 'CANDIDATE_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'CANDIDATE_NOT_FOUND', message: 'candidate not found' },
        });

      case 'CANDIDATE_HAS_ACTIVE_APPLICATIONS':
        throw new ConflictException({
          success: false,
          error: {
            code: 'CANDIDATE_HAS_ACTIVE_APPLICATIONS',
            message: 'candidate has active applications — close or withdraw all applications before archiving (M17)',
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
// toCandidateShape — maps CandidateRecord (service layer) to HTTP response shape.
// tenantId excluded per SEC-003 — clients must not derive tenantId from responses.
// deletedAt excluded — archived candidates are invisible (NOT_FOUND); no caller sees deletedAt.
// Date objects serialized to ISO 8601 strings.
// ---------------------------------------------------------------------------
function toCandidateShape(record: CandidateRecord): object {
  return {
    id:        record.id,
    firstName: record.firstName,
    lastName:  record.lastName,
    email:     record.email,
    phone:     record.phone,
    status:    record.status,
    source:    record.source,
    notes:     record.notes,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
