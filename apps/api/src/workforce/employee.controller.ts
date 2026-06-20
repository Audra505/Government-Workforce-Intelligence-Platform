// Reference: spec/01_requirements.md — FR-110, FR-111, FR-112 Employee Management; FR-113 Skill Assignment
// Reference: spec/06_api_contracts.md — Employee API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-001 through EMP-AUTH-005
// Reference: directives/14_skill_management_rules.md — SKL-200 through SKL-211
//
// EmployeeController is the sole HTTP transport layer for the workforce/employee domain.
// It maps EmployeeService and EmployeeSkillService result types → HTTP status codes + response envelopes.
// tenantId is never accepted from the request — always derived from the validated JWT (SEC-003/EMP-002).
//
// Authorization (directives/13_employee_management_rules.md — GD-M12-3):
//   POST  /employees                 — System Administrator, HR Director                                     (EMP-AUTH-001)
//   GET   /employees                 — SA, HR Director, Workforce Planner, Hiring Manager, Compliance Officer (EMP-AUTH-002)
//   GET   /employees/:id             — SA, HR Director, Workforce Planner, Hiring Manager, Compliance Officer (EMP-AUTH-003)
//   PUT   /employees/:id             — System Administrator, HR Director                                     (EMP-AUTH-004)
//   POST  /employees/:id/status      — System Administrator, HR Director                                     (EMP-AUTH-005)
//   POST  /employees/:id/skills      — System Administrator, HR Director                                     (SKL-200)
//   GET   /employees/:id/skills      — SA, HR Director, Workforce Planner, Compliance Officer                (SKL-200)
//
// RBAC-952: Executive User is NOT listed in @RequireRoles for any GET endpoint.
//   Executive Users receive HTTP 403. Non-negotiable per EMP-004 and EMP-402.
// Hiring Manager: read on /employees and /employees/:id; NOT authorized for /employees/:id/skills.
// Recruiter is NOT listed on any endpoint — Recruiter access is Phase 3 Talent Acquisition domain.
//
// Route-level @RequireRoles() is used (not class-level) because read and write endpoints
// have different authorized role sets.
//
// Dynamic HTTP status (POST /employees/:id/skills — GD-M13-2 D15):
//   INSERT path (first assignment) → 201 Created
//   UPDATE path (repeat assignment) → 200 OK
//   @Res({ passthrough: true }) is used so NestJS retains normal response serialization
//   (interceptors, pipes, exception filters) while allowing res.status() to be called.
//   This is the only route in this controller that requires dynamic status.

import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
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
import { EmployeeService, EmployeeRecord } from './employee.service';
import { EmployeeSkillService, EmployeeSkillRecord } from './employee-skill.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { ChangeEmployeeStatusDto } from './dto/change-employee-status.dto';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import { AssignSkillDto } from './dto/assign-skill.dto';

