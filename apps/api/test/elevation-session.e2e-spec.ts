// Reference: governance/GD-M37-1.md — M37 Elevation Sessions Foundation
// (Decision 14 strict audit-write, Decision 13 concurrency/idempotency,
// Decision 9 actor separation, Decision 7 tenant isolation)
//
// Real-database integration tests — no HTTP, no supertest, no NestJS
// application bootstrap. M37 has no controller (GD-M37-1 Decision 4), so
// this exercises PrismaService + AuditService + ElevationSessionService
// directly against the repository's local development PostgreSQL instance,
// following this repo's existing test/*.e2e-spec.ts convention (real
// PrismaClient, self-contained fixtures created in beforeAll and deleted in
// afterAll) but without the parts of that convention (app.init(), supertest)
// that only make sense for an HTTP-facing milestone.
//
// This file exists specifically because elevation-session.service.spec.ts's
// mocked $transaction cannot prove: (a) a forced audit-write failure actually
// rolls back the real database row, (b) the partial unique index and
// tenant-scoped idempotency index actually reject concurrent conflicting
// writes at the database layer, and (c) the approver-separation CHECK
// constraint actually rejects a direct write that bypasses the service.

import 'reflect-metadata';
import { PrismaClient, ElevationSessionStatus } from '@prisma/client';

import type { PrismaService } from '../src/database/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { AuditEventType } from '../src/audit/enums/audit-event-type.enum';
import { CAPABILITIES } from '../src/identity/permissions.catalog';
import { ElevationSessionService } from '../src/identity/elevation-session.service';

const FIXTURE_PASSWORD_HASH = '$2b$12$e2eFixtureHashNotARealBcryptHash1234567';
const SUFFIX = Date.now();
const FIXTURE_TENANT_CODE = `E2E-ELEVATION-${SUFFIX}`;
const CROSS_TENANT_CODE = `E2E-ELEVATION-CROSS-${SUFFIX}`;

