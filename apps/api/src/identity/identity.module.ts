import { Module } from '@nestjs/common';

import { IdentityService } from './identity.service';

// Reference: spec/10_backend_architecture.md — Identity Module (D-001)
// Reference: spec/07_security_architecture.md — Authentication Architecture
//
// Not @Global() — IdentityService is a domain service, not a cross-cutting
// infrastructure provider. PrismaService resolves from the global scope
// (PrismaModule is @Global() in AppModule). Same resolution pattern as AuditModule.
//
// Steps adding to this module:
//   Step 4 (this file): IdentityService
//   Step 5: AuthService
//   Step 6: JwtStrategy, JwtAuthGuard, PassportModule, JwtModule
//   Step 7: AuthController

@Module({
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
