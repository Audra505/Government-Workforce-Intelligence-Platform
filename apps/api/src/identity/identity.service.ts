import * as bcrypt from 'bcrypt';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';

// Reference: spec/07_security_architecture.md — Account Lockout (5 attempts / 15 min)
// Reference: spec/07_security_architecture.md — Tenant Isolation (tenantId from JWT only)
// Reference: PROGRESS.md — Step 2 Lockout Contract (reset on successful login only)
// Reference: PROGRESS.md — Phase 1 Limitation: global email lookup (single tenant); Phase 2 adds tenant discriminator
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// Prisma utility type — exact shape of user row with roles eagerly loaded.
// Roles are included for JWT construction in AuthService (Step 5).
// Permission loading is deferred to Phase 2 when the RBAC guard is implemented.
export type UserWithRoles = Prisma.UserGetPayload<{
  include: { userRoles: { include: { role: true } } };
}>;

// Discriminated union returned to AuthService.
// AuthService uses the outcome to select the correct audit event type(s) and HTTP response.
// AuthController maps all failure outcomes to the same HTTP 401 body (user enumeration protection).
export type IdentityValidationResult =
  | { outcome: 'SUCCESS'; user: UserWithRoles }
  | { outcome: 'EMAIL_NOT_FOUND' }
  | { outcome: 'ACCOUNT_LOCKED'; userId: string; tenantId: string }
  | { outcome: 'INVALID_PASSWORD'; userId: string; tenantId: string; isNowLocked: boolean }
  | { outcome: 'TENANT_COLLISION' };

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async validateCredentials(
    email: string,
    password: string,
  ): Promise<IdentityValidationResult> {
    const users = await this.prisma.user.findMany({
      where: { email, deletedAt: null },
      include: { userRoles: { include: { role: true } } },
    });

    if (users.length > 1) {
      // Phase 1 limitation: global email lookup. Same email in multiple tenants is a
      // configuration error that must not occur with a single tenant.
      // SEC-003: tenant isolation violation — fail loudly, no PII in log message.
      // Phase 2 resolution: scope query to tenantId once tenant discriminator is added to LoginDto.
      this.logger.error(
        `Multi-tenant email collision: action=AUTH_LOGIN_FAILURE count=${users.length}`,
      );
      return { outcome: 'TENANT_COLLISION' };
    }

    if (users.length === 0) {
      return { outcome: 'EMAIL_NOT_FOUND' };
    }

    const user = users[0]!;
    const now = new Date();

    if (user.lockedUntil !== null && user.lockedUntil > now) {
      return { outcome: 'ACCOUNT_LOCKED', userId: user.id, tenantId: user.tenantId };
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      const newCount = user.failedLoginAttempts + 1;
      const isNowLocked = newCount >= LOCKOUT_THRESHOLD;

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: newCount,
          ...(isNowLocked && { lockedUntil: new Date(now.getTime() + LOCKOUT_DURATION_MS) }),
        },
      });

      return {
        outcome: 'INVALID_PASSWORD',
        userId: user.id,
        tenantId: user.tenantId,
        isNowLocked,
      };
    }

    // Step 2 contract: successful login resets failedLoginAttempts to 0 and lockedUntil to null.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now },
    });

    return { outcome: 'SUCCESS', user };
  }
}
