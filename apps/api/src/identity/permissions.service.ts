// Reference: governance/GD-M36-1.md — Decision 13 (PermissionsService design)
//
// Resolves a set of role names to the union of capabilities those roles grant,
// via the seeded RolePermission table. Pure query — no caching, no JWT
// interaction, no side effects, no tenant parameter (Role/Permission/
// RolePermission are tenant-agnostic reference data, matching the existing
// role-name authorization model this service extends).
//
// NOT wired into any runtime enforcement path in M36 — see CapabilityGuard,
// which consumes this service but is never registered on any controller.
// GD-M36-1 Decision 7: RolesGuard remains the sole runtime authorization
// authority throughout and after M36.

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { joinCapability } from './permissions.catalog';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the union of every capability granted to any of the given role
   * names, via the seeded RolePermission table.
   *
   * - Unknown role names (matching no seeded Role) contribute zero
   *   capabilities and never throw — the underlying query simply matches no
   *   rows for that name, exactly as RolesGuard's own .some(...) check finds
   *   no match for a role name RolesGuard doesn't recognize.
   * - A role with zero seeded RolePermission rows (missing-permission case)
   *   contributes zero capabilities and never throws, for the same reason.
   * - An empty role-name array returns an empty set without querying the
   *   database.
   * - Database/query failures are NOT caught here — they propagate to the
   *   caller (CapabilityGuard), which fails closed on any rejection. This
   *   service must never swallow an error into a false "no capabilities"
   *   result, because that would be indistinguishable from a legitimate
   *   empty-capability outcome.
   */
  async resolve(roleNames: readonly string[]): Promise<Set<string>> {
    if (roleNames.length === 0) {
      return new Set<string>();
    }

    const rows = await this.prisma.rolePermission.findMany({
      where: { role: { name: { in: [...roleNames] } } },
      select: {
        permission: { select: { resource: true, action: true } },
      },
    });

    const capabilities = new Set<string>();
    for (const row of rows) {
      capabilities.add(joinCapability(row.permission.resource, row.permission.action));
    }

    return capabilities;
  }
}
