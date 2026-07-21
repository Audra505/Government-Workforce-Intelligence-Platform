// Reference: governance/GD-M34-1.md — Decisions 14, 15, 16, 17, 18
//
// SnapshotWriterService is the ONLY place the write-on-query deduplication
// rule (Decision 17) is implemented. Every signal service (VacancyRiskService,
// WorkforceReadinessService, AttritionRiskService, DepartmentGapService,
// ExecutiveMetricsService) calls write() as an internal, response-shape-
// invisible side effect of its own score()/getByTenant() computation — no
// caller's return type or HTTP response changes because of this service.
//
// No scheduler, cron, or worker triggers this — write-on-query only
// (Decision 16). No read method exists on this service and no controller
// or module exposes snapshot data (Decision 18) — the table is written to
// and read by nothing else.
//
// Write failures must never affect the triggering request's own response
// (Decision 16) — every error is caught and logged here, never rethrown,
// matching AuditService.logEvent()'s established failure-handling pattern.

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';

// ---------------------------------------------------------------------------
// Governed value sets — GD-M34-1 Decision 15 (see schema.prisma model comment
// for the documented refinement of signalType's illustrative value list)
// ---------------------------------------------------------------------------

export type SnapshotSignalType =
  | 'VACANCY_RISK'
  | 'WORKFORCE_READINESS'
  | 'ATTRITION_RISK'
  | 'EXECUTIVE_METRICS_VACANCY_RATE'
  | 'EXECUTIVE_METRICS_COVERAGE_RATE'
  | 'EXECUTIVE_METRICS_TIME_TO_FILL'
  | 'EXECUTIVE_METRICS_HIRING_VELOCITY';

export type SnapshotScopeType = 'TENANT' | 'DEPARTMENT';

// Sentinel scopeId for TENANT-scoped rows — see schema.prisma model comment:
// a non-null sentinel is required for the dedup UNIQUE constraint to actually
// enforce Decision 17's guarantee (PostgreSQL does not deduplicate NULLs).
export const TENANT_SCOPE_SENTINEL_ID = '00000000-0000-0000-0000-000000000000';

export interface SnapshotWriteInput {
  tenantId: string;
  signalType: SnapshotSignalType;
  scopeType: SnapshotScopeType;
  // Required when scopeType === 'DEPARTMENT'; ignored (sentinel used instead)
  // when scopeType === 'TENANT'.
  scopeId?: string | null;
  score: number | null;
  level: string | null;
  confidence: number;
  formulaVersion: string;
  computedAt: Date;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class SnapshotWriterService {
  private readonly logger = new Logger(SnapshotWriterService.name);

  constructor(private readonly prisma: PrismaService) {}

  async write(input: SnapshotWriteInput): Promise<void> {
    const scopeId =
      input.scopeType === 'DEPARTMENT' && input.scopeId
        ? input.scopeId
        : TENANT_SCOPE_SENTINEL_ID;
    const snapshotDate = this.toUtcDateOnly(input.computedAt);

    try {
      await this.prisma.workforceSignalSnapshot.upsert({
        where: {
          tenantId_signalType_scopeType_scopeId_snapshotDate: {
            tenantId: input.tenantId,
            signalType: input.signalType,
            scopeType: input.scopeType,
            scopeId,
            snapshotDate,
          },
        },
        create: {
          tenantId: input.tenantId,
          signalType: input.signalType,
          scopeType: input.scopeType,
          scopeId,
          snapshotDate,
          score: input.score,
          level: input.level,
          confidence: input.confidence,
          formulaVersion: input.formulaVersion,
          computedAt: input.computedAt,
        },
        update: {
          score: input.score,
          level: input.level,
          confidence: input.confidence,
          formulaVersion: input.formulaVersion,
          computedAt: input.computedAt,
        },
      });
    } catch (error) {
      // GD-M34-1 Decision 16: snapshot write failures must not affect the
      // triggering request's own response. Log and continue; never rethrow.
      // Never log score/level values here beyond what is already governed
      // aggregate data — nothing individually identifying is ever passed in.
      this.logger.error(
        `Snapshot write failed: signalType=${input.signalType} scopeType=${input.scopeType} tenantId=${input.tenantId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  // -------------------------------------------------------------------------
  // UTC calendar-day truncation — the deduplication key's snapshotDate
  // component (Decision 17). Deliberately UTC, not server-local time, so the
  // key is stable regardless of host timezone.
  // -------------------------------------------------------------------------

  private toUtcDateOnly(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }
}
