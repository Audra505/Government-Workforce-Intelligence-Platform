// Reference: spec/07_security_architecture.md — Account Lockout (5 attempts / 15 min)
// Reference: spec/07_security_architecture.md — Tenant Isolation (SEC-003)
// Reference: PROGRESS.md — Step 2 Lockout Contract (reset on successful login only)
//
// Pure unit tests — no database connection, no real bcrypt execution.
// PrismaService is replaced with jest.fn() mocks.
// bcrypt module is fully mocked via jest.mock() — tests run in < 1ms each.
//
// jest.mock() must precede imports; Jest hoists it automatically.
/* eslint-disable */
jest.mock('bcrypt');

import * as bcrypt from 'bcrypt';
import { Test, type TestingModule } from '@nestjs/testing';

import { PrismaService } from '../database/prisma.service';
import { IdentityService, type UserWithRoles } from './identity.service';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_ID   = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ROLE_ID   = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const EMAIL     = 'test@example.gov';
const PASSWORD  = 'TestPassword1!';

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<UserWithRoles> = {}): UserWithRoles {
  const base = {
    id: USER_ID,
    tenantId: TENANT_ID,
    email: EMAIL,
    passwordHash: 'hashed-password',
    firstName: 'Test',
    lastName: 'User',
    status: 'ACTIVE',
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    userRoles: [
      {
        userId: USER_ID,
        roleId: ROLE_ID,
        role: {
          id: ROLE_ID,
          name: 'System Administrator',
          description: 'Full platform access',
          createdAt: new Date('2026-01-01'),
        },
      },
    ],
  };
  return { ...base, ...overrides } as UserWithRoles;
}

