// Reference: spec/07_security_architecture.md — JWT Architecture, User Enumeration Protection
// Reference: directives/08_audit_rules.md — AUD-200 through AUD-210 (auth audit events)
// Reference: PROGRESS.md — Step 5 AuthService Design Decisions
//
// Pure unit tests — no database, no real JWT signing, no HTTP.
// IdentityService, JwtService, and AuditService are replaced with jest.fn() mocks.
// Verifies: LoginResult outcomes, JWT payload construction, audit event selection,
// sentinel UUID usage, lockout event ordering, TENANT_COLLISION no-audit rule, logout.

import { Test, type TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';

import { AuditService, SYSTEM_USER_ID, SYSTEM_TENANT_ID } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import { IdentityService } from './identity.service';
import { AuthService, type JwtPayload } from './auth.service';
import { JWT_ACCESS_EXPIRES_IN_SECONDS } from './identity.constants';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_ID   = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ROLE_ID   = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const EMAIL     = 'test@example.gov';
const PASSWORD  = 'TestPassword1!';
const MOCK_TOKEN = 'mock.jwt.token';

// Minimal UserWithRoles-shaped object for SUCCESS outcome
const successUser = {
  id: USER_ID,
  tenantId: TENANT_ID,
  email: EMAIL,
  userRoles: [
    { role: { id: ROLE_ID, name: 'System Administrator' } },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthService', () => {
  let service: AuthService;
  let mockIdentityService: { validateCredentials: jest.Mock };
  let mockJwtService: { sign: jest.Mock };
  let mockAuditService: { logEvent: jest.Mock };

  beforeEach(async () => {
    mockIdentityService = { validateCredentials: jest.fn() };
    mockJwtService = { sign: jest.fn().mockReturnValue(MOCK_TOKEN) };
    mockAuditService = { logEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: IdentityService, useValue: mockIdentityService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => jest.clearAllMocks());

  // --------------------------------------------------------------------------
  // Instantiation
  // --------------------------------------------------------------------------

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // login() — SUCCESS outcome
  // --------------------------------------------------------------------------

  it('login() SUCCESS: outcome is SUCCESS', async () => {
    mockIdentityService.validateCredentials.mockResolvedValue({
      outcome: 'SUCCESS',
      user: successUser,
    });

    const result = await service.login(EMAIL, PASSWORD);

    expect(result.outcome).toBe('SUCCESS');
  });

  it('login() SUCCESS: accessToken equals the value returned by jwtService.sign', async () => {
    mockIdentityService.validateCredentials.mockResolvedValue({
      outcome: 'SUCCESS',
      user: successUser,
    });

    const result = await service.login(EMAIL, PASSWORD);

    expect(result).toMatchObject({ outcome: 'SUCCESS', accessToken: MOCK_TOKEN });
  });

  it('login() SUCCESS: expiresIn equals JWT_ACCESS_EXPIRES_IN_SECONDS (3600)', async () => {
    mockIdentityService.validateCredentials.mockResolvedValue({
      outcome: 'SUCCESS',
      user: successUser,
    });

    const result = await service.login(EMAIL, PASSWORD);

    expect(result).toMatchObject({ outcome: 'SUCCESS', expiresIn: JWT_ACCESS_EXPIRES_IN_SECONDS });
    expect(JWT_ACCESS_EXPIRES_IN_SECONDS).toBe(3600);
  });

  it('login() SUCCESS: JWT payload contains sub=userId, tenantId, email, and roles', async () => {
    mockIdentityService.validateCredentials.mockResolvedValue({
      outcome: 'SUCCESS',
      user: successUser,
    });

    await service.login(EMAIL, PASSWORD);

    const calledPayload = mockJwtService.sign.mock.calls[0]![0] as JwtPayload;
    expect(calledPayload).toMatchObject({
      sub: USER_ID,
      tenantId: TENANT_ID,
      email: EMAIL,
      roles: ['System Administrator'],
    });
  });

  it('login() SUCCESS: calls auditService.logEvent with AUTH_LOGIN_SUCCESS', async () => {
    mockIdentityService.validateCredentials.mockResolvedValue({
      outcome: 'SUCCESS',
      user: successUser,
    });

    await service.login(EMAIL, PASSWORD);

    expect(mockAuditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditEventType.AUTH_LOGIN_SUCCESS,
        tenantId: TENANT_ID,
        userId: USER_ID,
      }),
    );
  });

  // --------------------------------------------------------------------------
  // login() — EMAIL_NOT_FOUND outcome
  // --------------------------------------------------------------------------

  it('login() EMAIL_NOT_FOUND: returns UNAUTHORIZED', async () => {
    mockIdentityService.validateCredentials.mockResolvedValue({ outcome: 'EMAIL_NOT_FOUND' });

    const result = await service.login(EMAIL, PASSWORD);

    expect(result.outcome).toBe('UNAUTHORIZED');
  });

  it('login() EMAIL_NOT_FOUND: logEvent called with SYSTEM_USER_ID and SYSTEM_TENANT_ID', async () => {
    mockIdentityService.validateCredentials.mockResolvedValue({ outcome: 'EMAIL_NOT_FOUND' });

    await service.login(EMAIL, PASSWORD);

    expect(mockAuditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditEventType.AUTH_LOGIN_FAILURE,
        userId: SYSTEM_USER_ID,
        tenantId: SYSTEM_TENANT_ID,
      }),
    );
  });

  // --------------------------------------------------------------------------
  // login() — ACCOUNT_LOCKED outcome
  // --------------------------------------------------------------------------

  it('login() ACCOUNT_LOCKED: returns UNAUTHORIZED', async () => {
    mockIdentityService.validateCredentials.mockResolvedValue({
      outcome: 'ACCOUNT_LOCKED',
      userId: USER_ID,
      tenantId: TENANT_ID,
    });

    const result = await service.login(EMAIL, PASSWORD);

    expect(result.outcome).toBe('UNAUTHORIZED');
  });

  it('login() ACCOUNT_LOCKED: logEvent called with AUTH_LOGIN_FAILURE and real userId and tenantId', async () => {
    mockIdentityService.validateCredentials.mockResolvedValue({
      outcome: 'ACCOUNT_LOCKED',
      userId: USER_ID,
      tenantId: TENANT_ID,
    });

    await service.login(EMAIL, PASSWORD);

    expect(mockAuditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditEventType.AUTH_LOGIN_FAILURE,
        userId: USER_ID,
        tenantId: TENANT_ID,
      }),
    );
  });

  // --------------------------------------------------------------------------
  // login() — INVALID_PASSWORD outcome
  // --------------------------------------------------------------------------

  it('login() INVALID_PASSWORD (not now locked): returns UNAUTHORIZED', async () => {
    mockIdentityService.validateCredentials.mockResolvedValue({
      outcome: 'INVALID_PASSWORD',
      userId: USER_ID,
      tenantId: TENANT_ID,
      isNowLocked: false,
    });

    const result = await service.login(EMAIL, PASSWORD);

    expect(result.outcome).toBe('UNAUTHORIZED');
  });

  it('login() INVALID_PASSWORD (not now locked): logEvent called once — AUTH_LOGIN_FAILURE only', async () => {
    mockIdentityService.validateCredentials.mockResolvedValue({
      outcome: 'INVALID_PASSWORD',
      userId: USER_ID,
      tenantId: TENANT_ID,
      isNowLocked: false,
    });

    await service.login(EMAIL, PASSWORD);

    expect(mockAuditService.logEvent).toHaveBeenCalledTimes(1);
    expect(mockAuditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditEventType.AUTH_LOGIN_FAILURE }),
    );
  });

  it('login() INVALID_PASSWORD (now locked): logEvent called twice — AUTH_LOGIN_FAILURE then AUTH_ACCOUNT_LOCKOUT', async () => {
    mockIdentityService.validateCredentials.mockResolvedValue({
      outcome: 'INVALID_PASSWORD',
      userId: USER_ID,
      tenantId: TENANT_ID,
      isNowLocked: true,
    });

    await service.login(EMAIL, PASSWORD);

    expect(mockAuditService.logEvent).toHaveBeenCalledTimes(2);
    // First call: AUTH_LOGIN_FAILURE
    expect(mockAuditService.logEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ action: AuditEventType.AUTH_LOGIN_FAILURE }),
    );
    // Second call: AUTH_ACCOUNT_LOCKOUT
    expect(mockAuditService.logEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action: AuditEventType.AUTH_ACCOUNT_LOCKOUT }),
    );
  });

  // --------------------------------------------------------------------------
  // login() — TENANT_COLLISION outcome
  // --------------------------------------------------------------------------

  it('login() TENANT_COLLISION: returns INTERNAL_ERROR', async () => {
    mockIdentityService.validateCredentials.mockResolvedValue({ outcome: 'TENANT_COLLISION' });

    const result = await service.login(EMAIL, PASSWORD);

    expect(result.outcome).toBe('INTERNAL_ERROR');
  });

  it('login() TENANT_COLLISION: auditService.logEvent is NOT called', async () => {
    mockIdentityService.validateCredentials.mockResolvedValue({ outcome: 'TENANT_COLLISION' });

    await service.login(EMAIL, PASSWORD);

    expect(mockAuditService.logEvent).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // logout()
  // --------------------------------------------------------------------------

  it('logout() calls auditService.logEvent with AUTH_LOGOUT, userId, and tenantId', async () => {
    await service.logout(USER_ID, TENANT_ID);

    expect(mockAuditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditEventType.AUTH_LOGOUT,
        userId: USER_ID,
        tenantId: TENANT_ID,
      }),
    );
  });

  it('logout() resolves without error', async () => {
    await expect(service.logout(USER_ID, TENANT_ID)).resolves.toBeUndefined();
  });
});
