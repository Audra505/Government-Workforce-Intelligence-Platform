// Reference: spec/01_requirements.md — FR-001 User Registration
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation, Password Rules
// Reference: directives/08_audit_rules.md — AUD-250 (User Created), AUD-300 (Role Assigned)
//
// UsersService is transport-agnostic: no HTTP exceptions thrown, no HTTP responses returned.
// HTTP status mapping is the sole responsibility of UsersController.
//
// tenantId is never derived from the DTO — only from the caller-supplied JWT context (SEC-003).
// actorUserId is the authenticated administrator performing the creation.
//
// Phase 1 decision: user is created with status 'ACTIVE' (Decision 2, Option B).
// The Prisma model default is 'INVITED'; this is explicitly overridden at creation time.

import { Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import { BCRYPT_ROUNDS } from '../identity/identity.constants';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

// Shared intermediate user shape — produced by all three service methods.
// Excludes: passwordHash, tenantId (implicit from auth context), failedLoginAttempts,
// lockedUntil, deletedAt (soft-delete implementation detail).
export type UserRecord = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  roles: string[];
  createdAt: Date;
  lastLoginAt: Date | null;
};

// Milestone 6 Step 5 — CreateUserResult SUCCESS extended from Step 3 approved shape.
// Changed from { userId, email, roles } to { user: UserRecord } to avoid a second
// DB round-trip in UsersController. No consumers existed at the time of this change.
export type CreateUserResult =
  | { outcome: 'SUCCESS'; user: UserRecord }
  | { outcome: 'EMAIL_CONFLICT' }
  | { outcome: 'ROLE_NOT_FOUND'; missingIds: string[] }
  | { outcome: 'FORBIDDEN_ROLE_ASSIGNMENT'; forbiddenRoleId: string }
  | { outcome: 'INTERNAL_ERROR' };

export type GetRolesResult = { id: string; name: string }[];

export type ListUsersResult =
  | { outcome: 'SUCCESS'; users: UserRecord[]; total: number; page: number; pageSize: number }
  | { outcome: 'INTERNAL_ERROR' };

export type GetUserByIdResult =
  | { outcome: 'SUCCESS'; user: UserRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

// Helper type — matches the Prisma row shape returned by USER_READ_SELECT.
type UserRowWithRoles = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  createdAt: Date;
  lastLoginAt: Date | null;
  userRoles: Array<{ role: { name: string } }>;
};

// Shared Prisma select for read operations (listUsers, getUserById).
// createUser constructs UserRecord directly from the transaction result + foundRoles.
const USER_READ_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  status: true,
  createdAt: true,
  lastLoginAt: true,
  userRoles: {
    select: { role: { select: { name: true } } },
  },
} as const;

