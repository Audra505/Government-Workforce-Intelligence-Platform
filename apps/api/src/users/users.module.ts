// Reference: spec/01_requirements.md — FR-001 User Registration, FR-003 Role-Based Authorization
// Reference: spec/10_backend_architecture.md — Module Organization
//
// UsersModule is not @Global() — domain service module, not a cross-cutting infrastructure provider.
// PrismaService and AuditService resolve from the global scope (@Global() providers).
// IdentityModule is imported to expose JwtAuthGuard and RolesGuard to UsersController's guard chain.
// RolesGuard requires Reflector via DI — it must be resolved through IdentityModule's provider scope,
// not instantiated directly, for constructor injection to work.
//
// No exports: UsersService has no consumers outside this module in Phase 1.
// Export added when a domain module that requires user lookup is implemented.
import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [IdentityModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
