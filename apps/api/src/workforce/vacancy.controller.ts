// Reference: spec/01_requirements.md — FR-103 Vacancy Management
// Reference: spec/06_api_contracts.md — Vacancy API contracts + RBAC matrix (line 837)
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/03_vacancy_management_rules.md — VAC-001 through VAC-702
//
// VacancyController is the sole HTTP transport layer for the workforce/vacancy domain.
// It maps VacancyService result types → HTTP status codes + response envelopes.
// tenantId is never accepted from the request — always derived from the validated JWT (SEC-003).
//
// Authorization (RBAC governance decision approved 2026-06-17; baseline until VAC-AUTH directive added):
//   POST  /vacancies           — System Administrator, HR Director                         (write)
//   GET   /vacancies           — System Administrator, HR Director, Workforce Planner       (read)
//   GET   /vacancies/:id       — System Administrator, HR Director, Workforce Planner       (read)
//   PUT   /vacancies/:id       — System Administrator, HR Director                         (write)
//   POST  /vacancies/:id/close — System Administrator, HR Director                         (write)
//
// Hiring Manager vacancy access is Phase 3 — absent from spec/06 RBAC matrix.
// Workforce Planner has read-only access, consistent with POS-AUTH-002/003 position precedent.
//
// VAC-601: requiresReview flag present in response — no approval gate endpoint in Phase 2 scope.
// VAC-602: Cancellation restricted to authorized roles (SA + HR Director) via RBAC guard.
//
// PUT /vacancies/:id internal routing (Governance Decision 8-3):
//   dto.status === 'OPEN' → openVacancy()  [DRAFT→OPEN lifecycle transition]
//   otherwise             → updateVacancy() [field update only, status unchanged]

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
import { VacancyService, VacancyRecord } from './vacancy.service';
import { CreateVacancyDto } from './dto/create-vacancy.dto';
import { UpdateVacancyDto } from './dto/update-vacancy.dto';
import { ListVacanciesQueryDto } from './dto/list-vacancies-query.dto';
import { CloseVacancyDto } from './dto/close-vacancy.dto';
import { VacancyResponseDto } from './dto/vacancy-response.dto';

