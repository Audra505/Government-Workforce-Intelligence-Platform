import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AuditChainVerificationResult, Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService, SYSTEM_USER_ID } from './audit.service';
import { AuditEventType } from './enums/audit-event-type.enum';
import { AUDIT_HASH_CANONICALIZERS, computeAuditEventHash } from './audit-hash.util';
import type { AuditVerificationConfig } from '../config/audit.config';

// Reference: governance/GD-M39-1.md — Decision 8 (verification requirements),
// Decision 13 (chain-verification worker)
//
// Automatic, tenant-batched, database-coordinated chain verification.
// verifyTenantChain() NEVER repairs, rehashes, or rewrites any row it
// inspects — a detected break is reported, never silently corrected.

interface ChainedEventRow {
  id: string;
  tenant_id: string;
  sequence_no: bigint;
  record_hash: string;
  previous_hash: string | null;
  hash_version: string;
  user_id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  result: string;
  metadata: unknown;
  occurred_at: Date;
  created_at: Date;
  retention_until: Date;
}

export type VerifyChainResult =
  | { outcome: 'OK'; rowsChecked: number }
  | { outcome: 'BROKEN'; reasons: string[]; rowsChecked: number };

@Injectable()
export class AuditChainVerificationService implements OnModuleInit {
  private readonly logger = new Logger(AuditChainVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  // GD-M39-1 Decision 13 — same test-disabling convention as the recovery
  // worker (audit-recovery-worker.service.ts).
  onModuleInit(): void {
    if (process.env['NODE_ENV'] === 'test') {
      return;
    }

    const config = this.getConfig();
    const timer = setInterval(() => {
      this.runVerificationCycle().catch((error) => {
        this.logger.error(
          'Audit chain verification cycle failed',
          error instanceof Error ? error.stack : String(error),
        );
      });
    }, config.intervalMs);

    this.schedulerRegistry.addInterval('audit-chain-verification-worker', timer);
  }

  private getConfig(): AuditVerificationConfig {
    return this.configService.get<AuditVerificationConfig>('audit.verification')!;
  }

  // GD-M39-1 Decision 16, endpoint 5 — the manual, System-Administrator-only
  // out-of-cycle verification request. Only advances nextVerificationAt; it
  // NEVER performs verification synchronously. Called by
  // AuditEventsService.requestReverification() from inside its own strict
  // audit-write transaction.
  async scheduleImmediateVerification(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<void> {
    const now = new Date();
    await tx.$executeRaw`
      INSERT INTO "audit"."audit_chain_state" ("tenant_id", "last_sequence", "next_verification_at", "updated_at")
      VALUES (${tenantId}::uuid, 0, ${now}, ${now})
      ON CONFLICT ("tenant_id") DO UPDATE SET "next_verification_at" = ${now}, "updated_at" = ${now}
    `;
  }

  async runVerificationCycle(): Promise<void> {
    const config = this.getConfig();
    const now = new Date();
    const staleBefore = new Date(now.getTime() - config.claimTimeoutMs);

    const dueTenantIds = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ tenant_id: string }>>`
        SELECT "tenant_id" FROM "audit"."audit_chain_state"
        WHERE "next_verification_at" <= ${now}
          AND ("verification_claimed_at" IS NULL OR "verification_claimed_at" <= ${staleBefore})
        ORDER BY "next_verification_at" ASC
        LIMIT ${config.batchSize}
        FOR UPDATE SKIP LOCKED
      `;
      const ids = rows.map((r) => r.tenant_id);
      if (ids.length > 0) {
        await tx.auditChainState.updateMany({
          where: { tenantId: { in: ids } },
          data: { verificationClaimedAt: now },
        });
      }
      return ids;
    });

