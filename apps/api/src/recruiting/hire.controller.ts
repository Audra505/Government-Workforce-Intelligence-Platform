// Reference: governance/GD-M19-1.md — Decisions 3, 5, 6, 13, 14
// Reference: spec/01_requirements.md — FR-304 Hiring Workflow
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: governance/GD-PRE-PHASE3-003.md — Decision 3 (SA+HRD only; Recruiter denied)
//
// HireController is the sole HTTP transport layer for the M19 hire action.
// It maps HireService result types → HTTP status codes + response envelopes.
// tenantId is never accepted from the request — always derived from the validated JWT (SEC-003).
//
// Authorization (GD-PRE-PHASE3-003 D3; GD-M19-1 D3):
//   POST /applications/:id/hire — System Administrator, HR Director only
//   Recruiter, Compliance Officer, Hiring Manager, Workforce Planner, Executive User: denied
//
// No request body accepted (GD-M19-1 D6 — hire is a no-body action endpoint).
// Single endpoint only — no CRUD, no list, no batch hire (GD-M19-1 D14).

import {
  ConflictException,
  Controller,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
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
import { HireService, HireEmployeeRecord } from './hire.service';

@ApiTags('recruiting')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class HireController {
  constructor(private readonly hireService: HireService) {}

  // --------------------------------------------------------------------------
  // POST /api/v1/applications/:id/hire
  // --------------------------------------------------------------------------

  @Post('applications/:id/hire')
  @HttpCode(201)
  @RequireRoles('System Administrator', 'HR Director')
  @ApiOperation({
    summary: 'Hire a candidate — creates an employee record from an accepted-offer application (GD-M19-1 D3)',
  })
  @ApiParam({ name: 'id', description: 'Application UUID v4', type: 'string' })
  @ApiResponse({ status: 201, description: 'Hire completed — employee record created with status PENDING_ONBOARDING' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — only System Administrator and HR Director may hire' })
  @ApiResponse({ status: 404, description: 'Application, candidate, vacancy, or position not found' })
  @ApiResponse({ status: 409, description: 'APPLICATION_ALREADY_HIRED — application is already in HIRED state' })
  @ApiResponse({ status: 422, description: 'Precondition failure — application not at OFFER, no accepted offer, candidate archived, vacancy not available, or position occupied' })
  @ApiResponse({ status: 500, description: 'Internal server error or employee number generation collision' })
  async hireApplication(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.hireService.hire(id, actor.tenantId, actor.userId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toHireEmployeeShape(result.employee) };

      case 'APPLICATION_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'APPLICATION_NOT_FOUND', message: 'application not found' },
        });

      case 'APPLICATION_ALREADY_HIRED':
        throw new ConflictException({
          success: false,
          error: {
            code: 'APPLICATION_ALREADY_HIRED',
            message: 'application has already been hired (GD-M19-1 D6)',
          },
        });

      case 'APPLICATION_NOT_AT_OFFER_STATUS':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'APPLICATION_NOT_AT_OFFER_STATUS',
            message: 'application must be at OFFER status to proceed with hire',
          },
        });

      case 'ACCEPTED_OFFER_NOT_FOUND':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'ACCEPTED_OFFER_NOT_FOUND',
            message: 'no accepted offer exists for this application',
          },
        });

      case 'CANDIDATE_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'CANDIDATE_NOT_FOUND', message: 'candidate not found' },
        });

      case 'CANDIDATE_ARCHIVED':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'CANDIDATE_ARCHIVED',
            message: 'candidate is archived and cannot be hired',
          },
        });

      case 'VACANCY_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'VACANCY_NOT_FOUND', message: 'vacancy not found' },
        });

      case 'VACANCY_NOT_AVAILABLE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'VACANCY_NOT_AVAILABLE',
            message: 'vacancy is not available for hire (status is FILLED or CANCELLED)',
          },
        });

      case 'POSITION_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'POSITION_NOT_FOUND', message: 'position not found' },
        });

      case 'POSITION_NOT_AVAILABLE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'POSITION_NOT_AVAILABLE',
            message: 'position is already occupied by an active employee',
          },
        });

      case 'EMPLOYEE_NUMBER_GENERATION_FAILED':
        throw new InternalServerErrorException({
          success: false,
          error: {
            code: 'EMPLOYEE_NUMBER_GENERATION_FAILED',
            message: 'employee number generation failed due to a concurrent conflict; retry the request',
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
// toHireEmployeeShape — maps HireEmployeeRecord (service layer) to HTTP response shape.
// Mirrors toEmployeeShape() in employee.controller.ts (GD-M19-1 D13).
// tenantId excluded per SEC-003.
// deletedAt excluded — newly created employees are never soft-deleted.
// departmentName is not available from the hire transaction (no relation join);
// callers requiring departmentName should follow up with GET /api/v1/employees/:id.
// ---------------------------------------------------------------------------
function toHireEmployeeShape(record: HireEmployeeRecord): object {
  return {
    id:                   record.id,
    departmentId:         record.departmentId,
    departmentName:       null,
    positionId:           record.positionId,
    employeeNumber:       record.employeeNumber,
    firstName:            record.firstName,
    lastName:             record.lastName,
    email:                record.email,
    employmentStatus:     record.employmentStatus,
    appointmentAuthority: record.appointmentAuthority,
    hireDate:             record.hireDate ? record.hireDate.toISOString() : null,
    terminationDate:      record.terminationDate ? record.terminationDate.toISOString() : null,
    createdAt:            record.createdAt.toISOString(),
    updatedAt:            record.updatedAt.toISOString(),
  };
}
