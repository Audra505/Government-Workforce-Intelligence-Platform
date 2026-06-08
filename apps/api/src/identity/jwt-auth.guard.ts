import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Reference: spec/07_security_architecture.md — JWT Architecture
//
// Apply to protected routes via @UseGuards(JwtAuthGuard).
// Returns HTTP 401 when the Authorization: Bearer token is absent, malformed, or expired.
// On success, attaches RequestUser to req.user (populated by JwtStrategy.validate()).
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
