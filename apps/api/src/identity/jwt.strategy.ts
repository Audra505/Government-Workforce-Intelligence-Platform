import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { JwtPayload } from './auth.service';

// Reference: spec/07_security_architecture.md — JWT Architecture, SEC-003 Tenant Isolation
// Reference: spec/10_backend_architecture.md — Identity Module (D-001)
//
// The object attached to req.user on every successfully authenticated request.
// tenantId is derived exclusively from the JWT payload — never from request body,
// query parameters, or path parameters (SEC-003: tenant isolation contract).
export interface RequestUser {
  userId: string;
  tenantId: string;
  email: string;
  roles: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // env.validation.ts aborts startup if JWT_SECRET is absent — non-null assertion is safe.
      secretOrKey: config.get<string>('JWT_SECRET')!,
    });
  }

  // validate() is called by passport-jwt after signature and expiry verification pass.
  // No database call — JWT payload is self-contained for Phase 1.
  // Phase 2: add permission loading here if per-request RBAC enforcement requires it.
  validate(payload: JwtPayload): RequestUser {
    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      email: payload.email,
      roles: payload.roles,
    };
  }
}
