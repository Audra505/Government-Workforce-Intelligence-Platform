import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { AuditChainVerificationResult, AuditWriteFailureStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

// Reference: governance/GD-M39-1.md — Decision 21 (Operational Visibility)
//
// The existing, confirmed-unauthenticated GET /health endpoint may expose
// only a coarse aggregate here (auditIntegrity: 'ok' | 'degraded') — NEVER
// tenant IDs, event counts, failure counts, record IDs, or any per-tenant
// chain-health detail. All such detail is available exclusively behind
// audit:read via GET /api/v1/audit-events/recovery-status.
//
// Mirrors PrismaHealthIndicator's convention: the catch clause omits the
// error binding so no raw error can be forwarded to the HTTP response.
//
// Deliberately never throws HealthCheckError: an audit write/verification
// backlog is a real operator-actionable condition, but it is not database
// unavailability, and container orchestration commonly restarts a pod whose
// liveness/readiness probe reports unhealthy. Flipping /health's overall
// HTTP status (and therefore risking a restart loop) over a backlog that a
// restart cannot fix is an infrastructure behavior change GD-M39-1 does not
// authorize (Decision 7/25 — no Docker/Compose/CI-credential file is in
// M39's scope). The coarse signal is surfaced as data on an
// always-"healthy" indicator instead — visible to any caller of /health,
// never gating its HTTP status.
@Injectable()
export class AuditIntegrityHealthIndicator extends HealthIndicator {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const [brokenChainCount, abandonedFailureCount] = await Promise.all([
        this.prisma.auditChainState.count({
          where: { lastVerificationResult: AuditChainVerificationResult.BROKEN },
        }),
        this.prisma.auditWriteFailure.count({
          where: { status: AuditWriteFailureStatus.ABANDONED },
        }),
      ]);
      const degraded = brokenChainCount > 0 || abandonedFailureCount > 0;
      return this.getStatus(key, true, { auditIntegrity: degraded ? 'degraded' : 'ok' });
    } catch {
      // Database itself is unreachable — PrismaHealthIndicator already
      // reports that as a real failure; this indicator degrades gracefully
      // rather than duplicating that failure under a second key.
      return this.getStatus(key, true, { auditIntegrity: 'degraded' });
    }
  }
}