describe('ElevationSessionService (real database)', () => {
  let prisma: PrismaClient;
  let auditService: AuditService;
  let service: ElevationSessionService;

  let tenantId: string;
  let crossTenantId: string;
  let requesterId: string;
  let granteeId: string;
  let approverId: string;
  let revokerId: string;
  let crossTenantUserId: string;
  let usersCreatePermissionId: string;
  let usersReadPermissionId: string;

  const createdSessionIds: string[] = [];
  const extraUserIds: string[] = [];

  // Each independent scenario below needs its own grantee: a grantee with a
  // lingering non-terminal (REQUESTED/APPROVED/ACTIVE) session from an
  // earlier test would correctly trip the Decision 13 partial-unique-index
  // guarantee under test elsewhere in this file — that is real, intended
  // enforcement, not a bug, so cross-scenario fixture isolation requires a
  // fresh grantee per independent scenario rather than reusing one.
  let makeFreshGrantee: () => Promise<string>;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    auditService = new AuditService(prisma as unknown as PrismaService);
    service = new ElevationSessionService(prisma as unknown as PrismaService, auditService);

    const tenant = await prisma.tenant.create({
      data: { name: 'E2E Elevation Tenant', code: FIXTURE_TENANT_CODE, status: 'ACTIVE' },
    });
    tenantId = tenant.id;

    const crossTenant = await prisma.tenant.create({
      data: { name: 'E2E Elevation Cross Tenant', code: CROSS_TENANT_CODE, status: 'ACTIVE' },
    });
    crossTenantId = crossTenant.id;

    async function makeUser(emailPrefix: string, tenant: string): Promise<string> {
      const user = await prisma.user.create({
        data: {
          tenantId: tenant,
          email: `${emailPrefix}-${SUFFIX}@test.gov`,
          passwordHash: FIXTURE_PASSWORD_HASH,
          firstName: 'E2E',
          lastName: emailPrefix,
          status: 'ACTIVE',
          failedLoginAttempts: 0,
        },
      });
      return user.id;
    }

    requesterId = await makeUser('elevation-requester', tenantId);
    granteeId = await makeUser('elevation-grantee', tenantId);
    approverId = await makeUser('elevation-approver', tenantId);
    revokerId = await makeUser('elevation-revoker', tenantId);
    crossTenantUserId = await makeUser('elevation-cross', crossTenantId);

    let freshGranteeCounter = 0;
    makeFreshGrantee = async () => {
      freshGranteeCounter += 1;
      const id = await makeUser(`elevation-fresh-grantee-${freshGranteeCounter}`, tenantId);
      extraUserIds.push(id);
      return id;
    };

    const usersCreatePermission = await prisma.permission.findFirstOrThrow({
      where: { resource: 'users', action: 'create' },
    });
    usersCreatePermissionId = usersCreatePermission.id;

    const usersReadPermission = await prisma.permission.findFirstOrThrow({
      where: { resource: 'users', action: 'read' },
    });
    usersReadPermissionId = usersReadPermission.id;
  });

  afterAll(async () => {
    if (prisma) {
      if (createdSessionIds.length > 0) {
        await prisma.elevationSessionCapability
          .deleteMany({ where: { elevationSessionId: { in: createdSessionIds } } })
          .catch(() => {});
        await prisma.elevationSession.deleteMany({ where: { id: { in: createdSessionIds } } }).catch(() => {});
      }
      // Sweep any session left over from a test that intentionally created
      // extras beyond createdSessionIds (concurrency tests below).
      await prisma.elevationSessionCapability
        .deleteMany({ where: { elevationSession: { tenantId: { in: [tenantId, crossTenantId] } } } })
        .catch(() => {});
      await prisma.elevationSession
        .deleteMany({ where: { tenantId: { in: [tenantId, crossTenantId] } } })
        .catch(() => {});

      const actorIds = [requesterId, granteeId, approverId, revokerId, crossTenantUserId, ...extraUserIds].filter(
        Boolean,
      );
      if (actorIds.length > 0) {
        await prisma.auditEvent.deleteMany({ where: { userId: { in: actorIds } } }).catch(() => {});
      }
      for (const id of [requesterId, granteeId, approverId, revokerId, crossTenantUserId, ...extraUserIds]) {
        if (id) await prisma.user.delete({ where: { id } }).catch(() => {});
      }
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
      await prisma.tenant.delete({ where: { id: crossTenantId } }).catch(() => {});

      await prisma.$disconnect();
    }
  });

  // --------------------------------------------------------------------------
  // Strict audit transactionality (GD-M37-1 Decision 14)
  // --------------------------------------------------------------------------

  describe('strict elevation audit-write transactionality', () => {
    it('SUCCESS: the state transition and its audit event are both committed together', async () => {
      const result = await service.requestElevation({
        tenantId,
        requestedByUserId: requesterId,
        granteeUserId: granteeId,
        purpose: 'E2E: prove commit-together',
        capabilities: [CAPABILITIES.USERS_CREATE],
        idempotencyKey: `e2e-commit-${SUFFIX}`,
      });

      expect(result.outcome).toBe('SUCCESS');
      const sessionId = (result as { outcome: 'SUCCESS'; session: { id: string } }).session.id;
      createdSessionIds.push(sessionId);

      const row = await prisma.elevationSession.findUnique({ where: { id: sessionId } });
      expect(row).not.toBeNull();
      expect(row!.status).toBe(ElevationSessionStatus.REQUESTED);

      const auditRow = await prisma.auditEvent.findFirst({
        where: { entityId: sessionId, action: AuditEventType.ELEVATION_SESSION_REQUESTED },
      });
      expect(auditRow).not.toBeNull();
      expect(auditRow!.result).toBe('SUCCESS');
    });

    it('FORCED AUDIT FAILURE: rolls back the state mutation — no ElevationSession row is left behind', async () => {
      const spy = jest.spyOn(auditService, 'logEventStrict').mockRejectedValueOnce(new Error('forced audit failure'));
      const freshGrantee = await makeFreshGrantee();

      const idempotencyKey = `e2e-rollback-${SUFFIX}`;
      const result = await service.requestElevation({
        tenantId,
        requestedByUserId: requesterId,
        granteeUserId: freshGrantee,
        purpose: 'E2E: prove rollback-together',
        capabilities: [CAPABILITIES.USERS_READ],
        idempotencyKey,
      });

      expect(result.outcome).toBe('INTERNAL_ERROR');

      const row = await prisma.elevationSession.findFirst({ where: { tenantId, idempotencyKey } });
      expect(row).toBeNull(); // proves the transaction rolled back — no partial row committed

      spy.mockRestore();
    });

    it('after a forced-failure rollback, the same idempotencyKey can be used again (no orphaned row blocking retry)', async () => {
      const freshGrantee = await makeFreshGrantee();
      const idempotencyKey = `e2e-rollback-retry-${SUFFIX}`;
      const spy = jest.spyOn(auditService, 'logEventStrict').mockRejectedValueOnce(new Error('forced audit failure'));

      const failed = await service.requestElevation({
        tenantId,
        requestedByUserId: requesterId,
        granteeUserId: freshGrantee,
        purpose: 'E2E: first attempt fails',
        capabilities: [CAPABILITIES.USERS_READ],
        idempotencyKey,
      });
      expect(failed.outcome).toBe('INTERNAL_ERROR');
      spy.mockRestore();

      const retried = await service.requestElevation({
        tenantId,
        requestedByUserId: requesterId,
        granteeUserId: freshGrantee,
        purpose: 'E2E: retry succeeds',
        capabilities: [CAPABILITIES.USERS_READ],
        idempotencyKey,
      });
      expect(retried.outcome).toBe('SUCCESS');
      createdSessionIds.push((retried as { outcome: 'SUCCESS'; session: { id: string } }).session.id);
    });
  });

  // --------------------------------------------------------------------------
  // Concurrency and database-backed constraints (GD-M37-1 Decision 13)
  // --------------------------------------------------------------------------

  describe('concurrency and database constraints', () => {
    it('CONCURRENCY: two concurrent requests with the same tenant-scoped idempotencyKey — exactly one SUCCEEDS, the DB has exactly one row', async () => {
      const idempotencyKey = `e2e-concurrent-idem-${SUFFIX}`;
      // Distinct grantees so only the (tenantId, idempotencyKey) unique index
      // is contended by this race — the separate (tenantId, granteeUserId)
      // partial-unique-index race is isolated in its own test below. Racing
      // both constraints in the same pair of concurrent inserts risks a
      // genuine Postgres deadlock (two transactions each holding one index's
      // lock while waiting on the other), which would prove nothing about
      // either constraint individually.
      const granteeA = await makeFreshGrantee();
      const granteeB = await makeFreshGrantee();
      const [a, b] = await Promise.all([
        service.requestElevation({
          tenantId,
          requestedByUserId: requesterId,
          granteeUserId: granteeA,
          purpose: 'E2E: concurrent idempotency A',
          capabilities: [CAPABILITIES.USERS_READ],
          idempotencyKey,
        }),
        service.requestElevation({
          tenantId,
          requestedByUserId: requesterId,
          granteeUserId: granteeB,
          purpose: 'E2E: concurrent idempotency B',
          capabilities: [CAPABILITIES.USERS_READ],
          idempotencyKey,
        }),
      ]);

      const outcomes = [a.outcome, b.outcome].sort();
      expect(outcomes).toEqual(['DUPLICATE_IDEMPOTENCY_KEY', 'SUCCESS']);

      const rows = await prisma.elevationSession.findMany({ where: { tenantId, idempotencyKey } });
      expect(rows).toHaveLength(1);
      createdSessionIds.push(rows[0]!.id);
    });

    it('CONCURRENCY: two concurrent non-terminal requests for the same (tenant, grantee) — exactly one SUCCEEDS, the DB has exactly one non-terminal row for that grantee', async () => {
      const [a, b] = await Promise.all([
        service.requestElevation({
          tenantId,
          requestedByUserId: requesterId,
          granteeUserId: revokerId, // distinct grantee, reused as a plain grantee here
          purpose: 'E2E: concurrent grantee A',
          capabilities: [CAPABILITIES.USERS_READ],
          idempotencyKey: `e2e-concurrent-grantee-a-${SUFFIX}`,
        }),
        service.requestElevation({
          tenantId,
          requestedByUserId: requesterId,
          granteeUserId: revokerId,
          purpose: 'E2E: concurrent grantee B',
          capabilities: [CAPABILITIES.USERS_READ],
          idempotencyKey: `e2e-concurrent-grantee-b-${SUFFIX}`,
        }),
      ]);

      const outcomes = [a.outcome, b.outcome].sort();
      expect(outcomes).toEqual(['GRANTEE_HAS_NON_TERMINAL_SESSION', 'SUCCESS']);

      const nonTerminalRows = await prisma.elevationSession.findMany({
        where: {
          tenantId,
          granteeUserId: revokerId,
          status: { in: [ElevationSessionStatus.REQUESTED, ElevationSessionStatus.APPROVED, ElevationSessionStatus.ACTIVE] },
        },
      });
      expect(nonTerminalRows).toHaveLength(1);
      createdSessionIds.push(nonTerminalRows[0]!.id);
    });

    it('DB CONSTRAINT: a duplicate (elevationSessionId, permissionId) row is rejected directly by the database, bypassing the service', async () => {
      const freshGrantee = await makeFreshGrantee();
      const created = await service.requestElevation({
        tenantId,
        requestedByUserId: requesterId,
        granteeUserId: freshGrantee,
        purpose: 'E2E: per-session duplicate permission proof',
        capabilities: [CAPABILITIES.USERS_UPDATE],
        idempotencyKey: `e2e-dup-permission-${SUFFIX}`,
      });
      expect(created.outcome).toBe('SUCCESS');
      const sessionId = (created as { outcome: 'SUCCESS'; session: { id: string } }).session.id;
      createdSessionIds.push(sessionId);

      const usersUpdatePermission = await prisma.permission.findFirstOrThrow({
        where: { resource: 'users', action: 'update' },
      });

      await expect(
        prisma.elevationSessionCapability.create({
          data: { elevationSessionId: sessionId, permissionId: usersUpdatePermission.id },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('DB CONSTRAINT: the approver-separation CHECK constraint rejects approvedByUserId === requestedByUserId even via a direct write bypassing the service', async () => {
      const freshGrantee = await makeFreshGrantee();
      const created = await service.requestElevation({
        tenantId,
        requestedByUserId: requesterId,
        granteeUserId: freshGrantee,
        purpose: 'E2E: approver-separation CHECK constraint proof',
        capabilities: [CAPABILITIES.USERS_READ],
        idempotencyKey: `e2e-check-constraint-${SUFFIX}`,
      });
      expect(created.outcome).toBe('SUCCESS');
      const sessionId = (created as { outcome: 'SUCCESS'; session: { id: string } }).session.id;
      createdSessionIds.push(sessionId);

      let thrown: unknown;
      try {
        await prisma.elevationSession.update({
          where: { id: sessionId },
          data: { approvedByUserId: requesterId }, // deliberately violates the CHECK constraint
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeDefined();

      // The row must remain unchanged — the CHECK constraint must have
      // rejected the write outright, not partially applied it.
      const row = await prisma.elevationSession.findUnique({ where: { id: sessionId } });
      expect(row!.approvedByUserId).toBeNull();
    });

    it('TENANT ISOLATION: a grantee belonging to a different tenant fails closed with ACTOR_NOT_FOUND', async () => {
      const result = await service.requestElevation({
        tenantId,
        requestedByUserId: requesterId,
        granteeUserId: crossTenantUserId, // real user, but in crossTenantId, not tenantId
        purpose: 'E2E: cross-tenant grantee must fail closed',
        capabilities: [CAPABILITIES.USERS_READ],
        idempotencyKey: `e2e-cross-tenant-${SUFFIX}`,
      });

      expect(result.outcome).toBe('ACTOR_NOT_FOUND');

      const rows = await prisma.elevationSession.findMany({
        where: { tenantId, idempotencyKey: `e2e-cross-tenant-${SUFFIX}` },
      });
      expect(rows).toHaveLength(0);
    });

    it('TERMINAL-STATE IMMUTABILITY: a second decide attempt on an already-decided item is rejected after a real DB round trip', async () => {
      const freshGrantee = await makeFreshGrantee();
      const created = await service.requestElevation({
        tenantId,
        requestedByUserId: requesterId,
        granteeUserId: freshGrantee,
        purpose: 'E2E: terminal immutability proof',
        capabilities: [CAPABILITIES.USERS_READ],
        idempotencyKey: `e2e-immutability-${SUFFIX}`,
      });
      expect(created.outcome).toBe('SUCCESS');
      const session = (created as { outcome: 'SUCCESS'; session: { id: string; capabilities: Array<{ permissionId: string }> } }).session;
      createdSessionIds.push(session.id);

      const first = await service.decideElevationCapabilities({
        sessionId: session.id,
        tenantId,
        approverUserId: approverId,
        decisions: [{ permissionId: usersReadPermissionId, decision: 'GRANTED' }],
      });
      expect(first.outcome).toBe('SUCCESS_APPROVED');

      const dbRow = await prisma.elevationSession.findUnique({ where: { id: session.id } });
      expect(dbRow!.status).toBe(ElevationSessionStatus.APPROVED);

      // Conflicting approval attempt: session has already left REQUESTED.
      const second = await service.decideElevationCapabilities({
        sessionId: session.id,
        tenantId,
        approverUserId: approverId,
        decisions: [{ permissionId: usersReadPermissionId, decision: 'DENIED' }],
      });
      expect(second.outcome).toBe('INVALID_LIFECYCLE_STATE');

      const unchangedRow = await prisma.elevationSessionCapability.findFirst({
        where: { elevationSessionId: session.id, permissionId: usersReadPermissionId },
      });
      expect(unchangedRow!.decision).toBe('GRANTED'); // never flipped to DENIED
    });
  });

  // --------------------------------------------------------------------------
  // Full lifecycle happy path against the real database
  // --------------------------------------------------------------------------

  describe('full lifecycle against the real database', () => {
    it('REQUESTED -> APPROVED -> ACTIVE -> REVOKED, each transition persisted and independently re-readable', async () => {
      const freshGrantee = await makeFreshGrantee();
      const created = await service.requestElevation({
        tenantId,
        requestedByUserId: requesterId,
        granteeUserId: freshGrantee,
        purpose: 'E2E: full lifecycle proof',
        capabilities: [CAPABILITIES.USERS_CREATE],
        idempotencyKey: `e2e-full-lifecycle-${SUFFIX}`,
      });
      expect(created.outcome).toBe('SUCCESS');
      const sessionId = (created as { outcome: 'SUCCESS'; session: { id: string } }).session.id;
      createdSessionIds.push(sessionId);

      const approved = await service.decideElevationCapabilities({
        sessionId,
        tenantId,
        approverUserId: approverId,
        decisions: [{ permissionId: usersCreatePermissionId, decision: 'GRANTED' }],
      });
      expect(approved.outcome).toBe('SUCCESS_APPROVED');

      const activated = await service.markElevationSessionLifecycleActive({
        sessionId,
        tenantId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      expect(activated.outcome).toBe('SUCCESS');

      const activeRow = await prisma.elevationSession.findUnique({ where: { id: sessionId } });
      expect(activeRow!.status).toBe(ElevationSessionStatus.ACTIVE);
      expect(activeRow!.activatedAt).not.toBeNull();
      expect(activeRow!.expiresAt).not.toBeNull();

      const revoked = await service.revokeElevationSession({
        sessionId,
        tenantId,
        revokedByUserId: freshGrantee, // self-revocation, permitted per GD-M37-1 Decision 12
        revokedReason: 'E2E: no longer needed',
      });
      expect(revoked.outcome).toBe('SUCCESS');

      const finalRow = await prisma.elevationSession.findUnique({ where: { id: sessionId } });
      expect(finalRow!.status).toBe(ElevationSessionStatus.REVOKED);
      expect(finalRow!.revokedByUserId).toBe(freshGrantee);

      const auditActions = await prisma.auditEvent.findMany({
        where: { entityId: sessionId },
        select: { action: true },
      });
      const actionSet = new Set(auditActions.map((a) => a.action));
      expect(actionSet.has(AuditEventType.ELEVATION_SESSION_REQUESTED)).toBe(true);
      expect(actionSet.has(AuditEventType.ELEVATION_SESSION_APPROVED)).toBe(true);
      expect(actionSet.has(AuditEventType.ELEVATION_SESSION_ACTIVATED)).toBe(true);
      expect(actionSet.has(AuditEventType.ELEVATION_SESSION_REVOKED)).toBe(true);
    });
  });
});
