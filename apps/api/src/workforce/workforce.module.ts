// Reference: spec/01_requirements.md — FR-100 Position Management
// Reference: spec/10_backend_architecture.md — Module Organization
// Reference: directives/02_position_management_rules.md — POS-AUTH-001 through POS-AUTH-005
//
// WorkforceModule is not @Global() — domain service module, not a cross-cutting infrastructure provider.
// PrismaService and AuditService resolve from the global scope (@Global() providers).
// IdentityModule is imported to expose JwtAuthGuard and RolesGuard to PositionController's guard chain.
// RolesGuard requires Reflector via DI — resolved through IdentityModule's provider scope,
// matching the same pattern established in UsersModule and OrganizationModule.
//
// No exports: PositionService has no consumers outside this module in Phase 1.
// Export added when a domain module requires position lookup (e.g., vacancy planning).
import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module';
import { PositionController } from './position.controller';
import { PositionService } from './position.service';

@Module({
  imports: [IdentityModule],
  controllers: [PositionController],
  providers: [PositionService],
})
export class WorkforceModule {}