@ApiTags('workforce')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class VacancyController {
  constructor(private readonly vacancyService: VacancyService) {}

  // --------------------------------------------------------------------------
  // POST /api/v1/vacancies
  // --------------------------------------------------------------------------

  @Post('vacancies')
  @HttpCode(201)
  @RequireRoles('System Administrator', 'HR Director')
  @ApiOperation({ summary: 'Create a new vacancy for an active position (VAC-100, VAC-102)' })
  @ApiResponse({ status: 201, type: VacancyResponseDto, description: 'Vacancy created in DRAFT status' })
  @ApiResponse({ status: 400, description: 'Validation error — missing or invalid fields' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 422, description: 'Position does not exist in this tenant or is not ACTIVE (VAC-101, VAC-102)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async createVacancy(
    @Body() dto: CreateVacancyDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.vacancyService.createVacancy(
      {
        positionId: dto.positionId,
        priority: dto.priority,
        reason: dto.reason,
        expectedFillDate: new Date(dto.expectedFillDate),
      },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toVacancyShape(result.vacancy) };

      case 'POSITION_NOT_ELIGIBLE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'POSITION_NOT_ELIGIBLE',
            message: 'position does not exist in this tenant or is not in ACTIVE status',
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
  // GET /api/v1/vacancies
  // --------------------------------------------------------------------------

  @Get('vacancies')
  @RequireRoles('System Administrator', 'HR Director', 'Workforce Planner')
  @ApiOperation({ summary: 'List vacancies within the authenticated tenant' })
  @ApiResponse({ status: 200, description: 'Paginated vacancy list with aging metrics' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async listVacancies(
    @Query() query: ListVacanciesQueryDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.vacancyService.listVacancies(actor.tenantId, query);

    switch (result.outcome) {
      case 'SUCCESS': {
        const totalPages = Math.ceil(result.total / result.pageSize);
        return {
          success: true,
          data: {
            vacancies: result.vacancies.map(toVacancyShape),
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
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/vacancies/:id
  // --------------------------------------------------------------------------

  @Get('vacancies/:id')
  @RequireRoles('System Administrator', 'HR Director', 'Workforce Planner')
  @ApiOperation({ summary: 'Get a vacancy by ID within the authenticated tenant' })
  @ApiParam({ name: 'id', description: 'Vacancy UUID v4', type: 'string' })
  @ApiResponse({ status: 200, type: VacancyResponseDto, description: 'Vacancy found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Vacancy not found in this tenant' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getVacancyById(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.vacancyService.getVacancyById(id, actor.tenantId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toVacancyShape(result.vacancy) };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'vacancy not found' },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // PUT /api/v1/vacancies/:id
  // Routes to openVacancy() when dto.status === 'OPEN'; otherwise updateVacancy().
  // --------------------------------------------------------------------------

  @Put('vacancies/:id')
  @RequireRoles('System Administrator', 'HR Director')
  @ApiOperation({ summary: 'Update vacancy fields or transition DRAFT→OPEN (send status:"OPEN")' })
  @ApiParam({ name: 'id', description: 'Vacancy UUID v4', type: 'string' })
  @ApiResponse({ status: 200, type: VacancyResponseDto, description: 'Vacancy updated or transitioned to OPEN' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid fields' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Vacancy not found in this tenant' })
  @ApiResponse({ status: 409, description: 'Vacancy is closed (VAC-501) or invalid lifecycle transition' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async updateVacancy(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateVacancyDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result =
      dto.status === 'OPEN'
        ? await this.vacancyService.openVacancy(id, actor.tenantId, actor.userId)
        : await this.vacancyService.updateVacancy(
            id,
            {
              priority: dto.priority,
              reason: dto.reason,
              expectedFillDate: dto.expectedFillDate
                ? new Date(dto.expectedFillDate)
                : undefined,
            },
            actor.tenantId,
            actor.userId,
          );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toVacancyShape(result.vacancy) };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'vacancy not found' },
        });

      case 'VACANCY_CLOSED':
        throw new ConflictException({
          success: false,
          error: {
            code: 'VACANCY_CLOSED',
            message: 'closed vacancies are read-only (VAC-501)',
          },
        });

      case 'INVALID_TRANSITION':
        throw new ConflictException({
          success: false,
          error: {
            code: 'INVALID_TRANSITION',
            message: 'vacancy must be in DRAFT status to transition to OPEN',
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
  // POST /api/v1/vacancies/:id/close
  // --------------------------------------------------------------------------

  @Post('vacancies/:id/close')
  @HttpCode(200)
  @RequireRoles('System Administrator', 'HR Director')
  @ApiOperation({ summary: 'Close a vacancy as FILLED or CANCELLED (VAC-500, VAC-502)' })
  @ApiParam({ name: 'id', description: 'Vacancy UUID v4', type: 'string' })
  @ApiResponse({ status: 200, type: VacancyResponseDto, description: 'Vacancy closed — status=CLOSED, filledAt set if FILLED' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid or missing closureType' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Vacancy not found in this tenant' })
  @ApiResponse({ status: 409, description: 'Vacancy already closed or invalid source state for this closure type' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async closeVacancy(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CloseVacancyDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.vacancyService.closeVacancy(
      id,
      dto.closureType as 'FILLED' | 'CANCELLED',
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toVacancyShape(result.vacancy) };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'vacancy not found' },
        });

      case 'VACANCY_CLOSED':
        throw new ConflictException({
          success: false,
          error: {
            code: 'VACANCY_CLOSED',
            message: 'vacancy is already closed (VAC-501)',
          },
        });

      case 'INVALID_TRANSITION':
        throw new ConflictException({
          success: false,
          error: {
            code: 'INVALID_TRANSITION',
            message: 'invalid source state for this closure type — FILLED requires OPEN or IN_RECRUITMENT',
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
// toVacancyShape — maps VacancyRecord (service layer) to HTTP response shape.
// Date objects serialized to ISO 8601 strings. Null dates remain null.
// tenantId excluded per SEC-003. deletedAt excluded (soft-delete detail).
// ---------------------------------------------------------------------------
function toVacancyShape(record: VacancyRecord): object {
  return {
    id:               record.id,
    positionId:       record.positionId,
    positionTitle:    record.positionTitle,
    departmentId:     record.departmentId,
    departmentName:   record.departmentName,
    priority:         record.priority,
    reason:           record.reason,
    status:           record.status,
    expectedFillDate: record.expectedFillDate
      ? record.expectedFillDate.toISOString()
      : null,
    filledAt:         record.filledAt
      ? record.filledAt.toISOString()
      : null,
    createdAt:        record.createdAt.toISOString(),
    updatedAt:        record.updatedAt.toISOString(),
    ageInDays:        record.ageInDays,
    agingStatus:      record.agingStatus,
    requiresReview:   record.requiresReview,
  };
}
