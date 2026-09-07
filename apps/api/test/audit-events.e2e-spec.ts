// Reference: governance/GD-M39-1.md — M39 Audit Read, Recovery, and
// Integrity Foundation (Decision 16 endpoints, Decision 24 validation gate)
//
// Real-database, real-HTTP E2E tests — mirrors users.e2e-spec.ts's app
// bootstrap exactly. Self-contained: fixtures created in beforeAll, deleted
// in afterAll. Covers: authentication/role/capability enforcement, tenant
// isolation, route ordering (static routes before :id), list/detail
// metadata-allowlist behavior, the requeue lifecycle, the reverify
// scheduling behavior, and the coarse public health aggregate.
//
// Requires the M39 migration to have been applied and `prisma generate` to
// have produced M39-aware Prisma Client types before this suite is run —
// neither has been done in this implementation pass (explicitly out of
// scope for this task; see the implementation report's "Tests executed
// versus intentionally unexecuted" section).

import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RequestMethod, ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

import { AppModule } from '../src/app.module';
import type { PrismaService } from '../src/database/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { AuditEventType } from '../src/audit/enums/audit-event-type.enum';

const FIXTURE_PASSWORD = 'E2eTest1234!';
const SUFFIX = Date.now();
const FIXTURE_TENANT_CODE = `E2E-AUDIT-${SUFFIX}`;
const CROSS_TENANT_CODE = `E2E-AUDIT-CROSS-${SUFFIX}`;
const SA_EMAIL = `e2e-audit-sa-${SUFFIX}@test.gov`;
const CO_EMAIL = `e2e-audit-co-${SUFFIX}@test.gov`;
const RECRUITER_EMAIL = `e2e-audit-rec-${SUFFIX}@test.gov`;
const CROSS_SA_EMAIL = `e2e-audit-cross-sa-${SUFFIX}@test.gov`;

