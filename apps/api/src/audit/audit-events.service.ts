import { Injectable, Logger } from '@nestjs/common';
import { AuditWriteFailureStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from './audit.service';
import { AuditChainVerificationService } from './audit-chain-verification.service';
import { AuditEventType } from './enums/audit-event-type.enum';
import { filterAuditEventMetadata } from './audit-response-allowlist';
import { ListAuditEventsQueryDto } from './dto/list-audit-events-query.dto';

// Reference: governance/GD-M39-1.md — Decision 16 (five endpoints), Decision
// 17 (audit-read API design), Decision 18 (metadata/PII controls),
// Decision 19 (approval/elevation correlation), Decision 20 (viewer),
// Decision 21 (operational visibility)
//
// A "recorded late" event is one whose createdAt materially differs from
// its occurredAt (Decision 5/20) — an implementation-time threshold, not
// itself governed to an exact value; five seconds comfortably exceeds
// ordinary same-transaction processing jitter while still catching a
// genuine recovered-write replay (which is always at least one full
// recovery-worker cycle later).
const RECORDED_LATE_THRESHOLD_MS = 5000;

export interface AuditEventResponseShape {
  id: string;
  tenantId: string;
  actorUserId: string;
  actorDisplayName: string | null;
  action: string;
  result: string;
  entityType: string | null;
  entityId: string | null;
  occurredAt: string;
  createdAt: string;
  recordedLate: boolean;
  metadata: Record<string, unknown> | null;
}

export type ListAuditEventsResult =
  | { outcome: 'SUCCESS'; events: AuditEventResponseShape[]; nextCursor: string | null }
  | { outcome: 'INVALID_CURSOR' };

export type GetAuditEventResult =
  | { outcome: 'SUCCESS'; event: AuditEventResponseShape }
  | { outcome: 'NOT_FOUND' };

export interface RecoveryStatusSummary {
  counts: { pending: number; inProgress: number; abandoned: number; retried: number };
  abandonedFailures: Array<{
    id: string;
    action: string;
    entityType: string | null;
    entityId: string | null;
    occurredAt: string;
    attemptCount: number;
    failureReason: string;
  }>;
  chain: {
    status: 'OK' | 'BROKEN' | 'UNVERIFIED';
    lastVerifiedAt: string | null;
    nextVerificationAt: string | null;
  };
}

export type RequeueResult =
  | { outcome: 'SUCCESS'; failureId: string }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'NOT_ABANDONED'; currentStatus: string }
  | { outcome: 'INTERNAL_ERROR' };

export type ReverifyResult = { outcome: 'SUCCESS' } | { outcome: 'INTERNAL_ERROR' };

class FailureNotFoundViolation extends Error {
  constructor() {
    super('FAILURE_NOT_FOUND');
  }
}

class NotAbandonedViolation extends Error {
  constructor(public readonly currentStatus: string) {
    super('NOT_ABANDONED');
  }
}

interface CursorPayload {
  createdAt: string;
  id: string;
}

@Injectable()
export class AuditEventsService {
  private readonly logger = new Logger(AuditEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly chainVerificationService: AuditChainVerificationService,
  ) {}

