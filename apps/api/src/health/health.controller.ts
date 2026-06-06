import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckResult, HealthCheckService } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma-health.indicator';

// Reference: spec/10_backend_architecture.md — Health Checks
// Reference: execution/02_phase_1_foundation.md — Deliverable 3 (validation: GET /health returns 200)
//
// Route: GET /health (excluded from global /api prefix — see main.ts Step 7)
// No authentication guard — health endpoints must be reachable by load balancers and
// Docker Compose healthcheck without credentials.

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([() => this.prismaIndicator.isHealthy('database')]);
  }
}
