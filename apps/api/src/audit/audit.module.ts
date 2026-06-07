import { Global, Module } from '@nestjs/common';

import { AuditService } from './audit.service';

// Reference: execution/02_phase_1_foundation.md — Deliverable 8 (Audit Foundation)
// Reference: spec/10_backend_architecture.md — Audit Architecture
// Reference: directives/08_audit_rules.md — AUD-001 through AUD-1300
//
// @Global() makes AuditService available throughout the application without
// requiring domain modules to import AuditModule explicitly.
// AppModule imports this once (Step 6); all domain modules (IdentityModule M5,
// WorkforceModule M7+, etc.) inject AuditService directly from the global scope.
//
// PrismaModule is not imported here — it is @Global() and registered in AppModule.
// PrismaService is resolved from the global scope when AuditService is constructed.
// Dependency graph: Domain Modules → AuditModule → PrismaModule (global).

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