  // GD-M39-1 Decision 17 — cursor pagination on (createdAt, id), newest
  // first. Filters combine as AND; caseId and search each contribute their
  // own OR clause, kept structurally separate so the two never collapse
  // into a single, incorrect OR across unrelated conditions.
  async listAuditEvents(
    tenantId: string,
    actorUserId: string,
    query: ListAuditEventsQueryDto,
  ): Promise<ListAuditEventsResult> {
    const pageSize = query.pageSize ?? 20;

    let cursor: CursorPayload | null = null;
    if (query.cursor) {
      cursor = decodeCursor(query.cursor);
      if (!cursor) {
        return { outcome: 'INVALID_CURSOR' };
      }
    }

    const andClauses: Prisma.AuditEventWhereInput[] = [{ tenantId }];

    if (query.occurredAtFrom || query.occurredAtTo) {
      andClauses.push({
        occurredAt: {
          ...(query.occurredAtFrom ? { gte: new Date(query.occurredAtFrom) } : {}),
          ...(query.occurredAtTo ? { lte: new Date(query.occurredAtTo) } : {}),
        },
      });
    }
    if (query.actorUserId) andClauses.push({ userId: query.actorUserId });
    if (query.action) andClauses.push({ action: query.action });
    if (query.result) andClauses.push({ result: query.result });
    if (query.entityType) andClauses.push({ entityType: query.entityType });
    if (query.entityId) andClauses.push({ entityId: query.entityId });

    if (query.caseId) {
      const approvalRequests = await this.prisma.approvalRequest.findMany({
        where: { tenantId, decisionCaseId: query.caseId },
        select: { id: true },
      });
      andClauses.push({
        OR: [
          { entityType: 'DECISION_CASE', entityId: query.caseId },
          { entityType: 'APPROVAL_REQUEST', entityId: { in: approvalRequests.map((r) => r.id) } },
        ],
      });
    }

    if (query.search) {
      const term = query.search.trim();
      if (term.length > 0) {
        andClauses.push({
          OR: [
            { action: { contains: term, mode: 'insensitive' } },
            { entityType: { contains: term, mode: 'insensitive' } },
            { result: { contains: term, mode: 'insensitive' } },
          ],
        });
      }
    }

    if (cursor) {
      const cursorCreatedAt = new Date(cursor.createdAt);
      andClauses.push({
        OR: [
          { createdAt: { lt: cursorCreatedAt } },
          { AND: [{ createdAt: cursorCreatedAt }, { id: { lt: cursor.id } }] },
        ],
      });
    }

    const rows = await this.prisma.auditEvent.findMany({
      where: { AND: andClauses },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
    });

    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const nextCursor = hasMore
      ? encodeCursor({
          createdAt: pageRows[pageRows.length - 1]!.createdAt.toISOString(),
          id: pageRows[pageRows.length - 1]!.id,
        })
      : null;

    const actorDisplayNames = await this.resolveActorDisplayNames(
      tenantId,
      pageRows.map((r) => r.userId),
    );

    await this.emitAuditLogQueried(tenantId, actorUserId);

    return {
      outcome: 'SUCCESS',
      events: pageRows.map((row) => toResponseShape(row, actorDisplayNames.get(row.userId) ?? null)),
      nextCursor,
    };
  }

  async getAuditEventById(
    tenantId: string,
    actorUserId: string,
    id: string,
  ): Promise<GetAuditEventResult> {
    const row = await this.prisma.auditEvent.findFirst({ where: { id, tenantId } });
    if (!row) {
      return { outcome: 'NOT_FOUND' };
    }

    const actorDisplayNames = await this.resolveActorDisplayNames(tenantId, [row.userId]);
    await this.emitAuditLogQueried(tenantId, actorUserId);

    return {
      outcome: 'SUCCESS',
      event: toResponseShape(row, actorDisplayNames.get(row.userId) ?? null),
    };
  }

  // GD-M39-1 Decision 16/20 — sanitized recovery + chain-health summary
  // only. Aggregate counts and a bounded list of ABANDONED failures (ids,
  // safe fields only — no metadata, no raw failure payload) so a System
  // Administrator can identify a candidate for manual requeue without this
  // endpoint ever exposing raw metadata or a raw database error.
  async getRecoveryStatus(tenantId: string, actorUserId: string): Promise<RecoveryStatusSummary> {
    const [pending, inProgress, abandoned, retried, abandonedFailures, chainState] = await Promise.all([
      this.prisma.auditWriteFailure.count({ where: { tenantId, status: AuditWriteFailureStatus.PENDING } }),
      this.prisma.auditWriteFailure.count({ where: { tenantId, status: AuditWriteFailureStatus.IN_PROGRESS } }),
      this.prisma.auditWriteFailure.count({ where: { tenantId, status: AuditWriteFailureStatus.ABANDONED } }),
      this.prisma.auditWriteFailure.count({ where: { tenantId, status: AuditWriteFailureStatus.RETRIED } }),
      this.prisma.auditWriteFailure.findMany({
        where: { tenantId, status: AuditWriteFailureStatus.ABANDONED },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
      this.prisma.auditChainState.findUnique({ where: { tenantId } }),
    ]);

    await this.emitAuditLogQueried(tenantId, actorUserId);

    return {
      counts: { pending, inProgress, abandoned, retried },
      abandonedFailures: abandonedFailures.map((f) => ({
        id: f.id,
        action: f.action,
        entityType: f.entityType,
        entityId: f.entityId,
        occurredAt: f.occurredAt.toISOString(),
        attemptCount: f.attemptCount,
        failureReason: f.failureReason,
      })),
      chain: {
        status: chainState?.lastVerificationResult ?? 'UNVERIFIED',
        lastVerifiedAt: chainState?.lastVerifiedAt?.toISOString() ?? null,
        nextVerificationAt: chainState?.nextVerificationAt?.toISOString() ?? null,
      },
    };
  }

  // GD-M39-1 Decision 14/16 — requeue accepts no replacement event payload;
  // only an ABANDONED row may be requeued; history/attemptCount are
  // untouched; one transaction, atomic with its AUDIT_WRITE_RECOVERY_REQUEUED
  // logEventStrict() write.
  async requeueFailedWrite(
    tenantId: string,
    failureId: string,
    actorUserId: string,
  ): Promise<RequeueResult> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const failure = await tx.auditWriteFailure.findFirst({ where: { id: failureId, tenantId } });
        if (!failure) throw new FailureNotFoundViolation();
        if (failure.status !== AuditWriteFailureStatus.ABANDONED) {
          throw new NotAbandonedViolation(failure.status);
        }

        await tx.auditWriteFailure.update({
          where: { id: failureId },
          data: { status: AuditWriteFailureStatus.PENDING, nextAttemptAt: new Date() },
        });

        await this.auditService.logEventStrict(tx, {
          tenantId,
          userId: actorUserId,
          action: AuditEventType.AUDIT_WRITE_RECOVERY_REQUEUED,
          result: 'SUCCESS',
          entityType: 'AUDIT_WRITE_FAILURE',
          entityId: failureId,
        });
      });