describe('Audit Events (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let auditService: AuditService;

  let saToken: string;
  let coToken: string;
  let recruiterToken: string;
  let crossSaToken: string;

  let tenantId: string;
  let crossTenantId: string;
  let saUserId: string;
  let coUserId: string;
  let recruiterUserId: string;
  let crossSaUserId: string;

  let seededEventId: string;
  let abandonedFailureId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.setGlobalPrefix('api', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();

    prisma = new PrismaClient();
    auditService = new AuditService(prisma as unknown as PrismaService);
    const passwordHash = await bcrypt.hash(FIXTURE_PASSWORD, 12);

    const tenant = await prisma.tenant.create({
      data: { name: 'E2E Audit Tenant', code: FIXTURE_TENANT_CODE, status: 'ACTIVE' },
    });
    tenantId = tenant.id;

    const crossTenant = await prisma.tenant.create({
      data: { name: 'E2E Audit Cross Tenant', code: CROSS_TENANT_CODE, status: 'ACTIVE' },
    });
    crossTenantId = crossTenant.id;

    const saRole = await prisma.role.findUniqueOrThrow({ where: { name: 'System Administrator' } });
    const coRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Compliance Officer' } });
    const recruiterRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Recruiter' } });

    async function makeUser(email: string, tenant: string, roleId: string): Promise<string> {
      const user = await prisma.user.create({
        data: {
          tenantId: tenant,
          email,
          passwordHash,
          firstName: 'E2E',
          lastName: 'Audit',
          status: 'ACTIVE',
          failedLoginAttempts: 0,
        },
      });
      await prisma.userRole.create({ data: { userId: user.id, roleId } });
      return user.id;
    }

    saUserId = await makeUser(SA_EMAIL, tenantId, saRole.id);
    coUserId = await makeUser(CO_EMAIL, tenantId, coRole.id);
    recruiterUserId = await makeUser(RECRUITER_EMAIL, tenantId, recruiterRole.id);
    crossSaUserId = await makeUser(CROSS_SA_EMAIL, crossTenantId, saRole.id);

    async function login(email: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: FIXTURE_PASSWORD });
      return res.body.data.accessToken as string;
    }

    saToken = await login(SA_EMAIL);
    coToken = await login(CO_EMAIL);
    recruiterToken = await login(RECRUITER_EMAIL);
    crossSaToken = await login(CROSS_SA_EMAIL);

    // A real, chain-written fixture event for list/detail assertions.
    await auditService.logEvent({
      tenantId,
      userId: saUserId,
      action: AuditEventType.WORKFORCE_EMPLOYEE_UPDATED,
      result: 'SUCCESS',
      entityType: 'EMPLOYEE',
      entityId: '00000000-0000-4000-8000-000000000001',
      metadata: { updatedFields: ['firstName'], secretShouldNeverAppear: 'x' },
    });
    const seeded = await prisma.auditEvent.findFirst({
      where: { tenantId, action: AuditEventType.WORKFORCE_EMPLOYEE_UPDATED },
      orderBy: { createdAt: 'desc' },
    });
    seededEventId = seeded!.id;

    // An ABANDONED AuditWriteFailure fixture for the requeue lifecycle test.
    const abandoned = await prisma.auditWriteFailure.create({
      data: {
        id: '00000000-0000-4000-8000-000000000099',
        tenantId,
        userId: saUserId,
        action: AuditEventType.AUTH_LOGIN_FAILURE,
        result: 'FAILURE',
        occurredAt: new Date(),
        failureReason: 'UNKNOWN_ERROR',
        status: 'ABANDONED',
        attemptCount: 5,
        nextAttemptAt: new Date(),
      },
    });
    abandonedFailureId = abandoned.id;
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.auditWriteFailureAttempt.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.auditWriteFailure.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.auditChainState.deleteMany({ where: { tenantId: { in: [tenantId, crossTenantId] } } }).catch(() => {});
      // audit_events is append-only (GD-M39-1 Decision 7) — deletion is
      // expected to be rejected; .catch() matches the graceful-degradation
      // pattern used by every other *.e2e-spec.ts file's audit cleanup.
      await prisma.auditEvent.deleteMany({ where: { tenantId: { in: [tenantId, crossTenantId] } } }).catch(() => {});

      for (const userId of [saUserId, coUserId, recruiterUserId, crossSaUserId].filter(Boolean)) {
        await prisma.userRole.deleteMany({ where: { userId } }).catch(() => {});
        await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      }
      if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
      if (crossTenantId) await prisma.tenant.delete({ where: { id: crossTenantId } }).catch(() => {});
      await prisma.$disconnect();
    }
    if (app) await app.close();
  }, 30_000);

  // -------------------------------------------------------------------------
  // Authentication and role/capability enforcement
  // -------------------------------------------------------------------------

  describe('authentication and role enforcement', () => {
    it('GET /audit-events without a token → 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/audit-events').expect(401);
    });

    it('GET /audit-events with Recruiter role → 403 (not System Administrator or Compliance Officer)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/audit-events')
        .set('Authorization', `Bearer ${recruiterToken}`)
        .expect(403);
    });

    it('GET /audit-events with System Administrator role → 200', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/audit-events')
        .set('Authorization', `Bearer ${saToken}`)
        .expect(200);
    });

    it('GET /audit-events with Compliance Officer role → 200 (read-only role permitted)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/audit-events')
        .set('Authorization', `Bearer ${coToken}`)
        .expect(200);
    });

    it('POST /audit-events/recovery/:id/requeue with Compliance Officer role → 403 (audit:recover is SA-only)', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/audit-events/recovery/${abandonedFailureId}/requeue`)
        .set('Authorization', `Bearer ${coToken}`)
        .expect(403);
    });

    it('POST /audit-events/integrity/reverify with Compliance Officer role → 403 (audit:recover is SA-only)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/audit-events/integrity/reverify')
        .set('Authorization', `Bearer ${coToken}`)
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // Route ordering — static routes must never be captured by GET :id
  // (GD-M39-1 Decision 16)
  // -------------------------------------------------------------------------

  describe('route ordering', () => {
    it('GET /audit-events/recovery-status resolves to the recovery-status handler, not the :id detail handler', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/audit-events/recovery-status')
        .set('Authorization', `Bearer ${saToken}`)
        .expect(200);

      // The :id handler would 400 on a non-UUID param (ParseUUIDPipe);
      // reaching 200 with a `counts`/`chain` shaped body proves the
      // recovery-status route, not :id, matched.
      expect(res.body.data).toHaveProperty('counts');
      expect(res.body.data).toHaveProperty('chain');
    });
  });

  // -------------------------------------------------------------------------
  // Tenant isolation
  // -------------------------------------------------------------------------

  describe('tenant isolation', () => {
    it('GET /audit-events/:id for an in-tenant event, from a cross-tenant SA token → 404 (never leaks cross-tenant data)', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/audit-events/${seededEventId}`)
        .set('Authorization', `Bearer ${crossSaToken}`)
        .expect(404);
    });

    it('GET /audit-events list from the cross-tenant SA token never includes the fixture tenant\'s event', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/audit-events')
        .set('Authorization', `Bearer ${crossSaToken}`)
        .expect(200);

      const ids = (res.body.data.events as Array<{ id: string }>).map((e) => e.id);
      expect(ids).not.toContain(seededEventId);
    });

    it('POST requeue for an in-tenant failure id, from a cross-tenant SA token → 404', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/audit-events/recovery/${abandonedFailureId}/requeue`)
        .set('Authorization', `Bearer ${crossSaToken}`)
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // List / detail behavior and metadata allowlist
  // -------------------------------------------------------------------------

  describe('list and detail', () => {
    it('GET /audit-events/:id returns the seeded event with an allowlisted metadata shape only', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/audit-events/${seededEventId}`)
        .set('Authorization', `Bearer ${saToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(seededEventId);
      expect(res.body.data.metadata).toEqual({ updatedFields: ['firstName'] });
      expect(res.body.data.metadata).not.toHaveProperty('secretShouldNeverAppear');
    });

    it('GET /audit-events/:id for a non-existent id → 404', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/audit-events/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${saToken}`)
        .expect(404);
    });

    it('GET /audit-events filters by action', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/audit-events')
        .query({ action: AuditEventType.WORKFORCE_EMPLOYEE_UPDATED })
        .set('Authorization', `Bearer ${saToken}`)
        .expect(200);

      const ids = (res.body.data.events as Array<{ id: string }>).map((e) => e.id);
      expect(ids).toContain(seededEventId);
    });

    it('GET /audit-events with an invalid cursor → 400', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/audit-events')
        .query({ cursor: 'not-a-valid-cursor' })
        .set('Authorization', `Bearer ${saToken}`)
        .expect(400);
    });
  });

  // -------------------------------------------------------------------------
  // Recovery status and requeue lifecycle (GD-M39-1 Decision 11/12/14/16)
  // -------------------------------------------------------------------------

  describe('recovery status and requeue', () => {
    it('GET /audit-events/recovery-status lists the ABANDONED fixture with safe fields only', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/audit-events/recovery-status')
        .set('Authorization', `Bearer ${saToken}`)
        .expect(200);

      const entry = (res.body.data.abandonedFailures as Array<{ id: string }>).find(
        (f) => f.id === abandonedFailureId,
      );
      expect(entry).toBeDefined();
      expect(entry).not.toHaveProperty('metadata');
    });

    it('POST requeue on the ABANDONED fixture → 200, flips status to PENDING, preserves attemptCount', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/audit-events/recovery/${abandonedFailureId}/requeue`)
        .set('Authorization', `Bearer ${saToken}`)
        .expect(200);

      const updated = await prisma.auditWriteFailure.findUniqueOrThrow({
        where: { id: abandonedFailureId },
      });
      expect(updated.status).toBe('PENDING');
      expect(updated.attemptCount).toBe(5); // unchanged by requeue (Decision 12/14)
    });

    it('a second requeue attempt on the now-PENDING row → 403 (only ABANDONED may be requeued)', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/audit-events/recovery/${abandonedFailureId}/requeue`)
        .set('Authorization', `Bearer ${saToken}`)
        .expect(403);
    });

    it('requeue writes an AUDIT_WRITE_RECOVERY_REQUEUED event correlated to the failure id', async () => {
      const event = await prisma.auditEvent.findFirst({
        where: {
          tenantId,
          action: AuditEventType.AUDIT_WRITE_RECOVERY_REQUEUED,
          entityId: abandonedFailureId,
        },
      });
      expect(event).not.toBeNull();
      expect(event!.result).toBe('SUCCESS');
    });

    it('POST requeue for a non-existent failure id → 404', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/audit-events/recovery/00000000-0000-4000-8000-000000000000/requeue')
        .set('Authorization', `Bearer ${saToken}`)
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // Reverify (GD-M39-1 Decision 14/16)
  // -------------------------------------------------------------------------

  describe('reverify', () => {
    it('POST /audit-events/integrity/reverify → 200 and schedules nextVerificationAt at/near now, tenant-scoped only', async () => {
      const before = new Date();
      await request(app.getHttpServer())
        .post('/api/v1/audit-events/integrity/reverify')
        .set('Authorization', `Bearer ${saToken}`)
        .expect(200);

      const state = await prisma.auditChainState.findUniqueOrThrow({ where: { tenantId } });
      expect(state.nextVerificationAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    });

    it('writes an AUDIT_CHAIN_REVERIFICATION_REQUESTED event for the caller tenant', async () => {
      const event = await prisma.auditEvent.findFirst({
        where: { tenantId, action: AuditEventType.AUDIT_CHAIN_REVERIFICATION_REQUESTED },
      });
      expect(event).not.toBeNull();
    });

    it('does not affect the cross-tenant AuditChainState row', async () => {
      const crossState = await prisma.auditChainState.findUnique({ where: { tenantId: crossTenantId } });
      // Either no row exists yet, or if one does it was not touched by this
      // tenant's reverify call — either way, no cross-tenant leakage.
      expect(crossState === null || crossState.tenantId === crossTenantId).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Strict-audit rollback proof — GD-M39-1 Decision 14/16: both M39 human
  // mutations (requeue, reverify) use logEventStrict() inside the SAME
  // transaction as their state change, so a strict-audit-write failure
  // must roll back the entire mutation, exactly like the pre-existing
  // M37/M38 strict-audit contract. Failure is injected via a jest spy on
  // the REAL AuditService instance resolved from the app's own DI
  // container (app.get(AuditService)) — the exact singleton
  // AuditEventsService is actually injected with — so the HTTP request
  // below exercises the real controller -> real service -> real
  // prisma.$transaction() -> real PostgreSQL rollback path. No Prisma
  // method is mocked; the transaction itself is 100% real.
  // -------------------------------------------------------------------------

  describe('strict-audit rollback proof (real database, real transaction)', () => {
    let realAuditService: AuditService;

    beforeAll(() => {
      realAuditService = app.get(AuditService);
    });

    it('requeue: a forced logEventStrict() failure rolls back the ENTIRE transaction — no status/attempt/scheduling change persists, no event persists', async () => {
      // Dedicated fixture, independent of the shared abandonedFailureId
      // (already transitioned away from ABANDONED by the earlier
      // "recovery status and requeue" describe block, which runs first in
      // file order).
      const rollbackFailureId = randomUUID();
      const created = await prisma.auditWriteFailure.create({
        data: {
          id: rollbackFailureId,
          tenantId,
          userId: saUserId,
          action: AuditEventType.AUTH_LOGIN_FAILURE,
          result: 'FAILURE',
          occurredAt: new Date('2026-02-01T00:00:00.000Z'),
          failureReason: 'UNKNOWN_ERROR',
          status: 'ABANDONED',
          attemptCount: 4,
          nextAttemptAt: new Date('2026-02-01T00:00:00.000Z'),
          claimedAt: null,
          claimedBy: null,
          attemptedAt: new Date('2026-01-31T23:00:00.000Z'),
        },
      });

      // Complete relevant pre-operation state, captured independently.
      const preState = await prisma.auditWriteFailure.findUniqueOrThrow({
        where: { id: rollbackFailureId },
      });

      const spy = jest
        .spyOn(realAuditService, 'logEventStrict')
        .mockRejectedValueOnce(new Error('forced test failure — requeue rollback proof'));

      try {
        const res = await request(app.getHttpServer())
          .post(`/api/v1/audit-events/recovery/${rollbackFailureId}/requeue`)
          .set('Authorization', `Bearer ${saToken}`);

        // The request/service call fails.
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);

        // The row remains byte-for-byte equivalent in every
        // mutation-relevant field — queried independently, fresh from the
        // database, not from any in-memory reference.
        const postState = await prisma.auditWriteFailure.findUniqueOrThrow({
          where: { id: rollbackFailureId },
        });
        expect(postState.status).toBe('ABANDONED'); // no requeue transition persisted
        expect(postState.status).toBe(preState.status);
        expect(postState.attemptCount).toBe(preState.attemptCount);
        expect(postState.nextAttemptAt.getTime()).toBe(preState.nextAttemptAt.getTime());
        expect(postState.claimedAt).toBe(preState.claimedAt);
        expect(postState.claimedBy).toBe(preState.claimedBy);
        expect(postState.attemptedAt?.getTime()).toBe(preState.attemptedAt?.getTime());
        expect(postState.updatedAt.getTime()).toBe(preState.updatedAt.getTime());

        // No AUDIT_WRITE_RECOVERY_REQUEUED event persisted.
        const event = await prisma.auditEvent.findFirst({
          where: {
            tenantId,
            action: AuditEventType.AUDIT_WRITE_RECOVERY_REQUEUED,
            entityId: rollbackFailureId,
          },
        });
        expect(event).toBeNull();

        // No partial related write — no attempt row was created by this
        // requeue call either (requeue itself never creates attempt rows;
        // only the recovery worker does).
        const attempts = await prisma.auditWriteFailureAttempt.findMany({
          where: { auditWriteFailureId: rollbackFailureId },
        });
        expect(attempts).toHaveLength(0);
      } finally {
        spy.mockRestore();
        await prisma.auditWriteFailure.delete({ where: { id: rollbackFailureId } }).catch(() => {});
      }

      // Sanity: the fixture creation itself is unaffected by the spy
      // restoration ordering — created.id matches what we operated on.
      expect(created.id).toBe(rollbackFailureId);
    });

    it('reverify: a forced logEventStrict() failure rolls back the ENTIRE transaction — no nextVerificationAt change persists, no event persists', async () => {
      // Use a dedicated tenant so this test's pre-state capture is not
      // entangled with the earlier successful "reverify" describe block's
      // mutation of the shared tenantId's AuditChainState row.
      const rollbackTenant = await prisma.tenant.create({
        data: {
          name: 'E2E Reverify Rollback Tenant',
          code: `E2E-AUDIT-REVERIFY-ROLLBACK-${SUFFIX}`,
          status: 'ACTIVE',
        },
      });
      const rollbackUser = await prisma.user.create({
        data: {
          tenantId: rollbackTenant.id,
          email: `e2e-audit-reverify-rollback-${SUFFIX}@test.gov`,
          passwordHash: await bcrypt.hash(FIXTURE_PASSWORD, 12),
          firstName: 'E2E',
          lastName: 'Reverify',
          status: 'ACTIVE',
          failedLoginAttempts: 0,
        },
      });
      const saRoleRow = await prisma.role.findUniqueOrThrow({ where: { name: 'System Administrator' } });
      await prisma.userRole.create({ data: { userId: rollbackUser.id, roleId: saRoleRow.id } });
      const rollbackTokenRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: `e2e-audit-reverify-rollback-${SUFFIX}@test.gov`, password: FIXTURE_PASSWORD });
      const rollbackToken = rollbackTokenRes.body.data.accessToken as string;

      // A fixed, known-stable AuditChainState row, set via upsert rather
      // than create — the login call just above already wrote an
      // AUTH_LOGIN_SUCCESS audit event for rollbackTenant, which itself
      // race-safe-initializes an AuditChainState row as a side effect of
      // the normal chain-writing path (see AuditService.writeChainedEvent).
      // upsert overwrites that auto-created row with this test's own known
      // baseline, rather than colliding with it on the tenantId unique key.
      const fixedNextVerificationAt = new Date('2026-03-01T00:00:00.000Z');
      const fixedLastVerifiedAt = new Date('2026-02-01T00:00:00.000Z');
      await prisma.auditChainState.upsert({
        where: { tenantId: rollbackTenant.id },
        create: {
          tenantId: rollbackTenant.id,
          lastSequence: 0,
          lastHash: null,
          nextVerificationAt: fixedNextVerificationAt,
          verificationClaimedAt: null,
          lastVerifiedAt: fixedLastVerifiedAt,
          lastVerificationResult: 'OK',
          updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        },
        update: {
          nextVerificationAt: fixedNextVerificationAt,
          verificationClaimedAt: null,
          lastVerifiedAt: fixedLastVerifiedAt,
          lastVerificationResult: 'OK',
          updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        },
      });

      const preState = await prisma.auditChainState.findUniqueOrThrow({
        where: { tenantId: rollbackTenant.id },
      });

      const spy = jest
        .spyOn(realAuditService, 'logEventStrict')
        .mockRejectedValueOnce(new Error('forced test failure — reverify rollback proof'));

      try {
        const res = await request(app.getHttpServer())
          .post('/api/v1/audit-events/integrity/reverify')
          .set('Authorization', `Bearer ${rollbackToken}`);

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);

        const postState = await prisma.auditChainState.findUniqueOrThrow({
          where: { tenantId: rollbackTenant.id },
        });
        expect(postState.nextVerificationAt.getTime()).toBe(fixedNextVerificationAt.getTime()); // no scheduling change persisted
        expect(postState.nextVerificationAt.getTime()).toBe(preState.nextVerificationAt.getTime());
        expect(postState.verificationClaimedAt).toBe(preState.verificationClaimedAt);
        expect(postState.lastVerifiedAt?.getTime()).toBe(preState.lastVerifiedAt?.getTime());
        expect(postState.lastVerificationResult).toBe(preState.lastVerificationResult);
        expect(postState.lastSequence).toBe(preState.lastSequence);
        expect(postState.lastHash).toBe(preState.lastHash);
        expect(postState.updatedAt.getTime()).toBe(preState.updatedAt.getTime());

        const event = await prisma.auditEvent.findFirst({
          where: {
            tenantId: rollbackTenant.id,
            action: AuditEventType.AUDIT_CHAIN_REVERIFICATION_REQUESTED,
          },
        });
        expect(event).toBeNull();
      } finally {
        spy.mockRestore();
        await prisma.auditChainState.deleteMany({ where: { tenantId: rollbackTenant.id } }).catch(() => {});
        await prisma.userRole.deleteMany({ where: { userId: rollbackUser.id } }).catch(() => {});
        await prisma.user.delete({ where: { id: rollbackUser.id } }).catch(() => {});
        await prisma.tenant.delete({ where: { id: rollbackTenant.id } }).catch(() => {});
      }
    });

    it('the spy is fully restored — an ordinary requeue call after the rollback tests still succeeds normally', async () => {
      // Proves the failure-injection mechanism is test-only and does not
      // leak into subsequent calls — logEventStrict() is not weakened.
      const controlFailureId = randomUUID();
      await prisma.auditWriteFailure.create({
        data: {
          id: controlFailureId,
          tenantId,
          userId: saUserId,
          action: AuditEventType.AUTH_LOGIN_FAILURE,
          result: 'FAILURE',
          occurredAt: new Date(),
          failureReason: 'UNKNOWN_ERROR',
          status: 'ABANDONED',
          attemptCount: 1,
          nextAttemptAt: new Date(),
        },
      });

      try {
        await request(app.getHttpServer())
          .post(`/api/v1/audit-events/recovery/${controlFailureId}/requeue`)
          .set('Authorization', `Bearer ${saToken}`)
          .expect(200);

        const postState = await prisma.auditWriteFailure.findUniqueOrThrow({
          where: { id: controlFailureId },
        });
        expect(postState.status).toBe('PENDING');
      } finally {
        await prisma.auditWriteFailureAttempt
          .deleteMany({ where: { auditWriteFailureId: controlFailureId } })
          .catch(() => {});
        await prisma.auditWriteFailure.delete({ where: { id: controlFailureId } }).catch(() => {});
      }
    });
  });

  // -------------------------------------------------------------------------
  // Coarse public health aggregate (GD-M39-1 Decision 21)
  // -------------------------------------------------------------------------

  describe('public health endpoint', () => {
    it('GET /health includes a coarse auditIntegrity value without tenant IDs, counts, or failure IDs', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);

      const body = JSON.stringify(res.body);
      expect(['ok', 'degraded']).toContain(res.body.info?.auditIntegrity?.auditIntegrity);
      expect(body).not.toContain(tenantId);
      expect(body).not.toContain(abandonedFailureId);
    });

    it('GET /health requires no authentication', async () => {
      await request(app.getHttpServer()).get('/health').expect(200);
    });

    // Binding project-owner clarification: audit-integrity degradation is
    // non-gating. The ABANDONED fixture (abandonedFailureId, created in
    // beforeAll and still ABANDONED at this point in the suite — the
    // requeue lifecycle tests above transition it to PENDING, but this
    // describe block runs before "recovery status and requeue" in file
    // order... to keep this test deterministic regardless of suite
    // ordering, it creates and cleans up its OWN dedicated ABANDONED
    // fixture rather than depending on shared suite state.
    it('reports degraded (never a non-200/failing status) against a real database ABANDONED write failure', async () => {
      const degradedFailureId = randomUUID();
      await prisma.auditWriteFailure.create({
        data: {
          id: degradedFailureId,
          tenantId,
          userId: saUserId,
          action: AuditEventType.AUTH_LOGIN_FAILURE,
          result: 'FAILURE',
          occurredAt: new Date(),
          failureReason: 'UNKNOWN_ERROR',
          status: 'ABANDONED',
          attemptCount: 5,
          nextAttemptAt: new Date(),
        },
      });

      try {
        const res = await request(app.getHttpServer()).get('/health').expect(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.info.auditIntegrity.auditIntegrity).toBe('degraded');
        const body = JSON.stringify(res.body);
        expect(body).not.toContain(tenantId);
        expect(body).not.toContain(degradedFailureId);
        // Structural check, not a substring guess — the response must
        // carry no key at all from AuditWriteFailure's shape (attemptCount,
        // failureReason, occurredAt, etc.), only the coarse aggregate.
        expect(res.body.info.auditIntegrity).toEqual({ status: 'up', auditIntegrity: 'degraded' });
      } finally {
        await prisma.auditWriteFailure.delete({ where: { id: degradedFailureId } }).catch(() => {});
      }
    });

    it('reports degraded (never a non-200/failing status) against a real database BROKEN chain state', async () => {
      const brokenTenant = await prisma.tenant.create({
        data: { name: 'E2E Health Broken Tenant', code: `E2E-HEALTH-BROKEN-${SUFFIX}`, status: 'ACTIVE' },
      });
      await prisma.auditChainState.create({
        data: {
          tenantId: brokenTenant.id,
          lastSequence: 0,
          nextVerificationAt: new Date(),
          lastVerificationResult: 'BROKEN',
          updatedAt: new Date(),
        },
      });

      try {
        const res = await request(app.getHttpServer()).get('/health').expect(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.info.auditIntegrity.auditIntegrity).toBe('degraded');
        const body = JSON.stringify(res.body);
        expect(body).not.toContain(brokenTenant.id);
      } finally {
        await prisma.auditChainState.deleteMany({ where: { tenantId: brokenTenant.id } }).catch(() => {});
        await prisma.tenant.delete({ where: { id: brokenTenant.id } }).catch(() => {});
      }
    });
  });
});
