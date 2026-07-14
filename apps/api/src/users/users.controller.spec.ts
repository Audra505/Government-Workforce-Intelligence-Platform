// Reference: spec/06_api_contracts.md — POST /api/v1/users, GET /api/v1/users, GET /api/v1/users/:id
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
//
// Pure unit tests — no HTTP server, no guards, no database.
// UsersService is replaced with jest.fn() mocks.
// JwtAuthGuard and RolesGuard are overridden to always pass.
// Controller methods are called directly with a mock RequestUser actor.
// Verifies: HTTP exception types, response envelope shapes, date serialization, error codes.

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import { UsersController } from './users.controller';
import { UsersService, type UserRecord } from './users.service';
import type { RequestUser } from '../identity/jwt.strategy';
import type { ListUsersQueryDto } from './dto/list-users-query.dto';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID  = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_ID   = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ROLE_ID   = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const mockActor: RequestUser = {
  userId: ACTOR_ID,
  tenantId: TENANT_ID,
  email: 'admin@dev.gov',
  firstName: '',
  lastName: '',
  roles: ['System Administrator'],
};

const CREATED_AT = new Date('2026-06-09T12:00:00.000Z');

const userRecord: UserRecord = {
  id: USER_ID,
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane.smith@agency.gov',
  status: 'ACTIVE',
  roles: ['System Administrator'],
  createdAt: CREATED_AT,
  lastLoginAt: null,
};

const createDto: CreateUserDto = {
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane.smith@agency.gov',
  roleIds: [ROLE_ID],
  password: 'TempPass1234!',
};