      return { outcome: 'SUCCESS', failureId };
    } catch (error) {
      if (error instanceof FailureNotFoundViolation) return { outcome: 'NOT_FOUND' };
      if (error instanceof NotAbandonedViolation) {
        return { outcome: 'NOT_ABANDONED', currentStatus: error.currentStatus };
      }
      this.logger.error(
        `requeueFailedWrite failed: tenantId=${tenantId} failureId=${failureId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  // GD-M39-1 Decision 14/16 — no tenant payload (caller tenant only);
  // schedules nextVerificationAt = now() only, never a synchronous
  // repair/rehash. One transaction, atomic with its
  // AUDIT_CHAIN_REVERIFICATION_REQUESTED logEventStrict() write.
  async requestReverification(tenantId: string, actorUserId: string): Promise<ReverifyResult> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.chainVerificationService.scheduleImmediateVerification(tx, tenantId);
        await this.auditService.logEventStrict(tx, {
          tenantId,
          userId: actorUserId,
          action: AuditEventType.AUDIT_CHAIN_REVERIFICATION_REQUESTED,
          result: 'SUCCESS',
          entityType: 'AUDIT_CHAIN_STATE',
          entityId: tenantId,
        });
      });
      return { outcome: 'SUCCESS' };
    } catch (error) {
      this.logger.error(
        `requestReverification failed: tenantId=${tenantId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  // GD-M39-1 Decision 17 — tenant-safe actor resolution: fails closed
  // (returns null display name, never a name) if the joined row isn't
  // found in-tenant. Batched to avoid N+1 queries on a list page.
  private async resolveActorDisplayNames(
    tenantId: string,
    userIds: string[],
  ): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length === 0) return new Map();

    const users = await this.prisma.user.findMany({
      where: { id: { in: uniqueIds }, tenantId },
      select: { id: true, firstName: true, lastName: true },
    });

    const result = new Map<string, string>();
    for (const user of users) {
      result.set(user.id, `${user.firstName} ${user.lastName}`.trim());
    }
    return result;
  }

  // GD-M39-1 Decision 17 — every read via this API emits AUDIT_LOG_QUERIED,
  // via logEvent() (best-effort, not strict — a read-triggered event, not a
  // governed mutation). Never stores returned records or filter values.
  private async emitAuditLogQueried(tenantId: string, actorUserId: string): Promise<void> {
    await this.auditService.logEvent({
      tenantId,
      userId: actorUserId,
      action: AuditEventType.AUDIT_LOG_QUERIED,
      result: 'SUCCESS',
    });
  }
}

function toResponseShape(
  row: { id: string; tenantId: string; userId: string; action: string; result: string; entityType: string | null; entityId: string | null; occurredAt: Date; createdAt: Date; metadata: unknown },
  actorDisplayName: string | null,
): AuditEventResponseShape {
  const recordedLate = row.createdAt.getTime() - row.occurredAt.getTime() > RECORDED_LATE_THRESHOLD_MS;

  return {
    id: row.id,
    tenantId: row.tenantId,
    actorUserId: row.userId,
    actorDisplayName,
    action: row.action,
    result: row.result,
    entityType: row.entityType,
    entityId: row.entityId,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    recordedLate,
    metadata: filterAuditEventMetadata(row.action, row.metadata),
  };
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      decoded !== null &&
      typeof decoded === 'object' &&
      typeof (decoded as CursorPayload).createdAt === 'string' &&
      typeof (decoded as CursorPayload).id === 'string' &&
      !Number.isNaN(new Date((decoded as CursorPayload).createdAt).getTime())
    ) {
      return decoded as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}
