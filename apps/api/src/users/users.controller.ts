// Reference: spec/01_requirements.md — FR-001 User Registration, FR-003 Role-Based Authorization
// Reference: spec/06_api_contracts.md — POST /api/v1/users, GET /api/v1/users, GET /api/v1/users/:id
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/10_role_based_access_rules.md — role set
//
// UsersController is the sole HTTP transport layer for user management (FR-001).
// It maps UsersService result types → HTTP status codes + response envelopes.
// tenantId is never accepted from the request — always derived from the validated JWT (SEC-003).
//
// Role mapping: spec/06 uses "Administrator"; directives/10 defines "System Administrator".
// @RequireRoles uses the directive-authoritative name — no role named "Administrator" exists in the DB.
//
// All three routes require JwtAuthGuard + RolesGuard applied at the class level.
// Guard ordering is mandatory: JwtAuthGuard (→ 401) runs before RolesGuard (→ 403).
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { UsersService, UserRecord } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';

@ApiTags('users')
@Controller({ path: 'users', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('System Administrator', 'HR Director')
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new user account' })
  @ApiResponse({ status: 201, type: UserResponseDto, description: 'User created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid fields or role not found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role or forbidden role assignment' })
  @ApiResponse({ status: 409, description: 'Email already exists within this tenant' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async createUser(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.usersService.createUser(dto, actor.tenantId, actor.userId, actor.roles);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toResponseShape(result.user) };

      case 'ROLE_NOT_FOUND':
        throw new BadRequestException({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `roles not found: ${result.missingIds.join(', ')}`,
          },
        });

      case 'EMAIL_CONFLICT':
        throw new ConflictException({
          success: false,
          error: { code: 'CONFLICT', message: 'email already exists within this tenant' },
        });

      case 'FORBIDDEN_ROLE_ASSIGNMENT':
        throw new ForbiddenException({
          success: false,
          error: {
            code: 'FORBIDDEN_ROLE_ASSIGNMENT',
            message: 'HR Director may not assign System Administrator',
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  @Get()
  @ApiOperation({ summary: 'List users within the authenticated tenant' })
  @ApiResponse({ status: 200, description: 'Paginated user list' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async listUsers(
    @Query() query: ListUsersQueryDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.usersService.listUsers(actor.tenantId, query);

    switch (result.outcome) {
      case 'SUCCESS': {
        const totalPages = Math.ceil(result.total / result.pageSize);
        return {
          success: true,
          data: {
            users: result.users.map(toResponseShape),
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

  @Patch(':id')
  @ApiOperation({ summary: 'Update user fields, status, and/or role assignments' })
  @ApiParam({ name: 'id', description: 'User UUID v4', type: 'string' })
  @ApiResponse({ status: 200, type: UserResponseDto, description: 'User updated successfully' })
  @ApiResponse({ status: 400, description: 'No meaningful change, role not found, or invalid status value' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role, forbidden role assignment, or forbidden user management' })
  @ApiResponse({ status: 404, description: 'User not found in this tenant' })
  @ApiResponse({ status: 409, description: 'Email already exists within this tenant' })
  @ApiResponse({ status: 422, description: 'Last System Administrator guard or invalid status transition' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async updateUser(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.usersService.updateUser(
      id, dto, actor.tenantId, actor.userId, actor.roles,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toResponseShape(result.user) };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'user not found' },
        });

      case 'NO_MEANINGFUL_CHANGE':
        throw new BadRequestException({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'request contains no updatable fields' },
        });

      case 'EMAIL_CONFLICT':
        throw new ConflictException({
          success: false,
          error: { code: 'CONFLICT', message: 'email already exists within this tenant' },
        });

      case 'ROLE_NOT_FOUND':
        throw new BadRequestException({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `roles not found: ${result.missingIds.join(', ')}`,
          },
        });

      case 'FORBIDDEN_USER_MANAGEMENT':
        throw new ForbiddenException({
          success: false,
          error: {
            code: 'FORBIDDEN_USER_MANAGEMENT',
            message: 'HR Director may not manage System Administrator users',
          },
        });

      case 'FORBIDDEN_ROLE_ASSIGNMENT':
        throw new ForbiddenException({
          success: false,
          error: {
            code: 'FORBIDDEN_ROLE_ASSIGNMENT',
            message: 'HR Director may not assign System Administrator',
          },
        });

      case 'LAST_SYSTEM_ADMINISTRATOR':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'LAST_SYSTEM_ADMINISTRATOR',
            message: 'Cannot modify the last active System Administrator',
          },
        });

      case 'INVALID_STATUS_TRANSITION':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'INVALID_STATUS_TRANSITION',
            message: `Cannot transition user status from ${result.from} to ${result.to}`,
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by ID within the authenticated tenant' })
  @ApiParam({ name: 'id', description: 'User UUID v4', type: 'string' })
  @ApiResponse({ status: 200, type: UserResponseDto, description: 'User found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'User not found in this tenant' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getUserById(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.usersService.getUserById(id, actor.tenantId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toResponseShape(result.user) };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'user not found' },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }
}

// Maps UserRecord (service layer) to the HTTP response shape.
// Date objects are serialised to ISO 8601 strings for consistent JSON output.
function toResponseShape(user: UserRecord): object {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    status: user.status,
    roles: user.roles,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
  };
}
