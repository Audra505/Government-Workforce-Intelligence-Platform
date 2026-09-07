import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import auditConfig from './config/audit.config';
import { validate } from './config/env.validation';
import { AuditModule } from './audit/audit.module';
import { PrismaModule } from './database/prisma.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { UsersModule } from './users/users.module';
import { OrganizationModule } from './organization/organization.module';
import { WorkforceModule } from './workforce/workforce.module';
import { RecruitingModule } from './recruiting/recruiting.module';
import { IntelligenceModule } from './intelligence/intelligence.module';
import { DecisionsModule } from './decisions/decisions.module';

// Reference: execution/02_phase_1_foundation.md — Deliverable 3 (Backend Foundation)
// Reference: spec/10_backend_architecture.md — Module Organization
//
// Module registration order follows dependency sequencing:
//   Milestone 3: ConfigModule (global), PrismaModule (global), HealthModule
//   Milestone 4: AuditModule (precedes Authentication — established before auth layer)
//   Milestone 5: IdentityModule (Authentication, RBAC)
//   Milestone 6: UsersModule (User Registration — FR-001)
//   Milestone 7: OrganizationModule (Organization Management — FR-050, FR-051)
//   Milestone 8: WorkforceModule (Position Management — FR-100)
//   Milestone 16+: RecruitingModule (Phase 3 Recruiting Domain — FR-300+)
//   M30+: IntelligenceModule (Phase 4 Intelligence — FR-401+; GD-M30-1)
//   M38: DecisionsModule (Decision Case and Approval Foundation; GD-M38-1).
//     Internal-service-only — declares no controllers, so registering it
//     here adds zero new HTTP surface (GD-M38-1 Decision 18).
//   M39: ScheduleModule.forRoot() (governance/GD-M39-1.md Decision 13) —
//     one new dependency (@nestjs/schedule), powering
//     AuditRecoveryWorkerService and AuditChainVerificationService's
//     automatic, database-coordinated background work. This is an explicit,
//     documented deployment-behavior change: every running API instance
//     now executes recurring background work in addition to serving HTTP
//     requests. Both workers disable their own timer registration when
//     NODE_ENV=test (see their onModuleInit()), so this registration alone
//     does not affect the existing test-suite process lifecycle.

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      load: [appConfig, databaseConfig, auditConfig],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    HealthModule,
    AuditModule,
    IdentityModule,
    UsersModule,
    OrganizationModule,
    WorkforceModule,
    RecruitingModule,
    IntelligenceModule,
    DecisionsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
