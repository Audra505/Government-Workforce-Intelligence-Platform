import { Global, Module } from '@nestjs/common';

import { AuditService } from './audit.service';
import { AuditRecoveryWorkerService } from './audit-recovery-worker.service';
import { AuditChainVerificationService } from './audit-chain-verification.service';
import { AuditEventsController } from './audit-events.controller';
import { AuditEventsService } from './audit-events.service';

// Reference: execution/02_phase_1_foundation.md — Deliverable 8 (Audit Foundation)
// Reference: spec/10_backend_architecture.md — Audit Architecture
// Reference: directives/08_audit_rules.md — AUD-001 through AUD-1300
// Reference: governance/GD-M39-1.md — Decision 4 (first HTTP surface since
// M36), Decision 13 (automatic recovery/chain-verification workers)
//
// @Global() makes AuditService available throughout the application without
// requiring domain modules to import AuditModule explicitly.
// AppModule imports this once (Step 6); all domain modules (IdentityModule M5,
// WorkforceModule M7+, etc.) inject AuditService directly from the global scope.
//
// PrismaModule is not imported here — it is @Global() and registered in AppModule.
// PrismaService is resolved from the global scope when AuditService is constructed.
// Dependency graph: Domain Modules → AuditModule → PrismaModule (global).
//
// M39 additions: AuditRecoveryWorkerService and AuditChainVerificationService
// are internal, automatically-scheduled workers (no controller, no route —
// ScheduleModule.forRoot() is registered once in AppModule, which is what
// makes SchedulerRegistry injectable here). AuditEventsController/Service
// are this module's first-ever HTTP surface (GD-M39-1 Decision 4).

@Global()
@Module({
  controllers: [AuditEventsController],
  providers: [
    AuditService,
    AuditRecoveryWorkerService,
    AuditChainVerificationService,
    AuditEventsService,
  ],
  exports: [AuditService, AuditChainVerificationService],
})
export class AuditModule {}
