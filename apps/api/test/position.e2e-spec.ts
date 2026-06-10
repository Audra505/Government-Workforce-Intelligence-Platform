// Reference: spec/06_api_contracts.md — Position API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/02_position_management_rules.md — POS-AUTH-001 through POS-AUTH-005
// Reference: directives/08_audit_rules.md — AUD-400
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
//   positions (→ departments ON DELETE RESTRICT) deleted before departments
//   departments (→ tenants ON DELETE RESTRICT) deleted before tenants

import 'reflect-metadata';
import request from 'supertest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RequestMethod, ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

import { AppModule } from '../src/app.module';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const FIXTURE_PASSWORD    = 'E2eTest1234!';
const SUFFIX              = Date.now();
const FIXTURE_TENANT_CODE = `E2E-POS-${SUFFIX}`;
const CROSS_TENANT_CODE   = `E2E-POS-X-${SUFFIX}`;
const ADMIN_EMAIL         = `e2e-pos-admin-${SUFFIX}@test.gov`;
const HR_EMAIL            = `e2e-pos-hr-${SUFFIX}@test.gov`;
const WP_EMAIL            = `e2e-pos-wp-${SUFFIX}@test.gov`;
const RESTRICTED_EMAIL    = `e2e-pos-restricted-${SUFFIX}@test.gov`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Position (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let adminToken: string;
  let hrToken: string;
  let wpToken: string;
  let restrictedToken: string;

  let fixtureTenantId: string;
  let crossTenantId: string;
  let adminUserId: string;
  let hrUserId: string;
  let wpUserId: string;
  let restrictedUserId: string;

  // Pre-created departments
  let primaryDeptId: string;
  let crossTenantDeptId: string;

  // Pre-created positions (Prisma-direct — not via API)
  let primaryPositionId: string;     // DRAFT: used for GET, title update tests
  let activateTargetId: string;      // DRAFT: transitioned to ACTIVE in Group 4
  let closedPositionId: string;      // CLOSED: POSITION_CLOSED and ALREADY_CLOSED tests
  let closeTargetSAId: string;       // DRAFT: SA closes this in Group 5
  let closeTargetHRId: string;       // DRAFT: HR Director closes this in Group 5
  let crossTenantPosId: string;      // DRAFT in cross-tenant: isolation tests
  let softDeletedPosId: string;      // DRAFT + deletedAt: soft-delete filter tests

  // API-created position IDs — captured from POST responses for cleanup
  const apiCreatedPositionIds: string[] = [];

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

    // Tenants
    const tenant = await prisma.tenant.create({
      data: { name: 'E2E Position Tenant', code: FIXTURE_TENANT_CODE, status: 'ACTIVE' },
    });
    fixtureTenantId = tenant.id;

    const crossTenant = await prisma.tenant.create({
      data: { name: 'E2E Cross Tenant Pos', code: CROSS_TENANT_CODE, status: 'ACTIVE' },
    });
    crossTenantId = crossTenant.id;

    // Resolve role IDs — roles must exist from seed
    const sysAdminRole  = await prisma.role.findUniqueOrThrow({ where: { name: 'System Administrator' } });
    const hrRole        = await prisma.role.findUniqueOrThrow({ where: { name: 'HR Director' } });
    const wpRole        = await prisma.role.findUniqueOrThrow({ where: { name: 'Workforce Planner' } });
    const recruiterRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Recruiter' } });

    // Fixture users
    const adminUser = await prisma.user.create({
      data: {
        tenantId: fixtureTenantId, email: ADMIN_EMAIL, passwordHash,
        firstName: 'E2E', lastName: 'PosAdmin', status: 'ACTIVE', failedLoginAttempts: 0,
      },
    });
    adminUserId = adminUser.id;
    await prisma.userRole.create({ data: { userId: adminUser.id, roleId: sysAdminRole.id } });

    const hrUser = await prisma.user.create({
      data: {
        tenantId: fixtureTenantId, email: HR_EMAIL, passwordHash,
        firstName: 'E2E', lastName: 'PosHR', status: 'ACTIVE', failedLoginAttempts: 0,
      },
    });
    hrUserId = hrUser.id;
    await prisma.userRole.create({ data: { userId: hrUser.id, roleId: hrRole.id } });

    const wpUser = await prisma.user.create({
      data: {
        tenantId: fixtureTenantId, email: WP_EMAIL, passwordHash,
        firstName: 'E2E', lastName: 'PosWP', status: 'ACTIVE', failedLoginAttempts: 0,
      },
    });
    wpUserId = wpUser.id;
    await prisma.userRole.create({ data: { userId: wpUser.id, roleId: wpRole.id } });

    const restrictedUser = await prisma.user.create({
      data: {
        tenantId: fixtureTenantId, email: RESTRICTED_EMAIL, passwordHash,
        firstName: 'E2E', lastName: 'PosRestricted', status: 'ACTIVE', failedLoginAttempts: 0,
      },
    });
    restrictedUserId = restrictedUser.id;
    await prisma.userRole.create({ data: { userId: restrictedUser.id, roleId: recruiterRole.id } });

    // Pre-created departments
    const primaryDept = await prisma.department.create({
      data: { tenantId: fixtureTenantId, name: 'E2E Primary Dept', code: `E2E-PD-${SUFFIX}`, status: 'ACTIVE' },
    });
    primaryDeptId = primaryDept.id;

    const crossDept = await prisma.department.create({
      data: { tenantId: crossTenantId, name: 'E2E Cross Dept', code: `E2E-CD-${SUFFIX}`, status: 'ACTIVE' },
    });
    crossTenantDeptId = crossDept.id;

    // Pre-created positions
    const primaryPos = await prisma.position.create({
      data: { tenantId: fixtureTenantId, departmentId: primaryDeptId, title: 'E2E Primary Position', status: 'DRAFT' },
    });
    primaryPositionId = primaryPos.id;

    const activateTarget = await prisma.position.create({
      data: { tenantId: fixtureTenantId, departmentId: primaryDeptId, title: 'E2E Activate Target', status: 'DRAFT' },
    });
    activateTargetId = activateTarget.id;

    const closedPos = await prisma.position.create({
      data: { tenantId: fixtureTenantId, departmentId: primaryDeptId, title: 'E2E Closed Position', status: 'CLOSED' },
    });
    closedPositionId = closedPos.id;

    const closeTargetSA = await prisma.position.create({
      data: { tenantId: fixtureTenantId, departmentId: primaryDeptId, title: 'E2E SA Close Target', status: 'DRAFT' },
    });
    closeTargetSAId = closeTargetSA.id;

    const closeTargetHR = await prisma.position.create({
      data: { tenantId: fixtureTenantId, departmentId: primaryDeptId, title: 'E2E HR Close Target', status: 'DRAFT' },
    });
    closeTargetHRId = closeTargetHR.id;

    const crossTenantPos = await prisma.position.create({
      data: { tenantId: crossTenantId, departmentId: crossTenantDeptId, title: 'E2E Cross Tenant Pos', status: 'DRAFT' },
    });
    crossTenantPosId = crossTenantPos.id;

    // Soft-deleted position — deletedAt set at creation for visibility tests
    const softDeletedPos = await prisma.position.create({
      data: {
        tenantId: fixtureTenantId, departmentId: primaryDeptId,
        title: 'E2E Soft Deleted Pos', status: 'DRAFT', deletedAt: new Date(),
      },
    });
    softDeletedPosId = softDeletedPos.id;

    // Authenticate all fixture users
    const adminRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: FIXTURE_PASSWORD });
    adminToken = adminRes.body.data.accessToken as string;

    const hrRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: HR_EMAIL, password: FIXTURE_PASSWORD });
    hrToken = hrRes.body.data.accessToken as string;

    const wpRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: WP_EMAIL, password: FIXTURE_PASSWORD });
    wpToken = wpRes.body.data.accessToken as string;

    const restrictedRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: RESTRICTED_EMAIL, password: FIXTURE_PASSWORD });
    restrictedToken = restrictedRes.body.data.accessToken as string;
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      // Positions must be deleted before departments (FK ON DELETE RESTRICT)
      const tenantIds = [fixtureTenantId, crossTenantId].filter(Boolean);
      if (tenantIds.length > 0) {
        await prisma.position.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
      }

      // Departments
      for (const deptId of [primaryDeptId, crossTenantDeptId].filter(Boolean)) {
        await prisma.department.delete({ where: { id: deptId } }).catch(() => {});
      }

      // Audit events for fixture actors (covers login + all position write operations)
      const actorIds = [adminUserId, hrUserId, wpUserId, restrictedUserId].filter(Boolean);
      if (actorIds.length > 0) {
        await prisma.auditEvent.deleteMany({ where: { userId: { in: actorIds } } }).catch(() => {});
      }

      // Fixture users (userRoles first — FK constraint)
      for (const userId of actorIds) {
        await prisma.userRole.deleteMany({ where: { userId } }).catch(() => {});
        await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      }

      // Tenants — all positions, departments, and users removed above
      if (fixtureTenantId) await prisma.tenant.delete({ where: { id: fixtureTenantId } }).catch(() => {});
      if (crossTenantId)   await prisma.tenant.delete({ where: { id: crossTenantId } }).catch(() => {});

      await prisma.$disconnect();
    }
    await app?.close();
  }, 30_000);

  // --------------------------------------------------------------------------
  // Group 1: POST /api/v1/positions
  // --------------------------------------------------------------------------

  describe('POST /api/v1/positions', () => {
    it('SA JWT + valid payload → HTTP 201 + { success: true, data: position }', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/positions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: `E2E SA Created ${SUFFIX}`, departmentId: primaryDeptId });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({ title: `E2E SA Created ${SUFFIX}`, status: 'DRAFT' });
      expect(res.body.data.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      if (res.body.data?.id) apiCreatedPositionIds.push(res.body.data.id as string);
    });

    it('HR Director JWT → HTTP 201 (POS-AUTH-001: HR Director authorized)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/positions')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ title: `E2E HR Created ${SUFFIX}`, departmentId: primaryDeptId });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      if (res.body.data?.id) apiCreatedPositionIds.push(res.body.data.id as string);
    });

    it('Workforce Planner JWT → HTTP 403 (POS-AUTH-001: write requires SA or HR Director)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/positions')
        .set('Authorization', `Bearer ${wpToken}`)
        .send({ title: 'Blocked Position', departmentId: primaryDeptId });

      expect(res.status).toBe(403);
    });

    it('Recruiter JWT → HTTP 403 (POS-AUTH-001)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/positions')
        .set('Authorization', `Bearer ${restrictedToken}`)
        .send({ title: 'Blocked Position', departmentId: primaryDeptId });

      expect(res.status).toBe(403);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/positions')
        .send({ title: 'No Auth Position', departmentId: primaryDeptId });

      expect(res.status).toBe(401);
    });

    it('departmentId from cross-tenant → HTTP 404 department not found (SEC-003 / Decision 4)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/positions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Cross Dept Position', departmentId: crossTenantDeptId });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    });

    it('missing required field (title) → HTTP 400 (ValidationPipe rejects)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/positions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ departmentId: primaryDeptId });

      expect(res.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // Group 2: GET /api/v1/positions
  // --------------------------------------------------------------------------

  describe('GET /api/v1/positions', () => {
    it('SA JWT → HTTP 200 + { success: true, data: { positions, total, page, pageSize, totalPages } }', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/positions')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({ page: 1, pageSize: 20 });
      expect(Array.isArray(res.body.data.positions)).toBe(true);
      expect(typeof res.body.data.total).toBe('number');
      expect(typeof res.body.data.totalPages).toBe('number');
    });

    it('HR Director JWT → HTTP 200 (POS-AUTH-002)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/positions')
        .set('Authorization', `Bearer ${hrToken}`);

      expect(res.status).toBe(200);
    });

    it('Workforce Planner JWT → HTTP 200 (POS-AUTH-002: read includes Workforce Planner)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/positions')
        .set('Authorization', `Bearer ${wpToken}`);

      expect(res.status).toBe(200);
    });

    it('Recruiter JWT → HTTP 403 (POS-AUTH-002: read restricted to SA, HR Director, WP)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/positions')
        .set('Authorization', `Bearer ${restrictedToken}`);

      expect(res.status).toBe(403);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/positions');

      expect(res.status).toBe(401);
    });

    it('response excludes cross-tenant position (SEC-003 tenant isolation)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/positions')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.positions as Array<{ id: string }>).map(p => p.id);
      expect(ids).not.toContain(crossTenantPosId);
    });

    it('status filter → returns only positions matching the specified status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/positions?status=CLOSED')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const positions = res.body.data.positions as Array<{ id: string; status: string }>;
      expect(positions.every(p => p.status === 'CLOSED')).toBe(true);
      expect(positions.map(p => p.id)).toContain(closedPositionId);
    });
  });

  // --------------------------------------------------------------------------
  // Group 3: GET /api/v1/positions/:id
  // --------------------------------------------------------------------------

  describe('GET /api/v1/positions/:id', () => {
    it('valid UUID of existing position in tenant → HTTP 200 + correct data', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/positions/${primaryPositionId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(primaryPositionId);
    });

    it('valid UUID of position in different tenant → HTTP 404 (SEC-003 cross-tenant isolation)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/positions/${crossTenantPosId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    });

    it('valid UUID not present in DB → HTTP 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/positions/00000000-0000-4000-8000-000000000099')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('malformed UUID → HTTP 400 (ParseUUIDPipe rejects)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/positions/not-a-valid-uuid')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/positions/${primaryPositionId}`);

      expect(res.status).toBe(401);
    });

    it('Recruiter JWT → HTTP 403 (POS-AUTH-003)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/positions/${primaryPositionId}`)
        .set('Authorization', `Bearer ${restrictedToken}`);

      expect(res.status).toBe(403);
    });
  });

  // --------------------------------------------------------------------------
  // Group 4: PUT /api/v1/positions/:id
  // --------------------------------------------------------------------------

  describe('PUT /api/v1/positions/:id', () => {
    it('SA JWT + title change → HTTP 200 + updated position data', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/positions/${primaryPositionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'E2E Updated Title' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('E2E Updated Title');
      expect(res.body.data.id).toBe(primaryPositionId);
    });

    it('HR Director JWT → HTTP 200 (POS-AUTH-004: HR Director authorized for update)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/positions/${primaryPositionId}`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ salaryBand: 'P5' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('Workforce Planner JWT → HTTP 403 (POS-AUTH-004: update restricted to SA and HR Director)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/positions/${primaryPositionId}`)
        .set('Authorization', `Bearer ${wpToken}`)
        .send({ title: 'Blocked Update' });

      expect(res.status).toBe(403);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/positions/${primaryPositionId}`)
        .send({ title: 'No Auth' });

      expect(res.status).toBe(401);
    });

    it('non-existent position UUID → HTTP 404 + { success: false, error: { code: "NOT_FOUND" } }', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/positions/00000000-0000-4000-8000-000000000099')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Ghost' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    });

    it('status=ACTIVE → HTTP 200 + position.status === "ACTIVE" (emits WORKFORCE_POSITION_ACTIVATED)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/positions/${activateTargetId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ACTIVE');
    });

    it('CLOSED position → HTTP 409 + { success: false, error: { code: "POSITION_CLOSED" } } (POS-202)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/positions/${closedPositionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Attempt Update Closed' });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'POSITION_CLOSED' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 5: POST /api/v1/positions/:id/close
  // --------------------------------------------------------------------------

  describe('POST /api/v1/positions/:id/close', () => {
    it('SA JWT + valid DRAFT position → HTTP 200 + position.status === "CLOSED" (POS-AUTH-005)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/positions/${closeTargetSAId}/close`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('CLOSED');
      expect(res.body.data.id).toBe(closeTargetSAId);
    });

    it('HR Director JWT → HTTP 200 (POS-AUTH-005: HR Director authorized for close)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/positions/${closeTargetHRId}/close`)
        .set('Authorization', `Bearer ${hrToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('CLOSED');
    });

    it('Workforce Planner JWT → HTTP 403 (POS-AUTH-005: closure restricted to SA and HR Director)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/positions/${closedPositionId}/close`)
        .set('Authorization', `Bearer ${wpToken}`);

      expect(res.status).toBe(403);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/positions/${closedPositionId}/close`);

      expect(res.status).toBe(401);
    });

    it('non-existent position UUID → HTTP 404', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/positions/00000000-0000-4000-8000-000000000099/close')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('already-closed position → HTTP 409 + { success: false, error: { code: "ALREADY_CLOSED" } }', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/positions/${closedPositionId}/close`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'ALREADY_CLOSED' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 6: Audit record verification (AUD-400)
  // Depends on write events from Group 1 (POST), Group 4 (PUT), Group 5 (close).
  // --------------------------------------------------------------------------

  describe('Audit record verification (AUD-400)', () => {
    it('WORKFORCE_POSITION_CREATED record written after POST (AUD-400)', async () => {
      expect(apiCreatedPositionIds.length).toBeGreaterThan(0);
      const createdId = apiCreatedPositionIds[0]!;

      const record = await prisma.auditEvent.findFirst({
        where: { entityId: createdId, action: 'WORKFORCE_POSITION_CREATED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
    });

    it('WORKFORCE_POSITION_UPDATED record written after PUT title change (AUD-400)', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: primaryPositionId, action: 'WORKFORCE_POSITION_UPDATED' },
      });

      expect(record).not.toBeNull();
    });

    it('WORKFORCE_POSITION_ACTIVATED record written after PUT status=ACTIVE (AUD-400)', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: activateTargetId, action: 'WORKFORCE_POSITION_ACTIVATED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
    });

    it('WORKFORCE_POSITION_CLOSED record written after close endpoint (AUD-400 / POS-501)', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: closeTargetSAId, action: 'WORKFORCE_POSITION_CLOSED' },
      });

      expect(record).not.toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Group 7: Soft-delete visibility (deletedAt: null filter — SEC-003)
  // --------------------------------------------------------------------------

  describe('Soft-delete visibility', () => {
    it('soft-deleted position (deletedAt set) not returned in GET /positions list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/positions')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.positions as Array<{ id: string }>).map(p => p.id);
      expect(ids).not.toContain(softDeletedPosId);
    });

    it('soft-deleted position returns HTTP 404 on GET /positions/:id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/positions/${softDeletedPosId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });
});
