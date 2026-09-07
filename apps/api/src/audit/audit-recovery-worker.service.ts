import { randomUUID } from 'node:crypto';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AuditWriteFailureStatus, AuditWriteFailureAttemptStatus } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService, SYSTEM_USER_ID } from './audit.service';
import { AuditEventType } from './enums/audit-event-type.enum';
import { classifyAuditFailure, AUDIT_FAILURE_CATEGORIES } from './audit-failure-classification';
import type { AuditRecoveryConfig } from '../config/audit.config';

// Reference: governance/GD-M39-1.md — Decision 11 (bounded recovery guarantee),
// Decision 12 (attempt history), Decision 13 (automatic workers)
//
// Automatic, database-coordinated recovery of logEvent() failures dead-lettered
// into AuditWriteFailure. No manual trigger is required for ordinary operation
// — see Decision 16 endpoint 4 for the SA-only manual requeue path, which only
// resets an ABANDONED row back to PENDING for this worker to pick up again.

interface ClaimedFailureRow {
  id: string;
  tenant_id: string;
  user_id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  result: string;
  metadata: unknown;
  occurred_at: Date;
  attempt_count: number;
}

@Injectable()
export class AuditRecoveryWorkerService implements OnModuleInit {
  private readonly logger = new Logger(AuditRecoveryWorkerService.name);
  private readonly workerId = randomUUID();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  // GD-M39-1 Decision 13 — "Scheduler execution must be disabled or safely
  // controlled during automated test runs." Jest sets NODE_ENV=test by
  // default; tests call runRecoveryCycle() directly instead of relying on
  // the timer. Interval value is configurable (audit.config.ts), which
  // requires SchedulerRegistry.addInterval() rather than a static
  // @Interval() decorator (whose value must be known at class-decoration
  // time).
  onModuleInit(): void {
    if (process.env['NODE_ENV'] === 'test') {
      return;
    }

    const config = this.getConfig();
    const timer = setInterval(() => {
      this.runRecoveryCycle().catch((error) => {
        this.logger.error(
          'Audit recovery cycle failed',
          error instanceof Error ? error.stack : String(error),
        );
      });
    }, config.intervalMs);

    this.schedulerRegistry.addInterval('audit-recovery-worker', timer);
  }

  private getConfig(): AuditRecoveryConfig {
    return this.configService.get<AuditRecoveryConfig>('audit.recovery')!;
  }

  // Reclaims stale IN_PROGRESS claims, then claims and processes a batch of
  // due PENDING rows. Public and directly callable (by tests, and by the
  // interval timer above).
  async runRecoveryCycle(): Promise<void> {
    const config = this.getConfig();
    const now = new Date();

    const { reclaimed, abandoned } = await this.reclaimStaleClaims(config, now);
    for (const failure of reclaimed) {
      await this.processClaimedFailure(failure, config);
    }
    for (const failure of abandoned) {
      // GD-M39-1 Decision 14 — emitted only after reclaimStaleClaims's
      // transaction (which already durably set status ABANDONED) commits.
      await this.auditService.logOperationalEvent({
        tenantId: failure.tenant_id,
        userId: SYSTEM_USER_ID,
        action: AuditEventType.AUDIT_WRITE_RECOVERY_ABANDONED,
        result: 'FAILURE',
        entityType: 'AUDIT_WRITE_FAILURE',
        entityId: failure.id,
      });
    }

    const claimed = await this.claimDueFailures(config, now);
    for (const failure of claimed) {
      await this.processClaimedFailure(failure, config);
    }
  }

