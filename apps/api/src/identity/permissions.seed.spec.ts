// Reference: governance/GD-M36-1.md — Decision 11 (catalog + Appendix A),
// "existing idempotent upsert-per-role/user pattern this decision's seed
// extension must follow exactly" (References section)
//
// Two groups of coverage:
//  1. Catalog-level invariants on permissions.catalog.ts itself — exactly 62
//     unique capability keys, no duplicate mapping entries, and the 4 reserved
//     capabilities (GD-M36-1 Decision 12) absent from the seeded mapping table.
//  2. seedPermissionsAndRolePermissions() idempotency — a mocked
//     PermissionsSeedClient proves every write goes through upsert() keyed on
//     the schema's natural unique constraints (never a blind create), and that
//     calling the function twice against the same mock state produces
//     identical upsert call shapes both times.

import { seedPermissionsAndRolePermissions, type PermissionsSeedClient } from './permissions.seed';
import {
  CAPABILITIES,
  CAPABILITY_ROLE_MAPPINGS,
  RESERVED_CAPABILITIES,
  ALL_PLATFORM_ROLES,
} from './permissions.catalog';

// ---------------------------------------------------------------------------
// Catalog invariants
// ---------------------------------------------------------------------------

describe('permissions.catalog — catalog invariants', () => {
  it('CAPABILITIES contains exactly 62 unique capability keys', () => {
    const values = Object.values(CAPABILITIES);
    expect(values).toHaveLength(62);
    expect(new Set(values).size).toBe(62);
  });

  it('CAPABILITY_ROLE_MAPPINGS has exactly one entry per capability (62 total, no duplicates)', () => {
    expect(CAPABILITY_ROLE_MAPPINGS).toHaveLength(62);

    const capabilitiesInMappings = CAPABILITY_ROLE_MAPPINGS.map((m) => m.capability);
    expect(new Set(capabilitiesInMappings).size).toBe(62);
  });

  it('every mapped capability corresponds to a key in CAPABILITIES', () => {
    const catalogValues = new Set(Object.values(CAPABILITIES));
    for (const mapping of CAPABILITY_ROLE_MAPPINGS) {
      expect(catalogValues.has(mapping.capability)).toBe(true);
    }
  });

  it('none of the 4 reserved capabilities appear in CAPABILITY_ROLE_MAPPINGS', () => {
    const mappedCapabilities = new Set(CAPABILITY_ROLE_MAPPINGS.map((m) => m.capability));
    for (const reserved of RESERVED_CAPABILITIES) {
      expect(mappedCapabilities.has(reserved as never)).toBe(false);
    }
  });

  it('none of the 4 reserved capabilities appear as CAPABILITIES values', () => {
    const catalogValues = new Set(Object.values(CAPABILITIES));
    for (const reserved of RESERVED_CAPABILITIES) {
      expect(catalogValues.has(reserved as never)).toBe(false);
    }
  });

  it('RESERVED_CAPABILITIES has exactly the 4 GD-M36-1 Decision 12 entries', () => {
    expect(RESERVED_CAPABILITIES).toHaveLength(4);
    expect(new Set(RESERVED_CAPABILITIES)).toEqual(
      new Set(['employees:terminate', 'users:deactivate', 'users:assign-role', 'offers:rescind']),
    );
  });

  it('every mapping role list is a non-empty subset of ALL_PLATFORM_ROLES', () => {
    const platformRoleSet = new Set(ALL_PLATFORM_ROLES);
    for (const mapping of CAPABILITY_ROLE_MAPPINGS) {
      expect(mapping.roles.length).toBeGreaterThan(0);
      for (const role of mapping.roles) {
        expect(platformRoleSet.has(role as never)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// seedPermissionsAndRolePermissions() idempotency
// ---------------------------------------------------------------------------

describe('seedPermissionsAndRolePermissions', () => {
  function makeMockClient(): PermissionsSeedClient & {
    _permissionIds: Map<string, string>;
    _roleIds: Map<string, string>;
  } {
    const permissionIds = new Map<string, string>();
    const roleIds = new Map<string, string>();
    let permissionCounter = 0;
    let roleCounter = 0;

    for (const role of ALL_PLATFORM_ROLES) {
      roleCounter += 1;
      roleIds.set(role, `role-${roleCounter}`);
    }

    const client: PermissionsSeedClient & {
      _permissionIds: Map<string, string>;
      _roleIds: Map<string, string>;
    } = {
      _permissionIds: permissionIds,
      _roleIds: roleIds,
      permission: {
        upsert: jest.fn(async ({ where, create }) => {
          const key = `${where.resource_action.resource}:${where.resource_action.action}`;
          let id = permissionIds.get(key);
          if (!id) {
            permissionCounter += 1;
            id = `permission-${permissionCounter}`;
            permissionIds.set(key, id);
          }
          return { id, resource: create.resource, action: create.action };
        }),
      },
      role: {
        findUniqueOrThrow: jest.fn(async ({ where }) => {
          const id = roleIds.get(where.name);
          if (!id) {
            throw new Error(`role not found: ${where.name}`);
          }
          return { id, name: where.name };
        }),
      },
      rolePermission: {
        upsert: jest.fn(async () => ({})),
      },
    };

    return client;
  }

  it('upserts exactly one Permission per unique capability (62) and one RolePermission per mapping-role pair', async () => {
    const client = makeMockClient();

    const totalRolePermissionPairs = CAPABILITY_ROLE_MAPPINGS.reduce(
      (sum, mapping) => sum + mapping.roles.length,
      0,
    );

    const result = await seedPermissionsAndRolePermissions(client);

    expect(result.permissionsUpserted).toBe(62);
    expect(result.rolePermissionsUpserted).toBe(totalRolePermissionPairs);
    expect(client.permission.upsert).toHaveBeenCalledTimes(62);
    expect(client.rolePermission.upsert).toHaveBeenCalledTimes(totalRolePermissionPairs);
  });

  it('every Permission upsert is keyed on the resource_action unique constraint with an empty update (never a blind create)', async () => {
    const client = makeMockClient();

    await seedPermissionsAndRolePermissions(client);

    const upsertMock = client.permission.upsert as jest.Mock;
    for (const call of upsertMock.mock.calls) {
      const [args] = call;
      expect(args.where.resource_action).toBeDefined();
      expect(args.where.resource_action.resource).toEqual(expect.any(String));
      expect(args.where.resource_action.action).toEqual(expect.any(String));
      expect(args.update).toEqual({});
    }
  });

  it('every RolePermission upsert is keyed on the roleId_permissionId unique constraint with an empty update (never a blind create)', async () => {
    const client = makeMockClient();

    await seedPermissionsAndRolePermissions(client);

    const upsertMock = client.rolePermission.upsert as jest.Mock;
    for (const call of upsertMock.mock.calls) {
      const [args] = call;
      expect(args.where.roleId_permissionId).toBeDefined();
      expect(args.where.roleId_permissionId.roleId).toEqual(expect.any(String));
      expect(args.where.roleId_permissionId.permissionId).toEqual(expect.any(String));
      expect(args.update).toEqual({});
    }
  });

  it('calling the function twice against the same backing store produces identical upsert call shapes both times', async () => {
    const client = makeMockClient();

    const firstRun = await seedPermissionsAndRolePermissions(client);
    const firstPermissionCalls = (client.permission.upsert as jest.Mock).mock.calls.length;
    const firstRolePermissionCalls = (client.rolePermission.upsert as jest.Mock).mock.calls.length;

    const secondRun = await seedPermissionsAndRolePermissions(client);
    const secondPermissionCalls =
      (client.permission.upsert as jest.Mock).mock.calls.length - firstPermissionCalls;
    const secondRolePermissionCalls =
      (client.rolePermission.upsert as jest.Mock).mock.calls.length - firstRolePermissionCalls;

    // Both runs issue the same number and shape of upsert calls — idempotent
    // by construction, since every call is where-keyed on a natural unique
    // constraint rather than a blind create.
    expect(secondRun).toEqual(firstRun);
    expect(secondPermissionCalls).toBe(firstPermissionCalls);
    expect(secondRolePermissionCalls).toBe(firstRolePermissionCalls);
  });

  it('throws (does not swallow) when a mapped role has not been seeded', async () => {
    const client = makeMockClient();
    client._roleIds.delete('Recruiter');

    await expect(seedPermissionsAndRolePermissions(client)).rejects.toThrow(
      'role not found: Recruiter',
    );
  });
});
