// Reference: spec/01_requirements.md — FR-003 Role-Based Authorization
// Reference: directives/10_role_based_access_rules.md — platform role set
//
// Apply to a route handler or controller class to declare the roles required to access it.
// RolesGuard reads this metadata at request time via ROLES_KEY.
// Must be combined with JwtAuthGuard — JwtAuthGuard populates req.user before RolesGuard runs.
//
// Usage: @RequireRoles('System Administrator', 'HR Director')
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

export const RequireRoles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
