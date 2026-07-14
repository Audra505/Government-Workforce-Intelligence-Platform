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
import { type UpdateUserDto } from './dto/update-user.dto';

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
    user: { create: jest.Mock; update: jest.Mock };
    userRole: { createMany: jest.Mock; deleteMany: jest.Mock; count: jest.Mock };
  };
  let mockAuditService: { logEvent: jest.Mock };

  beforeEach(async () => {
    mockTx = {
      user: {
        create: jest.fn().mockResolvedValue(createdRow),
        update: jest.fn().mockResolvedValue(undefined),
      },
      userRole: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue(undefined),
        count: jest.fn().mockResolvedValue(1), // default: 1 remaining SA (guard passes)
      },
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

      const result = await service.createUser(createDto, TENANT_ID, ACTOR_ID, ['System Administrator']);

      expect(result.outcome).toBe('SUCCESS');
      expect((result as { outcome: 'SUCCESS'; user: UserRecord }).user).toBeDefined();
    });

    it('SUCCESS: UserRecord.status is "ACTIVE" (Decision 2, Option B)', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      const result = await service.createUser(createDto, TENANT_ID, ACTOR_ID, ['System Administrator']);

      expect((result as { outcome: 'SUCCESS'; user: UserRecord }).user.status).toBe('ACTIVE');
    });

    it('SUCCESS: UserRecord.roles contains assigned role names', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      const result = await service.createUser(createDto, TENANT_ID, ACTOR_ID, ['System Administrator']);

      expect((result as { outcome: 'SUCCESS'; user: UserRecord }).user.roles).toEqual(['System Administrator']);
    });

    it('SUCCESS: UserRecord.lastLoginAt is null for a newly created user', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      const result = await service.createUser(createDto, TENANT_ID, ACTOR_ID, ['System Administrator']);

      expect((result as { outcome: 'SUCCESS'; user: UserRecord }).user.lastLoginAt).toBeNull();
    });

    it('SUCCESS: UserRecord.createdAt is a Date', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      const result = await service.createUser(createDto, TENANT_ID, ACTOR_ID, ['System Administrator']);

      expect((result as { outcome: 'SUCCESS'; user: UserRecord }).user.createdAt).toBeInstanceOf(Date);
    });

    it('SUCCESS: email is normalized to lowercase and trimmed before DB operations', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      await service.createUser({ ...createDto, email: '  Jane.Smith@AGENCY.GOV  ' }, TENANT_ID, ACTOR_ID, ['System Administrator']);

      const createCall = mockTx.user.create.mock.calls[0]![0] as { data: { email: string } };
      expect(createCall.data.email).toBe('jane.smith@agency.gov');
    });

    it('SUCCESS: bcrypt.hash is called with BCRYPT_ROUNDS (12)', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      await service.createUser(createDto, TENANT_ID, ACTOR_ID, ['System Administrator']);

      expect(mockedBcryptHash).toHaveBeenCalledWith(createDto.password, BCRYPT_ROUNDS);
    });

    it('SUCCESS: role validation runs before bcrypt.hash (bcrypt not called when roles are missing)', async () => {
      mockPrisma.role.findMany.mockResolvedValue([]); // all roles missing

      await service.createUser(createDto, TENANT_ID, ACTOR_ID, ['System Administrator']);

      expect(mockedBcryptHash).not.toHaveBeenCalled();
    });

    it('SUCCESS: IDENTITY_USER_CREATED audit event emitted after transaction', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      await service.createUser(createDto, TENANT_ID, ACTOR_ID, ['System Administrator']);

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

      await service.createUser({ ...createDto, roleIds: [ROLE_ID_1, ROLE_ID_2] }, TENANT_ID, ACTOR_ID, ['System Administrator']);

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

      const result = await service.createUser(createDto, TENANT_ID, ACTOR_ID, ['System Administrator']);

      expect(result.outcome).toBe('EMAIL_CONFLICT');
    });

    it('EMAIL_CONFLICT: no audit events emitted', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);
      const p2002 = new Prisma.PrismaClientKnownRequestError('unique constraint', {
        code: 'P2002',
        clientVersion: '5.0.0',
      });
      mockPrisma.$transaction.mockRejectedValue(p2002);

      await service.createUser(createDto, TENANT_ID, ACTOR_ID, ['System Administrator']);

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('ROLE_NOT_FOUND: absent role UUID returns { outcome: "ROLE_NOT_FOUND", missingIds: [id] }', async () => {
      mockPrisma.role.findMany.mockResolvedValue([]); // none found

      const result = await service.createUser(createDto, TENANT_ID, ACTOR_ID, ['System Administrator']);

      expect(result.outcome).toBe('ROLE_NOT_FOUND');
      expect((result as { outcome: 'ROLE_NOT_FOUND'; missingIds: string[] }).missingIds).toContain(ROLE_ID_1);
    });

    it('ROLE_NOT_FOUND: no audit events emitted', async () => {
      mockPrisma.role.findMany.mockResolvedValue([]);

      await service.createUser(createDto, TENANT_ID, ACTOR_ID, ['System Administrator']);

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('INTERNAL_ERROR: non-P2002 transaction error returns { outcome: "INTERNAL_ERROR" }', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);
      mockPrisma.$transaction.mockRejectedValue(new Error('connection lost'));

      const result = await service.createUser(createDto, TENANT_ID, ACTOR_ID, ['System Administrator']);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    // GD-M26-1 Decision 3 — Assignable role enforcement
    it('FORBIDDEN_ROLE_ASSIGNMENT: HRD actor + System Administrator roleId returns { outcome: "FORBIDDEN_ROLE_ASSIGNMENT" }', async () => {
      // foundRole1 has name 'System Administrator'
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      const result = await service.createUser(createDto, TENANT_ID, ACTOR_ID, ['HR Director']);

      expect(result.outcome).toBe('FORBIDDEN_ROLE_ASSIGNMENT');
      expect((result as { outcome: 'FORBIDDEN_ROLE_ASSIGNMENT'; forbiddenRoleId: string }).forbiddenRoleId)
        .toBe(ROLE_ID_1);
    });

    it('FORBIDDEN_ROLE_ASSIGNMENT: HRD actor — AUTHZ_ACCESS_DENIED audit event emitted', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      await service.createUser(createDto, TENANT_ID, ACTOR_ID, ['HR Director']);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.AUTHZ_ACCESS_DENIED,
          result: 'FAILURE',
          entityType: 'ROLE',
          entityId: ROLE_ID_1,
        }),
      );
    });

    it('FORBIDDEN_ROLE_ASSIGNMENT: no transaction runs when assignment is forbidden', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      await service.createUser(createDto, TENANT_ID, ACTOR_ID, ['HR Director']);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('SA actor + System Administrator roleId → SUCCESS (SA may assign any role)', async () => {
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      const result = await service.createUser(createDto, TENANT_ID, ACTOR_ID, ['System Administrator']);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('HRD actor + non-SA roleId → SUCCESS (allowed roles pass through)', async () => {
      const hrDirectorRole = { id: ROLE_ID_2, name: 'HR Director' };
      mockPrisma.role.findMany.mockResolvedValue([hrDirectorRole]);

      const result = await service.createUser(
        { ...createDto, roleIds: [ROLE_ID_2] },
        TENANT_ID,
        ACTOR_ID,
        ['HR Director'],
      );

      expect(result.outcome).toBe('SUCCESS');
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

  // --------------------------------------------------------------------------
  // getRoles()
  // GD-M26-1 Decision 2 — Roles endpoint, filtered by actor authorization level
  // --------------------------------------------------------------------------

  describe('getRoles()', () => {
    const mockAllRoles = [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Compliance Officer' },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Executive User' },
      { id: '33333333-3333-4333-8333-333333333333', name: 'Hiring Manager' },
      { id: '44444444-4444-4444-8444-444444444444', name: 'HR Director' },
      { id: '55555555-5555-4555-8555-555555555555', name: 'Recruiter' },
      { id: '66666666-6666-4666-8666-666666666666', name: 'System Administrator' },
      { id: '77777777-7777-4777-8777-777777777777', name: 'Workforce Planner' },
    ];

    const mockSixRoles = mockAllRoles.filter(r => r.name !== 'System Administrator');

    it('SA actor — calls prisma.role.findMany with no name filter', async () => {
      mockPrisma.role.findMany.mockResolvedValue(mockAllRoles);

      await service.getRoles(['System Administrator']);

      const callArgs = mockPrisma.role.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
      expect(callArgs.where).toEqual({});
    });

    it('SA actor — returns all 7 roles as returned by prisma', async () => {
      mockPrisma.role.findMany.mockResolvedValue(mockAllRoles);

      const result = await service.getRoles(['System Administrator']);

      expect(result).toEqual(mockAllRoles);
      expect(result).toHaveLength(7);
    });

    it('HRD actor — calls prisma.role.findMany with name NOT System Administrator filter', async () => {
      mockPrisma.role.findMany.mockResolvedValue(mockSixRoles);

      await service.getRoles(['HR Director']);

      const callArgs = mockPrisma.role.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
      expect(callArgs.where).toEqual({ name: { not: 'System Administrator' } });
    });

    it('HRD actor — returns 6 roles without System Administrator', async () => {
      mockPrisma.role.findMany.mockResolvedValue(mockSixRoles);

      const result = await service.getRoles(['HR Director']);

      expect(result).toHaveLength(6);
      expect(result.find(r => r.name === 'System Administrator')).toBeUndefined();
    });

    it('orderBy: { name: "asc" } is passed in all cases', async () => {
      mockPrisma.role.findMany.mockResolvedValue(mockAllRoles);

      await service.getRoles(['System Administrator']);

      const callArgs = mockPrisma.role.findMany.mock.calls[0]![0] as { orderBy: Record<string, unknown> };
      expect(callArgs.orderBy).toEqual({ name: 'asc' });
    });

    it('select: { id: true, name: true } is passed in all cases', async () => {
      mockPrisma.role.findMany.mockResolvedValue(mockAllRoles);

      await service.getRoles(['System Administrator']);

      const callArgs = mockPrisma.role.findMany.mock.calls[0]![0] as { select: Record<string, unknown> };
      expect(callArgs.select).toEqual({ id: true, name: true });
    });
  });

  // --------------------------------------------------------------------------
  // updateUser()
  // GD-M27-1 Decisions 3–8
  // --------------------------------------------------------------------------

  // Helper: target user row with role IDs (extended shape required by updateUser).
  // Default is an ACTIVE System Administrator — override via the overrides param.
  function makeTargetRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: USER_ID,
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane.smith@agency.gov',
      status: 'ACTIVE',
      createdAt: CREATED_AT,
      lastLoginAt: null,
      userRoles: [{ role: { id: ROLE_ID_1, name: 'System Administrator' } }],
      ...overrides,
    };
  }

  const SA_ACTOR_ROLES = ['System Administrator'];
  const HRD_ACTOR_ROLES = ['HR Director'];
  const NON_SA_TARGET_ROLES = [{ role: { id: ROLE_ID_2, name: 'HR Director' } }];

  describe('updateUser()', () => {
    // ---- No meaningful change ----

    it('NO_MEANINGFUL_CHANGE: empty dto returns { outcome: "NO_MEANINGFUL_CHANGE" }', async () => {
      const result = await service.updateUser(USER_ID, {} as UpdateUserDto, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);
      expect(result.outcome).toBe('NO_MEANINGFUL_CHANGE');
    });

    it('NO_MEANINGFUL_CHANGE: prisma is never called when DTO is empty', async () => {
      await service.updateUser(USER_ID, {} as UpdateUserDto, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });

    // ---- NOT_FOUND ----

    it('NOT_FOUND: user absent returns { outcome: "NOT_FOUND" }', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      const result = await service.updateUser(USER_ID, { firstName: 'New' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);
      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('NOT_FOUND: cross-tenant ID returns null → NOT_FOUND (no enumeration)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      const result = await service.updateUser(USER_ID, { firstName: 'New' }, 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz', ACTOR_ID, SA_ACTOR_ROLES);
      expect(result.outcome).toBe('NOT_FOUND');
    });

    // ---- Field updates ----

    it('SUCCESS: firstName update returns { outcome: "SUCCESS" } with updated firstName', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow());

      const result = await service.updateUser(USER_ID, { firstName: 'Updated' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(result.outcome).toBe('SUCCESS');
      expect((result as { outcome: 'SUCCESS'; user: UserRecord }).user.firstName).toBe('Updated');
    });

    it('SUCCESS: lastName update — user.update is called with { lastName }', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow());

      await service.updateUser(USER_ID, { lastName: 'NewLast' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      const updateCall = mockTx.user.update.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(updateCall.data['lastName']).toBe('NewLast');
    });

    it('SUCCESS: email is normalized to lowercase and trimmed before write', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow());

      await service.updateUser(USER_ID, { email: '  Jane.Smith@AGENCY.GOV  ' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      const updateCall = mockTx.user.update.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(updateCall.data['email']).toBe('jane.smith@agency.gov');
    });

    it('SUCCESS: IDENTITY_USER_UPDATED audit event emitted when field changes', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({ firstName: 'Old' }));

      await service.updateUser(USER_ID, { firstName: 'New' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.IDENTITY_USER_UPDATED }),
      );
    });

    it('SUCCESS: no IDENTITY_USER_UPDATED when provided email equals current email', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({ email: 'jane.smith@agency.gov' }));

      await service.updateUser(USER_ID, { email: 'JANE.SMITH@AGENCY.GOV' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      const fieldAudit = mockAuditService.logEvent.mock.calls.filter(
        (c: unknown[]) => (c[0] as { action: string }).action === AuditEventType.IDENTITY_USER_UPDATED,
      );
      expect(fieldAudit.length).toBe(0);
    });

    // ---- Email conflict ----

    it('EMAIL_CONFLICT: P2002 in transaction returns { outcome: "EMAIL_CONFLICT" }', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow());
      const p2002 = new Prisma.PrismaClientKnownRequestError('unique constraint', {
        code: 'P2002',
        clientVersion: '5.0.0',
      });
      mockPrisma.$transaction.mockRejectedValue(p2002);

      const result = await service.updateUser(USER_ID, { email: 'conflict@test.gov' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(result.outcome).toBe('EMAIL_CONFLICT');
    });

    // ---- Status transitions ----

    it('SUCCESS: ACTIVE → SUSPENDED returns SUCCESS with SUSPENDED status', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({
        status: 'ACTIVE',
        userRoles: NON_SA_TARGET_ROLES,
      }));

      const result = await service.updateUser(USER_ID, { status: 'SUSPENDED' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(result.outcome).toBe('SUCCESS');
      expect((result as { outcome: 'SUCCESS'; user: UserRecord }).user.status).toBe('SUSPENDED');
    });

    it('SUCCESS: ACTIVE → DEACTIVATED returns DEACTIVATED status', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({
        status: 'ACTIVE',
        userRoles: NON_SA_TARGET_ROLES,
      }));

      const result = await service.updateUser(USER_ID, { status: 'DEACTIVATED' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(result.outcome).toBe('SUCCESS');
      expect((result as { outcome: 'SUCCESS'; user: UserRecord }).user.status).toBe('DEACTIVATED');
    });

    it('SUCCESS: SUSPENDED → ACTIVE returns ACTIVE status', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({
        status: 'SUSPENDED',
        userRoles: NON_SA_TARGET_ROLES,
      }));

      const result = await service.updateUser(USER_ID, { status: 'ACTIVE' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(result.outcome).toBe('SUCCESS');
      expect((result as { outcome: 'SUCCESS'; user: UserRecord }).user.status).toBe('ACTIVE');
    });

    it('SUCCESS: SUSPENDED → DEACTIVATED returns DEACTIVATED status', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({
        status: 'SUSPENDED',
        userRoles: NON_SA_TARGET_ROLES,
      }));

      const result = await service.updateUser(USER_ID, { status: 'DEACTIVATED' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('SUCCESS: DEACTIVATED → ACTIVE returns ACTIVE status', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({
        status: 'DEACTIVATED',
        userRoles: NON_SA_TARGET_ROLES,
      }));

      const result = await service.updateUser(USER_ID, { status: 'ACTIVE' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('INVALID_STATUS_TRANSITION: INVITED → SUSPENDED returns INVALID_STATUS_TRANSITION', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({
        status: 'INVITED',
        userRoles: NON_SA_TARGET_ROLES,
      }));

      const result = await service.updateUser(USER_ID, { status: 'SUSPENDED' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(result.outcome).toBe('INVALID_STATUS_TRANSITION');
      expect((result as { outcome: 'INVALID_STATUS_TRANSITION'; from: string; to: string }).from).toBe('INVITED');
    });

    it('INVALID_STATUS_TRANSITION: INVITED → DEACTIVATED returns INVALID_STATUS_TRANSITION', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({
        status: 'INVITED',
        userRoles: NON_SA_TARGET_ROLES,
      }));

      const result = await service.updateUser(USER_ID, { status: 'DEACTIVATED' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(result.outcome).toBe('INVALID_STATUS_TRANSITION');
    });

    it('INVALID_STATUS_TRANSITION: DEACTIVATED → SUSPENDED returns INVALID_STATUS_TRANSITION', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({
        status: 'DEACTIVATED',
        userRoles: NON_SA_TARGET_ROLES,
      }));

      const result = await service.updateUser(USER_ID, { status: 'SUSPENDED' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(result.outcome).toBe('INVALID_STATUS_TRANSITION');
      expect((result as { outcome: 'INVALID_STATUS_TRANSITION'; from: string }).from).toBe('DEACTIVATED');
    });

    it('SUCCESS: same-status send is treated as no-op — update not called for status field', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({
        status: 'ACTIVE',
        userRoles: NON_SA_TARGET_ROLES,
      }));

      // Also send a different field so the request is not NO_MEANINGFUL_CHANGE
      await service.updateUser(USER_ID, { status: 'ACTIVE', firstName: 'Same' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      const updateCall = mockTx.user.update.mock.calls[0]?.[0] as { data: Record<string, unknown> } | undefined;
      // status should NOT be in updateData when it equals currentStatus
      expect(updateCall?.data['status']).toBeUndefined();
    });

    // ---- Status audit events ----

    it('IDENTITY_USER_SUSPENDED emitted when status transitions to SUSPENDED', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({
        status: 'ACTIVE',
        userRoles: NON_SA_TARGET_ROLES,
      }));

      await service.updateUser(USER_ID, { status: 'SUSPENDED' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.IDENTITY_USER_SUSPENDED }),
      );
    });

    it('IDENTITY_USER_DEACTIVATED emitted when status transitions to DEACTIVATED', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({
        status: 'ACTIVE',
        userRoles: NON_SA_TARGET_ROLES,
      }));

      await service.updateUser(USER_ID, { status: 'DEACTIVATED' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.IDENTITY_USER_DEACTIVATED }),
      );
    });

    it('IDENTITY_USER_REACTIVATED emitted when status transitions to ACTIVE from SUSPENDED', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({
        status: 'SUSPENDED',
        userRoles: NON_SA_TARGET_ROLES,
      }));

      await service.updateUser(USER_ID, { status: 'ACTIVE' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.IDENTITY_USER_REACTIVATED }),
      );
    });

    // ---- Last-SA guard ----

    it('LAST_SYSTEM_ADMINISTRATOR: SA target + status → SUSPENDED + 0 remaining active SAs', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({ status: 'ACTIVE' })); // SA user
      mockTx.userRole.count.mockResolvedValue(0);

      const result = await service.updateUser(USER_ID, { status: 'SUSPENDED' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(result.outcome).toBe('LAST_SYSTEM_ADMINISTRATOR');
    });

    it('LAST_SYSTEM_ADMINISTRATOR: SA target + status → DEACTIVATED + 0 remaining active SAs', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({ status: 'ACTIVE' }));
      mockTx.userRole.count.mockResolvedValue(0);

      const result = await service.updateUser(USER_ID, { status: 'DEACTIVATED' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(result.outcome).toBe('LAST_SYSTEM_ADMINISTRATOR');
    });

    it('SUCCESS: SA target + status → SUSPENDED + 1 remaining active SA — guard passes', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({ status: 'ACTIVE' }));
      mockTx.userRole.count.mockResolvedValue(1);

      const result = await service.updateUser(USER_ID, { status: 'SUSPENDED' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('LAST_SYSTEM_ADMINISTRATOR: SA target + role removal removes SA + 0 remaining active SAs', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({ status: 'ACTIVE' }));
      mockPrisma.role.findMany.mockResolvedValue([foundRole2]); // new roles: no SA
      mockTx.userRole.count.mockResolvedValue(0);

      const result = await service.updateUser(USER_ID, { roleIds: [ROLE_ID_2] }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(result.outcome).toBe('LAST_SYSTEM_ADMINISTRATOR');
    });

    it('SUCCESS: SA target + role removal + 1 remaining active SA — guard passes', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({ status: 'ACTIVE' }));
      mockPrisma.role.findMany.mockResolvedValue([foundRole2]);
      mockTx.userRole.count.mockResolvedValue(1);

      const result = await service.updateUser(USER_ID, { roleIds: [ROLE_ID_2] }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('no Last-SA guard check for non-SA target user + status → DEACTIVATED', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({
        status: 'ACTIVE',
        userRoles: NON_SA_TARGET_ROLES,
      }));

      await service.updateUser(USER_ID, { status: 'DEACTIVATED' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(mockTx.userRole.count).not.toHaveBeenCalled();
    });

    // ---- HRD authority boundary ----

    it('FORBIDDEN_USER_MANAGEMENT: HRD actor + SA target returns { outcome: "FORBIDDEN_USER_MANAGEMENT" }', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow()); // default: SA target

      const result = await service.updateUser(USER_ID, { firstName: 'Attempt' }, TENANT_ID, ACTOR_ID, HRD_ACTOR_ROLES);

      expect(result.outcome).toBe('FORBIDDEN_USER_MANAGEMENT');
    });

    it('FORBIDDEN_USER_MANAGEMENT: AUTHZ_ACCESS_DENIED audit event emitted', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow());

      await service.updateUser(USER_ID, { firstName: 'Attempt' }, TENANT_ID, ACTOR_ID, HRD_ACTOR_ROLES);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.AUTHZ_ACCESS_DENIED,
          result: 'FAILURE',
          entityType: 'USER',
          entityId: USER_ID,
        }),
      );
    });

    it('SUCCESS: SA actor + SA target → allowed (no FORBIDDEN_USER_MANAGEMENT)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow()); // SA target
      mockTx.userRole.count.mockResolvedValue(1);

      const result = await service.updateUser(USER_ID, { firstName: 'New' }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('SUCCESS: HRD actor + non-SA target → allowed', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({ userRoles: NON_SA_TARGET_ROLES }));

      const result = await service.updateUser(USER_ID, { firstName: 'New' }, TENANT_ID, ACTOR_ID, HRD_ACTOR_ROLES);

      expect(result.outcome).toBe('SUCCESS');
    });

    // ---- Role reassignment ----

    it('ROLE_NOT_FOUND: unknown roleId returns { outcome: "ROLE_NOT_FOUND", missingIds }', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({ userRoles: NON_SA_TARGET_ROLES }));
      mockPrisma.role.findMany.mockResolvedValue([]); // none found

      const result = await service.updateUser(USER_ID, { roleIds: [ROLE_ID_1] }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(result.outcome).toBe('ROLE_NOT_FOUND');
      expect((result as { outcome: 'ROLE_NOT_FOUND'; missingIds: string[] }).missingIds).toContain(ROLE_ID_1);
    });

    it('FORBIDDEN_ROLE_ASSIGNMENT: HRD actor + SA roleId in roleIds returns FORBIDDEN_ROLE_ASSIGNMENT', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({ userRoles: NON_SA_TARGET_ROLES }));
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]); // SA role

      const result = await service.updateUser(USER_ID, { roleIds: [ROLE_ID_1] }, TENANT_ID, ACTOR_ID, HRD_ACTOR_ROLES);

      expect(result.outcome).toBe('FORBIDDEN_ROLE_ASSIGNMENT');
      expect((result as { outcome: 'FORBIDDEN_ROLE_ASSIGNMENT'; forbiddenRoleId: string }).forbiddenRoleId).toBe(ROLE_ID_1);
    });

    it('FORBIDDEN_ROLE_ASSIGNMENT: AUTHZ_ACCESS_DENIED emitted on entityType ROLE', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({ userRoles: NON_SA_TARGET_ROLES }));
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]);

      await service.updateUser(USER_ID, { roleIds: [ROLE_ID_1] }, TENANT_ID, ACTOR_ID, HRD_ACTOR_ROLES);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.AUTHZ_ACCESS_DENIED,
          result: 'FAILURE',
          entityType: 'ROLE',
          entityId: ROLE_ID_1,
        }),
      );
    });

    it('SUCCESS: SA actor replaces roles — deleteMany + createMany called in transaction', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({ userRoles: NON_SA_TARGET_ROLES }));
      mockPrisma.role.findMany.mockResolvedValue([foundRole1, foundRole2]);

      await service.updateUser(USER_ID, { roleIds: [ROLE_ID_1, ROLE_ID_2] }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect(mockTx.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
      expect(mockTx.userRole.createMany).toHaveBeenCalled();
    });

    it('SUCCESS: role replacement — updated user.roles reflects new role set', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({ userRoles: NON_SA_TARGET_ROLES }));
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]); // SA role replaces HRD

      const result = await service.updateUser(USER_ID, { roleIds: [ROLE_ID_1] }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      expect((result as { outcome: 'SUCCESS'; user: UserRecord }).user.roles).toEqual(['System Administrator']);
    });

    // ---- Role audit events ----

    it('AUTHZ_ROLE_REMOVED emitted for each role removed from user', async () => {
      // Target has SA + HRD; new roleIds has only HRD → SA is removed
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({
        userRoles: [
          { role: { id: ROLE_ID_1, name: 'System Administrator' } },
          { role: { id: ROLE_ID_2, name: 'HR Director' } },
        ],
      }));
      // New set: HRD only (SA removed)
      mockPrisma.role.findMany.mockResolvedValue([foundRole2]);
      mockTx.userRole.count.mockResolvedValue(1); // still 1 other active SA — guard passes

      await service.updateUser(USER_ID, { roleIds: [ROLE_ID_2] }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      const removedCalls = mockAuditService.logEvent.mock.calls.filter(
        (c: unknown[]) => (c[0] as { action: string }).action === AuditEventType.AUTHZ_ROLE_REMOVED,
      );
      expect(removedCalls.length).toBe(1);
      expect((removedCalls[0]![0] as { metadata: Record<string, unknown> }).metadata['roleId']).toBe(ROLE_ID_1);
    });

    it('AUTHZ_ROLE_ASSIGNED emitted for each role newly added during replacement', async () => {
      // Target has HRD only; new roleIds adds SA
      mockPrisma.user.findFirst.mockResolvedValue(makeTargetRow({ userRoles: NON_SA_TARGET_ROLES }));
      mockPrisma.role.findMany.mockResolvedValue([foundRole1]); // SA added

      await service.updateUser(USER_ID, { roleIds: [ROLE_ID_1] }, TENANT_ID, ACTOR_ID, SA_ACTOR_ROLES);

      const assignedCalls = mockAuditService.logEvent.mock.calls.filter(
        (c: unknown[]) => (c[0] as { action: string }).action === AuditEventType.AUTHZ_ROLE_ASSIGNED,
      );
      expect(assignedCalls.length).toBe(1);
      expect((assignedCalls[0]![0] as { metadata: Record<string, unknown> }).metadata['roleId']).toBe(ROLE_ID_1);
    });
  });
});
