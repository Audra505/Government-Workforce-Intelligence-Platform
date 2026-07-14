// Reference: governance/GD-M26-1.md — Decision 2 (GET /api/v1/roles)
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/10_role_based_access_rules.md — role set
//
// Returns the set of platform roles the authenticated actor may assign.
// SA receives all 7 roles; HRD receives 6 (System Administrator excluded).
// WP and all other roles receive 403 from the class-level RolesGuard.
//
// Placed in a dedicated controller registered in UsersModule (no new module)
// to expose the governance-specified path GET /api/v1/roles rather than
// GET /api/v1/users/roles that would result from adding it to UsersController.
import {
  Controller,
  Get,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import { RequireRoles } from '../identity/decorators/require-roles.decorator';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { RequestUser } from '../identity/jwt.strategy';
import { UsersService } from './users.service';

@ApiTags('roles')
@Controller({ path: 'roles', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('System Administrator', 'HR Director')
@ApiBearerAuth()
export class RolesController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List platform roles available for assignment filtered by actor authorization level' })
  @ApiResponse({ status: 200, description: 'Role list — SA: all 7 roles; HRD: 6 roles (System Administrator excluded)' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  async getRoles(@CurrentUser() actor: RequestUser): Promise<object> {
    const roles = await this.usersService.getRoles(actor.roles);
    return { success: true, data: { roles } };
  }
}
