// Reference: spec/01_requirements.md — FR-001 User Registration
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation, Password Rules
// Reference: directives/08_audit_rules.md — AUD-250 (User Created), AUD-300 (Role Assigned)
//
// Pure unit tests — no database, no real bcrypt execution.
// PrismaService and AuditService are replaced with jest.fn() mocks.
// bcrypt module is fully mocked via jest.mock() — tests run in < 1ms each.
//
// jest.mock() must precede imports; Jest hoists it automatically.
/* eslint-disable */
jest.mock('bcrypt');

import * as bcrypt from 'bcrypt';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import { BCRYPT_ROUNDS } from '../identity/identity.constants';
import { UsersService, type UserRecord } from './users.service';
import { type CreateUserDto } from './dto/create-user.dto';
import { type ListUsersQueryDto } from './dto/list-users-query.dto';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID    = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID     = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_ID      = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ROLE_ID_1    = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ROLE_ID_2    = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const MOCK_HASH    = '$2b$12$mockhash';
const CREATED_AT   = new Date('2026-06-09T00:00:00.000Z');

const createDto: CreateUserDto = {
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'Jane.Smith@AGENCY.GOV',
  roleIds: [ROLE_ID_1],
  password: 'TempPass1234!',
};

const foundRole1 = { id: ROLE_ID_1, name: 'System Administrator' };
const foundRole2 = { id: ROLE_ID_2, name: 'HR Director' };

const createdRow = {
  id: USER_ID,
  firstName: 'Jane',
  lastName: 'Smith',
  status: 'ACTIVE',
  createdAt: CREATED_AT,
  lastLoginAt: null,
};

function makeUserRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: USER_ID,
    firstName: 'Jane',
    lastName: 'Smith',
    email: 'jane.smith@agency.gov',
    status: 'ACTIVE',
    createdAt: CREATED_AT,
    lastLoginAt: null,
    userRoles: [{ role: { name: 'System Administrator' } }],
    ...overrides,
  };
}

