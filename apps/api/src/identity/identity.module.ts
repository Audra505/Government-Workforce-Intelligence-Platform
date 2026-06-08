import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthService } from './auth.service';
import { JWT_ACCESS_EXPIRES_IN_SECONDS } from './identity.constants';
import { IdentityService } from './identity.service';

// Reference: spec/10_backend_architecture.md — Identity Module (D-001)
// Reference: spec/07_security_architecture.md — Authentication Architecture, JWT Architecture
//
// Not @Global() — domain service module, not a cross-cutting infrastructure provider.
// PrismaService and AuditService resolve from the global scope (@Global() providers).
// ConfigService resolves from the global ConfigModule.
//
// Steps adding to this module:
//   Step 4: IdentityService
//   Step 5 (this update): AuthService, PassportModule, JwtModule
//   Step 6: JwtStrategy, JwtAuthGuard
//   Step 7: AuthController

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        // JWT_ACCESS_EXPIRES_IN_SECONDS is the single source of truth for token lifetime.
        // jsonwebtoken interprets a raw integer as seconds.
        // AuthService login response expiresIn consumes the same constant.
        signOptions: { expiresIn: JWT_ACCESS_EXPIRES_IN_SECONDS },
      }),
    }),
  ],
  providers: [IdentityService, AuthService],
  exports: [IdentityService, AuthService],
})
export class IdentityModule {}