@ApiTags('workforce')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class EmployeeController {
  constructor(
    private readonly employeeService: EmployeeService,
    private readonly employeeSkillService: EmployeeSkillService,
  ) {}

  // --------------------------------------------------------------------------
  // POST /api/v1/employees
  // --------------------------------------------------------------------------

  @Post('employees')
  @HttpCode(201)
  @RequireRoles('System Administrator', 'HR Director')
  @ApiOperation({ summary: 'Create a new employee record (EMP-AUTH-001) — defaults to PENDING_ONBOARDING (GD-M12-1)' })
  @ApiResponse({ status: 201, description: 'Employee created — employmentStatus = PENDING_ONBOARDING' })
  @ApiResponse({ status: 400, description: 'Validation error — missing or invalid fields' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 409, description: 'Employee number already in use within this tenant (EMP-803)' })
  @ApiResponse({ status: 422, description: 'Department does not exist in this tenant (EMP-202)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async createEmployee(
    @Body() dto: CreateEmployeeDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.employeeService.createEmployee(
      {
        employeeNumber: dto.employeeNumber,
        firstName: dto.firstName,
        lastName: dto.lastName,
        departmentId: dto.departmentId,
        email: dto.email,
        hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
      },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toEmployeeShape(result.employee) };

      case 'DEPARTMENT_NOT_FOUND':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'DEPARTMENT_NOT_FOUND',
            message: 'department does not exist in this tenant (EMP-202)',
          },
        });

      case 'EMPLOYEE_NUMBER_CONFLICT':
        throw new ConflictException({
          success: false,
          error: {
            code: 'EMPLOYEE_NUMBER_CONFLICT',
            message: 'employee number already in use within this tenant (EMP-803)',
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
  // GET /api/v1/employees
  // --------------------------------------------------------------------------

  @Get('employees')
  @RequireRoles('System Administrator', 'HR Director', 'Workforce Planner', 'Hiring Manager', 'Compliance Officer')
  @ApiOperation({ summary: 'List employees within the authenticated tenant (EMP-AUTH-002) — Executive Users forbidden (RBAC-952)' })
  @ApiResponse({ status: 200, description: 'Paginated employee list' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — Executive Users forbidden (RBAC-952)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async listEmployees(
    @Query() query: ListEmployeesQueryDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.employeeService.listEmployees(actor.tenantId, {
      employmentStatus: query.employmentStatus,
      departmentId: query.departmentId,
      page: query.page,
      pageSize: query.pageSize,
    });

    switch (result.outcome) {
      case 'SUCCESS': {
        const totalPages = Math.ceil(result.total / result.pageSize);
        return {
          success: true,
          data: {
            employees: result.employees.map(toEmployeeShape),
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
  // GET /api/v1/employees/:id
  // --------------------------------------------------------------------------

  @Get('employees/:id')
  @RequireRoles('System Administrator', 'HR Director', 'Workforce Planner', 'Hiring Manager', 'Compliance Officer')
  @ApiOperation({ summary: 'Get an employee by ID (EMP-AUTH-003) — Executive Users forbidden (RBAC-952); cross-tenant returns 404 (SEC-003)' })
  @ApiParam({ name: 'id', description: 'Employee UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Employee found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — Executive Users forbidden (RBAC-952)' })
  @ApiResponse({ status: 404, description: 'Employee not found — absent and cross-tenant return identical response (SEC-003/EMP-802)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getEmployeeById(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.employeeService.getEmployeeById(id, actor.tenantId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toEmployeeShape(result.employee) };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'employee not found' },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // PUT /api/v1/employees/:id
  // --------------------------------------------------------------------------

  @Put('employees/:id')
  @RequireRoles('System Administrator', 'HR Director')
  @ApiOperation({ summary: 'Update employee profile fields (EMP-AUTH-004) — SEPARATED employees are read-only (EMP-302); employeeNumber immutable (GD-M12-6)' })
  @ApiParam({ name: 'id', description: 'Employee UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Employee updated' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid fields' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Employee not found in this tenant' })
  @ApiResponse({ status: 422, description: 'EMPLOYEE_NUMBER_IMMUTABLE (GD-M12-6) | EMPLOYEE_IS_SEPARATED (EMP-302) | DEPARTMENT_NOT_FOUND (EMP-202)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async updateEmployee(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.employeeService.updateEmployee(
      id,
      {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        departmentId: dto.departmentId,
        hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
        employeeNumber: dto.employeeNumber,
      },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toEmployeeShape(result.employee) };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'employee not found' },
        });

      case 'EMPLOYEE_NUMBER_IMMUTABLE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'EMPLOYEE_NUMBER_IMMUTABLE',
            message: 'employeeNumber may not be changed after creation (GD-M12-6/EMP-304)',
          },
        });

      case 'EMPLOYEE_IS_SEPARATED':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'EMPLOYEE_IS_SEPARATED',
            message: 'SEPARATED employees are read-only — no updates permitted (EMP-302)',
          },
        });

      case 'DEPARTMENT_NOT_FOUND':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'DEPARTMENT_NOT_FOUND',
            message: 'department does not exist in this tenant (EMP-202)',
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
  // POST /api/v1/employees/:id/status
  // --------------------------------------------------------------------------

  @Post('employees/:id/status')
  @HttpCode(200)
  @RequireRoles('System Administrator', 'HR Director')
  @ApiOperation({ summary: 'Change employee lifecycle status (EMP-AUTH-005) — enforces GD-M12-1 transition rules (EMP-801)' })
  @ApiParam({ name: 'id', description: 'Employee UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Status changed — audit event emitted (EMP-700)' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid status value' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Employee not found in this tenant' })
  @ApiResponse({ status: 422, description: 'INVALID_TRANSITION — forbidden lifecycle transition (EMP-801); SEPARATED is terminal (GD-M12-1) | TERMINATION_BEFORE_HIRE_DATE — separation date precedes hire date (GD-M12-8/EMP-805)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async changeEmployeeStatus(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ChangeEmployeeStatusDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.employeeService.changeEmployeeStatus(
      id,
      { status: dto.status, separationReason: dto.separationReason },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'STATUS_CHANGED':
        return { success: true, data: toEmployeeShape(result.employee) };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'employee not found' },
        });

      case 'INVALID_TRANSITION':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'INVALID_TRANSITION',
            message: 'forbidden lifecycle transition — see GD-M12-1 for allowed transitions (EMP-801)',
          },
        });

      case 'TERMINATION_BEFORE_HIRE_DATE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'TERMINATION_BEFORE_HIRE_DATE',
            message: 'separation date cannot precede hire date — update or remove the hire date before separating this employee (GD-M12-8/EMP-805)',
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
  // POST /api/v1/employees/:id/skills
  // --------------------------------------------------------------------------

  @Post('employees/:id/skills')
  @RequireRoles('System Administrator', 'HR Director')
  @ApiOperation({
    summary: 'Assign or update a skill for an employee (SKL-200/SKL-203) — ' +
             'first assignment returns 201 (GD-M13-2 D15); repeat returns 200; ' +
             'SEPARATED employees blocked (EMP-302/SKL-202)',
  })
  @ApiParam({ name: 'id', description: 'Employee UUID v4', type: 'string' })
  @ApiResponse({ status: 201, description: 'Skill assigned — INSERT path (first assignment)' })
  @ApiResponse({ status: 200, description: 'Skill updated — UPDATE path (repeat assignment)' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid skillId, proficiencyLevel, or verifiedAt format' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Employee not found or cross-tenant (SEC-003)' })
  @ApiResponse({ status: 422, description: 'EMPLOYEE_SEPARATED | SKILL_NOT_FOUND | INVALID_PROFICIENCY_LEVEL' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async assignEmployeeSkill(
    @Param('id', new ParseUUIDPipe({ version: '4' })) employeeId: string,
    @Body() dto: AssignSkillDto,
    @CurrentUser() actor: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<object> {
    // SKL-211: Only SA and HR Director may set verifiedAt. Endpoint is currently restricted
    // to these roles via @RequireRoles, so this gate is always true here. Implemented
    // defensively per SKL-211 for correctness if RBAC is later extended.
    const authorizedForVerifiedAt = actor.roles.some(
      (r) => r === 'System Administrator' || r === 'HR Director',
    );
    const verifiedAt =
      dto.verifiedAt !== undefined && authorizedForVerifiedAt
        ? new Date(dto.verifiedAt)
        : undefined;

    const result = await this.employeeSkillService.assignSkill(
      {
        employeeId,
        skillId:          dto.skillId,
        proficiencyLevel: dto.proficiencyLevel,
        verifiedAt,
      },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'ASSIGNED':
        res.status(HttpStatus.CREATED);
        return { success: true, data: toSkillAssignmentShape(result.assignment) };

      case 'UPDATED':
        res.status(HttpStatus.OK);
        return { success: true, data: toSkillAssignmentShape(result.assignment) };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'employee not found' },
        });

      case 'EMPLOYEE_SEPARATED':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'EMPLOYEE_SEPARATED',
            message: 'SEPARATED employees cannot receive skill assignments (EMP-302/SKL-202)',
          },
        });

      case 'SKILL_NOT_FOUND':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'SKILL_NOT_FOUND',
            message: 'skill not found in this tenant (SKL-201)',
          },
        });

      case 'INVALID_PROFICIENCY_LEVEL':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'INVALID_PROFICIENCY_LEVEL',
            message: 'proficiencyLevel must be one of: BEGINNER, DEVELOPING, PROFICIENT, ADVANCED, EXPERT (SKL-210)',
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
  // GET /api/v1/employees/:id/skills
  // --------------------------------------------------------------------------

  @Get('employees/:id/skills')
  @RequireRoles('System Administrator', 'HR Director', 'Workforce Planner', 'Compliance Officer')
  @ApiOperation({
    summary: 'List skill assignments for an employee (SKL-200) — ' +
             'returns complete set (GD-M13-2 D14); cross-tenant returns 404 (SEC-003); ' +
             'Executive Users and Hiring Managers forbidden (RBAC-952)',
  })
  @ApiParam({ name: 'id', description: 'Employee UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Skill assignment list — complete set, no pagination' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Employee not found or cross-tenant (SEC-003)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async listEmployeeSkills(
    @Param('id', new ParseUUIDPipe({ version: '4' })) employeeId: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.employeeSkillService.listEmployeeSkills(employeeId, actor.tenantId);

    switch (result.outcome) {
      case 'SUCCESS':
        return {
          success: true,
          data: { skills: result.assignments.map(toSkillAssignmentShape) },
        };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'employee not found' },
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
// toEmployeeShape — maps EmployeeRecord (service layer) to HTTP response shape.
// tenantId excluded per SEC-003 — clients must not derive tenantId from responses.
// Date objects serialized to ISO 8601 strings. Null dates remain null.
// ---------------------------------------------------------------------------
function toEmployeeShape(record: EmployeeRecord): object {
  return {
    id:               record.id,
    departmentId:     record.departmentId,
    departmentName:   record.departmentName,
    employeeNumber:   record.employeeNumber,
    firstName:        record.firstName,
    lastName:         record.lastName,
    email:            record.email,
    employmentStatus: record.employmentStatus,
    hireDate:         record.hireDate ? record.hireDate.toISOString() : null,
    terminationDate:  record.terminationDate ? record.terminationDate.toISOString() : null,
    createdAt:        record.createdAt.toISOString(),
    updatedAt:        record.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// toSkillAssignmentShape — maps EmployeeSkillRecord → HTTP response shape.
// Field set: GD-M13-2 Decision 14.
// tenantId excluded (SEC-003). employeeId excluded (in URL). skillDescription
// excluded (prose; available via GET /api/v1/skills/:id). No timestamps (junction
// table has no timestamp columns per GD-M13-4 Decision 2).
// verifiedAt: Date | null serialized as ISO 8601 string or null.
// ---------------------------------------------------------------------------
function toSkillAssignmentShape(record: EmployeeSkillRecord): object {
  return {
    skillId:          record.skillId,
    skillName:        record.skillName,
    skillCategory:    record.skillCategory,
    proficiencyLevel: record.proficiencyLevel,
    verifiedAt:       record.verifiedAt?.toISOString() ?? null,
  };
}
