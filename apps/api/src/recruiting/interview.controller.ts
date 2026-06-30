// Reference: spec/01_requirements.md — FR-307 through FR-314 Interview Management
// Reference: spec/06_api_contracts.md — Interview API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: governance/GD-M18-1.md — Decisions 5, 8, 13, 14, 16
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (tenant isolation)
// Reference: governance/GD-PRE-PHASE3-003.md — RBAC authority
//
// InterviewController is the sole HTTP transport layer for the interview management domain.
// It maps InterviewService result types → HTTP status codes + response envelopes.
// tenantId is never accepted from the request — always derived from the validated JWT (SEC-003).
//
// Authorization (GD-PRE-PHASE3-003; GD-M18-1 D16):
//   POST  /interviews                    — System Administrator, HR Director, Recruiter
//   GET   /interviews                    — System Administrator, HR Director, Recruiter, Compliance Officer
//   GET   /interviews/:id                — System Administrator, HR Director, Recruiter, Compliance Officer
//   PUT   /interviews/:id                — System Administrator, HR Director, Recruiter
//   POST  /interviews/:id/complete       — System Administrator, HR Director, Recruiter
//   POST  /interviews/:id/feedback       — System Administrator, HR Director, Recruiter
//   POST  /interviews/:id/cancel         — System Administrator, HR Director, Recruiter
//   POST  /interviews/:id/no-show        — System Administrator, HR Director, Recruiter
//
// Compliance Officer: read-only (list + detail only).
// Hiring Manager: denied for all M18A interview endpoints (scoped model deferred — GD-M18-1 D16).
// Workforce Planner, Executive User: denied all M18A interview endpoints.
// No PATCH, delete, offer, hire, or resume endpoints in M18A.

