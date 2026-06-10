// Reference: spec/01_requirements.md — FR-050 Agency Management, FR-051 Department Management
// Reference: spec/06_api_contracts.md — Organization API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/12_organization_management_rules.md — ORG-AUTH-001, ORG-AUTH-002, ORG-AUTH-003
//
// OrganizationController is the sole HTTP transport layer for the organization domain.
// It maps DepartmentService and AgencyService result types → HTTP status codes + response envelopes.
// tenantId is never accepted from the request — always derived from the validated JWT (SEC-003).
//
// Authorization summary:
//   POST  /departments      — System Administrator, HR Director                         (ORG-AUTH-001)
//   PATCH /departments/:id  — System Administrator, HR Director                         (ORG-AUTH-001)
//   GET   /departments      — System Administrator, HR Director, Workforce Planner       (ORG-AUTH-002)
//   GET   /departments/:id  — System Administrator, HR Director, Workforce Planner       (ORG-AUTH-002)
//   GET   /agencies/current — any authenticated user (no role restriction)               (ORG-AUTH-003)
//
// RolesGuard behavior: when no @RequireRoles() is applied to a handler, RolesGuard returns true
// (no-op) — all authenticated users are allowed. This is the mechanism for GET /agencies/current.
//
// Route-level @RequireRoles() is used (not class-level) because this controller serves
// three distinct role sets across its five endpoints.

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
import { DepartmentService, DepartmentRecord } from './department.service';
import { AgencyService, AgencyRecord } from './agency.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { ListDepartmentsQueryDto } from './dto/list-departments-query.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { DepartmentResponseDto } from './dto/department-response.dto';
import { AgencyResponseDto } from './dto/agency-response.dto';

@ApiTags('organization')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class OrganizationController {
  constructor(
    private readonly departmentService: DepartmentService,
    private readonly agencyService: AgencyService,
  ) {}

  // ---------------------------------------------------------------------------
  // Departments
  // ---------------------------------------------------------------------------

  @Post('departments')
  @HttpCode(201)
  @RequireRoles('System Administrator', 'HR Director')
  @ApiOperation({ summary: 'Create a new department within the authenticated tenant' })
  @ApiResponse({ status: 201, type: DepartmentResponseDto, description: 'Department created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error — missing or invalid fields' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 409, description: 'Department code already exists within this tenant' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async createDepartment(
    @Body() dto: CreateDepartmentDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.departmentService.createDepartment(
      dto,
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toDepartmentShape(result.department) };

      case 'CODE_CONFLICT':
        throw new ConflictException({
          success: false,
          error: {
            code: 'CONFLICT',
            message: 'department code already exists within this tenant',
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  @Get('departments')
  @RequireRoles('System Administrator', 'HR Director', 'Workforce Planner')
  @ApiOperation({ summary: 'List departments within the authenticated tenant' })
  @ApiResponse({ status: 200, description: 'Paginated department list' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async listDepartments(
    @Query() query: ListDepartmentsQueryDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.departmentService.listDepartments(actor.tenantId, query);

    switch (result.outcome) {
      case 'SUCCESS': {
        const totalPages = Math.ceil(result.total / result.pageSize);
        return {
          success: true,
          data: {
            departments: result.departments.map(toDepartmentShape),
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

  @Get('departments/:id')
  @RequireRoles('System Administrator', 'HR Director', 'Workforce Planner')
  @ApiOperation({ summary: 'Get a department by ID within the authenticated tenant' })
  @ApiParam({ name: 'id', description: 'Department UUID v4', type: 'string' })
  @ApiResponse({ status: 200, type: DepartmentResponseDto, description: 'Department found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Department not found in this tenant' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getDepartmentById(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.departmentService.getDepartmentById(id, actor.tenantId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toDepartmentShape(result.department) };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'department not found' },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  @Patch('departments/:id')
  @RequireRoles('System Administrator', 'HR Director')
  @ApiOperation({ summary: 'Update a department within the authenticated tenant' })
  @ApiParam({ name: 'id', description: 'Department UUID v4', type: 'string' })
  @ApiResponse({ status: 200, type: DepartmentResponseDto, description: 'Department updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid fields' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Department not found in this tenant' })
  @ApiResponse({ status: 409, description: 'Department code already exists within this tenant' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async updateDepartment(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.departmentService.updateDepartment(
      id,
      dto,
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toDepartmentShape(result.department) };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'department not found' },
        });

      case 'CODE_CONFLICT':
        throw new ConflictException({
          success: false,
          error: {
            code: 'CONFLICT',
            message: 'department code already exists within this tenant',
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // ---------------------------------------------------------------------------
  // Agency
  // ---------------------------------------------------------------------------

  @Get('agencies/current')
  // No @RequireRoles — RolesGuard returns true when no roles are defined on a handler.
  // Every authenticated user needs agency context (ORG-AUTH-003, AGY-002).
  @ApiOperation({ summary: 'Get agency data for the authenticated tenant (derived from JWT)' })
  @ApiResponse({ status: 200, type: AgencyResponseDto, description: 'Agency data for the authenticated tenant' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Agency not found (defensive — should not occur for valid tokens)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getAgency(@CurrentUser() actor: RequestUser): Promise<object> {
    const result = await this.agencyService.getAgency(actor.tenantId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toAgencyShape(result.agency) };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'agency not found' },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }
}

// Maps DepartmentRecord (service layer) to the HTTP response shape.
// Date objects are serialised to ISO 8601 strings for consistent JSON output.
function toDepartmentShape(dept: DepartmentRecord): object {
  return {
    id: dept.id,
    name: dept.name,
    code: dept.code,
    description: dept.description,
    status: dept.status,
    createdAt: dept.createdAt.toISOString(),
  };
}

// Maps AgencyRecord (service layer) to the HTTP response shape.
// id excluded per AGY-003 — internal identifiers are not exposed via the agency endpoint.
function toAgencyShape(agency: AgencyRecord): object {
  return {
    name: agency.name,
    code: agency.code,
    status: agency.status,
    createdAt: agency.createdAt.toISOString(),
  };
}
