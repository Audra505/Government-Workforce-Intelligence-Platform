// Reference: spec/01_requirements.md — FR-100 Position Management
// Reference: spec/06_api_contracts.md — Position API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/02_position_management_rules.md — POS-AUTH-001 through POS-AUTH-005
//
// PositionController is the sole HTTP transport layer for the workforce/position domain.
// It maps PositionService result types → HTTP status codes + response envelopes.
// tenantId is never accepted from the request — always derived from the validated JWT (SEC-003).
//
// Authorization summary (directives/02_position_management_rules.md — Authorization Rules):
//   POST  /positions          — System Administrator, HR Director                         (POS-AUTH-001)
//   GET   /positions          — System Administrator, HR Director, Workforce Planner       (POS-AUTH-002)
//   GET   /positions/:id      — System Administrator, HR Director, Workforce Planner       (POS-AUTH-003)
//   PUT   /positions/:id      — System Administrator, HR Director                         (POS-AUTH-004)
//   POST  /positions/:id/close — System Administrator, HR Director                        (POS-AUTH-005)
//
// Route-level @RequireRoles() is used (not class-level) because list/read endpoints allow
// Workforce Planner access while write endpoints restrict to SA + HR Director.

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
import { PositionService, PositionRecord, PositionDetailRecord } from './position.service';
import { CreatePositionDto } from './dto/create-position.dto';
import { ListPositionsQueryDto } from './dto/list-positions-query.dto';
import { UpdatePositionDto } from './dto/update-position.dto';
import { PositionResponseDto } from './dto/position-response.dto';

@ApiTags('workforce')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class PositionController {
  constructor(private readonly positionService: PositionService) {}

  @Post('positions')
  @HttpCode(201)
  @RequireRoles('System Administrator', 'HR Director')
  @ApiOperation({ summary: 'Create a new position within the authenticated tenant' })
  @ApiResponse({ status: 201, type: PositionResponseDto, description: 'Position created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error — missing or invalid fields' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Department not found within this tenant' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async createPosition(
    @Body() dto: CreatePositionDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.positionService.createPosition(
      dto,
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toPositionShape(result.position) };

      case 'DEPARTMENT_NOT_FOUND':
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

  @Get('positions')
  @RequireRoles('System Administrator', 'HR Director', 'Workforce Planner')
  @ApiOperation({ summary: 'List positions within the authenticated tenant' })
  @ApiResponse({ status: 200, description: 'Paginated position list' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async listPositions(
    @Query() query: ListPositionsQueryDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.positionService.listPositions(actor.tenantId, query);

    switch (result.outcome) {
      case 'SUCCESS': {
        const totalPages = Math.ceil(result.total / result.pageSize);
        return {
          success: true,
          data: {
            positions: result.positions.map(toPositionShape),
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

  @Get('positions/:id')
  @RequireRoles('System Administrator', 'HR Director', 'Workforce Planner')
  @ApiOperation({ summary: 'Get a position by ID within the authenticated tenant' })
  @ApiParam({ name: 'id', description: 'Position UUID v4', type: 'string' })
  @ApiResponse({ status: 200, type: PositionResponseDto, description: 'Position found — includes occupant field (GD-M15-1 D7)' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Position not found in this tenant' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getPositionById(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.positionService.getPositionById(id, actor.tenantId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toPositionDetailShape(result.position) };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'position not found' },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  @Put('positions/:id')
  @RequireRoles('System Administrator', 'HR Director')
  @ApiOperation({ summary: 'Update a position within the authenticated tenant' })
  @ApiParam({ name: 'id', description: 'Position UUID v4', type: 'string' })
  @ApiResponse({ status: 200, type: PositionResponseDto, description: 'Position updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid fields' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Position not found in this tenant' })
  @ApiResponse({ status: 409, description: 'Position is closed and cannot be updated (POS-202)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async updatePosition(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdatePositionDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.positionService.updatePosition(
      id,
      dto,
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toPositionShape(result.position) };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'position not found' },
        });

      case 'POSITION_CLOSED':
        throw new ConflictException({
          success: false,
          error: {
            code: 'POSITION_CLOSED',
            message: 'closed positions cannot be updated — use POST /positions/:id/close to confirm closure intent',
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  @Post('positions/:id/close')
  @HttpCode(200)
  @RequireRoles('System Administrator', 'HR Director')
  @ApiOperation({ summary: 'Close a position — irreversible lifecycle transition (POS-AUTH-005)' })
  @ApiParam({ name: 'id', description: 'Position UUID v4', type: 'string' })
  @ApiResponse({ status: 200, type: PositionResponseDto, description: 'Position closed successfully' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Position not found in this tenant' })
  @ApiResponse({ status: 409, description: 'Position already closed, has non-CLOSED vacancies (POS-500), or has an active incumbent (GD-M15-1 D5)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async closePosition(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.positionService.closePosition(
      id,
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toPositionShape(result.position) };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'position not found' },
        });

      case 'ALREADY_CLOSED':
        throw new ConflictException({
          success: false,
          error: {
            code: 'ALREADY_CLOSED',
            message: 'position is already closed',
          },
        });

      case 'HAS_ACTIVE_VACANCIES':
        throw new ConflictException({
          success: false,
          error: {
            code: 'HAS_ACTIVE_VACANCIES',
            message: 'position has active or draft vacancies — close all vacancies before closing position (POS-500)',
          },
        });

      case 'HAS_ACTIVE_INCUMBENT':
        throw new ConflictException({
          success: false,
          error: {
            code: 'HAS_ACTIVE_INCUMBENT',
            message: 'position has an active incumbent — reassign or separate the employee before closing (GD-M15-1 D5; POS-500)',
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

// Maps PositionRecord (service layer) to the HTTP response shape.
// Date objects are serialised to ISO 8601 strings for consistent JSON output.
function toPositionShape(position: PositionRecord): object {
  return {
    id: position.id,
    departmentId: position.departmentId,
    title: position.title,
    classification: position.classification,
    salaryBand: position.salaryBand,
    status: position.status,
    createdAt: position.createdAt.toISOString(),
  };
}

// Maps PositionDetailRecord to HTTP response shape for GET /positions/:id only.
// Includes occupant sub-object; hireDate as YYYY-MM-DD per GD-M15-1 D7.
function toPositionDetailShape(position: PositionDetailRecord): object {
  return {
    ...toPositionShape(position),
    occupant: position.occupant
      ? {
          id: position.occupant.id,
          firstName: position.occupant.firstName,
          lastName: position.occupant.lastName,
          employeeNumber: position.occupant.employeeNumber,
          employmentStatus: position.occupant.employmentStatus,
          hireDate: position.occupant.hireDate
            ? position.occupant.hireDate.toISOString().slice(0, 10)
            : null,
        }
      : null,
  };
}
