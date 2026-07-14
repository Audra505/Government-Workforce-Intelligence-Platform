// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: PROGRESS.md — Step 6 JwtStrategy Design Decisions
//
// Pure unit tests — no HTTP, no database, no real JWT verification.
// ConfigService is mocked; validate() is a pure synchronous transformation.
// Critical: Test 3 (tenantId from payload only) verifies the structural
// enforcement of SEC-003 — tenantId on every authenticated request comes
// exclusively from the validated JWT payload.

import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { JwtStrategy, type RequestUser } from './jwt.strategy';
import { type JwtPayload } from './auth.service';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET = 'test-jwt-secret-for-unit-tests';

const mockPayload: JwtPayload = {
  sub: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  email: 'test@example.gov',
  firstName: 'Test',
  lastName: 'User',
  roles: ['System Administrator'],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'JWT_SECRET') return TEST_JWT_SECRET;
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  afterEach(() => jest.clearAllMocks());

  // --------------------------------------------------------------------------
  // Instantiation
  // --------------------------------------------------------------------------

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // validate() — field mapping
  // --------------------------------------------------------------------------

  it('validate() maps payload.sub to RequestUser.userId', () => {
    const result: RequestUser = strategy.validate(mockPayload);

    expect(result.userId).toBe(mockPayload.sub);
  });

  it('validate() maps payload.tenantId to RequestUser.tenantId (SEC-003 isolation)', () => {
    // tenantId must come from the JWT payload exclusively — never from request body,
    // query params, or path params. This test verifies that structural guarantee.
    const result: RequestUser = strategy.validate(mockPayload);

    expect(result.tenantId).toBe(mockPayload.tenantId);
  });

  it('validate() maps payload.email to RequestUser.email', () => {
    const result: RequestUser = strategy.validate(mockPayload);

    expect(result.email).toBe(mockPayload.email);
  });

  it('validate() maps payload.firstName to RequestUser.firstName', () => {
    const result: RequestUser = strategy.validate(mockPayload);

    expect(result.firstName).toBe(mockPayload.firstName);
  });

  it('validate() maps payload.lastName to RequestUser.lastName', () => {
    const result: RequestUser = strategy.validate(mockPayload);

    expect(result.lastName).toBe(mockPayload.lastName);
  });

  it('validate() maps payload.roles array to RequestUser.roles', () => {
    const result: RequestUser = strategy.validate(mockPayload);

    expect(result.roles).toEqual(mockPayload.roles);
  });

  it('validate() returns a complete RequestUser with all six fields', () => {
    const result: RequestUser = strategy.validate(mockPayload);

    expect(result).toEqual({
      userId: mockPayload.sub,
      tenantId: mockPayload.tenantId,
      email: mockPayload.email,
      firstName: mockPayload.firstName,
      lastName: mockPayload.lastName,
      roles: mockPayload.roles,
    });
  });

  it('validate() defaults firstName and lastName to empty string for pre-M28 tokens without name fields', () => {
    // Simulates a token issued before M28 that carries no firstName/lastName.
    const legacyPayload = {
      sub: mockPayload.sub,
      tenantId: mockPayload.tenantId,
      email: mockPayload.email,
      roles: mockPayload.roles,
    } as unknown as JwtPayload;

    const result: RequestUser = strategy.validate(legacyPayload);

    expect(result.firstName).toBe('');
    expect(result.lastName).toBe('');
  });
});
