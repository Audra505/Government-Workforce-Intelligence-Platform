// Reference: spec/06_api_contracts.md — POST /api/v1/auth/login, POST /api/v1/auth/logout, GET /api/v1/auth/me
// Reference: spec/07_security_architecture.md — User Enumeration Protection, SEC-003
// Reference: PROGRESS.md — Step 7 AuthController Design Decisions
//
// Pure unit tests — no HTTP server, no database, no guard execution.
// AuthService is replaced with jest.fn() mocks.
// Controller methods are called directly; HTTP exceptions are thrown and caught.
// Verifies: response shapes, status code contract (via exceptions thrown),
// service call boundaries, tenantId exclusion from /me.

import { InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { type LoginDto } from './dto/login.dto';
import { type RequestUser } from './jwt.strategy';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const EMAIL    = 'test@example.gov';
const PASSWORD = 'TestPassword1!';
const TOKEN    = 'mock.jwt.token';
const USER_ID  = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const mockCurrentUser: RequestUser = {
  userId: USER_ID,
  tenantId: TENANT_ID,
  email: EMAIL,
  roles: ['System Administrator'],
};

const loginDto: LoginDto = { email: EMAIL, password: PASSWORD };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthController', () => {
  let controller: AuthController;
  let mockAuthService: { login: jest.Mock; logout: jest.Mock };

  beforeEach(async () => {
    mockAuthService = {
      login: jest.fn(),
      logout: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  afterEach(() => jest.clearAllMocks());

  // --------------------------------------------------------------------------
  // Instantiation
  // --------------------------------------------------------------------------

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // login()
  // --------------------------------------------------------------------------

  it('login() calls authService.login with email and password from the DTO', async () => {
    mockAuthService.login.mockResolvedValue({ outcome: 'SUCCESS', accessToken: TOKEN, expiresIn: 3600 });

    await controller.login(loginDto);

    expect(mockAuthService.login).toHaveBeenCalledWith(EMAIL, PASSWORD);
  });

  it('login() SUCCESS: returns { success: true, data: { accessToken, expiresIn } }', async () => {
    mockAuthService.login.mockResolvedValue({ outcome: 'SUCCESS', accessToken: TOKEN, expiresIn: 3600 });

    const result = await controller.login(loginDto);

    expect(result).toEqual({
      success: true,
      data: { accessToken: TOKEN, expiresIn: 3600 },
    });
  });

  it('login() UNAUTHORIZED: throws UnauthorizedException with structured error body', async () => {
    mockAuthService.login.mockResolvedValue({ outcome: 'UNAUTHORIZED' });

    await expect(controller.login(loginDto)).rejects.toThrow(UnauthorizedException);
  });

  it('login() UNAUTHORIZED: exception body contains success: false, code: UNAUTHORIZED', async () => {
    mockAuthService.login.mockResolvedValue({ outcome: 'UNAUTHORIZED' });

    try {
      await controller.login(loginDto);
      fail('expected UnauthorizedException to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      const response = (err as UnauthorizedException).getResponse() as Record<string, unknown>;
      expect(response).toMatchObject({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
      });
    }
  });

  it('login() INTERNAL_ERROR: throws InternalServerErrorException', async () => {
    mockAuthService.login.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

    await expect(controller.login(loginDto)).rejects.toThrow(InternalServerErrorException);
  });

  // --------------------------------------------------------------------------
  // logout()
  // --------------------------------------------------------------------------

  it('logout() calls authService.logout with user.userId and user.tenantId', async () => {
    await controller.logout(mockCurrentUser);

    expect(mockAuthService.logout).toHaveBeenCalledWith(USER_ID, TENANT_ID);
  });

  it('logout() returns { success: true }', async () => {
    const result = await controller.logout(mockCurrentUser);

    expect(result).toEqual({ success: true });
  });

  // --------------------------------------------------------------------------
  // me()
  // --------------------------------------------------------------------------

  it('me() returns { success: true, data: { id, email, roles } }', () => {
    const result = controller.me(mockCurrentUser);

    expect(result).toEqual({
      success: true,
      data: {
        id: USER_ID,
        email: EMAIL,
        roles: ['System Administrator'],
      },
    });
  });

  it('me() response data does NOT include tenantId', () => {
    const result = controller.me(mockCurrentUser) as { success: boolean; data: Record<string, unknown> };

    expect(result.data).not.toHaveProperty('tenantId');
  });

  it('me() uses user.userId as the id field in the response', () => {
    const result = controller.me(mockCurrentUser) as { success: boolean; data: Record<string, unknown> };

    expect(result.data['id']).toBe(USER_ID);
  });

  it('me() preserves the full roles array from the RequestUser', () => {
    const userWithMultipleRoles: RequestUser = {
      ...mockCurrentUser,
      roles: ['System Administrator', 'HR Director'],
    };

    const result = controller.me(userWithMultipleRoles) as { success: boolean; data: Record<string, unknown> };

    expect(result.data['roles']).toEqual(['System Administrator', 'HR Director']);
  });
});