import {
  Body,
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
import { InterviewService, InterviewRecord } from './interview.service';
import { CreateInterviewDto } from './dto/create-interview.dto';
import { UpdateInterviewDto } from './dto/update-interview.dto';
import { InterviewFeedbackDto } from './dto/interview-feedback.dto';
import { ListInterviewsQueryDto } from './dto/list-interviews-query.dto';

@ApiTags('recruiting')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class InterviewController {
  constructor(private readonly interviewService: InterviewService) {}

  // --------------------------------------------------------------------------
  // POST /api/v1/interviews
  // --------------------------------------------------------------------------

  @Post('interviews')
  @HttpCode(201)
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter')
  @ApiOperation({ summary: 'Schedule a new interview for an application (GD-M18-1 D5)' })
  @ApiResponse({ status: 201, description: 'Interview created — status = SCHEDULED' })
  @ApiResponse({ status: 400, description: 'Validation error — missing or invalid fields' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — Compliance Officer, Hiring Manager, Workforce Planner, Executive User forbidden' })
  @ApiResponse({ status: 404, description: 'Application or interviewer not found in this tenant' })
  @ApiResponse({ status: 422, description: 'Application is in terminal state, or both interviewerName and interviewerUserId are absent (GD-M18-1 D13)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async createInterview(
    @Body() dto: CreateInterviewDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.interviewService.createInterview(
      {
        applicationId:     dto.applicationId,
        interviewType:     dto.interviewType,
        scheduledAt:       dto.scheduledAt,
        interviewerName:   dto.interviewerName,
        interviewerUserId: dto.interviewerUserId,
      },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toInterviewShape(result.interview) };

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
            message: 'application is in a terminal state — no new interviews may be scheduled (GD-M18-1 D5)',
          },
        });

      case 'INTERVIEWER_REQUIRED':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'INTERVIEWER_REQUIRED',
            message: 'at least one of interviewerName or interviewerUserId is required (GD-M18-1 D13)',
          },
        });

      case 'INTERVIEWER_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'INTERVIEWER_NOT_FOUND', message: 'interviewer not found in this tenant' },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/interviews
  // --------------------------------------------------------------------------

  @Get('interviews')
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter', 'Compliance Officer')
  @ApiOperation({ summary: 'List interviews within the authenticated tenant (GD-M18-1 D16) — paginated with optional filters' })
  @ApiResponse({ status: 200, description: 'Paginated interview list' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — Hiring Manager, Workforce Planner, Executive User forbidden' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async listInterviews(
    @Query() query: ListInterviewsQueryDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.interviewService.listInterviews(
      {
        page:          query.page,
        pageSize:      query.pageSize,
        applicationId: query.applicationId,
        status:        query.status,
        interviewType: query.interviewType,
      },
      actor.tenantId,
    );

    switch (result.outcome) {
      case 'SUCCESS': {
        const totalPages = Math.ceil(result.total / result.pageSize);
        return {
          success: true,
          data: {
            interviews: result.interviews.map(toInterviewShape),
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
  // GET /api/v1/interviews/:id
  // --------------------------------------------------------------------------

  @Get('interviews/:id')
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter', 'Compliance Officer')
  @ApiOperation({ summary: 'Get an interview by ID — cross-tenant and soft-deleted interviews return 404 (SEC-003)' })
  @ApiParam({ name: 'id', description: 'Interview UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Interview found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Interview not found — absent, deleted, and cross-tenant return identical response (SEC-003)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getInterviewById(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.interviewService.getInterviewById(id, actor.tenantId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toInterviewShape(result.interview) };

      case 'INTERVIEW_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'INTERVIEW_NOT_FOUND', message: 'interview not found' },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // PUT /api/v1/interviews/:id
  // --------------------------------------------------------------------------

  @Put('interviews/:id')
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter')
  @ApiOperation({ summary: 'Update interview scheduledAt, interviewerName, or interviewerUserId — status not updatable here; use action endpoints (GD-M18-1 D5)' })
  @ApiParam({ name: 'id', description: 'Interview UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Interview updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — Compliance Officer, Hiring Manager, Workforce Planner, Executive User forbidden' })
  @ApiResponse({ status: 404, description: 'Interview or interviewer not found' })
  @ApiResponse({ status: 422, description: 'Interview is in terminal state, or update would clear both interviewer fields (GD-M18-1 D5, D13)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async updateInterview(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateInterviewDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.interviewService.updateInterview(
      id,
      {
        scheduledAt:       dto.scheduledAt,
        interviewerName:   dto.interviewerName,
        interviewerUserId: dto.interviewerUserId,
      },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toInterviewShape(result.interview) };

      case 'INTERVIEW_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'INTERVIEW_NOT_FOUND', message: 'interview not found' },
        });

      case 'INTERVIEW_IN_TERMINAL_STATE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'INTERVIEW_IN_TERMINAL_STATE',
            message: 'interview is in a terminal state and cannot be modified (GD-M18-1 D5)',
          },
        });

      case 'INTERVIEWER_REQUIRED':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'INTERVIEWER_REQUIRED',
            message: 'at least one of interviewerName or interviewerUserId is required (GD-M18-1 D13)',
          },
        });

      case 'INTERVIEWER_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'INTERVIEWER_NOT_FOUND', message: 'interviewer not found in this tenant' },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/interviews/:id/complete
  // --------------------------------------------------------------------------

  @Post('interviews/:id/complete')
  @HttpCode(200)
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter')
  @ApiOperation({ summary: 'Mark an interview as COMPLETED — terminal state, cannot be undone (GD-M18-1 D5)' })
  @ApiParam({ name: 'id', description: 'Interview UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Interview marked as COMPLETED' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Interview not found' })
  @ApiResponse({ status: 422, description: 'Interview already in terminal state (GD-M18-1 D5)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async completeInterview(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.interviewService.completeInterview(id, actor.tenantId, actor.userId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toInterviewShape(result.interview) };

      case 'INTERVIEW_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'INTERVIEW_NOT_FOUND', message: 'interview not found' },
        });

      case 'INTERVIEW_IN_TERMINAL_STATE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'INTERVIEW_IN_TERMINAL_STATE',
            message: 'interview is already in a terminal state (GD-M18-1 D5)',
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
  // POST /api/v1/interviews/:id/feedback
  // --------------------------------------------------------------------------

  @Post('interviews/:id/feedback')
  @HttpCode(200)
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter')
  @ApiOperation({ summary: 'Record feedback for an interview — allowed on SCHEDULED or COMPLETED; blocked on CANCELLED and NO_SHOW (GD-M18-1 D5)' })
  @ApiParam({ name: 'id', description: 'Interview UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Feedback recorded' })
  @ApiResponse({ status: 400, description: 'Validation error — feedback text missing or too long' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Interview not found' })
  @ApiResponse({ status: 422, description: 'Interview is CANCELLED or NO_SHOW — feedback not permitted (GD-M18-1 D5)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async recordFeedback(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: InterviewFeedbackDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.interviewService.recordFeedback(
      id,
      { feedback: dto.feedback },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toInterviewShape(result.interview) };

      case 'INTERVIEW_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'INTERVIEW_NOT_FOUND', message: 'interview not found' },
        });

      case 'INTERVIEW_FEEDBACK_NOT_ALLOWED':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'INTERVIEW_FEEDBACK_NOT_ALLOWED',
            message: 'feedback is not permitted for CANCELLED or NO_SHOW interviews (GD-M18-1 D5)',
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
  // POST /api/v1/interviews/:id/cancel
  // --------------------------------------------------------------------------

  @Post('interviews/:id/cancel')
  @HttpCode(200)
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter')
  @ApiOperation({ summary: 'Cancel an interview — sets status to CANCELLED (terminal); cannot be undone (GD-M18-1 D5)' })
  @ApiParam({ name: 'id', description: 'Interview UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Interview cancelled' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Interview not found' })
  @ApiResponse({ status: 422, description: 'Interview already in terminal state (GD-M18-1 D5)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async cancelInterview(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.interviewService.cancelInterview(id, actor.tenantId, actor.userId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toInterviewShape(result.interview) };

      case 'INTERVIEW_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'INTERVIEW_NOT_FOUND', message: 'interview not found' },
        });

      case 'INTERVIEW_IN_TERMINAL_STATE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'INTERVIEW_IN_TERMINAL_STATE',
            message: 'interview is already in a terminal state (GD-M18-1 D5)',
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
  // POST /api/v1/interviews/:id/no-show
  // --------------------------------------------------------------------------

  @Post('interviews/:id/no-show')
  @HttpCode(200)
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter')
  @ApiOperation({ summary: 'Mark an interview as NO_SHOW — terminal state; candidate did not attend (GD-M18-1 D5)' })
  @ApiParam({ name: 'id', description: 'Interview UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Interview marked as NO_SHOW' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Interview not found' })
  @ApiResponse({ status: 422, description: 'Interview already in terminal state (GD-M18-1 D5)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async noShowInterview(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.interviewService.noShowInterview(id, actor.tenantId, actor.userId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toInterviewShape(result.interview) };

      case 'INTERVIEW_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'INTERVIEW_NOT_FOUND', message: 'interview not found' },
        });

      case 'INTERVIEW_IN_TERMINAL_STATE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'INTERVIEW_IN_TERMINAL_STATE',
            message: 'interview is already in a terminal state (GD-M18-1 D5)',
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
// toInterviewShape — maps InterviewRecord (service layer) to HTTP response shape.
// tenantId excluded per SEC-003 — clients must not derive tenantId from responses.
// deletedAt excluded — soft-deleted interviews are invisible (NOT_FOUND); no caller sees deletedAt.
// scheduledAt serialized as ISO 8601 string or null.
// Date objects (createdAt, updatedAt) serialized to ISO 8601 strings.
// ---------------------------------------------------------------------------
function toInterviewShape(record: InterviewRecord): object {
  return {
    id:                record.id,
    applicationId:     record.applicationId,
    interviewType:     record.interviewType,
    scheduledAt:       record.scheduledAt ? record.scheduledAt.toISOString() : null,
    status:            record.status,
    interviewerName:   record.interviewerName,
    interviewerUserId: record.interviewerUserId,
    feedback:          record.feedback,
    createdAt:         record.createdAt.toISOString(),
    updatedAt:         record.updatedAt.toISOString(),
  };
}
