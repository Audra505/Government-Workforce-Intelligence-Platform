// Reference: governance/GD-M36-1.md — Decision 4 (seven roles preserved),
// Decision 5 (fixture identities preserved), Decision 11 (catalog + Appendix A),
// "existing idempotent upsert-per-role/user pattern this decision's seed
// extension must follow exactly" (References section)
//
// Idempotent Permission/RolePermission seeding, extracted into its own,
// independently unit-testable function so apps/api/prisma/seed.ts and this
// module's own spec file share one implementation — never two.
//
// Mirrors apps/api/prisma/seed.ts's existing upsert-per-item pattern exactly:
// every row is created-or-left-unchanged via its natural unique key, never via
// blind create/insert, so running this function any number of times against
// the same database produces the same final row set every time.
//
// This function performs NO destructive operation: it never deletes, never
// truncates, and never replaces an existing Role, User, or UserRole row — it
// only adds Permission and RolePermission rows.

import { CAPABILITY_ROLE_MAPPINGS, splitCapability } from './permissions.catalog';

// Minimal shape this function needs from a Prisma client — satisfied by both
// the raw PrismaClient the seed script uses and PrismaService (which extends
// PrismaClient) that the rest of the Nest application uses. Typing against
// this narrow interface (rather than importing the full generated
// PrismaClient type here) keeps this module trivially mockable in tests
// without requiring a real database connection.
export interface PermissionsSeedClient {
  permission: {
    upsert(args: {
      where: { resource_action: { resource: string; action: string } };
      update: Record<string, never>;
      create: { resource: string; action: string; description?: string };
    }): Promise<{ id: string; resource: string; action: string }>;
  };
  role: {
    findUniqueOrThrow(args: { where: { name: string } }): Promise<{ id: string; name: string }>;
  };
  rolePermission: {
    upsert(args: {
      where: { roleId_permissionId: { roleId: string; permissionId: string } };
      update: Record<string, never>;
      create: { roleId: string; permissionId: string };
    }): Promise<unknown>;
  };
}

export interface SeedPermissionsResult {
  permissionsUpserted: number;
  rolePermissionsUpserted: number;
}

/**
 * Idempotently seeds the 62 canonical Permission rows and every authorized
 * RolePermission mapping from CAPABILITY_ROLE_MAPPINGS. Safe to call any
 * number of times, including repeatedly within the same process, against the
 * same database — every operation is an upsert keyed on the schema's existing
 * unique constraints (`Permission.resource_action`, `RolePermission.
 * roleId_permissionId`), never a blind create.
 *
 * Roles are assumed already seeded (apps/api/prisma/seed.ts's existing
 * PLATFORM_ROLES loop runs first); this function looks each one up by name
 * and throws — via Prisma's own findUniqueOrThrow — if a required role is
 * missing, exactly like the existing seedDevUser()/seedFixtureUsers() pattern
 * already does for their own role lookups.
 */
export async function seedPermissionsAndRolePermissions(
  prisma: PermissionsSeedClient,
): Promise<SeedPermissionsResult> {
  let permissionsUpserted = 0;
  let rolePermissionsUpserted = 0;

  // Cache resolved Permission and Role rows within this call so a role or
  // capability referenced by multiple mapping entries (e.g. every read
  // capability's roles) is looked up / upserted only once per invocation.
  const permissionIdByCapability = new Map<string, string>();
  const roleIdByName = new Map<string, string>();

  for (const mapping of CAPABILITY_ROLE_MAPPINGS) {
    const { resource, action } = splitCapability(mapping.capability);

    let permissionId = permissionIdByCapability.get(mapping.capability);
    if (!permissionId) {
      const permission = await prisma.permission.upsert({
        where: { resource_action: { resource, action } },
        update: {},
        create: { resource, action },
      });
      permissionId = permission.id;
      permissionIdByCapability.set(mapping.capability, permissionId);
      permissionsUpserted += 1;
    }

    for (const roleName of mapping.roles) {
      let roleId = roleIdByName.get(roleName);
      if (!roleId) {
        const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
        roleId = role.id;
        roleIdByName.set(roleName, roleId);
      }

      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { roleId, permissionId },
      });
      rolePermissionsUpserted += 1;
    }
  }

  return { permissionsUpserted, rolePermissionsUpserted };
}
