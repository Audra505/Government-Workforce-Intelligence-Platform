// Reference: spec/01_requirements.md — FR-300 through FR-304 Candidate Management
// Reference: spec/06_api_contracts.md — Candidate API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: governance/GD-M16-1.md — D5 (email uniqueness), D9 (endpoints), D11 (RBAC), D13 (response shape)
// Reference: governance/GD-PRE-PHASE3-002.md — D1 (tenantId from JWT only), D2 (status = ACTIVE on create)
//
// E2E tests — real NestJS application + real PostgreSQL DB via PrismaClient.
// Self-contained: all fixtures created in beforeAll, deleted in afterAll.
// No seed.ts modifications — roles resolved via findUniqueOrThrow.
//
// App bootstrap mirrors main.ts exactly:
//   ValidationPipe (whitelist, forbidNonWhitelisted, transform)
//   global prefix 'api' (health excluded)
//   URI versioning
//
// Cleanup order respects FK constraints:
//   candidates (tenantId → tenants) deleted before tenants
//   audit events (userId → users) deleted before users
//   userRoles deleted before users
//   users before tenants
//   tenants last
//
// Candidates have no FK dependencies on positions or departments — cleanup is
// simpler than the workforce domain.
//
// Cross-tenant users: a second tenant (crossTenantId) owns its own SA user so
// the "tenant B user cannot see tenant A candidates" direction is covered.

import 'reflect-metadata';
import request from 'supertest';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  RequestMethod,
  ValidationPipe,
  VersioningType,
  type INestApplication,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

import { AppModule } from '../src/app.module';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const FIXTURE_PASSWORD          = 'E2eTest1234!';
const SUFFIX                    = Date.now();
const FIXTURE_TENANT_CODE       = `E2E-CAND-${SUFFIX}`;
const CROSS_TENANT_CODE         = `E2E-CAND-X-${SUFFIX}`;

