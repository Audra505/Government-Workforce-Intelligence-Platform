// Reference: governance/GD-M36-1.md — Decision 14 (@RequireCapability and CapabilityGuard),
// Decision 7 (RolesGuard remains sole runtime authority)
//
// Pure unit tests — no HTTP server, no database. Reflector and
// PermissionsService are manually mocked, mirroring roles.guard.spec.ts's
// pattern. Verifies: allow/deny/pass-through/fail-closed behaviors of
// CapabilityGuard.canActivate(). This guard is never registered on any
// controller or bootstrap path (see capability.guard.ts) — these tests prove
// its own correctness in isolation, independent of that non-registration.

import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';

import { CapabilityGuard } from './capability.guard';
import { CAPABILITY_KEY } from './decorators/require-capability.decorator';
import { PermissionsService } from './permissions.service';
import type { RequestUser } from './jwt.strategy';

// ---------------------------------------------------------------------------
// Mock factory helpers — mirrors roles.guard.spec.ts
// ---------------------------------------------------------------------------

function makeContext(
  user: RequestUser | undefined,
  handler: jest.Mock = jest.fn(),
  cls: jest.Mock = jest.fn(),
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

function makeUser(roles: string[]): RequestUser {
  return {
    userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    email: 'test@example.gov',
    firstName: '',
    lastName: '',
    roles,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CapabilityGuard', () => {
  let guard: CapabilityGuard;
  let mockReflector: { getAllAndOverride: jest.Mock };
  let mockPermissionsService: { resolve: jest.Mock };

  beforeEach(async () => {
    mockReflector = { getAllAndOverride: jest.fn() };
    mockPermissionsService = { resolve: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CapabilityGuard,
        { provide: Reflector, useValue: mockReflector },
        { provide: PermissionsService, useValue: mockPermissionsService },
      ],
    }).compile();

    guard = module.get<CapabilityGuard>(CapabilityGuard);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('no @RequireCapability metadata (reflector returns undefined) → canActivate returns true without resolving', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);

    const result = await guard.canActivate(makeContext(makeUser([])));

    expect(result).toBe(true);
    expect(mockPermissionsService.resolve).not.toHaveBeenCalled();
  });

  it('@RequireCapability() with empty array (reflector returns []) → canActivate returns true without resolving', async () => {
    mockReflector.getAllAndOverride.mockReturnValue([]);

    const result = await guard.canActivate(makeContext(makeUser([])));

    expect(result).toBe(true);
    expect(mockPermissionsService.resolve).not.toHaveBeenCalled();
  });

  it('required capability present in resolved set → returns true', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['employees:read']);
    mockPermissionsService.resolve.mockResolvedValue(new Set(['employees:read']));

    const result = await guard.canActivate(makeContext(makeUser(['System Administrator'])));

    expect(result).toBe(true);
  });

  it('required capability absent from resolved set → returns false', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['employees:create']);
    mockPermissionsService.resolve.mockResolvedValue(new Set(['employees:read']));

    const result = await guard.canActivate(makeContext(makeUser(['Recruiter'])));

    expect(result).toBe(false);
  });

  it('multiple required capabilities — one matches → returns true (any match is sufficient)', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['employees:read', 'employees:update']);
    mockPermissionsService.resolve.mockResolvedValue(new Set(['employees:update']));

    const result = await guard.canActivate(makeContext(makeUser(['HR Director'])));

    expect(result).toBe(true);
  });

  it('multiple required capabilities — none match → returns false', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['employees:read', 'employees:update']);
    mockPermissionsService.resolve.mockResolvedValue(new Set(['candidates:read']));

    const result = await guard.canActivate(makeContext(makeUser(['Recruiter'])));

    expect(result).toBe(false);
  });

  it('req.user is undefined (guard misconfiguration defense-in-depth) → returns false without resolving', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['employees:read']);

    const result = await guard.canActivate(makeContext(undefined));

    expect(result).toBe(false);
    expect(mockPermissionsService.resolve).not.toHaveBeenCalled();
  });

  it('PermissionsService.resolve() throws → fails closed, returns false', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['employees:read']);
    mockPermissionsService.resolve.mockRejectedValue(new Error('database unavailable'));

    const result = await guard.canActivate(makeContext(makeUser(['System Administrator'])));

    expect(result).toBe(false);
  });

  it('PermissionsService.resolve() returns a non-Set value → fails closed, returns false', async () => {
    // Defensive fail-closed path: an invalid resolver result must never be
    // treated as an implicit allow.
    mockReflector.getAllAndOverride.mockReturnValue(['employees:read']);
    mockPermissionsService.resolve.mockResolvedValue(['employees:read'] as unknown as Set<string>);

    const result = await guard.canActivate(makeContext(makeUser(['System Administrator'])));

    expect(result).toBe(false);
  });

  it('PermissionsService.resolve() returns null → fails closed, returns false', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['employees:read']);
    mockPermissionsService.resolve.mockResolvedValue(null as unknown as Set<string>);

    const result = await guard.canActivate(makeContext(makeUser(['System Administrator'])));

    expect(result).toBe(false);
  });

  it('reflector.getAllAndOverride called with CAPABILITY_KEY and [handler, class] — method-level overrides class-level', async () => {
    const handler = jest.fn();
    const cls = jest.fn();
    mockReflector.getAllAndOverride.mockReturnValue(['employees:read']);
    mockPermissionsService.resolve.mockResolvedValue(new Set(['employees:read']));

    await guard.canActivate(makeContext(makeUser(['System Administrator']), handler, cls));

    expect(mockReflector.getAllAndOverride).toHaveBeenCalledWith(CAPABILITY_KEY, [handler, cls]);
  });

  it("resolve() called with the actor's role list", async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['employees:read']);
    mockPermissionsService.resolve.mockResolvedValue(new Set(['employees:read']));

    await guard.canActivate(makeContext(makeUser(['System Administrator', 'HR Director'])));

    expect(mockPermissionsService.resolve).toHaveBeenCalledWith([
      'System Administrator',
      'HR Director',
    ]);
  });
});
