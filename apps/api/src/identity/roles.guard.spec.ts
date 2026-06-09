// Reference: spec/01_requirements.md — FR-003 Role-Based Authorization
// Reference: Milestone 6 Decision 3 — Option B: Role-Level Enforcement
//
// Pure unit tests — no HTTP server, no database, no JWT verification.
// Reflector and ExecutionContext are manually mocked.
// Verifies: allow/deny/pass-through/defense-in-depth behaviors of RolesGuard.canActivate().

import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';

import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from './decorators/require-roles.decorator';
import type { RequestUser } from './jwt.strategy';

// ---------------------------------------------------------------------------
// Mock factory helpers
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
    roles,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let mockReflector: { getAllAndOverride: jest.Mock };

  beforeEach(async () => {
    mockReflector = { getAllAndOverride: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('no @RequireRoles metadata (reflector returns undefined) → canActivate returns true', () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);

    const result = guard.canActivate(makeContext(makeUser([])));

    expect(result).toBe(true);
  });

  it('@RequireRoles() with empty array (reflector returns []) → canActivate returns true', () => {
    mockReflector.getAllAndOverride.mockReturnValue([]);

    const result = guard.canActivate(makeContext(makeUser([])));

    expect(result).toBe(true);
  });

  it('required role present in user.roles → returns true', () => {
    mockReflector.getAllAndOverride.mockReturnValue(['System Administrator']);

    const result = guard.canActivate(makeContext(makeUser(['System Administrator'])));

    expect(result).toBe(true);
  });

  it('required role absent from user.roles → returns false', () => {
    mockReflector.getAllAndOverride.mockReturnValue(['System Administrator']);

    const result = guard.canActivate(makeContext(makeUser(['Recruiter'])));

    expect(result).toBe(false);
  });

  it('multiple required roles — one matches → returns true (any match is sufficient)', () => {
    mockReflector.getAllAndOverride.mockReturnValue(['System Administrator', 'HR Director']);

    const result = guard.canActivate(makeContext(makeUser(['HR Director'])));

    expect(result).toBe(true);
  });

  it('multiple required roles — none match → returns false', () => {
    mockReflector.getAllAndOverride.mockReturnValue(['System Administrator', 'HR Director']);

    const result = guard.canActivate(makeContext(makeUser(['Recruiter'])));

    expect(result).toBe(false);
  });

  it('req.user is undefined (guard misconfiguration defense-in-depth) → returns false', () => {
    mockReflector.getAllAndOverride.mockReturnValue(['System Administrator']);

    const result = guard.canActivate(makeContext(undefined));

    expect(result).toBe(false);
  });

  it('reflector.getAllAndOverride called with ROLES_KEY and [handler, class] — method-level overrides class-level', () => {
    const handler = jest.fn();
    const cls = jest.fn();
    mockReflector.getAllAndOverride.mockReturnValue(['System Administrator']);

    guard.canActivate(makeContext(makeUser(['System Administrator']), handler, cls));

    expect(mockReflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [handler, cls]);
  });
});
