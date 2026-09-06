// Reference: governance/GD-M37-1.md — M37 Elevation Sessions Foundation
// (all 23 Decisions; this file implements Decisions 4-17 together)
//
// Internal-service-only. No HTTP controller, route, DTO, or Swagger surface
// exists or may be added for this service (GD-M37-1 Decision 4). No method
// on this class is consulted by RolesGuard, CapabilityGuard, JwtStrategy, or
// AuthService — an ElevationSession row reaching status ACTIVE is a modeled
// data fact only ("lifecycle-active"), never a real, "authorization-effective"
// grant of access (GD-M37-1 Decision 20). See elevation-session.structural.spec.ts
// for the automated proof that no import chain connects this service to any
// runtime authorization path (GD-M37-1 Decision 17).
//
// Every lifecycle-transition method below emits its audit event via
// AuditService.logEventStrict() from inside the same $transaction as the
// state mutation (GD-M37-1 Decision 14) — a narrow exception to this
// platform's normal write-only/best-effort AuditService.logEvent() (AUD-1300).
// If the audit write fails, the whole transaction (including the state
// mutation) rolls back.

import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  ElevationSessionStatus,
  ElevationCapabilityDecision,
  ElevationSessionScopeType,
} from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import { splitCapability, joinCapability, type Capability } from './permissions.catalog';
import { isElevationSessionAllowedCapability } from './elevation-session-allowlist';

// ---------------------------------------------------------------------------
// Record types
// ---------------------------------------------------------------------------

export interface ElevationSessionCapabilityRecord {
  id: string;
  permissionId: string;
  capability: string; // resource:action, resolved from Permission for caller convenience
  decision: ElevationCapabilityDecision;
}

