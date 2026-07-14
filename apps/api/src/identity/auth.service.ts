import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

// Reference: spec/06_api_contracts.md — POST /api/v1/auth/login, POST /api/v1/auth/logout
// Reference: spec/07_security_architecture.md — JWT Architecture, Authentication Flow
// Reference: directives/08_audit_rules.md — AUD-200 through AUD-210 (Authentication audit events)
// Reference: PROGRESS.md — Step 4 IdentityValidationResult contract (authoritative)
// Reference: PROGRESS.md — Step 2 Lockout Contract
//
// AuthService is transport-agnostic: no HTTP exceptions thrown, no HTTP responses returned.
// HTTP status mapping is the sole responsibility of AuthController (Step 7).
// AuthService may be invoked from any transport layer without modification.

import { AuditService, SYSTEM_USER_ID, SYSTEM_TENANT_ID } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import { IdentityService } from './identity.service';
import { JWT_ACCESS_EXPIRES_IN_SECONDS } from './identity.constants';

export interface JwtPayload {
  sub: string;        // user.id — standard JWT subject claim
  tenantId: string;   // user.tenantId — enforces tenant isolation at every protected request
  email: string;      // included for convenience in JwtStrategy and GET /auth/me
  firstName: string;  // GD-M28-1 D2: included for UserIdentityChip display
  lastName: string;   // GD-M28-1 D2: included for UserIdentityChip display
  roles: string[];    // role names — permission loading deferred to Phase 2 RBAC guard
}

// Structured result returned to AuthController.
// AuthController maps outcomes to HTTP responses — AuthService has no knowledge of HTTP.
export type LoginResult =
  | { outcome: 'SUCCESS'; accessToken: string; expiresIn: number }
  | { outcome: 'UNAUTHORIZED' }
  | { outcome: 'INTERNAL_ERROR' };

@Injectable()
export class AuthService {
  constructor(
    private readonly identityService: IdentityService,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const result = await this.identityService.validateCredentials(email, password);

    switch (result.outcome) {
      case 'SUCCESS': {
        const payload: JwtPayload = {
          sub: result.user.id,
          tenantId: result.user.tenantId,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          roles: result.user.userRoles.map((ur) => ur.role.name),
        };
        const accessToken = this.jwtService.sign(payload);

        await this.auditService.logEvent({
          tenantId: result.user.tenantId,
          userId: result.user.id,
          action: AuditEventType.AUTH_LOGIN_SUCCESS,
          result: 'SUCCESS',
        });

        return { outcome: 'SUCCESS', accessToken, expiresIn: JWT_ACCESS_EXPIRES_IN_SECONDS };
      }

      case 'EMAIL_NOT_FOUND': {
        // No user record exists — userId and tenantId are both indeterminate.
        // SYSTEM_USER_ID and SYSTEM_TENANT_ID (zero UUID sentinels) preserve AUD-100
        // required-field contract without making tenantId nullable in the schema.
        await this.auditService.logEvent({
          tenantId: SYSTEM_TENANT_ID,
          userId: SYSTEM_USER_ID,
          action: AuditEventType.AUTH_LOGIN_FAILURE,
          result: 'FAILURE',
        });
        return { outcome: 'UNAUTHORIZED' };
      }

      case 'ACCOUNT_LOCKED': {
        await this.auditService.logEvent({
          tenantId: result.tenantId,
          userId: result.userId,
          action: AuditEventType.AUTH_LOGIN_FAILURE,
          result: 'FAILURE',
        });
        return { outcome: 'UNAUTHORIZED' };
      }

      case 'INVALID_PASSWORD': {
        await this.auditService.logEvent({
          tenantId: result.tenantId,
          userId: result.userId,
          action: AuditEventType.AUTH_LOGIN_FAILURE,
          result: 'FAILURE',
        });

        if (result.isNowLocked) {
          // Step 2 contract: 5th consecutive failure sets lockedUntil = NOW() + 15min.
          // AUTH_LOGIN_FAILURE emitted first (the immediate failure),
          // then AUTH_ACCOUNT_LOCKOUT (the state transition). Both are non-blocking (AUD-1300).
          await this.auditService.logEvent({
            tenantId: result.tenantId,
            userId: result.userId,
            action: AuditEventType.AUTH_ACCOUNT_LOCKOUT,
            result: 'FAILURE',
          });
        }

        return { outcome: 'UNAUTHORIZED' };
      }

      case 'TENANT_COLLISION': {
        // IdentityService already logged the error (no PII).
        // No audit event — no valid userId or tenantId to attach to the record.
        return { outcome: 'INTERNAL_ERROR' };
      }
    }
  }

  async logout(userId: string, tenantId: string): Promise<void> {
    // Phase 1 stateless logout: audit event written; frontend destroys the token.
    // No server-side token revocation or blocklist.
    // Phase 2: add refresh token invalidation or short-lived token blocklist.
    await this.auditService.logEvent({
      tenantId,
      userId,
      action: AuditEventType.AUTH_LOGOUT,
      result: 'SUCCESS',
    });
  }
}