  // GD-M39-1 Decision 12/13 — database-coordinated claim via
  // SELECT ... FOR UPDATE SKIP LOCKED, safe across any number of running
  // instances. Atomically, per claimed row: increments attemptCount and
  // creates the new IN_PROGRESS attempt row together.
  private async claimDueFailures(
    config: AuditRecoveryConfig,
    now: Date,
  ): Promise<ClaimedFailureRow[]> {
    return this.prisma.$transaction(async (tx) => {
      const dueRows = await tx.$queryRaw<ClaimedFailureRow[]>`
        SELECT "id", "tenant_id", "user_id", "action", "entity_type", "entity_id",
               "result", "metadata", "occurred_at", "attempt_count"
        FROM "audit"."audit_write_failures"
        WHERE "status" = 'PENDING' AND "next_attempt_at" <= ${now}
        ORDER BY "next_attempt_at" ASC
        LIMIT ${config.batchSize}
        FOR UPDATE SKIP LOCKED
      `;

      const claimed: ClaimedFailureRow[] = [];
      for (const row of dueRows) {
        const nextAttemptNumber = row.attempt_count + 1;
        await tx.auditWriteFailure.update({
          where: { id: row.id },
          data: {
            status: AuditWriteFailureStatus.IN_PROGRESS,
            attemptCount: nextAttemptNumber,
            claimedAt: now,
            claimedBy: this.workerId,
          },
        });
        await tx.auditWriteFailureAttempt.create({
          data: {
            tenantId: row.tenant_id,
            auditWriteFailureId: row.id,
            attemptNumber: nextAttemptNumber,
            claimedBy: this.workerId,
            startedAt: now,
            status: AuditWriteFailureAttemptStatus.IN_PROGRESS,
          },
        });
        claimed.push({ ...row, attempt_count: nextAttemptNumber });
      }
      return claimed;
    });
  }

  // GD-M39-1 Decision 12 — "A crashed worker's stale IN_PROGRESS attempt is
  // never silently left appearing active: claim-expiry logic closes it as
  // FAILED with a sanitized category (WORKER_TIMEOUT) and a completion
  // timestamp, ... then creates the next-numbered attempt." Reclaiming IS
  // re-claiming for an immediate retry within this same cycle — unless the
  // stale attempt had already reached the configured maximum, in which case
  // the parent is abandoned directly instead of creating another attempt.
  private async reclaimStaleClaims(
    config: AuditRecoveryConfig,
    now: Date,
  ): Promise<{ reclaimed: ClaimedFailureRow[]; abandoned: ClaimedFailureRow[] }> {
    const staleBefore = new Date(now.getTime() - config.claimTimeoutMs);

    return this.prisma.$transaction(async (tx) => {
      const staleRows = await tx.$queryRaw<ClaimedFailureRow[]>`
        SELECT "id", "tenant_id", "user_id", "action", "entity_type", "entity_id",
               "result", "metadata", "occurred_at", "attempt_count"
        FROM "audit"."audit_write_failures"
        WHERE "status" = 'IN_PROGRESS' AND "claimed_at" <= ${staleBefore}
        FOR UPDATE SKIP LOCKED
      `;

      const reclaimed: ClaimedFailureRow[] = [];
      const abandoned: ClaimedFailureRow[] = [];
      for (const row of staleRows) {
        await tx.auditWriteFailureAttempt.update({
          where: {
            auditWriteFailureId_attemptNumber: {
              auditWriteFailureId: row.id,
              attemptNumber: row.attempt_count,
            },
          },
          data: {
            status: AuditWriteFailureAttemptStatus.FAILED,
            completedAt: now,
            failureCategory: AUDIT_FAILURE_CATEGORIES.WORKER_TIMEOUT,
          },
        });

        if (row.attempt_count >= config.maxAttempts) {
          await tx.auditWriteFailure.update({
            where: { id: row.id },
            data: { status: AuditWriteFailureStatus.ABANDONED, attemptedAt: now },
          });
          // No new attempt was created for this row — its supplemental
          // AUDIT_WRITE_RECOVERY_ABANDONED notification is emitted by the
          // caller (runRecoveryCycle) only after this transaction commits
          // (GD-M39-1 Decision 14), not from inside it.
          abandoned.push(row);
          continue;
        }

        const nextAttemptNumber = row.attempt_count + 1;
        await tx.auditWriteFailure.update({
          where: { id: row.id },
          data: {
            status: AuditWriteFailureStatus.IN_PROGRESS,
            attemptCount: nextAttemptNumber,
            claimedAt: now,
            claimedBy: this.workerId,
          },
        });
        await tx.auditWriteFailureAttempt.create({
          data: {
            tenantId: row.tenant_id,
            auditWriteFailureId: row.id,
            attemptNumber: nextAttemptNumber,
            claimedBy: this.workerId,
            startedAt: now,
            status: AuditWriteFailureAttemptStatus.IN_PROGRESS,
          },
        });
        reclaimed.push({ ...row, attempt_count: nextAttemptNumber });
      }
      return { reclaimed, abandoned };
    });
  }

