// Reference: governance/GD-M30-1.md — Decision 2 (Module Path), Decision 1 (Scope)
// Reference: spec/10_backend_architecture.md — Module Organization
//
// IntelligenceModule is the Phase 4 entry module.
// Path: apps/api/src/intelligence/ (named spec/11 deviation per GD-M30-1 Decision 2).
// Not @Global() — domain service module.
// PrismaService and AuditService resolve from the global scope (@Global() providers).
// IdentityModule imported to expose JwtAuthGuard and RolesGuard — same pattern as WorkforceModule.
// No exports in M30 — no other module consumes IntelligenceModule services.

import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module';
import { IntelligenceController } from './intelligence.controller';
import { VacancyRiskService } from './services/vacancy-risk.service';
import { WorkforceReadinessService } from './services/workforce-readiness.service';
import { AttritionRiskService } from './services/attrition-risk.service';
import { DepartmentGapService } from './services/department-gap.service';
import { ExecutiveMetricsService } from './services/executive-metrics.service';
import { SnapshotWriterService } from './services/snapshot-writer.service';

@Module({
  imports: [IdentityModule],
  controllers: [IntelligenceController],
  providers: [
    VacancyRiskService,
    WorkforceReadinessService,
    AttritionRiskService,
    DepartmentGapService,
    ExecutiveMetricsService,
    SnapshotWriterService,
  ],
})
export class IntelligenceModule {}