// Typed reference to the mocked bcrypt.compare
const mockedBcryptCompare = bcrypt.compare as jest.MockedFunction<typeof bcrypt.compare>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IdentityService', () => {
  let service: IdentityService;
  let mockPrisma: { user: { findMany: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    mockPrisma = {
      user: {
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<IdentityService>(IdentityService);

    // Default: compare returns false (wrong password) — individual tests override as needed
    mockedBcryptCompare.mockResolvedValue(false as never);
  });

  afterEach(() => jest.clearAllMocks());

  // --------------------------------------------------------------------------
  // Instantiation
  // --------------------------------------------------------------------------

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // EMAIL_NOT_FOUND
  // --------------------------------------------------------------------------

  it('returns EMAIL_NOT_FOUND when no user exists for the given email', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);

    const result = await service.validateCredentials(EMAIL, PASSWORD);

    expect(result.outcome).toBe('EMAIL_NOT_FOUND');
  });

  it('queries with deletedAt: null to exclude soft-deleted users', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);

    await service.validateCredentials(EMAIL, PASSWORD);

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ email: EMAIL, deletedAt: null }),
      }),
    );
  });

  // --------------------------------------------------------------------------
  // TENANT_COLLISION
  // --------------------------------------------------------------------------

  it('returns TENANT_COLLISION when multiple users share the same email', async () => {
    mockPrisma.user.findMany.mockResolvedValue([makeUser(), makeUser()]);

    const result = await service.validateCredentials(EMAIL, PASSWORD);

    expect(result.outcome).toBe('TENANT_COLLISION');
  });

  // --------------------------------------------------------------------------
  // ACCOUNT_LOCKED
  // --------------------------------------------------------------------------

  it('returns ACCOUNT_LOCKED when lockedUntil is in the future', async () => {
    const future = new Date(Date.now() + 60_000);
    mockPrisma.user.findMany.mockResolvedValue([makeUser({ lockedUntil: future })]);

    const result = await service.validateCredentials(EMAIL, PASSWORD);

    expect(result.outcome).toBe('ACCOUNT_LOCKED');
  });

  it('ACCOUNT_LOCKED outcome includes userId and tenantId', async () => {
    const future = new Date(Date.now() + 60_000);
    mockPrisma.user.findMany.mockResolvedValue([makeUser({ lockedUntil: future })]);

    const result = await service.validateCredentials(EMAIL, PASSWORD);

    expect(result).toMatchObject({
      outcome: 'ACCOUNT_LOCKED',
      userId: USER_ID,
      tenantId: TENANT_ID,
    });
  });

  it('treats an expired lockedUntil as not locked and falls through to bcrypt', async () => {
    const past = new Date(Date.now() - 60_000);
    mockPrisma.user.findMany.mockResolvedValue([makeUser({ lockedUntil: past })]);
    mockedBcryptCompare.mockResolvedValue(true as never);

    const result = await service.validateCredentials(EMAIL, PASSWORD);

    // Expired lock → not blocked → bcrypt runs → SUCCESS
    expect(result.outcome).toBe('SUCCESS');
    expect(mockedBcryptCompare).toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // INVALID_PASSWORD
  // --------------------------------------------------------------------------

  it('returns INVALID_PASSWORD when bcrypt.compare returns false', async () => {
    mockPrisma.user.findMany.mockResolvedValue([makeUser()]);
    // spy already defaults to false

    const result = await service.validateCredentials(EMAIL, PASSWORD);

    expect(result.outcome).toBe('INVALID_PASSWORD');
  });

  it('INVALID_PASSWORD increments failedLoginAttempts by 1', async () => {
    mockPrisma.user.findMany.mockResolvedValue([makeUser({ failedLoginAttempts: 2 })]);

    await service.validateCredentials(EMAIL, PASSWORD);

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failedLoginAttempts: 3 }),
      }),
    );
  });

  it('INVALID_PASSWORD below threshold (count 4): isNowLocked false and lockedUntil not written', async () => {
    // failedLoginAttempts goes from 3 → 4; threshold is 5 → not yet locked
    mockPrisma.user.findMany.mockResolvedValue([makeUser({ failedLoginAttempts: 3 })]);

    const result = await service.validateCredentials(EMAIL, PASSWORD);

    expect(result).toMatchObject({ outcome: 'INVALID_PASSWORD', isNowLocked: false });
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ lockedUntil: expect.anything() }),
      }),
    );
  });

  it('INVALID_PASSWORD at threshold (count 5): isNowLocked true and lockedUntil set in update', async () => {
    // failedLoginAttempts goes from 4 → 5; threshold = 5 → lock triggered
    mockPrisma.user.findMany.mockResolvedValue([makeUser({ failedLoginAttempts: 4 })]);

    const result = await service.validateCredentials(EMAIL, PASSWORD);

    expect(result).toMatchObject({ outcome: 'INVALID_PASSWORD', isNowLocked: true });
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lockedUntil: expect.any(Date) }),
      }),
    );
  });

  it('INVALID_PASSWORD returns userId, tenantId, and isNowLocked', async () => {
    mockPrisma.user.findMany.mockResolvedValue([makeUser()]);

    const result = await service.validateCredentials(EMAIL, PASSWORD);

    expect(result).toMatchObject({
      outcome: 'INVALID_PASSWORD',
      userId: USER_ID,
      tenantId: TENANT_ID,
      isNowLocked: false,
    });
  });

  // --------------------------------------------------------------------------
  // SUCCESS
  // --------------------------------------------------------------------------

  it('returns SUCCESS when bcrypt.compare returns true', async () => {
    mockPrisma.user.findMany.mockResolvedValue([makeUser()]);
    mockedBcryptCompare.mockResolvedValue(true as never);

    const result = await service.validateCredentials(EMAIL, PASSWORD);

    expect(result.outcome).toBe('SUCCESS');
  });

  it('SUCCESS resets failedLoginAttempts to 0 in the update call', async () => {
    mockPrisma.user.findMany.mockResolvedValue([makeUser({ failedLoginAttempts: 3 })]);
    mockedBcryptCompare.mockResolvedValue(true as never);

    await service.validateCredentials(EMAIL, PASSWORD);

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failedLoginAttempts: 0 }),
      }),
    );
  });

  it('SUCCESS clears lockedUntil to null in the update call', async () => {
    const past = new Date(Date.now() - 60_000);
    mockPrisma.user.findMany.mockResolvedValue([makeUser({ lockedUntil: past })]);
    mockedBcryptCompare.mockResolvedValue(true as never);

    await service.validateCredentials(EMAIL, PASSWORD);

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lockedUntil: null }),
      }),
    );
  });

  it('SUCCESS updates lastLoginAt to a current Date in the update call', async () => {
    mockPrisma.user.findMany.mockResolvedValue([makeUser()]);
    mockedBcryptCompare.mockResolvedValue(true as never);

    await service.validateCredentials(EMAIL, PASSWORD);

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
      }),
    );
  });
});
