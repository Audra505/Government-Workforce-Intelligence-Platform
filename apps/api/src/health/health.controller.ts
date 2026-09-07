import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckResult, HealthCheckService } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma-health.indicator';
import { AuditIntegrityHealthIndicator } from './audit-integrity.health-indicator';

// Reference: spec/10_backend_architecture.md — Health Checks
// Reference: execution/02_phase_1_foundation.md — Deliverable 3 (validation: GET /health returns 200)
// Reference: governance/GD-M39-1.md — Decision 21 (coarse audit-integrity aggregate only)
//
// Route: GET /health (excluded from global /api prefix — see main.ts Step 7)
// No authentication guard — health endpoints must be reachable by load balancers and
// Docker Compose healthcheck without credentials.

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly auditIntegrityIndicator: AuditIntegrityHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prismaIndicator.isHealthy('database'),
      () => this.auditIntegrityIndicator.isHealthy('auditIntegrity'),
    ]);
  }
}
