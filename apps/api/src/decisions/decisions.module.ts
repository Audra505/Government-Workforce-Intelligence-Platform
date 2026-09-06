import { Module } from '@nestjs/common';

import { DecisionCaseService } from './decision-case.service';
import { ApprovalService } from './approval.service';

// Governance authority: governance/GD-M38-1.md Decision 18/19.
//
// Internal-service-only module — no controllers, no routes, no DTOs, no
// Swagger surface, no new @RequireCapability metadata. PrismaService and
// AuditService resolve from the global scope (@Global() providers), so this
// module declares no imports beyond its own two services.
//
// Registered in AppModule for dependency injection and internal testing
// only (GD-M38-1 Decision 18) — no existing controller or workflow may
// import from this module (GD-M38-1 Decision 19); see
// decisions.structural.spec.ts for the automated import-graph proof.
@Module({
  providers: [DecisionCaseService, ApprovalService],
  exports: [DecisionCaseService, ApprovalService],
})
export class DecisionsModule {}
