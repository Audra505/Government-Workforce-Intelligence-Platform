import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma-health.indicator';

// Reference: spec/10_backend_architecture.md — Health Checks (@nestjs/terminus)
//
// PrismaModule is not imported here — it is @Global() and registered in AppModule.
// PrismaService is therefore available for injection into PrismaHealthIndicator
// without an explicit import in this module.

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator],
})
export class HealthModule {}
