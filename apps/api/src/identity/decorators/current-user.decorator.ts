import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { RequestUser } from '../jwt.strategy';

// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
//
// Extracts the authenticated RequestUser from req.user, populated by JwtStrategy.validate().
// Use on protected route handlers instead of @Req() to avoid coupling handlers to the
// raw Express request type.
// Only valid on routes guarded by JwtAuthGuard — req.user is undefined otherwise.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest<{ user: RequestUser }>();
    return request.user;
  },
);
