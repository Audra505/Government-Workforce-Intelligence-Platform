import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { AuditWriteFailureStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { CreateAuditEventDto } from './dto/create-audit-event.dto';
import { HASH_VERSION_V1, hashAuditEvent, sortMetadataKeysDeep } from './audit-hash.util';
import { classifyAuditFailure } from './audit-failure-classification';

// Sentinel UUID for system-initiated audit events that have no human actor.
// Used by scheduled jobs, background processing, and startup-time events.
// No corresponding row in identity.users is required — audit_events.user_id
// carries no FK constraint (intentional design: cascading deletes must never
// corrupt the audit trail).
// Import this constant; do not redefine it elsewhere.
export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

// Sentinel UUID for audit events where the tenant context cannot be determined.
// Used exclusively for pre-authentication failures (e.g. EMAIL_NOT_FOUND) where
// no tenant is known and no DB round-trip can safely resolve one.
// Distinct semantic meaning from SYSTEM_USER_ID despite sharing the same value:
//   SYSTEM_USER_ID  → actor is the system (not a human)
//   SYSTEM_TENANT_ID → tenant is indeterminate (pre-authentication context)
// audit_events.tenant_id carries no FK constraint — zero UUID is safe.
// Import this constant; do not redefine it elsewhere.
export const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

// GD-M39-1 Decision 6 — retentionUntil = occurredAt + 7 years, computed
// identically here (application code, used only to satisfy Prisma's NOT
// NULL column typing at insert time and to include in the hashed row) and
// by the database's audit_events_derive_retention trigger (authoritative,
// unconditionally overwrites whatever is supplied).
//
// CLAMPS to the last valid day of the target month, exactly matching
// PostgreSQL's `timestamp + INTERVAL '7 years'` semantics — proven against
// a real PostgreSQL 16 instance during M39 validation. This does NOT match
// plain JS Date.setUTCFullYear()'s native day-of-month behavior: for a Feb
// 29 occurredAt whose +7-years target year is not a leap year,
// setUTCFullYear() alone silently OVERFLOWS into March 1, while Postgres
// clamps to February 28. An earlier version of this function used
// setUTCFullYear() directly and produced a value one full day later than
// what the database trigger would derive for the identical row — since
// retentionUntil participates in the governed hash, that mismatch would
// have made the persisted row's actual retentionUntil silently diverge
// from the value AuditService hashed. Do not revert to the bare
// setUTCFullYear() form.
export function deriveRetentionUntil(occurredAt: Date): Date {
  const targetYear = occurredAt.getUTCFullYear() + 7;
  const month = occurredAt.getUTCMonth();
  // Day 0 of the month AFTER `month` is JS's idiom for "the last day of
  // `month`" — mirrors Postgres's own end-of-month clamp for interval
  // arithmetic that overflows the target month's day count.
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate();
  const day = Math.min(occurredAt.getUTCDate(), lastDayOfTargetMonth);

  const retentionUntil = new Date(occurredAt.getTime());
  retentionUntil.setUTCFullYear(targetYear, month, day);
  return retentionUntil;
}

interface ChainWriteInput {
  id: string;
  occurredAt: Date;
  tenantId: string;
  userId: string;
  action: string;
  entityType?: string;
  entityId?: string;
  result: string;
  metadata?: object;
}

interface ChainStateRow {
  last_sequence: bigint;
  last_hash: string | null;
}

// Minimal shape needed from an existing AuditEvent row to verify a
// skipped-duplicate insert's attempted content actually matches what is
// already persisted under that id (see writeChainedEvent's count===0
// branch). Compares every field that participates in the governed hash
// EXCEPT sequenceNo/recordHash/previousHash/hashVersion/createdAt, which
// are legitimately allowed to differ from what a retry attempt COMPUTED
// (they are chain-position-derived, not part of the event's own identity)
// — only the caller-supplied identity/content fields must match exactly.
interface ExistingAuditEventContent {
  tenantId: string;
  userId: string;
  action: string;
  result: string;
  entityType: string | null;
  entityId: string | null;
  occurredAt: Date;
  metadata: unknown;
}

function auditEventContentMatches(
  existing: ExistingAuditEventContent,
  attempted: ChainWriteInput,
): boolean {
  return (
    existing.tenantId === attempted.tenantId &&
    existing.userId === attempted.userId &&
    existing.action === attempted.action &&
    existing.result === attempted.result &&
    (existing.entityType ?? null) === (attempted.entityType ?? null) &&
    (existing.entityId ?? null) === (attempted.entityId ?? null) &&
    existing.occurredAt.getTime() === attempted.occurredAt.getTime() &&
    JSON.stringify(sortMetadataKeysDeep(existing.metadata ?? null)) ===
      JSON.stringify(sortMetadataKeysDeep(attempted.metadata ?? null))
  );
}

// GD-M39-1 Decision 11/23 — a same-id/different-content collision under
// skipDuplicates is a genuine integrity bug, never a safe idempotent
// retry. Thrown (never silently swallowed) so it surfaces through the same
// failure paths as any other chain-write error — dead-lettered by
// logEvent(), rolled back by logEventStrict(), warned-only by
// logOperationalEvent() (see each method's existing catch behavior).
export class AuditEventContentMismatchError extends Error {
  constructor(public readonly eventId: string) {
    super(`Audit event content mismatch for existing id "${eventId}" — refusing to silently skip`);
  }
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  // GD-M39-1 Decision 5 — id and occurredAt are generated BEFORE the first
  // write attempt, so no change to any of the 91 existing call sites'
  // arguments is required; only this method's internals change.
  //
  // AUD-1300, extended by GD-M39-1 Decision 11: a failure here no longer
  // ends at a single log line. The failure is durably journaled into
  // AuditWriteFailure (best-effort itself — see the catch below) so the
  // automatic recovery worker (Decision 13) can retry it. logEvent()'s
  // non-throwing, best-effort contract for its 71 callers is unchanged.
  async logEvent(dto: CreateAuditEventDto): Promise<void> {
    const id = randomUUID();
    const occurredAt = new Date();

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.writeChainedEvent(tx, { id, occurredAt, ...dto });
      });
    } catch (error) {
      await this.deadLetter(id, occurredAt, dto, error);
    }
  }

  // GD-M37-1 Decision 14, extended by GD-M39-1 Decision 14 — the strict,
  // transaction-aware audit-write path. Originally narrow to M37/M38
  // lifecycle transitions; M39 additionally uses it for the two new human
  // mutations (requeue, manual re-verification request). Unlike logEvent()
  // above, this method does NOT swallow its own errors: it must be called
  // from within the same $transaction as the state mutation it records, so
  // that the transition and its audit event both succeed or both fail
  // together. Never dead-lettered — a failure here rolls back the entire
  // caller transaction (fail-closed), exactly as before M39.
  //
  // Participates in the same per-tenant hash chain as every other audit_events
  // row (Decision 8) — "strict" governs transaction/failure semantics only,
  // never the chain-writing path itself.
  async logEventStrict(tx: Prisma.TransactionClient, dto: CreateAuditEventDto): Promise<void> {
    const id = randomUUID();
    const occurredAt = new Date();
    await this.writeChainedEvent(tx, { id, occurredAt, ...dto });
  }

  // GD-M39-1 Decision 14 — a new, narrow, non-recursive path for
  // worker-generated supplemental notifications ONLY (recovery succeeded,
  // recovery abandoned, chain verification failed). Attempts exactly one
  // chained write. On its own failure it NEVER creates an AuditWriteFailure
  // row (no recursive dead-lettering of dead-letter-adjacent events) — it
  // only emits a structured application-log warning. Callers must invoke
  // this only AFTER the durable parent/attempt/chain state it describes is
  // already committed, in its own separate transaction — this method's
  // failure can never erase or roll back state that transaction already
  // made durable.
  async logOperationalEvent(dto: CreateAuditEventDto): Promise<void> {
    const id = randomUUID();
    const occurredAt = new Date();

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.writeChainedEvent(tx, { id, occurredAt, ...dto });
      });
    } catch (error) {
      this.logger.warn(
        `Operational audit write failed (non-recursive, not dead-lettered): action=${dto.action} tenantId=${dto.tenantId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  // GD-M39-1 Decision 11/23 — replays an originally-failed logEvent() call,
  // reusing its original id and occurredAt (never regenerated), through the
  // exact same chain-writing path every other write uses. Called by
  // AuditRecoveryWorkerService from inside its own claim transaction.
  // Idempotent: writeChainedEvent's ON CONFLICT DO NOTHING insert means a
  // row can never be durably written twice for the same id.
  async replayFailedWrite(
    tx: Prisma.TransactionClient,
    failure: {
      id: string;
      tenantId: string;
      userId: string;
      action: string;
      entityType: string | null;
      entityId: string | null;
      result: string;
      metadata: unknown;
      occurredAt: Date;
    },
  ): Promise<{ inserted: boolean }> {
    return this.writeChainedEvent(tx, {
      id: failure.id,
      occurredAt: failure.occurredAt,
      tenantId: failure.tenantId,
      userId: failure.userId,
      action: failure.action,
      entityType: failure.entityType ?? undefined,
      entityId: failure.entityId ?? undefined,
      result: failure.result,
      metadata: (failure.metadata as object | null) ?? undefined,
    });
  }

  // GD-M39-1 Decision 8/23 — the single chain-writing implementation every
  // write path (logEvent, logEventStrict, logOperationalEvent,
  // replayFailedWrite) routes through. Race-safe per-tenant sequence
  // allocation (INSERT ... ON CONFLICT DO NOTHING + SELECT ... FOR UPDATE,
  // inside the caller's transaction), deterministic hash computation
  // (audit-hash.util.ts, reused unmodified by the verification path), and
  // an idempotent, ON-CONFLICT-DO-NOTHING insert of the AuditEvent row
  // itself (createMany + skipDuplicates — Prisma's supported idiom for a
  // conflict-safe insert). The chain pointer (AuditChainState) is advanced
  // ONLY when a new row was actually inserted — a skipped duplicate must
  // never double-advance the tenant's sequence.
  private async writeChainedEvent(
    tx: Prisma.TransactionClient,
    input: ChainWriteInput,
  ): Promise<{ inserted: boolean }> {
    const createdAt = new Date();

    await tx.$executeRaw`
      INSERT INTO "audit"."audit_chain_state" ("tenant_id", "last_sequence", "next_verification_at", "updated_at")
      VALUES (${input.tenantId}::uuid, 0, ${createdAt}, ${createdAt})
      ON CONFLICT ("tenant_id") DO NOTHING
    `;

    const rows = await tx.$queryRaw<ChainStateRow[]>`
      SELECT "last_sequence", "last_hash" FROM "audit"."audit_chain_state"
      WHERE "tenant_id" = ${input.tenantId}::uuid
      FOR UPDATE
    `;
    const state = rows[0];
    const previousHash: string | null = state?.last_hash ?? null;
    const nextSequenceNo: bigint = (state?.last_sequence ?? 0n) + 1n;

    const retentionUntil = deriveRetentionUntil(input.occurredAt);

    const recordHash = hashAuditEvent({
      hashVersion: HASH_VERSION_V1,
      tenantId: input.tenantId,
      sequenceNo: nextSequenceNo,
      eventId: input.id,
      userId: input.userId,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      result: input.result,
      metadata: input.metadata ?? null,
      occurredAt: input.occurredAt,
      createdAt,
      retentionUntil,
      previousHash,
    });

    const { count } = await tx.auditEvent.createMany({
      data: [
        {
          id: input.id,
          tenantId: input.tenantId,
          userId: input.userId,
          entityType: input.entityType,
          entityId: input.entityId,
          action: input.action,
          result: input.result,
          metadata: input.metadata as object | undefined,
          occurredAt: input.occurredAt,
          retentionUntil,
          createdAt,
          sequenceNo: nextSequenceNo,
          recordHash,
          previousHash: previousHash ?? undefined,
          hashVersion: HASH_VERSION_V1,
        },
      ],
      skipDuplicates: true,
    });

    if (count === 0) {
      // Row already existed. This is the expected, safe idempotent-replay
      // case (Decision 11) ONLY if the existing row's governed content
      // actually matches what this call attempted — skipDuplicates alone
      // cannot distinguish "the same event, retried" from "a different
      // event that happens to reuse this id," and must never silently
      // treat the latter as a successful no-op (a same-id/different-content
      // collision is a genuine integrity bug, not a retry). Verified
      // during M39 validation: this path is unreachable in this
      // implementation's own normal operation (replayFailedWrite() always
      // re-reads its content fresh from the immutable AuditWriteFailure
      // row, so every retry of the same id carries byte-identical content
      // by construction) — the check exists as a defense-in-depth
      // guarantee, not because a current call site can trigger it.
      const existing = await tx.auditEvent.findUniqueOrThrow({ where: { id: input.id } });
      if (!auditEventContentMatches(existing, input)) {
        throw new AuditEventContentMismatchError(input.id);
      }
      // The chain pointer must NOT be advanced again — the earlier
      // successful write already did so.
      return { inserted: false };
    }

    await tx.$executeRaw`
      UPDATE "audit"."audit_chain_state"
      SET "last_sequence" = ${nextSequenceNo}, "last_hash" = ${recordHash}, "updated_at" = ${createdAt}
      WHERE "tenant_id" = ${input.tenantId}::uuid
    `;

    return { inserted: true };
  }

  // GD-M39-1 Decision 9/11 — best-effort dead-letter of a recoverable
  // logEvent() failure. Preserves the original eventId, occurredAt, tenant,
  // actor, action, entity, result, and metadata; stores only a sanitized
  // failure category, never a raw database driver error. This write is
  // itself best-effort: if it also fails (a total-outage-adjacent
  // scenario), this repository cannot durably or queryably record the
  // failure — only a structured application-log entry results, exactly as
  // Decision 11 states as this platform's explicit, binding limitation.
  private async deadLetter(
    id: string,
    occurredAt: Date,
    dto: CreateAuditEventDto,
    originalError: unknown,
  ): Promise<void> {
    // AUD-1300: never log metadata, userId, or entityId — may contain PII.
    this.logger.error(
      `Audit write failed: action=${dto.action} tenantId=${dto.tenantId}`,
      originalError instanceof Error ? originalError.stack : String(originalError),
    );

    try {
      const now = new Date();
      await this.prisma.auditWriteFailure.create({
        data: {
          id,
          tenantId: dto.tenantId,
          userId: dto.userId,
          action: dto.action,
          entityType: dto.entityType,
          entityId: dto.entityId,
          result: dto.result,
          metadata: dto.metadata as object | undefined,
          occurredAt,
          failureReason: classifyAuditFailure(originalError),
          status: AuditWriteFailureStatus.PENDING,
          attemptCount: 0,
          nextAttemptAt: now,
        },
      });
    } catch (deadLetterError) {
      this.logger.error(
        `Audit dead-letter write also failed: action=${dto.action} tenantId=${dto.tenantId}`,
        deadLetterError instanceof Error ? deadLetterError.stack : String(deadLetterError),
      );
    }
  }
}
