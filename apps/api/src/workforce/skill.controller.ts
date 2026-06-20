// Reference: spec/01_requirements.md — FR-113, FR-150 Skills Management
// Reference: spec/06_api_contracts.md — supplemented by GD-M13-2
// Reference: directives/14_skill_management_rules.md — SKL-100 through SKL-103
//
// SkillController is the sole HTTP transport layer for the skills catalog domain.
// Maps SkillService discriminated-union result types → HTTP status codes + response envelopes.
//
// SEC-003 (GD-M13-1 Decision 3):
//   tenantId is NEVER accepted from request body, query params, or route params.
//   tenantId is always derived from actor.tenantId (validated JWT via @CurrentUser()).
//
// RBAC (GD-M13-2 Decision 12, directives/14 SKL-100):
//   POST  /skills     — System Administrator, HR Director
//   PATCH /skills/:id — System Administrator, HR Director
//   GET   /skills     — SA, HR Director, Workforce Planner, Compliance Officer
//   GET   /skills/:id — SA, HR Director, Workforce Planner, Compliance Officer
//   Recruiter and Executive User: HTTP 403 on all skills endpoints (not in any @RequireRoles list).
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
import { SkillService, SkillRecord } from './skill.service';
import { CreateSkillDto } from './dto/create-skill.dto';
import { UpdateSkillDto } from './dto/update-skill.dto';
import { ListSkillsQueryDto } from './dto/list-skills-query.dto';

// ---------------------------------------------------------------------------
// toSkillShape — maps SkillRecord (service layer) to HTTP response shape.
// tenantId excluded per SEC-003 — clients must not derive tenantId from responses.
// Dates serialized to ISO 8601 strings.
// ---------------------------------------------------------------------------
function toSkillShape(skill: SkillRecord): object {
  return {
    id:          skill.id,
    name:        skill.name,
    category:    skill.category,
    description: skill.description,
    createdAt:   skill.createdAt.toISOString(),
    updatedAt:   skill.updatedAt.toISOString(),
  };
}

@ApiTags('workforce')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SkillController {
  constructor(private readonly skillService: SkillService) {}

  // --------------------------------------------------------------------------
  // POST /api/v1/skills
  // --------------------------------------------------------------------------

  @Post('skills')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles('System Administrator', 'HR Director')
  @ApiOperation({ summary: 'Create a new skill in the tenant catalog (SKL-100, GD-M13-2 Decision 4)' })
  @ApiResponse({ status: 201, description: 'Skill created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — Recruiter and Executive User forbidden (GD-M13-2 Decision 12)' })
  @ApiResponse({ status: 409, description: 'Skill name already exists in this tenant (SKL-003, GD-M13-2 Decision 8)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async createSkill(
    @Body() dto: CreateSkillDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.skillService.createSkill(
      {
        name: dto.name,
        category: dto.category,
        description: dto.description,
      },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toSkillShape(result.skill) };

      case 'SKILL_NAME_CONFLICT':
        throw new ConflictException({
          success: false,
          error: {
            code: 'SKILL_NAME_CONFLICT',
            message: 'skill name already exists in this tenant',
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
  // GET /api/v1/skills
  // --------------------------------------------------------------------------

  @Get('skills')
  @RequireRoles('System Administrator', 'HR Director', 'Workforce Planner', 'Compliance Officer')
  @ApiOperation({ summary: 'List all skills in the tenant catalog (SKL-100, GD-M13-2 Decision 2)' })
  @ApiResponse({ status: 200, description: 'Paginated skill list' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async listSkills(
    @Query() query: ListSkillsQueryDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.skillService.listSkills(actor.tenantId, {
      page: query.page,
      pageSize: query.pageSize,
      category: query.category,
    });

    switch (result.outcome) {
      case 'SUCCESS': {
        const totalPages = Math.ceil(result.total / result.pageSize);
        return {
          success: true,
          data: {
            skills: result.skills.map(toSkillShape),
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
  // GET /api/v1/skills/:id
  // --------------------------------------------------------------------------

  @Get('skills/:id')
  @RequireRoles('System Administrator', 'HR Director', 'Workforce Planner', 'Compliance Officer')
  @ApiOperation({ summary: 'Get a single skill by ID (tenant-scoped — SEC-003)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Skill found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Skill not found (absent, soft-deleted, or cross-tenant — SEC-003)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getSkillById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.skillService.getSkillById(id, actor.tenantId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toSkillShape(result.skill) };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'skill not found' },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'an unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // PATCH /api/v1/skills/:id
  // --------------------------------------------------------------------------

  @Patch('skills/:id')
  @RequireRoles('System Administrator', 'HR Director')
  @ApiOperation({ summary: 'Partially update a skill in the tenant catalog (SKL-102)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Skill updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Skill not found' })
  @ApiResponse({ status: 409, description: 'Skill name already exists in this tenant' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async updateSkill(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSkillDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.skillService.updateSkill(
      id,
      {
        name: dto.name,
        category: dto.category,
        description: dto.description,
      },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toSkillShape(result.skill) };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'skill not found' },
        });

      case 'SKILL_NAME_CONFLICT':
        throw new ConflictException({
          success: false,
          error: {
            code: 'SKILL_NAME_CONFLICT',
            message: 'skill name already exists in this tenant',
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