    for (const tenantId of dueTenantIds) {
      await this.verifyAndRecordTenant(tenantId, config);
    }
  }

  private async verifyAndRecordTenant(tenantId: string, config: AuditVerificationConfig): Promise<void> {
    const priorState = await this.prisma.auditChainState.findUnique({ where: { tenantId } });
    const priorResult = priorState?.lastVerificationResult ?? null;

    const verification = await this.verifyTenantChain(tenantId);
    const now = new Date();
    const nextVerificationAt = new Date(now.getTime() + config.intervalMs);
    const newResult: AuditChainVerificationResult =
      verification.outcome === 'OK' ? AuditChainVerificationResult.OK : AuditChainVerificationResult.BROKEN;

    // GD-M39-1 Decision 13 — persistent BROKEN state is never auto-cleared.
    // A tenant already BROKEN stays BROKEN even if a later scan finds no
    // NEW break (verification never repairs the underlying rows, so a
    // structural break already recorded remains true going forward).
    const finalResult: AuditChainVerificationResult =
      priorResult === AuditChainVerificationResult.BROKEN ? AuditChainVerificationResult.BROKEN : newResult;

    await this.prisma.auditChainState.update({
      where: { tenantId },
      data: {
        verificationClaimedAt: null,
        lastVerifiedAt: now,
        lastVerificationResult: finalResult,
        nextVerificationAt,
      },
    });

    // GD-M39-1 Decision 14 — supplemental notification only after the
    // durable BROKEN state above is committed, and deduplicated on the
    // transition into BROKEN (never re-emitted on a subsequent cycle that
    // finds the tenant already BROKEN).
    const transitionedIntoBroken =
      finalResult === AuditChainVerificationResult.BROKEN && priorResult !== AuditChainVerificationResult.BROKEN;

    if (transitionedIntoBroken) {
      await this.auditService.logOperationalEvent({
        tenantId,
        userId: SYSTEM_USER_ID,
        action: AuditEventType.AUDIT_CHAIN_VERIFICATION_FAILED,
        result: 'FAILURE',
        entityType: 'AUDIT_CHAIN_STATE',
        entityId: tenantId,
      });
    }
  }

  // GD-M39-1 Decision 8 — detects, beyond simple recompute-and-compare:
  // missing sequence numbers/gaps, duplicate sequence numbers, incorrect
  // genesis placement, and final-row-versus-chain-state mismatch. Legacy
  // pre-chain rows (sequenceNo IS NULL) are excluded from the walk entirely
  // — never fabricated, never treated as a break. NEVER repairs, rehashes,
  // or rewrites any row it inspects.
  async verifyTenantChain(tenantId: string): Promise<VerifyChainResult> {
    const rows = await this.prisma.$queryRaw<ChainedEventRow[]>`
      SELECT "id", "tenant_id", "sequence_no", "record_hash", "previous_hash", "hash_version",
             "user_id", "action", "entity_type", "entity_id", "result", "metadata",
             "occurred_at", "created_at", "retention_until"
      FROM "audit"."audit_events"
      WHERE "tenant_id" = ${tenantId}::uuid AND "sequence_no" IS NOT NULL
      ORDER BY "sequence_no" ASC
    `;

    const reasons: string[] = [];

    if (rows.length === 0) {
      return { outcome: 'OK', rowsChecked: 0 };
    }

    // Genesis: exactly one previousHash IS NULL AND sequenceNo = 1 row.
    const genesisRows = rows.filter((r) => r.previous_hash === null);
    const genesisAtSequenceOne = rows.length > 0 && rows[0]!.sequence_no === 1n && rows[0]!.previous_hash === null;
    if (genesisRows.length !== 1 || !genesisAtSequenceOne) {
      reasons.push('INVALID_GENESIS');
    }

    // Duplicate sequence numbers — independent re-scan, defense-in-depth
    // beyond the database's own unique constraint.
    const seen = new Set<string>();
    for (const row of rows) {
      const key = row.sequence_no.toString();
      if (seen.has(key)) {
        reasons.push(`DUPLICATE_SEQUENCE:${key}`);
      }
      seen.add(key);
    }

    // Missing sequence numbers / gaps — non-contiguous sequenceNo after
    // ordering.
    let expected = 1n;
    for (const row of rows) {
      if (row.sequence_no !== expected) {
        reasons.push(`SEQUENCE_GAP:expected=${expected}:found=${row.sequence_no}`);
        expected = row.sequence_no; // resync so one gap doesn't cascade into N reports
      }
      expected += 1n;
    }

    // Recompute-and-compare each row's hash under its OWN recorded
    // hashVersion — version-keyed dispatch, never a single assumed-current
    // rule.
    let previousHash: string | null = null;
    for (const row of rows) {
      const canonicalizer = AUDIT_HASH_CANONICALIZERS[row.hash_version];
      if (!canonicalizer) {
        reasons.push(`UNKNOWN_HASH_VERSION:${row.id}:${row.hash_version}`);
        previousHash = row.record_hash;
        continue;
      }

      if (row.previous_hash !== previousHash) {
        reasons.push(`PREVIOUS_HASH_MISMATCH:${row.id}`);
      }

      const canonicalJson = canonicalizer({
        hashVersion: row.hash_version,
        tenantId: row.tenant_id,
        sequenceNo: row.sequence_no,
        eventId: row.id,
        userId: row.user_id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        result: row.result,
        metadata: row.metadata,
        occurredAt: row.occurred_at,
        createdAt: row.created_at,
        retentionUntil: row.retention_until,
        previousHash: row.previous_hash,
      });
      const recomputedHash = computeAuditEventHash(canonicalJson);

      if (recomputedHash !== row.record_hash) {
        reasons.push(`HASH_MISMATCH:${row.id}`);
      }

      previousHash = row.record_hash;
    }

    // Final-row-versus-chain-state mismatch.
    const lastRow = rows[rows.length - 1]!;
    const chainState = await this.prisma.auditChainState.findUnique({ where: { tenantId } });
    if (
      !chainState ||
      chainState.lastSequence !== lastRow.sequence_no ||
      chainState.lastHash !== lastRow.record_hash
    ) {
      reasons.push('CHAIN_STATE_MISMATCH');
    }

    if (reasons.length > 0) {
      return { outcome: 'BROKEN', reasons, rowsChecked: rows.length };
    }
    return { outcome: 'OK', rowsChecked: rows.length };
  }
}
