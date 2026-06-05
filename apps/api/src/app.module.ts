import { Module } from '@nestjs/common';

// Phase 1 Foundation — root module scaffold
// Modules added progressively per execution/02_phase_1_foundation.md:
//   Milestone 3: ConfigModule, PrismaModule, HealthModule
//   Milestone 4: AuditModule (precedes Authentication — see corrected sequencing)
//   Milestone 6: IdentityModule (Authentication, RBAC)
@Module({
  imports: [],
  controllers: [],
  providers: [],
})
export class AppModule {}
