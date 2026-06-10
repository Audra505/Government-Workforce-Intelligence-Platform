// Reference: spec/01_requirements.md — FR-050 Agency Management, FR-051 Department Management
// Reference: spec/10_backend_architecture.md — Module Organization
// Reference: directives/12_organization_management_rules.md — ORG-006
//
// OrganizationModule encapsulates the organization domain: departments and agency management.
// IdentityModule is imported to expose JwtAuthGuard and RolesGuard to OrganizationController's
// guard chain. RolesGuard requires Reflector via DI — resolved through IdentityModule's provider
// scope, matching the same pattern established in UsersModule.
//
// PrismaService and AuditService resolve from the global scope (@Global() providers).
//
// No exports: DepartmentService and AgencyService have no consumers outside this module
// in Phase 1. Exports added when cross-domain lookups are required (e.g., workforce planning).
import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module';
import { OrganizationController } from './organization.controller';
import { DepartmentService } from './department.service';
import { AgencyService } from './agency.service';

@Module({
  imports: [IdentityModule],
  controllers: [OrganizationController],
  providers: [DepartmentService, AgencyService],
})
export class OrganizationModule {}