const ADMIN_EMAIL               = `e2e-cand-admin-${SUFFIX}@test.gov`;
const HR_EMAIL                  = `e2e-cand-hr-${SUFFIX}@test.gov`;
const RECRUITER_EMAIL           = `e2e-cand-rec-${SUFFIX}@test.gov`;
const CO_EMAIL                  = `e2e-cand-co-${SUFFIX}@test.gov`;
const HM_EMAIL                  = `e2e-cand-hm-${SUFFIX}@test.gov`;
const WP_EMAIL                  = `e2e-cand-wp-${SUFFIX}@test.gov`;
const EXEC_EMAIL                = `e2e-cand-exec-${SUFFIX}@test.gov`;
const CROSS_TENANT_ADMIN_EMAIL  = `e2e-cand-xadmin-${SUFFIX}@test.gov`;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Candidate (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  // JWTs — primary tenant
  let adminToken: string;
  let hrToken: string;
  let recruiterToken: string;
  let coToken: string;
  let hmToken: string;
  let wpToken: string;
  let execToken: string;

  // JWT — cross-tenant
  let crossTenantAdminToken: string;

  // Tenant + user IDs for cleanup
  let fixtureTenantId: string;
  let crossTenantId: string;
  let adminUserId: string;
  let hrUserId: string;
  let recruiterUserId: string;
  let coUserId: string;
  let hmUserId: string;
  let wpUserId: string;
  let execUserId: string;
  let crossTenantAdminUserId: string;

  // Pre-created candidate fixtures (Prisma-direct, not via API)
  let crossTenantCandidateId: string;       // ACTIVE in crossTenant — list/detail SEC-003
  let crossTenantUpdateTargetId: string;    // ACTIVE in crossTenant — cross-tenant update 404
  let crossTenantArchiveTargetId: string;   // ACTIVE in crossTenant — cross-tenant archive 404
  let preArchivedId: string;                // ARCHIVED + deletedAt — soft-delete filter
  let updateTargetId: string;               // ACTIVE — PUT target
  let archiveTarget1Id: string;             // ACTIVE — SA archives; then 404 twice
  let archiveTarget2Id: string;             // ACTIVE — HR archives
  let archiveTarget3Id: string;             // ACTIVE — Recruiter archives
  let archiveTarget4Id: string;             // ACTIVE — forbidden-role archive attempts (not modified)
  let archiveReuseId: string;               // ACTIVE — archived then email reused (partial unique index)

  // State captured across test groups
  let auditCreateCandidateId: string;       // POST response ID — CREATED audit check
  const auditUpdateEmail = `e2e-cand-audemail-${SUFFIX}@test.gov`; // email used in PUT — PII audit check

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.setGlobalPrefix('api', {
      exclude: [{ path: 'health', method: RequestMethod.GET }],
    });
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();

    prisma = new PrismaClient();
    const passwordHash = await bcrypt.hash(FIXTURE_PASSWORD, 12);

    // ---- Tenants ----
    const tenant = await prisma.tenant.create({
      data: { name: 'E2E Candidate Tenant', code: FIXTURE_TENANT_CODE, status: 'ACTIVE' },
    });
    fixtureTenantId = tenant.id;

    const crossTenant = await prisma.tenant.create({
      data: { name: 'E2E Candidate Cross Tenant', code: CROSS_TENANT_CODE, status: 'ACTIVE' },
    });
    crossTenantId = crossTenant.id;

    // ---- Roles (must exist from seed) ----
    const sysAdminRole  = await prisma.role.findUniqueOrThrow({ where: { name: 'System Administrator' } });
    const hrRole        = await prisma.role.findUniqueOrThrow({ where: { name: 'HR Director' } });
    const recruiterRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Recruiter' } });
    const coRole        = await prisma.role.findUniqueOrThrow({ where: { name: 'Compliance Officer' } });
    const hmRole        = await prisma.role.findUniqueOrThrow({ where: { name: 'Hiring Manager' } });
    const wpRole        = await prisma.role.findUniqueOrThrow({ where: { name: 'Workforce Planner' } });
    const execRole      = await prisma.role.findUniqueOrThrow({ where: { name: 'Executive User' } });

    // ---- Users ----
    const mkUser = async (
      tenantId: string, email: string, roleId: string, lastName: string,
    ): Promise<string> => {
      const u = await prisma.user.create({
        data: {
          tenantId, email, passwordHash,
          firstName: 'E2E', lastName, status: 'ACTIVE', failedLoginAttempts: 0,
        },
      });
      await prisma.userRole.create({ data: { userId: u.id, roleId } });
      return u.id;
    };

    adminUserId            = await mkUser(fixtureTenantId, ADMIN_EMAIL,              sysAdminRole.id,  'CandAdmin');
    hrUserId               = await mkUser(fixtureTenantId, HR_EMAIL,                 hrRole.id,        'CandHR');
    recruiterUserId        = await mkUser(fixtureTenantId, RECRUITER_EMAIL,          recruiterRole.id, 'CandRec');
    coUserId               = await mkUser(fixtureTenantId, CO_EMAIL,                 coRole.id,        'CandCO');
    hmUserId               = await mkUser(fixtureTenantId, HM_EMAIL,                 hmRole.id,        'CandHM');
    wpUserId               = await mkUser(fixtureTenantId, WP_EMAIL,                 wpRole.id,        'CandWP');
    execUserId             = await mkUser(fixtureTenantId, EXEC_EMAIL,               execRole.id,      'CandExec');
    crossTenantAdminUserId = await mkUser(crossTenantId,  CROSS_TENANT_ADMIN_EMAIL, sysAdminRole.id,  'XAdmin');

    // ---- Pre-created candidates (Prisma-direct) ----
    const mkCandidate = async (
      tenantId: string,
      email: string,
      extra?: { status?: string; deletedAt?: Date },
    ): Promise<string> => {
      const c = await prisma.candidate.create({
        data: {
          tenantId,
          firstName: 'E2E',
          lastName: 'Candidate',
          email,
          status: extra?.deletedAt ? 'ARCHIVED' : (extra?.status ?? 'ACTIVE'),
          ...(extra?.deletedAt ? { deletedAt: extra.deletedAt } : {}),
        },
      });
      return c.id;
    };

    crossTenantCandidateId    = await mkCandidate(crossTenantId,   `e2e-cand-xtenant-${SUFFIX}@test.gov`);
    crossTenantUpdateTargetId = await mkCandidate(crossTenantId,   `e2e-cand-xupdate-${SUFFIX}@test.gov`);
    crossTenantArchiveTargetId = await mkCandidate(crossTenantId,  `e2e-cand-xarchive-${SUFFIX}@test.gov`);
    preArchivedId             = await mkCandidate(fixtureTenantId, `e2e-cand-pre-arch-${SUFFIX}@test.gov`, {
      status: 'ARCHIVED', deletedAt: new Date(),
    });
    updateTargetId            = await mkCandidate(fixtureTenantId, `e2e-cand-uptgt-${SUFFIX}@test.gov`);
    archiveTarget1Id          = await mkCandidate(fixtureTenantId, `e2e-cand-archtgt1-${SUFFIX}@test.gov`);
    archiveTarget2Id          = await mkCandidate(fixtureTenantId, `e2e-cand-archtgt2-${SUFFIX}@test.gov`);
    archiveTarget3Id          = await mkCandidate(fixtureTenantId, `e2e-cand-archtgt3-${SUFFIX}@test.gov`);
    archiveTarget4Id          = await mkCandidate(fixtureTenantId, `e2e-cand-archtgt4-${SUFFIX}@test.gov`);
    archiveReuseId            = await mkCandidate(fixtureTenantId, `e2e-cand-reuse-${SUFFIX}@test.gov`);

    // ---- Authenticate all fixture users ----
    const login = async (email: string): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: FIXTURE_PASSWORD });
      return res.body.data.accessToken as string;
    };

    adminToken            = await login(ADMIN_EMAIL);
    hrToken               = await login(HR_EMAIL);
    recruiterToken        = await login(RECRUITER_EMAIL);
    coToken               = await login(CO_EMAIL);
    hmToken               = await login(HM_EMAIL);
    wpToken               = await login(WP_EMAIL);
    execToken             = await login(EXEC_EMAIL);
    crossTenantAdminToken = await login(CROSS_TENANT_ADMIN_EMAIL);
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      const tenantIds = [fixtureTenantId, crossTenantId].filter(Boolean);

      // Candidates before tenants (tenantId FK → tenants)
      if (tenantIds.length > 0) {
        await prisma.candidate.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
      }

      // Audit events before users (userId FK → users)
      const actorIds = [
        adminUserId, hrUserId, recruiterUserId, coUserId,
        hmUserId, wpUserId, execUserId, crossTenantAdminUserId,
      ].filter(Boolean);
      if (actorIds.length > 0) {
        await prisma.auditEvent.deleteMany({ where: { userId: { in: actorIds } } }).catch(() => {});
      }

      // Users + roles
      for (const userId of actorIds) {
        await prisma.userRole.deleteMany({ where: { userId } }).catch(() => {});
        await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      }

      // Tenants
      if (fixtureTenantId) await prisma.tenant.delete({ where: { id: fixtureTenantId } }).catch(() => {});
      if (crossTenantId)   await prisma.tenant.delete({ where: { id: crossTenantId } }).catch(() => {});

      await prisma.$disconnect();
    }
    await app?.close();
  }, 30_000);

  // --------------------------------------------------------------------------
  // Group 1: Authentication
  // --------------------------------------------------------------------------

  describe('Authentication', () => {
    it('GET /api/v1/candidates without Authorization → 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/candidates');
      expect(res.status).toBe(401);
    });

    it('POST /api/v1/candidates without Authorization → 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/candidates')
        .send({ firstName: 'X', lastName: 'Y', email: 'x@test.gov' });
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/candidates/:id without Authorization → 401', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/candidates/${updateTargetId}`);
      expect(res.status).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // Group 2: POST /api/v1/candidates — RBAC + response shape
  // --------------------------------------------------------------------------

  describe('POST /api/v1/candidates', () => {
    it('System Administrator + valid body → 201 + { success, data: candidate }; status = ACTIVE (GD-PRE-PHASE3-002 D2)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/candidates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Alice',
          lastName:  'Test',
          email:     `e2e-cand-sa-create-${SUFFIX}@test.gov`,
          source:    'USAJOBS',
          notes:     'E2E test candidate',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        firstName: 'Alice',
        lastName:  'Test',
        status:    'ACTIVE',
        source:    'USAJOBS',
      });
      expect(res.body.data.id).toMatch(UUID_V4);
      expect(typeof res.body.data.createdAt).toBe('string');
      expect(typeof res.body.data.updatedAt).toBe('string');

      // SEC-003: tenantId must not appear in response (GD-M16-1 D13)
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');

      // Capture for audit event verification (Group 9)
      auditCreateCandidateId = res.body.data.id as string;
    });

    it('HR Director → 201 (write authorized — GD-M16-1 D11)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/candidates')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ firstName: 'Bob', lastName: 'Test', email: `e2e-cand-hr-create-${SUFFIX}@test.gov` });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).not.toHaveProperty('tenantId');
    });

    it('Recruiter → 201 (write authorized — GD-M16-1 D11)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/candidates')
        .set('Authorization', `Bearer ${recruiterToken}`)
        .send({ firstName: 'Carol', lastName: 'Test', email: `e2e-cand-rec-create-${SUFFIX}@test.gov` });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('Compliance Officer → 403 (read-only role, write forbidden — GD-M16-1 D11)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/candidates')
        .set('Authorization', `Bearer ${coToken}`)
        .send({ firstName: 'X', lastName: 'Y', email: `e2e-cand-co-denied-${SUFFIX}@test.gov` });

      expect(res.status).toBe(403);
    });

    it('Hiring Manager → 403 (no M16 candidate access — GD-M16-1 D11)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/candidates')
        .set('Authorization', `Bearer ${hmToken}`)
        .send({ firstName: 'X', lastName: 'Y', email: `e2e-cand-hm-denied-${SUFFIX}@test.gov` });

      expect(res.status).toBe(403);
    });

    it('Workforce Planner → 403 (no M16 candidate access)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/candidates')
        .set('Authorization', `Bearer ${wpToken}`)
        .send({ firstName: 'X', lastName: 'Y', email: `e2e-cand-wp-denied-${SUFFIX}@test.gov` });

      expect(res.status).toBe(403);
    });

    it('Executive User → 403 (no M16 candidate access)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/candidates')
        .set('Authorization', `Bearer ${execToken}`)
        .send({ firstName: 'X', lastName: 'Y', email: `e2e-cand-exec-denied-${SUFFIX}@test.gov` });

      expect(res.status).toBe(403);
    });

    it('missing required field (firstName) → 400 (ValidationPipe rejects)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/candidates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ lastName: 'Test', email: `e2e-cand-bad-${SUFFIX}@test.gov` });

      expect(res.status).toBe(400);
    });

    it('forbidden field tenantId in body → 400 (ValidationPipe whitelist + forbidNonWhitelisted — SEC-003)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/candidates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'X',
          lastName:  'Y',
          email:     `e2e-cand-tid-inject-${SUFFIX}@test.gov`,
          tenantId:  '00000000-0000-4000-8000-000000000099',
        });

      expect(res.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // Group 3: Duplicate email constraint
  // --------------------------------------------------------------------------

  describe('Duplicate email constraint (GD-M16-1 D5)', () => {
    const DUPE_EMAIL = `e2e-cand-dupe-${SUFFIX}@test.gov`;

    it('first candidate with this email → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/candidates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'Orig', lastName: 'Dupe', email: DUPE_EMAIL });

      expect(res.status).toBe(201);
    });

    it('second active candidate with same email in same tenant → 409 CANDIDATE_EMAIL_ALREADY_EXISTS', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/candidates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'Dup2', lastName: 'Dupe', email: DUPE_EMAIL });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        success: false,
        error:   { code: 'CANDIDATE_EMAIL_ALREADY_EXISTS' },
      });
    });

    it('same email in cross-tenant → 201 (uniqueness is per-tenant — GD-M16-1 D5)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/candidates')
        .set('Authorization', `Bearer ${crossTenantAdminToken}`)
        .send({ firstName: 'CrossTen', lastName: 'Dupe', email: DUPE_EMAIL });

      expect(res.status).toBe(201);
    });
  });

  // --------------------------------------------------------------------------
  // Group 4: GET /api/v1/candidates — RBAC + list envelope + SEC-003
  // --------------------------------------------------------------------------

  describe('GET /api/v1/candidates', () => {
    it('System Administrator → 200 + paginated envelope', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/candidates')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('candidates');
      expect(res.body.data).toHaveProperty('total');
      expect(res.body.data).toHaveProperty('page');
      expect(res.body.data).toHaveProperty('pageSize');
      expect(res.body.data).toHaveProperty('totalPages');
      expect(Array.isArray(res.body.data.candidates)).toBe(true);
    });

    it('HR Director → 200 (read authorized — GD-M16-1 D11)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/candidates')
        .set('Authorization', `Bearer ${hrToken}`);

      expect(res.status).toBe(200);
    });

    it('Recruiter → 200 (read authorized — GD-M16-1 D11)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/candidates')
        .set('Authorization', `Bearer ${recruiterToken}`);

      expect(res.status).toBe(200);
    });

    it('Compliance Officer → 200 (read-only role, list authorized — GD-M16-1 D11)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/candidates')
        .set('Authorization', `Bearer ${coToken}`);

      expect(res.status).toBe(200);
    });

    it('Hiring Manager → 403 (no M16 candidate access)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/candidates')
        .set('Authorization', `Bearer ${hmToken}`);

      expect(res.status).toBe(403);
    });

    it('Workforce Planner → 403 (no M16 candidate access)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/candidates')
        .set('Authorization', `Bearer ${wpToken}`);

      expect(res.status).toBe(403);
    });

    it('Executive User → 403 (no M16 candidate access)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/candidates')
        .set('Authorization', `Bearer ${execToken}`);

      expect(res.status).toBe(403);
    });

    it('candidate records in list do not expose tenantId (SEC-003)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/candidates')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      for (const c of res.body.data.candidates as Record<string, unknown>[]) {
        expect(c).not.toHaveProperty('tenantId');
      }
    });

    it('candidate records in list do not expose deletedAt', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/candidates')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      for (const c of res.body.data.candidates as Record<string, unknown>[]) {
        expect(c).not.toHaveProperty('deletedAt');
      }
    });

    it('cross-tenant candidate NOT visible in primary-tenant list (SEC-003)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/candidates')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.candidates as { id: string }[]).map((c) => c.id);
      expect(ids).not.toContain(crossTenantCandidateId);
    });

    it('pre-archived candidate NOT in default ACTIVE list (soft-delete filter)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/candidates')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.candidates as { id: string }[]).map((c) => c.id);
      expect(ids).not.toContain(preArchivedId);
    });
  });

  // --------------------------------------------------------------------------
  // Group 5: GET /api/v1/candidates/:id — RBAC + shape + SEC-003
  // --------------------------------------------------------------------------

  describe('GET /api/v1/candidates/:id', () => {
    it('System Administrator → 200 + candidate shape', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/candidates/${updateTargetId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(updateTargetId);
      expect(res.body.data).toHaveProperty('firstName');
      expect(res.body.data).toHaveProperty('status');
      expect(res.body.data).toHaveProperty('createdAt');
    });

    it('HR Director → 200 + success envelope; response excludes tenantId and deletedAt (read authorized — GD-M16-1 D11)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/candidates/${updateTargetId}`)
        .set('Authorization', `Bearer ${hrToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(updateTargetId);
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('Compliance Officer → 200 (read-only role, detail authorized — GD-M16-1 D11)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/candidates/${updateTargetId}`)
        .set('Authorization', `Bearer ${coToken}`);

      expect(res.status).toBe(200);
    });

    it('Recruiter → 200 (read authorized)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/candidates/${updateTargetId}`)
        .set('Authorization', `Bearer ${recruiterToken}`);

      expect(res.status).toBe(200);
    });

    it('Hiring Manager → 403 (no M16 candidate access)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/candidates/${updateTargetId}`)
        .set('Authorization', `Bearer ${hmToken}`);

      expect(res.status).toBe(403);
    });

    it('Workforce Planner → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/candidates/${updateTargetId}`)
        .set('Authorization', `Bearer ${wpToken}`);

      expect(res.status).toBe(403);
    });

    it('Executive User → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/candidates/${updateTargetId}`)
        .set('Authorization', `Bearer ${execToken}`);

      expect(res.status).toBe(403);
    });

    it('cross-tenant candidate id → 404, not 403 (SEC-003: absent and cross-tenant return identical response)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/candidates/${crossTenantCandidateId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'CANDIDATE_NOT_FOUND' } });
    });

    it('non-existent UUID → 404 + CANDIDATE_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/candidates/00000000-0000-4000-8000-000000000099')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'CANDIDATE_NOT_FOUND' } });
    });

    it('pre-archived candidate → 404 (soft-deleted records invisible — SEC-003)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/candidates/${preArchivedId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('invalid UUID param → 400 (ParseUUIDPipe)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/candidates/not-a-uuid')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('response does not expose tenantId (SEC-003)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/candidates/${updateTargetId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('tenantId');
    });

    it('response does not expose deletedAt', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/candidates/${updateTargetId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });
  });

  // --------------------------------------------------------------------------
  // Group 6: PUT /api/v1/candidates/:id — RBAC + shape + SEC-003
  // --------------------------------------------------------------------------

  describe('PUT /api/v1/candidates/:id', () => {
    it('System Administrator → 200 + updated candidate shape', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/candidates/${updateTargetId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'UpdatedFirst', notes: 'Updated via SA' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.firstName).toBe('UpdatedFirst');
      expect(res.body.data.id).toBe(updateTargetId);
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('HR Director → 200 (write authorized — GD-M16-1 D11)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/candidates/${updateTargetId}`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ lastName: 'UpdatedLast' });

      expect(res.status).toBe(200);
    });

    it('Recruiter → 200 (write authorized — GD-M16-1 D11)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/candidates/${updateTargetId}`)
        .set('Authorization', `Bearer ${recruiterToken}`)
        .send({ source: 'LINKEDIN' });

      expect(res.status).toBe(200);
    });

    it('Compliance Officer → 403 (read-only role, write forbidden — GD-M16-1 D11)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/candidates/${updateTargetId}`)
        .set('Authorization', `Bearer ${coToken}`)
        .send({ notes: 'CO should not update' });

      expect(res.status).toBe(403);
    });

    it('Hiring Manager → 403 (no M16 candidate access)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/candidates/${updateTargetId}`)
        .set('Authorization', `Bearer ${hmToken}`)
        .send({ notes: 'HM should not update' });

      expect(res.status).toBe(403);
    });

    it('Workforce Planner → 403', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/candidates/${updateTargetId}`)
        .set('Authorization', `Bearer ${wpToken}`)
        .send({ notes: 'WP should not update' });

      expect(res.status).toBe(403);
    });

    it('Executive User → 403', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/candidates/${updateTargetId}`)
        .set('Authorization', `Bearer ${execToken}`)
        .send({ notes: 'Exec should not update' });

      expect(res.status).toBe(403);
    });

    it('duplicate email on update → 409 CANDIDATE_EMAIL_ALREADY_EXISTS (GD-M16-1 D5)', async () => {
      // Capture updateTargetId's current email from a GET
      const detailRes = await request(app.getHttpServer())
        .get(`/api/v1/candidates/${updateTargetId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      const existingEmail = detailRes.body.data.email as string;

      // Create a fresh candidate to collide against
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/candidates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'Fresh', lastName: 'ForDupUpdate', email: `e2e-cand-dup-upd-${SUFFIX}@test.gov` });
      const freshId = createRes.body.data.id as string;

      // Attempt to update freshId's email to the existing email
      const res = await request(app.getHttpServer())
        .put(`/api/v1/candidates/${freshId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: existingEmail });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'CANDIDATE_EMAIL_ALREADY_EXISTS' } });
    });

    it('update email for PII audit verification (Group 9) — email value must not appear in audit metadata', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/candidates/${updateTargetId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: auditUpdateEmail });

      expect(res.status).toBe(200);
    });

    it('cross-tenant candidate id → 404 for authorized role in wrong tenant (SEC-003)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/candidates/${crossTenantUpdateTargetId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'cross-tenant update attempt' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'CANDIDATE_NOT_FOUND' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 7: POST /api/v1/candidates/:id/archive
  // --------------------------------------------------------------------------

  describe('POST /api/v1/candidates/:id/archive', () => {
    // Forbidden-role checks first — archiveTarget4Id stays unmodified throughout
    it('Compliance Officer → 403 (read-only role, archive forbidden — GD-M16-1 D11)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/candidates/${archiveTarget4Id}/archive`)
        .set('Authorization', `Bearer ${coToken}`);

      expect(res.status).toBe(403);
    });

    it('Hiring Manager → 403 (no M16 candidate access)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/candidates/${archiveTarget4Id}/archive`)
        .set('Authorization', `Bearer ${hmToken}`);

      expect(res.status).toBe(403);
    });

    it('Workforce Planner → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/candidates/${archiveTarget4Id}/archive`)
        .set('Authorization', `Bearer ${wpToken}`);

      expect(res.status).toBe(403);
    });

    it('Executive User → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/candidates/${archiveTarget4Id}/archive`)
        .set('Authorization', `Bearer ${execToken}`);

      expect(res.status).toBe(403);
    });

    // State-mutating tests — ordered: archive → 204, then detail → 404, then re-archive → 404
    it('[STATE] System Administrator archives archiveTarget1Id → 204 No Content (no response body)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/candidates/${archiveTarget1Id}/archive`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
    });

    it('[STATE] archived candidate detail → 404 CANDIDATE_NOT_FOUND (soft-deleted — SEC-003)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/candidates/${archiveTarget1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'CANDIDATE_NOT_FOUND' } });
    });

    it('[STATE] repeated archive of same candidate → 404 (idempotent guard — already soft-deleted)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/candidates/${archiveTarget1Id}/archive`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'CANDIDATE_NOT_FOUND' } });
    });

    it('[STATE] archived candidate NOT in default ACTIVE list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/candidates')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.candidates as { id: string }[]).map((c) => c.id);
      expect(ids).not.toContain(archiveTarget1Id);
    });

    it('[STATE] HR Director archives archiveTarget2Id → 204', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/candidates/${archiveTarget2Id}/archive`)
        .set('Authorization', `Bearer ${hrToken}`);

      expect(res.status).toBe(204);
    });

    it('[STATE] Recruiter archives archiveTarget3Id → 204', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/candidates/${archiveTarget3Id}/archive`)
        .set('Authorization', `Bearer ${recruiterToken}`);

      expect(res.status).toBe(204);
    });

    it('[STATE] archive archiveReuseId → 204; same email immediately reusable (partial unique index WHERE deleted_at IS NULL — GD-M16-1 D5)', async () => {
      // Fetch email before archiving (known at fixture creation but sourced from API for realism)
      const detailRes = await request(app.getHttpServer())
        .get(`/api/v1/candidates/${archiveReuseId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(detailRes.status).toBe(200);
      const reuseEmail = detailRes.body.data.email as string;

      // Archive
      const archiveRes = await request(app.getHttpServer())
        .post(`/api/v1/candidates/${archiveReuseId}/archive`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(archiveRes.status).toBe(204);

      // Re-create with same email — partial unique index allows this since deletedAt is set
      const reCreateRes = await request(app.getHttpServer())
        .post('/api/v1/candidates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'ReuseEmail', lastName: 'Test', email: reuseEmail });
      expect(reCreateRes.status).toBe(201);
    });
  });

  // --------------------------------------------------------------------------
  // Group 8: Tenant isolation (SEC-003)
  // --------------------------------------------------------------------------

  describe('Tenant isolation (SEC-003)', () => {
    it('primary-tenant admin list does not include cross-tenant candidate', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/candidates')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.candidates as { id: string }[]).map((c) => c.id);
      expect(ids).not.toContain(crossTenantCandidateId);
    });

    it('cross-tenant admin list does not include primary-tenant candidates', async () => {
      const primaryRes = await request(app.getHttpServer())
        .get('/api/v1/candidates')
        .set('Authorization', `Bearer ${adminToken}`);
      const primaryIds = (primaryRes.body.data.candidates as { id: string }[]).map((c) => c.id);

      const crossRes = await request(app.getHttpServer())
        .get('/api/v1/candidates')
        .set('Authorization', `Bearer ${crossTenantAdminToken}`);
      const crossIds = (crossRes.body.data.candidates as { id: string }[]).map((c) => c.id);

      for (const id of primaryIds) {
        expect(crossIds).not.toContain(id);
      }
    });

    it('cross-tenant candidate detail → 404 (primary-tenant user; enumeration prevention)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/candidates/${crossTenantCandidateId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'CANDIDATE_NOT_FOUND' } });
    });

    it('cross-tenant update → 404 for authorized role in wrong tenant', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/candidates/${crossTenantUpdateTargetId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'cross-tenant update attempt' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'CANDIDATE_NOT_FOUND' } });
    });

    it('cross-tenant archive → 404 for authorized role in wrong tenant', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/candidates/${crossTenantArchiveTargetId}/archive`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'CANDIDATE_NOT_FOUND' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 9: Audit events
  // --------------------------------------------------------------------------

  describe('Audit events (GD-M16-1 D9; EMP-700/EMP-401 pattern)', () => {
    it('RECRUITING_CANDIDATE_CREATED written after POST /candidates', async () => {
      expect(auditCreateCandidateId).toBeDefined();

      const record = await prisma.auditEvent.findFirst({
        where: { entityId: auditCreateCandidateId, action: 'RECRUITING_CANDIDATE_CREATED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('CANDIDATE');
    });

    it('RECRUITING_CANDIDATE_CREATED metadata does not contain PII values (status only)', async () => {
      expect(auditCreateCandidateId).toBeDefined();

      const record = await prisma.auditEvent.findFirst({
        where: { entityId: auditCreateCandidateId, action: 'RECRUITING_CANDIDATE_CREATED' },
      });

      expect(record).not.toBeNull();
      const metaStr = JSON.stringify(record!.metadata);
      // Created audit has { status: 'ACTIVE' } only — no candidate PII values
      expect(metaStr).not.toContain('Alice');
      expect(metaStr).not.toContain('@test.gov');
    });

    it('RECRUITING_CANDIDATE_UPDATED written after PUT /candidates/:id', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: updateTargetId, action: 'RECRUITING_CANDIDATE_UPDATED' },
        orderBy: { createdAt: 'desc' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('CANDIDATE');
    });

    it('RECRUITING_CANDIDATE_UPDATED metadata has field names only — email VALUE not present (EMP-401 PII pattern)', async () => {
      const records = await prisma.auditEvent.findMany({
        where: { entityId: updateTargetId, action: 'RECRUITING_CANDIDATE_UPDATED' },
        orderBy: { createdAt: 'asc' },
      });

      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        const metaStr = JSON.stringify(record.metadata);
        expect(metaStr).not.toContain(auditUpdateEmail);
      }
    });

    it('RECRUITING_CANDIDATE_ARCHIVED written after POST /candidates/:id/archive', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: archiveTarget1Id, action: 'RECRUITING_CANDIDATE_ARCHIVED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('CANDIDATE');
    });

    it('RECRUITING_CANDIDATE_ARCHIVED metadata does not contain PII values', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: archiveTarget1Id, action: 'RECRUITING_CANDIDATE_ARCHIVED' },
      });

      expect(record).not.toBeNull();
      // Archived audit has { action: 'ARCHIVE' } only — no candidate field values
      const metaStr = JSON.stringify(record!.metadata);
      expect(metaStr).not.toContain('@test.gov');
      expect(metaStr).not.toContain('E2E');
    });
  });
});