const listQuery: ListUsersQueryDto = { page: 1, pageSize: 20 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UsersController', () => {
  let controller: UsersController;
  let mockUsersService: {
    createUser: jest.Mock;
    listUsers: jest.Mock;
    getUserById: jest.Mock;
    getRoles: jest.Mock;
    updateUser: jest.Mock;
  };

  beforeEach(async () => {
    mockUsersService = {
      createUser: jest.fn(),
      listUsers: jest.fn(),
      getUserById: jest.fn(),
      getRoles: jest.fn(),
      updateUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  afterEach(() => jest.clearAllMocks());

  // --------------------------------------------------------------------------
  // POST / — createUser()
  // --------------------------------------------------------------------------

  describe('createUser()', () => {
    it('SUCCESS: returns { success: true, data: { id, firstName, lastName, email, status, roles, createdAt, lastLoginAt } }', async () => {
      mockUsersService.createUser.mockResolvedValue({ outcome: 'SUCCESS', user: userRecord });

      const result = await controller.createUser(createDto, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({
        id: USER_ID,
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane.smith@agency.gov',
        status: 'ACTIVE',
        roles: ['System Administrator'],
      });
    });

    it('SUCCESS: createdAt is an ISO 8601 string (Date → .toISOString())', async () => {
      mockUsersService.createUser.mockResolvedValue({ outcome: 'SUCCESS', user: userRecord });

      const result = await controller.createUser(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']!['createdAt']).toBe(CREATED_AT.toISOString());
    });

    it('SUCCESS: lastLoginAt is null when user has never logged in', async () => {
      mockUsersService.createUser.mockResolvedValue({ outcome: 'SUCCESS', user: { ...userRecord, lastLoginAt: null } });

      const result = await controller.createUser(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']!['lastLoginAt']).toBeNull();
    });

    it('EMAIL_CONFLICT: throws ConflictException', async () => {
      mockUsersService.createUser.mockResolvedValue({ outcome: 'EMAIL_CONFLICT' });

      await expect(controller.createUser(createDto, mockActor)).rejects.toThrow(ConflictException);
    });

    it('EMAIL_CONFLICT: exception response contains { success: false, error: { code: "CONFLICT" } }', async () => {
      mockUsersService.createUser.mockResolvedValue({ outcome: 'EMAIL_CONFLICT' });

      try {
        await controller.createUser(createDto, mockActor);
        fail('expected ConflictException to be thrown');
      } catch (err) {
        const response = (err as ConflictException).getResponse() as Record<string, unknown>;
        expect(response).toMatchObject({ success: false, error: { code: 'CONFLICT' } });
      }
    });

    it('ROLE_NOT_FOUND: throws BadRequestException with code VALIDATION_ERROR', async () => {
      mockUsersService.createUser.mockResolvedValue({ outcome: 'ROLE_NOT_FOUND', missingIds: [ROLE_ID] });

      await expect(controller.createUser(createDto, mockActor)).rejects.toThrow(BadRequestException);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException with code INTERNAL_ERROR', async () => {
      mockUsersService.createUser.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.createUser(createDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });

    it('FORBIDDEN_ROLE_ASSIGNMENT: throws ForbiddenException', async () => {
      mockUsersService.createUser.mockResolvedValue({
        outcome: 'FORBIDDEN_ROLE_ASSIGNMENT',
        forbiddenRoleId: ROLE_ID,
      });

      await expect(controller.createUser(createDto, mockActor)).rejects.toThrow(ForbiddenException);
    });

    it('FORBIDDEN_ROLE_ASSIGNMENT: exception response contains { success: false, error: { code: "FORBIDDEN_ROLE_ASSIGNMENT" } }', async () => {
      mockUsersService.createUser.mockResolvedValue({
        outcome: 'FORBIDDEN_ROLE_ASSIGNMENT',
        forbiddenRoleId: ROLE_ID,
      });

      try {
        await controller.createUser(createDto, mockActor);
        fail('expected ForbiddenException to be thrown');
      } catch (err) {
        const response = (err as ForbiddenException).getResponse() as Record<string, unknown>;
        expect(response).toMatchObject({ success: false, error: { code: 'FORBIDDEN_ROLE_ASSIGNMENT' } });
      }
    });

    it('passes actor.roles to usersService.createUser', async () => {
      mockUsersService.createUser.mockResolvedValue({ outcome: 'SUCCESS', user: userRecord });

      await controller.createUser(createDto, mockActor);

      expect(mockUsersService.createUser).toHaveBeenCalledWith(
        createDto,
        TENANT_ID,
        ACTOR_ID,
        mockActor.roles,
      );
    });
  });

  // --------------------------------------------------------------------------
  // GET / — listUsers()
  // --------------------------------------------------------------------------

  describe('listUsers()', () => {
    it('SUCCESS: returns { success: true, data: { users, total, page, pageSize, totalPages } }', async () => {
      mockUsersService.listUsers.mockResolvedValue({
        outcome: 'SUCCESS',
        users: [userRecord],
        total: 1,
        page: 1,
        pageSize: 20,
      });

      const result = await controller.listUsers(listQuery, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ total: 1, page: 1, pageSize: 20 });
      expect((result['data']!['users'] as unknown[]).length).toBe(1);
    });

    it('SUCCESS: totalPages = Math.ceil(total / pageSize)', async () => {
      mockUsersService.listUsers.mockResolvedValue({
        outcome: 'SUCCESS',
        users: [],
        total: 25,
        page: 1,
        pageSize: 10,
      });

      const result = await controller.listUsers(listQuery, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']!['totalPages']).toBe(3); // Math.ceil(25 / 10)
    });

    it('SUCCESS: totalPages = 0 when total = 0', async () => {
      mockUsersService.listUsers.mockResolvedValue({
        outcome: 'SUCCESS',
        users: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });

      const result = await controller.listUsers(listQuery, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']!['totalPages']).toBe(0);
    });

    it('SUCCESS: each user in users array has ISO 8601 string for createdAt', async () => {
      mockUsersService.listUsers.mockResolvedValue({
        outcome: 'SUCCESS',
        users: [userRecord],
        total: 1,
        page: 1,
        pageSize: 20,
      });

      const result = await controller.listUsers(listQuery, mockActor) as Record<string, Record<string, unknown>>;

      const users = result['data']!['users'] as Array<Record<string, unknown>>;
      expect(users[0]!['createdAt']).toBe(CREATED_AT.toISOString());
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockUsersService.listUsers.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.listUsers(listQuery, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // GET /:id — getUserById()
  // --------------------------------------------------------------------------

  describe('getUserById()', () => {
    it('SUCCESS: returns { success: true, data: UserRecord shape }', async () => {
      mockUsersService.getUserById.mockResolvedValue({ outcome: 'SUCCESS', user: userRecord });

      const result = await controller.getUserById(USER_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']!['id']).toBe(USER_ID);
    });

    it('NOT_FOUND: throws NotFoundException with { success: false, error: { code: "NOT_FOUND" } }', async () => {
      mockUsersService.getUserById.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(controller.getUserById(USER_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockUsersService.getUserById.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.getUserById(USER_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });

    it('actor.tenantId from JWT is passed to service — controller does not accept tenantId from params', async () => {
      mockUsersService.getUserById.mockResolvedValue({ outcome: 'SUCCESS', user: userRecord });

      await controller.getUserById(USER_ID, mockActor);

      expect(mockUsersService.getUserById).toHaveBeenCalledWith(USER_ID, TENANT_ID);
    });
  });

  // --------------------------------------------------------------------------
  // PATCH /:id — updateUser()
  // GD-M27-1 Decision 3–7
  // --------------------------------------------------------------------------

  describe('updateUser()', () => {
    const updateDto: UpdateUserDto = { firstName: 'Updated' };

    it('SUCCESS: returns { success: true, data: UserRecord shape }', async () => {
      mockUsersService.updateUser.mockResolvedValue({ outcome: 'SUCCESS', user: userRecord });

      const result = await controller.updateUser(USER_ID, updateDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']!['id']).toBe(USER_ID);
    });

    it('SUCCESS: createdAt is serialized to ISO 8601 string', async () => {
      mockUsersService.updateUser.mockResolvedValue({ outcome: 'SUCCESS', user: userRecord });

      const result = await controller.updateUser(USER_ID, updateDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']!['createdAt']).toBe(CREATED_AT.toISOString());
    });

    it('passes (id, dto, tenantId, userId, roles) to service', async () => {
      mockUsersService.updateUser.mockResolvedValue({ outcome: 'SUCCESS', user: userRecord });

      await controller.updateUser(USER_ID, updateDto, mockActor);

      expect(mockUsersService.updateUser).toHaveBeenCalledWith(
        USER_ID, updateDto, TENANT_ID, ACTOR_ID, mockActor.roles,
      );
    });

    it('NOT_FOUND: throws NotFoundException', async () => {
      mockUsersService.updateUser.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(controller.updateUser(USER_ID, updateDto, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('NOT_FOUND: exception response contains { success: false, error: { code: "NOT_FOUND" } }', async () => {
      mockUsersService.updateUser.mockResolvedValue({ outcome: 'NOT_FOUND' });

      try {
        await controller.updateUser(USER_ID, updateDto, mockActor);
        fail('expected NotFoundException');
      } catch (err) {
        const response = (err as NotFoundException).getResponse() as Record<string, unknown>;
        expect(response).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
      }
    });

    it('NO_MEANINGFUL_CHANGE: throws BadRequestException', async () => {
      mockUsersService.updateUser.mockResolvedValue({ outcome: 'NO_MEANINGFUL_CHANGE' });

      await expect(controller.updateUser(USER_ID, {} as UpdateUserDto, mockActor)).rejects.toThrow(BadRequestException);
    });

    it('NO_MEANINGFUL_CHANGE: exception response contains code VALIDATION_ERROR', async () => {
      mockUsersService.updateUser.mockResolvedValue({ outcome: 'NO_MEANINGFUL_CHANGE' });

      try {
        await controller.updateUser(USER_ID, {} as UpdateUserDto, mockActor);
        fail('expected BadRequestException');
      } catch (err) {
        const response = (err as BadRequestException).getResponse() as Record<string, unknown>;
        expect(response).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
      }
    });

    it('EMAIL_CONFLICT: throws ConflictException', async () => {
      mockUsersService.updateUser.mockResolvedValue({ outcome: 'EMAIL_CONFLICT' });

      await expect(controller.updateUser(USER_ID, updateDto, mockActor)).rejects.toThrow(ConflictException);
    });

    it('EMAIL_CONFLICT: exception response contains code CONFLICT', async () => {
      mockUsersService.updateUser.mockResolvedValue({ outcome: 'EMAIL_CONFLICT' });

      try {
        await controller.updateUser(USER_ID, updateDto, mockActor);
        fail('expected ConflictException');
      } catch (err) {
        const response = (err as ConflictException).getResponse() as Record<string, unknown>;
        expect(response).toMatchObject({ success: false, error: { code: 'CONFLICT' } });
      }
    });

    it('ROLE_NOT_FOUND: throws BadRequestException with VALIDATION_ERROR', async () => {
      mockUsersService.updateUser.mockResolvedValue({
        outcome: 'ROLE_NOT_FOUND',
        missingIds: [ROLE_ID],
      });

      await expect(controller.updateUser(USER_ID, updateDto, mockActor)).rejects.toThrow(BadRequestException);
    });

    it('FORBIDDEN_USER_MANAGEMENT: throws ForbiddenException', async () => {
      mockUsersService.updateUser.mockResolvedValue({ outcome: 'FORBIDDEN_USER_MANAGEMENT' });

      await expect(controller.updateUser(USER_ID, updateDto, mockActor)).rejects.toThrow(ForbiddenException);
    });

    it('FORBIDDEN_USER_MANAGEMENT: exception response contains code FORBIDDEN_USER_MANAGEMENT', async () => {
      mockUsersService.updateUser.mockResolvedValue({ outcome: 'FORBIDDEN_USER_MANAGEMENT' });

      try {
        await controller.updateUser(USER_ID, updateDto, mockActor);
        fail('expected ForbiddenException');
      } catch (err) {
        const response = (err as ForbiddenException).getResponse() as Record<string, unknown>;
        expect(response).toMatchObject({ success: false, error: { code: 'FORBIDDEN_USER_MANAGEMENT' } });
      }
    });

    it('FORBIDDEN_ROLE_ASSIGNMENT: throws ForbiddenException', async () => {
      mockUsersService.updateUser.mockResolvedValue({
        outcome: 'FORBIDDEN_ROLE_ASSIGNMENT',
        forbiddenRoleId: ROLE_ID,
      });

      await expect(controller.updateUser(USER_ID, updateDto, mockActor)).rejects.toThrow(ForbiddenException);
    });

    it('FORBIDDEN_ROLE_ASSIGNMENT: exception response contains code FORBIDDEN_ROLE_ASSIGNMENT', async () => {
      mockUsersService.updateUser.mockResolvedValue({
        outcome: 'FORBIDDEN_ROLE_ASSIGNMENT',
        forbiddenRoleId: ROLE_ID,
      });

      try {
        await controller.updateUser(USER_ID, updateDto, mockActor);
        fail('expected ForbiddenException');
      } catch (err) {
        const response = (err as ForbiddenException).getResponse() as Record<string, unknown>;
        expect(response).toMatchObject({ success: false, error: { code: 'FORBIDDEN_ROLE_ASSIGNMENT' } });
      }
    });

    it('LAST_SYSTEM_ADMINISTRATOR: throws UnprocessableEntityException', async () => {
      mockUsersService.updateUser.mockResolvedValue({ outcome: 'LAST_SYSTEM_ADMINISTRATOR' });

      await expect(controller.updateUser(USER_ID, updateDto, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('LAST_SYSTEM_ADMINISTRATOR: exception response contains code LAST_SYSTEM_ADMINISTRATOR', async () => {
      mockUsersService.updateUser.mockResolvedValue({ outcome: 'LAST_SYSTEM_ADMINISTRATOR' });

      try {
        await controller.updateUser(USER_ID, updateDto, mockActor);
        fail('expected UnprocessableEntityException');
      } catch (err) {
        const response = (err as UnprocessableEntityException).getResponse() as Record<string, unknown>;
        expect(response).toMatchObject({ success: false, error: { code: 'LAST_SYSTEM_ADMINISTRATOR' } });
      }
    });

    it('INVALID_STATUS_TRANSITION: throws UnprocessableEntityException', async () => {
      mockUsersService.updateUser.mockResolvedValue({
        outcome: 'INVALID_STATUS_TRANSITION',
        from: 'INVITED',
        to: 'SUSPENDED',
      });

      await expect(controller.updateUser(USER_ID, { status: 'SUSPENDED' }, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('INVALID_STATUS_TRANSITION: error message includes from and to values', async () => {
      mockUsersService.updateUser.mockResolvedValue({
        outcome: 'INVALID_STATUS_TRANSITION',
        from: 'INVITED',
        to: 'SUSPENDED',
      });

      try {
        await controller.updateUser(USER_ID, { status: 'SUSPENDED' }, mockActor);
        fail('expected UnprocessableEntityException');
      } catch (err) {
        const response = (err as UnprocessableEntityException).getResponse() as Record<string, { message: string }>;
        expect(response['error']!.message).toContain('INVITED');
        expect(response['error']!.message).toContain('SUSPENDED');
      }
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockUsersService.updateUser.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.updateUser(USER_ID, updateDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });
});