function toUserRecord(u: UserRowWithRoles): UserRecord {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    status: u.status,
    roles: u.userRoles.map(ur => ur.role.name),
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  };
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createUser(
    dto: CreateUserDto,
    tenantId: string,
    actorUserId: string,
    actorRoles: string[],
  ): Promise<CreateUserResult> {
    // Normalize email — DTO validates format; service enforces canonical form
    const email = dto.email.toLowerCase().trim();

    // Defensive deduplication — DTO enforces @ArrayUnique; belt-and-suspenders here
    const uniqueRoleIds = [...new Set(dto.roleIds)];

    // Validate role existence before any write operations (fail fast, avoid bcrypt cost)
    const foundRoles = await this.prisma.role.findMany({
      where: { id: { in: uniqueRoleIds } },
      select: { id: true, name: true },
    });

    if (foundRoles.length !== uniqueRoleIds.length) {
      const foundIds = new Set(foundRoles.map(r => r.id));
      const missingIds = uniqueRoleIds.filter(id => !foundIds.has(id));
      return { outcome: 'ROLE_NOT_FOUND', missingIds };
    }

    // GD-M26-1 Decision 3: HR Director may not assign System Administrator.
    // Defense-in-depth: RolesController already filters SA from HRD's selector,
    // but service enforces the same restriction for direct API calls.
    if (!actorRoles.includes('System Administrator')) {
      const sysAdminRole = foundRoles.find(r => r.name === 'System Administrator');
      if (sysAdminRole) {
        await this.auditService.logEvent({
          tenantId,
          userId: actorUserId,
          action: AuditEventType.AUTHZ_ACCESS_DENIED,
          result: 'FAILURE',
          entityType: 'ROLE',
          entityId: sysAdminRole.id,
        });
        return { outcome: 'FORBIDDEN_ROLE_ASSIGNMENT', forbiddenRoleId: sysAdminRole.id };
      }
    }

    // Hash password outside the transaction — bcrypt is CPU-bound; holding a DB
    // connection open during bcrypt work unnecessarily contends the connection pool
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    // Atomic: user creation + role assignment in a single transaction.
    // If userRole.createMany fails, user.create is rolled back — no orphaned users.
    // UserRecord is constructed from the created row + foundRoles (already validated).
    // No re-read needed: email is the normalized value; roles come from foundRoles.
    let newUser: UserRecord;
    try {
      newUser = await this.prisma.$transaction(async tx => {
        const created = await tx.user.create({
          data: {
            tenantId,
            email,
            passwordHash,
            firstName: dto.firstName,
            lastName: dto.lastName,
            status: 'ACTIVE',
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            status: true,
            createdAt: true,
            lastLoginAt: true,
          },
        });

        await tx.userRole.createMany({
          data: foundRoles.map(role => ({ userId: created.id, roleId: role.id })),
        });

        return {
          id: created.id,
          firstName: created.firstName,
          lastName: created.lastName,
          email,
          status: created.status,
          roles: foundRoles.map(r => r.name),
          createdAt: created.createdAt,
          lastLoginAt: created.lastLoginAt,
        };
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Only unique constraint on identity.users reachable by create() is
        // idx_users_tenant_email — email already exists within this tenant.
        // Future: inspect e.meta?.target if additional unique constraints are added.
        return { outcome: 'EMAIL_CONFLICT' };
      }
      this.logger.error(
        'User creation failed: transaction error',
        e instanceof Error ? e.stack : String(e),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    // Audit events emitted after transaction commit — outside the transaction per AUD-1300.
    // AuditService.logEvent() swallows its own errors; audit failure does not block this return.
    await this.auditService.logEvent({
      tenantId,
      userId: actorUserId,
      action: AuditEventType.IDENTITY_USER_CREATED,
      result: 'SUCCESS',
      entityType: 'USER',
      entityId: newUser.id,
    });

    for (const role of foundRoles) {
      await this.auditService.logEvent({
        tenantId,
        userId: actorUserId,
        action: AuditEventType.AUTHZ_ROLE_ASSIGNED,
        result: 'SUCCESS',
        entityType: 'USER',
        entityId: newUser.id,
        metadata: { roleId: role.id, roleName: role.name },
      });
    }

    return { outcome: 'SUCCESS', user: newUser };
  }

  async listUsers(
    tenantId: string,
    query: ListUsersQueryDto,
  ): Promise<ListUsersResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.UserWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    let users: UserRowWithRoles[];
    let total: number;
    try {
      [users, total] = await Promise.all([
        this.prisma.user.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: USER_READ_SELECT,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.user.count({ where }),
      ]);
    } catch (e) {
      this.logger.error(
        'listUsers failed',
        e instanceof Error ? e.stack : String(e),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    return {
      outcome: 'SUCCESS',
      users: users.map(toUserRecord),
      total,
      page,
      pageSize,
    };
  }

  async getUserById(id: string, tenantId: string): Promise<GetUserByIdResult> {
    let user: UserRowWithRoles | null;
    try {
      // findFirst with tenantId enforces SEC-003 at the DB query level.
      // A caller cannot look up a user from another tenant even with a valid UUID.
      // NOT_FOUND is returned for both "does not exist" and "exists in different tenant"
      // — identical response prevents cross-tenant user enumeration.
      user = await this.prisma.user.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: USER_READ_SELECT,
      });
    } catch (e) {
      this.logger.error(
        'getUserById failed',
        e instanceof Error ? e.stack : String(e),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (!user) {
      return { outcome: 'NOT_FOUND' };
    }

    return { outcome: 'SUCCESS', user: toUserRecord(user) };
  }

  // GD-M26-1 Decision 2: returns roles the actor may assign.
  // SA receives all 7; HRD receives 6 (System Administrator excluded).
  async getRoles(actorRoles: string[]): Promise<GetRolesResult> {
    const where = actorRoles.includes('System Administrator')
      ? {}
      : { name: { not: 'System Administrator' as const } };

    return this.prisma.role.findMany({
      where,
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
}
