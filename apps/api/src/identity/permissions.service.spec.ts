// Reference: governance/GD-M36-1.md — Decision 13 (PermissionsService design)
//
// Pure unit tests — no real database. PrismaService.rolePermission.findMany is
// mocked directly. Verifies: single/multiple role resolution, union and
// deduplication, unknown roles, empty roles, roles with no seeded permission
// rows, and that resolver/database failures propagate rather than being
// swallowed (required for CapabilityGuard's fail-closed behavior).

import { Test, type TestingModule } from '@nestjs/testing';

import { PermissionsService } from './permissions.service';
import { PrismaService } from '../database/prisma.service';

describe('PermissionsService', () => {
  let service: PermissionsService;
  let mockPrisma: { rolePermission: { findMany: jest.Mock } };

  beforeEach(async () => {
    mockPrisma = {
      rolePermission: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PermissionsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<PermissionsService>(PermissionsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('empty role-name array → returns empty set without querying the database', async () => {
    const result = await service.resolve([]);

    expect(result).toEqual(new Set());
    expect(mockPrisma.rolePermission.findMany).not.toHaveBeenCalled();
  });

  it('single role → returns the capabilities granted to that role', async () => {
    mockPrisma.rolePermission.findMany.mockResolvedValue([
      { permission: { resource: 'employees', action: 'read' } },
      { permission: { resource: 'employees', action: 'create' } },
    ]);

    const result = await service.resolve(['System Administrator']);

    expect(result).toEqual(new Set(['employees:read', 'employees:create']));
  });

  it('multiple roles → returns the union of capabilities across all roles', async () => {
    mockPrisma.rolePermission.findMany.mockResolvedValue([
      { permission: { resource: 'employees', action: 'read' } },
      { permission: { resource: 'candidates', action: 'create' } },
      { permission: { resource: 'offers', action: 'approve' } },
    ]);

    const result = await service.resolve(['HR Director', 'Recruiter']);

    expect(result).toEqual(new Set(['employees:read', 'candidates:create', 'offers:approve']));
    expect(mockPrisma.rolePermission.findMany).toHaveBeenCalledWith({
      where: { role: { name: { in: ['HR Director', 'Recruiter'] } } },
      select: { permission: { select: { resource: true, action: true } } },
    });
  });

  it('duplicate rows across roles collapse into a single deduplicated capability', async () => {
    // Two roles sharing a capability (e.g. both granted employees:read) must
    // still yield exactly one 'employees:read' entry in the result set.
    mockPrisma.rolePermission.findMany.mockResolvedValue([
      { permission: { resource: 'employees', action: 'read' } },
      { permission: { resource: 'employees', action: 'read' } },
    ]);

    const result = await service.resolve(['HR Director', 'Workforce Planner']);

    expect(result.size).toBe(1);
    expect(result).toEqual(new Set(['employees:read']));
  });

  it('unknown role name → contributes zero capabilities, never throws', async () => {
    // Matches RolesGuard's own .some(...) semantics: an unrecognized role name
    // simply matches no rows rather than producing an error.
    mockPrisma.rolePermission.findMany.mockResolvedValue([]);

    const result = await service.resolve(['Not A Real Role']);

    expect(result).toEqual(new Set());
  });

  it('role with no seeded RolePermission rows → returns empty set, never throws', async () => {
    mockPrisma.rolePermission.findMany.mockResolvedValue([]);

    const result = await service.resolve(['Executive User']);

    expect(result).toEqual(new Set());
  });

  it('database/query failure propagates to the caller instead of being swallowed', async () => {
    // CapabilityGuard relies on this rejection to fail closed. If this service
    // ever caught the error and returned an empty set instead, a resolver
    // outage would be indistinguishable from a legitimate "no capabilities"
    // result — silently degrading a failure into a false denial-that-looks-like-success.
    const dbError = new Error('connection lost');
    mockPrisma.rolePermission.findMany.mockRejectedValue(dbError);

    await expect(service.resolve(['System Administrator'])).rejects.toThrow('connection lost');
  });
});