  // Replays the original write through AuditService's chain-writing path,
  // then transitions the attempt/parent to their terminal-for-this-attempt
  // state in a separate transaction — a single failing replay must not
  // block or roll back the rest of the claimed batch.
  private async processClaimedFailure(
    failure: ClaimedFailureRow,
    config: AuditRecoveryConfig,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.auditService.replayFailedWrite(tx, {
          id: failure.id,
          tenantId: failure.tenant_id,
          userId: failure.user_id,
          action: failure.action,
          entityType: failure.entity_type,
          entityId: failure.entity_id,
          result: failure.result,
          metadata: failure.metadata,
          occurredAt: failure.occurred_at,
        });

        const completedAt = new Date();
        await tx.auditWriteFailureAttempt.update({
          where: {
            auditWriteFailureId_attemptNumber: {
              auditWriteFailureId: failure.id,
              attemptNumber: failure.attempt_count,
            },
          },
          data: { status: AuditWriteFailureAttemptStatus.SUCCEEDED, completedAt },
        });
        await tx.auditWriteFailure.update({
          where: { id: failure.id },
          data: { status: AuditWriteFailureStatus.RETRIED, attemptedAt: completedAt },
        });
      });

      // GD-M39-1 Decision 14 — supplemental notification only after the
      // durable parent/attempt state above is already committed.
      await this.auditService.logOperationalEvent({
        tenantId: failure.tenant_id,
        userId: SYSTEM_USER_ID,
        action: AuditEventType.AUDIT_WRITE_RECOVERY_SUCCEEDED,
        result: 'SUCCESS',
        entityType: 'AUDIT_WRITE_FAILURE',
        entityId: failure.id,
      });
    } catch (error) {
      await this.handleFailedReplay(failure, config, error);
    }
  }

  private async handleFailedReplay(
    failure: ClaimedFailureRow,
    config: AuditRecoveryConfig,
    error: unknown,
  ): Promise<void> {
    const category = classifyAuditFailure(error);
    const willAbandon = failure.attempt_count >= config.maxAttempts;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.auditWriteFailureAttempt.update({
        where: {
          auditWriteFailureId_attemptNumber: {
            auditWriteFailureId: failure.id,
            attemptNumber: failure.attempt_count,
          },
        },
        data: { status: AuditWriteFailureAttemptStatus.FAILED, completedAt: now, failureCategory: category },
      });
      await tx.auditWriteFailure.update({
        where: { id: failure.id },
        data: willAbandon
          ? { status: AuditWriteFailureStatus.ABANDONED, attemptedAt: now }
          : {
              status: AuditWriteFailureStatus.PENDING,
              attemptedAt: now,
              nextAttemptAt: this.computeBackoff(failure.attempt_count, config, now),
            },
      });
    });

    if (willAbandon) {
      await this.auditService.logOperationalEvent({
        tenantId: failure.tenant_id,
        userId: SYSTEM_USER_ID,
        action: AuditEventType.AUDIT_WRITE_RECOVERY_ABANDONED,
        result: 'FAILURE',
        entityType: 'AUDIT_WRITE_FAILURE',
        entityId: failure.id,
      });
    }
  }

  // Exponential backoff, capped at config.maxBackoffMs.
  private computeBackoff(attemptNumber: number, config: AuditRecoveryConfig, now: Date): Date {
    const delayMs = Math.min(
      config.baseBackoffMs * 2 ** Math.max(0, attemptNumber - 1),
      config.maxBackoffMs,
    );
    return new Date(now.getTime() + delayMs);
  }
}