export interface ElevationSessionRecord {
  id: string;
  tenantId: string;
  requestedByUserId: string;
  granteeUserId: string;
  approvedByUserId: string | null;
  revokedByUserId: string | null;
  status: ElevationSessionStatus;
  purpose: string;
  requestedAt: Date;
  decidedAt: Date | null;
  activatedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  denialReason: string | null;
  idempotencyKey: string;
  capabilities: ElevationSessionCapabilityRecord[];
  // GD-M38-1 Decision 15 — additive M37 scope extension fields. Every
  // pre-M38 session row is backfilled to scopeType TENANT with both scope
  // target fields null, so existing callers reading this record continue
  // to see fully backward-compatible values.
  decisionCaseId: string | null;
  scopeType: ElevationSessionScopeType;
  scopeDepartmentId: string | null;
  scopeDecisionCaseId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const SESSION_WITH_CAPABILITIES_INCLUDE = {
  capabilities: { include: { permission: true } },
} as const;

type SessionWithCapabilities = Prisma.ElevationSessionGetPayload<{
  include: typeof SESSION_WITH_CAPABILITIES_INCLUDE;
}>;

function toElevationSessionRecord(row: SessionWithCapabilities): ElevationSessionRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    requestedByUserId: row.requestedByUserId,
    granteeUserId: row.granteeUserId,
    approvedByUserId: row.approvedByUserId,
    revokedByUserId: row.revokedByUserId,
    status: row.status,
    purpose: row.purpose,
    requestedAt: row.requestedAt,
    decidedAt: row.decidedAt,
    activatedAt: row.activatedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
    denialReason: row.denialReason,
    idempotencyKey: row.idempotencyKey,
    capabilities: row.capabilities.map((c) => ({
      id: c.id,
      permissionId: c.permissionId,
      capability: joinCapability(c.permission.resource, c.permission.action),
      decision: c.decision,
    })),
    decisionCaseId: row.decisionCaseId,
    scopeType: row.scopeType,
    scopeDepartmentId: row.scopeDepartmentId,
    scopeDecisionCaseId: row.scopeDecisionCaseId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Sentinel exceptions — thrown inside $transaction callbacks to signal a
// specific business outcome without polluting the transaction's own return
// type, mirroring UsersService's LastSaViolation pattern (users.service.ts).
// Guard checks run INSIDE the transaction to minimise the race window.
// ---------------------------------------------------------------------------

class SessionNotFoundViolation extends Error {
  constructor() {
    super('SESSION_NOT_FOUND');
  }
}

class InvalidLifecycleStateViolation extends Error {
  constructor(public readonly actualStatus: ElevationSessionStatus) {
    super('INVALID_LIFECYCLE_STATE');
  }
}

// GD-M37-1 Decision 9 — approver must differ from BOTH requester and
// grantee, with no exception, regardless of whether requester === grantee.
class ApproverSeparationViolation extends Error {
  constructor() {
    super('APPROVER_SEPARATION_VIOLATION');
  }
}

// GD-M37-1 Decision 12 — only the original requester may cancel, and only
// before any capability item has been decided.
class RequesterMismatchViolation extends Error {
  constructor() {
    super('REQUESTER_MISMATCH');
  }
}

class CapabilityAlreadyDecidedViolation extends Error {
  constructor() {
    super('CAPABILITY_ALREADY_DECIDED');
  }
}

class CapabilityItemNotPendingViolation extends Error {
  constructor(public readonly permissionId: string) {
    super('CAPABILITY_ITEM_NOT_PENDING');
  }
}

class NonTerminalSessionConflictViolation extends Error {
  constructor() {
    super('GRANTEE_HAS_NON_TERMINAL_SESSION');
  }
}

// GD-M37-1 Decision 7 — "No cross-tenant elevation session, grantee,
// requester, or approver reference is permitted." Actor-reference columns
// carry no FK (Decision 15), so this existence-and-tenant-membership check
// is the only enforcement mechanism and must not be silently omitted.
class ActorNotFoundViolation extends Error {
  constructor(
    public readonly actorRole: 'REQUESTER' | 'GRANTEE' | 'APPROVER' | 'REVOKER',
    public readonly userId: string,
  ) {
    super('ACTOR_NOT_FOUND');
  }
}

// GD-M38-1 Decision 15 — service-layer defense-in-depth for the scope
// invariants, alongside the migration-SQL CHECK constraints. Never
// consulted by isElevationLifecycleCapabilityValidAt() or any runtime
// authorization path — scope remains fully authorization-inert in M38.
// (Scope-consistency failures are returned as INVALID_SCOPE outcomes
// directly, synchronously, before any transaction opens — see
// requestElevation() — so no sentinel exception class is needed for them,
// unlike the two FK-existence violations below, which are discovered only
// inside the transaction.)
class ScopeDepartmentNotFoundViolation extends Error {
  constructor() {
    super('SCOPE_DEPARTMENT_NOT_FOUND');
  }
}

class ScopeDecisionCaseNotFoundViolation extends Error {
  constructor() {
    super('SCOPE_DECISION_CASE_NOT_FOUND');
  }
}

// ---------------------------------------------------------------------------
// requestElevation()
// ---------------------------------------------------------------------------

export interface RequestElevationInput {
  tenantId: string;
  requestedByUserId: string;
  granteeUserId: string; // may equal requestedByUserId — self-request is the ordinary case
  purpose: string;
  capabilities: string[]; // Capability key values, e.g. 'users:create'
  idempotencyKey: string;
  // -------------------------------------------------------------------
  // GD-M38-1 Decision 15 — optional, additive M37 scope extension. Every
  // field below defaults to fully backward-compatible TENANT-scope
  // behavior when omitted — existing callers require zero changes.
  // decisionCaseId is a soft correlation reference (no FK); when
  // scopeType is DECISION_CASE it MUST be supplied and becomes the
  // session's scopeDecisionCaseId as well (the two are required to match
  // — GD-M38-1's "DECISION_CASE-scoped elevation uses the authorized
  // correlating case as required").
  // -------------------------------------------------------------------
  scopeType?: ElevationSessionScopeType;
  scopeDepartmentId?: string; // required iff scopeType === DEPARTMENT
  decisionCaseId?: string; // required iff scopeType === DECISION_CASE
}

export type RequestElevationResult =
  | { outcome: 'SUCCESS'; session: ElevationSessionRecord }
  | { outcome: 'INVALID_PURPOSE' }
  | { outcome: 'NO_CAPABILITIES_REQUESTED' }
  | { outcome: 'CAPABILITY_NOT_ALLOWLISTED'; capability: string }
  | { outcome: 'CAPABILITY_NOT_FOUND'; capability: string }
  | { outcome: 'INVALID_IDEMPOTENCY_KEY' }
  | { outcome: 'ACTOR_NOT_FOUND'; actorRole: 'REQUESTER' | 'GRANTEE'; userId: string }
  | { outcome: 'DUPLICATE_IDEMPOTENCY_KEY' }
  | { outcome: 'GRANTEE_HAS_NON_TERMINAL_SESSION' }
  | { outcome: 'INVALID_SCOPE'; reason: string }
  | { outcome: 'SCOPE_DEPARTMENT_NOT_FOUND' }
  | { outcome: 'SCOPE_DECISION_CASE_NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// decideElevationCapabilities()
// ---------------------------------------------------------------------------

export interface DecideElevationCapabilitiesInput {
  sessionId: string;
  tenantId: string;
  approverUserId: string;
  decisions: Array<{ permissionId: string; decision: 'GRANTED' | 'DENIED' }>;
  denialReason?: string; // used only if this call causes the session to become DENIED
}

export type DecideElevationCapabilitiesResult =
  | { outcome: 'SUCCESS_PENDING'; session: ElevationSessionRecord } // items decided, session remains REQUESTED
  | { outcome: 'SUCCESS_APPROVED'; session: ElevationSessionRecord }
  | { outcome: 'SUCCESS_DENIED'; session: ElevationSessionRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INVALID_LIFECYCLE_STATE'; actualStatus: ElevationSessionStatus }
  | { outcome: 'APPROVER_NOT_FOUND' }
  | { outcome: 'APPROVER_SEPARATION_VIOLATION' }
  | { outcome: 'CAPABILITY_ITEM_NOT_PENDING'; permissionId: string }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// cancelElevationSession()
// ---------------------------------------------------------------------------

export interface CancelElevationSessionInput {
  sessionId: string;
  tenantId: string;
  requestedByUserId: string;
}

export type CancelElevationSessionResult =
  | { outcome: 'SUCCESS'; session: ElevationSessionRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INVALID_LIFECYCLE_STATE'; actualStatus: ElevationSessionStatus }
  | { outcome: 'REQUESTER_MISMATCH' }
  | { outcome: 'CAPABILITY_ALREADY_DECIDED' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// markElevationSessionLifecycleActive()
// ---------------------------------------------------------------------------

export interface MarkElevationSessionLifecycleActiveInput {
  sessionId: string;
  tenantId: string;
  expiresAt: Date; // mandatory once ACTIVE, never indefinite (GD-M37-1 Decision 8/11)
}

export type MarkElevationSessionLifecycleActiveResult =
  | { outcome: 'SUCCESS'; session: ElevationSessionRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INVALID_LIFECYCLE_STATE'; actualStatus: ElevationSessionStatus }
  | { outcome: 'INVALID_EXPIRATION' }
  | { outcome: 'ACTIVATION_FAILED'; session: ElevationSessionRecord }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// revokeElevationSession()
// ---------------------------------------------------------------------------

export interface RevokeElevationSessionInput {
  sessionId: string;
  tenantId: string;
  revokedByUserId: string; // NOT required to differ from requester/grantee/approver
  revokedReason: string;
}

export type RevokeElevationSessionResult =
  | { outcome: 'SUCCESS'; session: ElevationSessionRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INVALID_LIFECYCLE_STATE'; actualStatus: ElevationSessionStatus }
  | { outcome: 'INVALID_REVOCATION_REASON' }
  | { outcome: 'REVOKER_NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// reconcileExpiredElevationSession() — reporting-only (GD-M37-1 Decision 11).
// No scheduler exists or is wired to call this in M37; a future scheduler MAY
// call it for reporting purposes only. Never invoked from, and never a
// dependency of, any runtime authorization decision.
// ---------------------------------------------------------------------------

export interface ReconcileExpiredElevationSessionInput {
  sessionId: string;
  tenantId: string;
  now?: Date;
}

export type ReconcileExpiredElevationSessionResult =
  | { outcome: 'SUCCESS'; session: ElevationSessionRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INVALID_LIFECYCLE_STATE'; actualStatus: ElevationSessionStatus }
  | { outcome: 'NOT_YET_EXPIRED' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// Pure expiration/validity predicate — GD-M37-1 Decision 11's full validity
// rule, implemented and tested as a pure function. NEVER called from any
// runtime authorization path in M37 (no such path exists to call it from):
// status = ACTIVE AND tenantId matches AND now >= activatedAt AND
// now < expiresAt AND revokedAt IS NULL AND the capability's decision = GRANTED.
// ---------------------------------------------------------------------------

export interface ElevationCapabilityValidityCheck {
  session: {
    status: ElevationSessionStatus;
    tenantId: string;
    activatedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
  };
  capabilityDecision: ElevationCapabilityDecision;
  requestingTenantId: string;
  now: Date;
}

export function isElevationLifecycleCapabilityValidAt(check: ElevationCapabilityValidityCheck): boolean {
  const { session, capabilityDecision, requestingTenantId, now } = check;

  if (session.status !== ElevationSessionStatus.ACTIVE) return false;
  if (session.tenantId !== requestingTenantId) return false;
  if (session.activatedAt === null || now < session.activatedAt) return false;
  if (session.expiresAt === null || now >= session.expiresAt) return false;
  if (session.revokedAt !== null) return false;
  if (capabilityDecision !== ElevationCapabilityDecision.GRANTED) return false;

  return true;
}

// ---------------------------------------------------------------------------
// ElevationSessionService
// ---------------------------------------------------------------------------

@Injectable()
export class ElevationSessionService {
  private readonly logger = new Logger(ElevationSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // GD-M37-1 Decision 10 — every requested capability must already be one of
  // the 4 allowlisted capabilities AND resolve to a real, existing
  // identity.permissions row (referential integrity against the live M36
  // catalog). Capability -> Permission resolution happens only at
  // row-creation time; the "granted set" afterward is always the DERIVED
  // GRANTED subset, never a separately writable field.
  async requestElevation(input: RequestElevationInput): Promise<RequestElevationResult> {
    const purpose = input.purpose.trim();
    if (purpose.length === 0) {
      return { outcome: 'INVALID_PURPOSE' };
    }

    if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
      return { outcome: 'INVALID_IDEMPOTENCY_KEY' };
    }

    const requestedCapabilities = Array.from(new Set(input.capabilities));
    if (requestedCapabilities.length === 0) {
      return { outcome: 'NO_CAPABILITIES_REQUESTED' };
    }

    for (const capability of requestedCapabilities) {
      if (!isElevationSessionAllowedCapability(capability)) {
        return { outcome: 'CAPABILITY_NOT_ALLOWLISTED', capability };
      }
    }

    // GD-M38-1 Decision 15 — scope defaults to TENANT (fully
    // backward-compatible with every pre-M38 caller). Structural
    // consistency is validated synchronously here (mirrors the migration's
    // chk_elevation_sessions_scope_consistency CHECK); referenced-row
    // existence is validated inside the transaction below.
    const scopeType = input.scopeType ?? ElevationSessionScopeType.TENANT;
    let scopeValidation: { scopeDepartmentId: string | null; scopeDecisionCaseId: string | null };
    switch (scopeType) {
      case ElevationSessionScopeType.TENANT:
        if (input.scopeDepartmentId || input.decisionCaseId) {
          return { outcome: 'INVALID_SCOPE', reason: 'TENANT_SCOPE_MUST_NOT_SET_SCOPE_TARGETS' };
        }
        scopeValidation = { scopeDepartmentId: null, scopeDecisionCaseId: null };
        break;
      case ElevationSessionScopeType.DEPARTMENT:
        if (!input.scopeDepartmentId) {
          return { outcome: 'INVALID_SCOPE', reason: 'DEPARTMENT_SCOPE_REQUIRES_SCOPE_DEPARTMENT_ID' };
        }
        scopeValidation = { scopeDepartmentId: input.scopeDepartmentId, scopeDecisionCaseId: null };
        break;
      case ElevationSessionScopeType.DECISION_CASE:
        if (!input.decisionCaseId) {
          return { outcome: 'INVALID_SCOPE', reason: 'DECISION_CASE_SCOPE_REQUIRES_DECISION_CASE_ID' };
        }
        scopeValidation = { scopeDepartmentId: null, scopeDecisionCaseId: input.decisionCaseId };
        break;
      default: {
        const exhaustiveCheck: never = scopeType;
        return { outcome: 'INVALID_SCOPE', reason: `UNSUPPORTED_SCOPE_TYPE:${String(exhaustiveCheck)}` };
      }
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // GD-M37-1 Decision 7 — requester and grantee must both exist and
        // belong to this session's tenant; no cross-tenant actor reference
        // is permitted. Checked inside the transaction (guard-inside-tx
        // pattern, mirroring users.service.ts's Last-SA guard) since these
        // columns carry no FK to enforce it at the database layer.
        await this.assertActorInTenant(tx, input.requestedByUserId, input.tenantId, 'REQUESTER');
        await this.assertActorInTenant(tx, input.granteeUserId, input.tenantId, 'GRANTEE');

        // GD-M38-1 Decision 15 — real, restrictive FK targets must exist and
        // belong to this session's tenant before the row is created.
        if (scopeValidation.scopeDepartmentId) {
          const department = await tx.department.findFirst({
            where: { id: scopeValidation.scopeDepartmentId, tenantId: input.tenantId },
            select: { id: true },
          });
          if (!department) throw new ScopeDepartmentNotFoundViolation();
        }
        if (scopeValidation.scopeDecisionCaseId) {
          const decisionCase = await tx.decisionCase.findFirst({
            where: { id: scopeValidation.scopeDecisionCaseId, tenantId: input.tenantId },
            select: { id: true },
          });
          if (!decisionCase) throw new ScopeDecisionCaseNotFoundViolation();
        }

        const resolved = await this.resolvePermissionIds(tx, requestedCapabilities as Capability[]);
        if (resolved.missing.length > 0) {
          throw new CapabilityNotFoundViolation(resolved.missing[0]!);
        }

        let session: SessionWithCapabilities;
        try {
          session = await tx.elevationSession.create({
            data: {
              tenantId: input.tenantId,
              requestedByUserId: input.requestedByUserId,
              granteeUserId: input.granteeUserId,
              purpose,
              idempotencyKey: input.idempotencyKey.trim(),
              decisionCaseId: input.decisionCaseId ?? null,
              scopeType,
              scopeDepartmentId: scopeValidation.scopeDepartmentId,
              scopeDecisionCaseId: scopeValidation.scopeDecisionCaseId,
              capabilities: {
                create: resolved.permissionIds.map((permissionId) => ({ permissionId })),
              },
            },
            include: SESSION_WITH_CAPABILITIES_INCLUDE,
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const target = String(error.meta?.['target'] ?? '');
            if (target.toLowerCase().includes('idempotency')) {
              throw new DuplicateIdempotencyKeyViolation();
            }
            throw new NonTerminalSessionConflictViolation();
          }
          throw error;
        }

        await this.auditService.logEventStrict(tx, {
          tenantId: input.tenantId,
          userId: input.requestedByUserId,
          action: AuditEventType.ELEVATION_SESSION_REQUESTED,
          result: 'SUCCESS',
          entityType: 'ELEVATION_SESSION',
          entityId: session.id,
          metadata: { granteeUserId: input.granteeUserId, capabilityCount: requestedCapabilities.length },
        });

        return session;
      });

      return { outcome: 'SUCCESS', session: toElevationSessionRecord(created) };
    } catch (error) {
      if (error instanceof ActorNotFoundViolation) {
        return {
          outcome: 'ACTOR_NOT_FOUND',
          actorRole: error.actorRole as 'REQUESTER' | 'GRANTEE',
          userId: error.userId,
        };
      }
      if (error instanceof CapabilityNotFoundViolation) {
        return { outcome: 'CAPABILITY_NOT_FOUND', capability: error.capability };
      }
      if (error instanceof DuplicateIdempotencyKeyViolation) {
        return { outcome: 'DUPLICATE_IDEMPOTENCY_KEY' };
      }
      if (error instanceof NonTerminalSessionConflictViolation) {
        return { outcome: 'GRANTEE_HAS_NON_TERMINAL_SESSION' };
      }
      if (error instanceof ScopeDepartmentNotFoundViolation) {
        return { outcome: 'SCOPE_DEPARTMENT_NOT_FOUND' };
      }
      if (error instanceof ScopeDecisionCaseNotFoundViolation) {
        return { outcome: 'SCOPE_DECISION_CASE_NOT_FOUND' };
      }
      this.logger.error(
        `requestElevation failed: tenantId=${input.tenantId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  // GD-M37-1 Decision 8 — approval action may ONLY update `decision` on
  // EXISTING PENDING rows; it never inserts a row or substitutes a different
  // Permission. Once every item has a non-PENDING decision, the session
  // transitions REQUESTED -> APPROVED (>=1 GRANTED) or REQUESTED -> DENIED
  // (none GRANTED) in the same transaction (GD-M37-1 Decision 6).
  async decideElevationCapabilities(
    input: DecideElevationCapabilitiesInput,
  ): Promise<DecideElevationCapabilitiesResult> {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const session = await tx.elevationSession.findFirst({
          where: { id: input.sessionId, tenantId: input.tenantId },
          include: SESSION_WITH_CAPABILITIES_INCLUDE,
        });
        if (!session) throw new SessionNotFoundViolation();
        if (session.status !== ElevationSessionStatus.REQUESTED) {
          throw new InvalidLifecycleStateViolation(session.status);
        }

        // GD-M37-1 Decision 7 — the approver must exist and belong to this
        // session's tenant (no cross-tenant approver reference).
        await this.assertActorInTenant(tx, input.approverUserId, input.tenantId, 'APPROVER');

        // GD-M37-1 Decision 9 — approver must differ from BOTH requester and
        // grantee, with no exception. Enforced inside the transaction to
        // minimise the race window (mirrors UsersService's Last-SA guard).
        if (
          input.approverUserId === session.requestedByUserId ||
          input.approverUserId === session.granteeUserId
        ) {
          throw new ApproverSeparationViolation();
        }

        for (const decisionInput of input.decisions) {
          const item = session.capabilities.find((c) => c.permissionId === decisionInput.permissionId);
          if (!item || item.decision !== ElevationCapabilityDecision.PENDING) {
            throw new CapabilityItemNotPendingViolation(decisionInput.permissionId);
          }
        }

        for (const decisionInput of input.decisions) {
          await tx.elevationSessionCapability.update({
            where: { elevationSessionId_permissionId: {
              elevationSessionId: input.sessionId,
              permissionId: decisionInput.permissionId,
            } },
            data: { decision: decisionInput.decision as ElevationCapabilityDecision },
          });
        }

        await this.auditService.logEventStrict(tx, {
          tenantId: input.tenantId,
          userId: input.approverUserId,
          action: AuditEventType.ELEVATION_SESSION_CAPABILITY_DECIDED,
          result: 'SUCCESS',
          entityType: 'ELEVATION_SESSION',
          entityId: input.sessionId,
          metadata: { decidedCount: input.decisions.length },
        });

        const remainingPending = await tx.elevationSessionCapability.count({
          where: { elevationSessionId: input.sessionId, decision: ElevationCapabilityDecision.PENDING },
        });

        if (remainingPending > 0) {
          const stillPending = await tx.elevationSession.findFirstOrThrow({
            where: { id: input.sessionId },
            include: SESSION_WITH_CAPABILITIES_INCLUDE,
          });
          return { kind: 'PENDING' as const, session: stillPending };
        }

        const grantedCount = await tx.elevationSessionCapability.count({
          where: { elevationSessionId: input.sessionId, decision: ElevationCapabilityDecision.GRANTED },
        });
        const newStatus = grantedCount > 0 ? ElevationSessionStatus.APPROVED : ElevationSessionStatus.DENIED;

        const decided = await tx.elevationSession.update({
          where: { id: input.sessionId },
          data: {
            status: newStatus,
            decidedAt: new Date(),
            approvedByUserId: input.approverUserId,
            denialReason: newStatus === ElevationSessionStatus.DENIED ? (input.denialReason ?? null) : null,
          },
          include: SESSION_WITH_CAPABILITIES_INCLUDE,
        });

        await this.auditService.logEventStrict(tx, {
          tenantId: input.tenantId,
          userId: input.approverUserId,
          action:
            newStatus === ElevationSessionStatus.APPROVED
              ? AuditEventType.ELEVATION_SESSION_APPROVED
              : AuditEventType.ELEVATION_SESSION_DENIED,
          result: 'SUCCESS',
          entityType: 'ELEVATION_SESSION',
          entityId: input.sessionId,
        });

        return { kind: newStatus === ElevationSessionStatus.APPROVED ? ('APPROVED' as const) : ('DENIED' as const), session: decided };
      });

      if (result.kind === 'PENDING') {
        return { outcome: 'SUCCESS_PENDING', session: toElevationSessionRecord(result.session) };
      }
      if (result.kind === 'APPROVED') {
        return { outcome: 'SUCCESS_APPROVED', session: toElevationSessionRecord(result.session) };
      }
      return { outcome: 'SUCCESS_DENIED', session: toElevationSessionRecord(result.session) };
    } catch (error) {
      if (error instanceof SessionNotFoundViolation) return { outcome: 'NOT_FOUND' };
      if (error instanceof InvalidLifecycleStateViolation) {
        return { outcome: 'INVALID_LIFECYCLE_STATE', actualStatus: error.actualStatus };
      }
      if (error instanceof ActorNotFoundViolation) return { outcome: 'APPROVER_NOT_FOUND' };
      if (error instanceof ApproverSeparationViolation) return { outcome: 'APPROVER_SEPARATION_VIOLATION' };
      if (error instanceof CapabilityItemNotPendingViolation) {
        return { outcome: 'CAPABILITY_ITEM_NOT_PENDING', permissionId: error.permissionId };
      }
      this.logger.error(
        `decideElevationCapabilities failed: sessionId=${input.sessionId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  // GD-M37-1 Decision 6/12 — CANCELLED is only reachable from REQUESTED,
  // only before any item has been decided, and carries no
  // revokedByUserId/revokedReason (distinct from REVOKED).
  async cancelElevationSession(input: CancelElevationSessionInput): Promise<CancelElevationSessionResult> {
    try {
      const session = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.elevationSession.findFirst({
          where: { id: input.sessionId, tenantId: input.tenantId },
          include: SESSION_WITH_CAPABILITIES_INCLUDE,
        });
        if (!existing) throw new SessionNotFoundViolation();
        if (existing.status !== ElevationSessionStatus.REQUESTED) {
          throw new InvalidLifecycleStateViolation(existing.status);
        }
        if (existing.requestedByUserId !== input.requestedByUserId) {
          throw new RequesterMismatchViolation();
        }
        const anyDecided = existing.capabilities.some(
          (c) => c.decision !== ElevationCapabilityDecision.PENDING,
        );
        if (anyDecided) throw new CapabilityAlreadyDecidedViolation();

        const cancelled = await tx.elevationSession.update({
          where: { id: input.sessionId },
          data: { status: ElevationSessionStatus.CANCELLED },
          include: SESSION_WITH_CAPABILITIES_INCLUDE,
        });

        await this.auditService.logEventStrict(tx, {
          tenantId: input.tenantId,
          userId: input.requestedByUserId,
          action: AuditEventType.ELEVATION_SESSION_CANCELLED,
          result: 'SUCCESS',
          entityType: 'ELEVATION_SESSION',
          entityId: input.sessionId,
        });

        return cancelled;
      });

      return { outcome: 'SUCCESS', session: toElevationSessionRecord(session) };
    } catch (error) {
      if (error instanceof SessionNotFoundViolation) return { outcome: 'NOT_FOUND' };
      if (error instanceof InvalidLifecycleStateViolation) {
        return { outcome: 'INVALID_LIFECYCLE_STATE', actualStatus: error.actualStatus };
      }
      if (error instanceof RequesterMismatchViolation) return { outcome: 'REQUESTER_MISMATCH' };
      if (error instanceof CapabilityAlreadyDecidedViolation) return { outcome: 'CAPABILITY_ALREADY_DECIDED' };
      this.logger.error(
        `cancelElevationSession failed: sessionId=${input.sessionId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  // GD-M37-1 Decision 6/13 — APPROVED -> ACTIVE on success, or
  // APPROVED -> ACTIVATION_FAILED (terminal) if the "at most one non-terminal
  // session per (tenantId, granteeUserId)" guarantee is found violated at the
  // moment of activation. The database-level partial unique index
  // (idx_elevation_sessions_tenant_grantee_non_terminal) is the primary
  // enforcement mechanism; this defensive re-check exists to surface
  // ACTIVATION_FAILED deterministically rather than letting a raw constraint
  // violation propagate as an unhandled error.
  async markElevationSessionLifecycleActive(input: MarkElevationSessionLifecycleActiveInput): Promise<MarkElevationSessionLifecycleActiveResult> {
    if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.getTime()) || input.expiresAt <= new Date()) {
      return { outcome: 'INVALID_EXPIRATION' };
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.elevationSession.findFirst({
          where: { id: input.sessionId, tenantId: input.tenantId },
          include: SESSION_WITH_CAPABILITIES_INCLUDE,
        });
        if (!existing) throw new SessionNotFoundViolation();
        if (existing.status !== ElevationSessionStatus.APPROVED) {
          throw new InvalidLifecycleStateViolation(existing.status);
        }

        const conflictingCount = await tx.elevationSession.count({
          where: {
            tenantId: input.tenantId,
            granteeUserId: existing.granteeUserId,
            id: { not: existing.id },
            status: { in: [ElevationSessionStatus.REQUESTED, ElevationSessionStatus.APPROVED, ElevationSessionStatus.ACTIVE] },
          },
        });

        if (conflictingCount > 0) {
          const failed = await tx.elevationSession.update({
            where: { id: input.sessionId },
            data: { status: ElevationSessionStatus.ACTIVATION_FAILED },
            include: SESSION_WITH_CAPABILITIES_INCLUDE,
          });

          await this.auditService.logEventStrict(tx, {
            tenantId: input.tenantId,
            userId: existing.granteeUserId,
            action: AuditEventType.ELEVATION_SESSION_ACTIVATION_FAILED,
            result: 'FAILURE',
            entityType: 'ELEVATION_SESSION',
            entityId: input.sessionId,
            metadata: { reason: 'CONCURRENT_NON_TERMINAL_SESSION' },
          });

          return { kind: 'FAILED' as const, session: failed };
        }

        let activated: SessionWithCapabilities;
        try {
          activated = await tx.elevationSession.update({
            where: { id: input.sessionId },
            data: {
              status: ElevationSessionStatus.ACTIVE,
              activatedAt: new Date(),
              expiresAt: input.expiresAt,
            },
            include: SESSION_WITH_CAPABILITIES_INCLUDE,
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const failed = await tx.elevationSession.update({
              where: { id: input.sessionId },
              data: { status: ElevationSessionStatus.ACTIVATION_FAILED },
              include: SESSION_WITH_CAPABILITIES_INCLUDE,
            });
            await this.auditService.logEventStrict(tx, {
              tenantId: input.tenantId,
              userId: existing.granteeUserId,
              action: AuditEventType.ELEVATION_SESSION_ACTIVATION_FAILED,
              result: 'FAILURE',
              entityType: 'ELEVATION_SESSION',
              entityId: input.sessionId,
              metadata: { reason: 'CONCURRENT_ACTIVATION_CONFLICT' },
            });
            return { kind: 'FAILED' as const, session: failed };
          }
          throw error;
        }

        await this.auditService.logEventStrict(tx, {
          tenantId: input.tenantId,
          userId: existing.granteeUserId,
          action: AuditEventType.ELEVATION_SESSION_ACTIVATED,
          result: 'SUCCESS',
          entityType: 'ELEVATION_SESSION',
          entityId: input.sessionId,
        });

        return { kind: 'ACTIVE' as const, session: activated };
      });

      if (result.kind === 'FAILED') {
        return { outcome: 'ACTIVATION_FAILED', session: toElevationSessionRecord(result.session) };
      }
      return { outcome: 'SUCCESS', session: toElevationSessionRecord(result.session) };
    } catch (error) {
      if (error instanceof SessionNotFoundViolation) return { outcome: 'NOT_FOUND' };
      if (error instanceof InvalidLifecycleStateViolation) {
        return { outcome: 'INVALID_LIFECYCLE_STATE', actualStatus: error.actualStatus };
      }
      this.logger.error(
        `markElevationSessionLifecycleActive failed: sessionId=${input.sessionId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  // GD-M37-1 Decision 6/12 — ACTIVE -> REVOKED only. revokedByUserId is NOT
  // required to differ from requester/grantee/approver (self-revocation,
  // requester-initiated, or an independent actor are all permitted).
  async revokeElevationSession(input: RevokeElevationSessionInput): Promise<RevokeElevationSessionResult> {
    const revokedReason = input.revokedReason.trim();
    if (revokedReason.length === 0) {
      return { outcome: 'INVALID_REVOCATION_REASON' };
    }

    try {
      const session = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.elevationSession.findFirst({
          where: { id: input.sessionId, tenantId: input.tenantId },
          include: SESSION_WITH_CAPABILITIES_INCLUDE,
        });
        if (!existing) throw new SessionNotFoundViolation();
        if (existing.status !== ElevationSessionStatus.ACTIVE) {
          throw new InvalidLifecycleStateViolation(existing.status);
        }

        // SEC-003 / GD-M37-1 Decision 7's general tenant-isolation discipline
        // — the revoker must exist and belong to this session's tenant, even
        // though Decision 9/12 impose no distinctness requirement on who the
        // revoker may be relative to the other actors.
        await this.assertActorInTenant(tx, input.revokedByUserId, input.tenantId, 'REVOKER');

        const revoked = await tx.elevationSession.update({
          where: { id: input.sessionId },
          data: {
            status: ElevationSessionStatus.REVOKED,
            revokedAt: new Date(),
            revokedByUserId: input.revokedByUserId,
            revokedReason,
          },
          include: SESSION_WITH_CAPABILITIES_INCLUDE,
        });

        await this.auditService.logEventStrict(tx, {
          tenantId: input.tenantId,
          userId: input.revokedByUserId,
          action: AuditEventType.ELEVATION_SESSION_REVOKED,
          result: 'SUCCESS',
          entityType: 'ELEVATION_SESSION',
          entityId: input.sessionId,
        });

        return revoked;
      });

      return { outcome: 'SUCCESS', session: toElevationSessionRecord(session) };
    } catch (error) {
      if (error instanceof SessionNotFoundViolation) return { outcome: 'NOT_FOUND' };
      if (error instanceof InvalidLifecycleStateViolation) {
        return { outcome: 'INVALID_LIFECYCLE_STATE', actualStatus: error.actualStatus };
      }
      if (error instanceof ActorNotFoundViolation) return { outcome: 'REVOKER_NOT_FOUND' };
      this.logger.error(
        `revokeElevationSession failed: sessionId=${input.sessionId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  // GD-M37-1 Decision 11 — reporting-only reconciliation. Not called by any
  // scheduler in M37 (none exists); not called by, and not a dependency of,
  // any runtime authorization path. Provided only so a future, separately
  // governed scheduler has a well-defined, tested, transactional operation
  // to call for reporting purposes.
  async reconcileExpiredElevationSession(
    input: ReconcileExpiredElevationSessionInput,
  ): Promise<ReconcileExpiredElevationSessionResult> {
    const now = input.now ?? new Date();

    try {
      const session = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.elevationSession.findFirst({
          where: { id: input.sessionId, tenantId: input.tenantId },
          include: SESSION_WITH_CAPABILITIES_INCLUDE,
        });
        if (!existing) throw new SessionNotFoundViolation();
        if (existing.status !== ElevationSessionStatus.ACTIVE) {
          throw new InvalidLifecycleStateViolation(existing.status);
        }
        if (existing.expiresAt === null || now < existing.expiresAt) {
          throw new NotYetExpiredViolation();
        }

        const expired = await tx.elevationSession.update({
          where: { id: input.sessionId },
          data: { status: ElevationSessionStatus.EXPIRED },
          include: SESSION_WITH_CAPABILITIES_INCLUDE,
        });

        await this.auditService.logEventStrict(tx, {
          tenantId: input.tenantId,
          userId: existing.granteeUserId,
          action: AuditEventType.ELEVATION_SESSION_EXPIRED,
          result: 'SUCCESS',
          entityType: 'ELEVATION_SESSION',
          entityId: input.sessionId,
        });

        return expired;
      });

      return { outcome: 'SUCCESS', session: toElevationSessionRecord(session) };
    } catch (error) {
      if (error instanceof SessionNotFoundViolation) return { outcome: 'NOT_FOUND' };
      if (error instanceof InvalidLifecycleStateViolation) {
        return { outcome: 'INVALID_LIFECYCLE_STATE', actualStatus: error.actualStatus };
      }
      if (error instanceof NotYetExpiredViolation) return { outcome: 'NOT_YET_EXPIRED' };
      this.logger.error(
        `reconcileExpiredElevationSession failed: sessionId=${input.sessionId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }
  }

  // Tenant-scoped read. Returns null (not found) rather than throwing, so
  // callers cannot distinguish "wrong tenant" from "does not exist" (no
  // cross-tenant enumeration), matching UsersService.getUserById()'s pattern.
  async getElevationSessionById(id: string, tenantId: string): Promise<ElevationSessionRecord | null> {
    const row = await this.prisma.elevationSession.findFirst({
      where: { id, tenantId },
      include: SESSION_WITH_CAPABILITIES_INCLUDE,
    });
    return row ? toElevationSessionRecord(row) : null;
  }

  // GD-M37-1 Decision 7 — "No cross-tenant elevation session, grantee,
  // requester, or approver reference is permitted." Actor-reference columns
  // carry no FK to identity.users (Decision 15), so an actor's existence and
  // tenant membership can only be enforced here, at the service layer — it
  // must never be silently omitted. A missing or wrong-tenant identifier
  // fails closed (throws), never silently proceeds.
  private async assertActorInTenant(
    tx: Prisma.TransactionClient,
    userId: string,
    tenantId: string,
    actorRole: 'REQUESTER' | 'GRANTEE' | 'APPROVER' | 'REVOKER',
  ): Promise<void> {
    if (!userId) {
      throw new ActorNotFoundViolation(actorRole, userId);
    }
    const actor = await tx.user.findFirst({ where: { id: userId, tenantId }, select: { id: true } });
    if (!actor) {
      throw new ActorNotFoundViolation(actorRole, userId);
    }
  }

  private async resolvePermissionIds(
    tx: Prisma.TransactionClient,
    capabilities: Capability[],
  ): Promise<{ permissionIds: string[]; missing: string[] }> {
    const splits = capabilities.map((c) => ({ capability: c, ...splitCapability(c) }));
    const rows = await tx.permission.findMany({
      where: { OR: splits.map(({ resource, action }) => ({ resource, action })) },
    });

    const found = new Map<string, string>(); // capability -> permissionId
    for (const row of rows) {
      found.set(joinCapability(row.resource, row.action), row.id);
    }

    const permissionIds: string[] = [];
    const missing: string[] = [];
    for (const { capability } of splits) {
      const permissionId = found.get(capability);
      if (permissionId) {
        permissionIds.push(permissionId);
      } else {
        missing.push(capability);
      }
    }

    return { permissionIds, missing };
  }
}

class CapabilityNotFoundViolation extends Error {
  constructor(public readonly capability: string) {
    super('CAPABILITY_NOT_FOUND');
  }
}

class DuplicateIdempotencyKeyViolation extends Error {
  constructor() {
    super('DUPLICATE_IDEMPOTENCY_KEY');
  }
}

class NotYetExpiredViolation extends Error {
  constructor() {
    super('NOT_YET_EXPIRED');
  }
}
