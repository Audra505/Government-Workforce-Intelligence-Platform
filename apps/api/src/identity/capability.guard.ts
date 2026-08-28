// Reference: governance/GD-M36-1.md — Decision 14 (@RequireCapability and CapabilityGuard),
// Decision 7 (RolesGuard remains sole runtime authority), Decision 8 (no
// enforcement activation in M36)
//
// Structurally identical to roles.guard.ts's RolesGuard: given required
// capabilities from @RequireCapability metadata and a resolved capability set
// from PermissionsService, returns whether the required set intersects the
// resolved set. Same no-op-when-no-metadata behavior RolesGuard already has.
//
// NOT REGISTERED ON ANY CONTROLLER, GLOBAL GUARD LIST, OR APPLICATION
// BOOTSTRAP PATH IN M36. This class exists, is unit-tested in isolation, and
// is injectable — it is never added to any @UseGuards(...) list, never
// provided as an APP_GUARD, and never replaces RolesGuard anywhere.
// RolesGuard remains the sole mechanism that decides any request's real
// authorization outcome throughout M36 and after its completion.
//
// Fail-closed (GD-M36-1 Decision 14): if PermissionsService.resolve() throws,
// or returns anything that is not a usable Set, canActivate() returns false.
// This must hold even though the guard is never runtime-registered in M36 —
// its own correctness must be proven before any future milestone is trusted
// to attach it.
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { RequestUser } from './jwt.strategy';
import { CAPABILITY_KEY } from './decorators/require-capability.decorator';
import { PermissionsService } from './permissions.service';

@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredCapabilities = this.reflector.getAllAndOverride<string[]>(CAPABILITY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredCapabilities || requiredCapabilities.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = request.user;

    if (!user) {
      return false;
    }

    let resolvedCapabilities: Set<string>;
    try {
      resolvedCapabilities = await this.permissionsService.resolve(user.roles);
    } catch {
      // Fail closed: a resolver/database failure must never be treated as "allow".
      return false;
    }

    if (!resolvedCapabilities || typeof resolvedCapabilities.has !== 'function') {
      // Defensive fail-closed: an invalid resolver result is treated as a denial,
      // never as an implicit allow.
      return false;
    }

    return requiredCapabilities.some((capability) => resolvedCapabilities.has(capability));
  }
}
