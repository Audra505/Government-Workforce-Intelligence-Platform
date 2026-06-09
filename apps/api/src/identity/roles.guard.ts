// Reference: spec/01_requirements.md — FR-003 Role-Based Authorization
// Reference: Milestone 6 Decision 3 — Option B: Role-Level Enforcement
//
// Apply alongside JwtAuthGuard: @UseGuards(JwtAuthGuard, RolesGuard)
// Guard ordering is mandatory — JwtAuthGuard must run first to populate req.user.
//
// Behavior:
//   - No @RequireRoles() on route → returns true (no-op; all authenticated users allowed)
//   - User holds at least one required role → returns true (allowed)
//   - User holds none of the required roles → returns false → HTTP 403
//   - req.user absent (guard misconfiguration — JwtAuthGuard not applied first) → returns false
//
// No DB call. Role names are read from the JWT payload (RequestUser.roles),
// populated by JwtStrategy.validate(). DB-backed permission lookup deferred to Phase 2.
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { RequestUser } from './jwt.strategy';
import { ROLES_KEY } from './decorators/require-roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = request.user;

    if (!user) {
      return false;
    }

    return user.roles.some(role => requiredRoles.includes(role));
  }
}
