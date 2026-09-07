import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma-health.indicator';
import { AuditIntegrityHealthIndicator } from './audit-integrity.health-indicator';

// Reference: spec/10_backend_architecture.md — Health Checks (@nestjs/terminus)
// Reference: governance/GD-M39-1.md — Decision 21
//
// PrismaModule is not imported here — it is @Global() and registered in AppModule.
// PrismaService is therefore available for injection into PrismaHealthIndicator
// and AuditIntegrityHealthIndicator without an explicit import in this module.

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, AuditIntegrityHealthIndicator],
})
export class HealthModule {}