const mockedBcryptHash = bcrypt.hash as jest.MockedFunction<typeof bcrypt.hash>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UsersService', () => {
  let service: UsersService;
  let mockPrisma: {
    role: { findMany: jest.Mock };
    user: { findMany: jest.Mock; count: jest.Mock; findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let mockTx: {
    user: { create: jest.Mock };
    userRole: { createMany: jest.Mock };
  };
  let mockAuditService: { logEvent: jest.Mock };

  beforeEach(async () => {
    mockTx = {
      user: { create: jest.fn().mockResolvedValue(createdRow) },
      userRole: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };

    mockPrisma = {
      role: { findMany: jest.fn() },
      user: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
    };

    mockAuditService = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);

    mockedBcryptHash.mockResolvedValue(MOCK_HASH as never);
  });

  afterEach(() => jest.clearAllMocks());

  // --------------------------------------------------------------------------
  // createUser()
  // --------------------------------------------------------------------------

  describe('createUser()', () => {
    it('SUCCESS: returns { outcome: "SUCCESS", user: UserRecord }', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      const result = await service.createUser(createDto, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      expect((result as { outcome: 'SUCCESS'; user: UserRecord }).user).toBeDefined();
    });

    it('SUCCESS: UserRecord.status is "ACTIVE" (Decision 2, Option B)', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      const result = await service.createUser(createDto, TENANT_ID, ACTOR_ID);

      expect((result as { outcome: 'SUCCESS'; user: UserRecord }).user.status).toBe('ACTIVE');
    });

    it('SUCCESS: UserRecord.roles contains assigned role names', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      const result = await service.createUser(createDto, TENANT_ID, ACTOR_ID);

      expect((result as { outcome: 'SUCCESS'; user: UserRecord }).user.roles).toEqual(['System Administrator']);
    });

    it('SUCCESS: UserRecord.lastLoginAt is null for a newly created user', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      const result = await service.createUser(createDto, TENANT_ID, ACTOR_ID);

      expect((result as { outcome: 'SUCCESS'; user: UserRecord }).user.lastLoginAt).toBeNull();
    });

    it('SUCCESS: UserRecord.createdAt is a Date', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      const result = await service.createUser(createDto, TENANT_ID, ACTOR_ID);

      expect((result as { outcome: 'SUCCESS'; user: UserRecord }).user.createdAt).toBeInstanceOf(Date);
    });

    it('SUCCESS: email is normalized to lowercase and trimmed before DB operations', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      await service.createUser({ ...createDto, email: '  Jane.Smith@AGENCY.GOV  ' }, TENANT_ID, ACTOR_ID);

      const createCall = mockTx.user.create.mock.calls[0]![0] as { data: { email: string } };
      expect(createCall.data.email).toBe('jane.smith@agency.gov');
    });

    it('SUCCESS: bcrypt.hash is called with BCRYPT_ROUNDS (12)', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      await service.createUser(createDto, TENANT_ID, ACTOR_ID);

      expect(mockedBcryptHash).toHaveBeenCalledWith(createDto.password, BCRYPT_ROUNDS);
    });

    it('SUCCESS: role validation runs before bcrypt.hash (bcrypt not called when roles are missing)', async () => {
      mockPrisma.role.findMany.mockResolvedValue([]); // all roles missing

      await service.createUser(createDto, TENANT_ID, ACTOR_ID);

      expect(mockedBcryptHash).not.toHaveBeenCalled();
    });

    it('SUCCESS: IDENTITY_USER_CREATED audit event emitted after transaction', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      await service.createUser(createDto, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.IDENTITY_USER_CREATED,
          tenantId: TENANT_ID,
          userId: ACTOR_ID,
          entityType: 'USER',
          entityId: USER_ID,
        }),
      );
    });

    it('SUCCESS: AUTHZ_ROLE_ASSIGNED audit event emitted once per assigned role', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1, foundRole2]);
      mockTx.userRole.createMany.mockResolvedValue({ count: 2 });

      await service.createUser({ ...createDto, roleIds: [ROLE_ID_1, ROLE_ID_2] }, TENANT_ID, ACTOR_ID);

      const roleAssignedCalls = mockAuditService.logEvent.mock.calls.filter(
        (call: unknown[]) => (call[0] as { action: string }).action === AuditEventType.AUTHZ_ROLE_ASSIGNED,
      );
      expect(roleAssignedCalls.length).toBe(2);
    });

    it('EMAIL_CONFLICT: P2002 from $transaction returns { outcome: "EMAIL_CONFLICT" }', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);
      const p2002 = new Prisma.PrismaClientKnownRequestError('unique constraint', {
        code: 'P2002',
        clientVersion: '5.0.0',
      });
      mockPrisma.$transaction.mockRejectedValue(p2002);

      const result = await service.createUser(createDto, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('EMAIL_CONFLICT');
    });

    it('EMAIL_CONFLICT: no audit events emitted', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);
      const p2002 = new Prisma.PrismaClientKnownRequestError('unique constraint', {
        code: 'P2002',
        clientVersion: '5.0.0',
      });
      mockPrisma.$transaction.mockRejectedValue(p2002);

      await service.createUser(createDto, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('ROLE_NOT_FOUND: absent role UUID returns { outcome: "ROLE_NOT_FOUND", missingIds: [id] }', async () => {
      mockPrisma.role.findMany.mockResolvedValue([]); // none found

      const result = await service.createUser(createDto, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('ROLE_NOT_FOUND');
      expect((result as { outcome: 'ROLE_NOT_FOUND'; missingIds: string[] }).missingIds).toContain(ROLE_ID_1);
    });

    it('ROLE_NOT_FOUND: no audit events emitted', async () => {
      mockPrisma.role.findMany.mockResolvedValue([]);

      await service.createUser(createDto, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('INTERNAL_ERROR: non-P2002 transaction error returns { outcome: "INTERNAL_ERROR" }', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);
      mockPrisma.$transaction.mockRejectedValue(new Error('connection lost'));

      const result = await service.createUser(createDto, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // listUsers()
  // --------------------------------------------------------------------------

  describe('listUsers()', () => {
    const baseQuery: ListUsersQueryDto = { page: 1, pageSize: 20 };

    it('SUCCESS: returns { outcome: "SUCCESS", users, total, page, pageSize }', async () => {
      mockPrisma.user.findMany.mockResolvedValue([makeUserRow()]);
      mockPrisma.user.count.mockResolvedValue(1);

      const result = await service.listUsers(TENANT_ID, baseQuery);

      expect(result.outcome).toBe('SUCCESS');
      expect((result as { outcome: 'SUCCESS'; users: UserRecord[]; total: number }).users).toHaveLength(1);
      expect((result as { outcome: 'SUCCESS'; users: UserRecord[]; total: number }).total).toBe(1);
    });

    it('SUCCESS: default page=1 and pageSize=20 when query fields are undefined', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      const result = await service.listUsers(TENANT_ID, {});

      expect((result as { outcome: 'SUCCESS'; page: number; pageSize: number }).page).toBe(1);
      expect((result as { outcome: 'SUCCESS'; page: number; pageSize: number }).pageSize).toBe(20);
    });

    it('SUCCESS: status filter is applied to the Prisma where clause', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.listUsers(TENANT_ID, { ...baseQuery, status: 'ACTIVE' });

      const whereArg = mockPrisma.user.findMany.mock.calls[0]![0].where as Record<string, unknown>;
      expect(whereArg['status']).toBe('ACTIVE');
    });

    it('SUCCESS: search filter creates OR condition on email, firstName, lastName', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.listUsers(TENANT_ID, { ...baseQuery, search: 'jane' });

      const whereArg = mockPrisma.user.findMany.mock.calls[0]![0].where as Record<string, unknown>;
      expect(whereArg['OR']).toBeDefined();
      expect((whereArg['OR'] as unknown[]).length).toBe(3);
    });

    it('SUCCESS: users are mapped through toUserRecord — each has roles as string array', async () => {
      mockPrisma.user.findMany.mockResolvedValue([makeUserRow()]);
      mockPrisma.user.count.mockResolvedValue(1);

      const result = await service.listUsers(TENANT_ID, baseQuery);

      const users = (result as { outcome: 'SUCCESS'; users: UserRecord[] }).users;
      expect(users[0]!.roles).toEqual(['System Administrator']);
    });

    it('SUCCESS: skip is (page - 1) * pageSize', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.listUsers(TENANT_ID, { page: 3, pageSize: 10 });

      const findManyArgs = mockPrisma.user.findMany.mock.calls[0]![0] as { skip: number };
      expect(findManyArgs.skip).toBe(20); // (3 - 1) * 10
    });

    it('INTERNAL_ERROR: Promise.all rejection returns { outcome: "INTERNAL_ERROR" }', async () => {
      mockPrisma.user.findMany.mockRejectedValue(new Error('DB error'));

      const result = await service.listUsers(TENANT_ID, baseQuery);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // getUserById()
  // --------------------------------------------------------------------------

  describe('getUserById()', () => {
    it('SUCCESS: returns { outcome: "SUCCESS", user: UserRecord }', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeUserRow());

      const result = await service.getUserById(USER_ID, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      expect((result as { outcome: 'SUCCESS'; user: UserRecord }).user).toBeDefined();
    });

    it('SUCCESS: tenantId is included in the Prisma findFirst where clause (SEC-003)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeUserRow());

      await service.getUserById(USER_ID, TENANT_ID);

      const whereArg = mockPrisma.user.findFirst.mock.calls[0]![0].where as Record<string, unknown>;
      expect(whereArg['tenantId']).toBe(TENANT_ID);
      expect(whereArg['id']).toBe(USER_ID);
    });

    it('NOT_FOUND: findFirst returns null (user absent) returns { outcome: "NOT_FOUND" }', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const result = await service.getUserById(USER_ID, TENANT_ID);

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('NOT_FOUND: cross-tenant lookup returns null — same NOT_FOUND outcome (no enumeration)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const result = await service.getUserById(USER_ID, 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz');

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('INTERNAL_ERROR: findFirst throws returns { outcome: "INTERNAL_ERROR" }', async () => {
      mockPrisma.user.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await service.getUserById(USER_ID, TENANT_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });
});
