// Reference: spec/06_api_contracts.md — Organization API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/12_organization_management_rules.md — all ORG, AGY, DEP rules
// Reference: directives/08_audit_rules.md — AUD-350
//
// E2E tests — real NestJS application + real PostgreSQL DB via PrismaClient.
// Self-contained: all fixtures created in beforeAll, deleted in afterAll.
// No seed.ts modifications — roles resolved via findUniqueOrThrow.
//
// App bootstrap mirrors main.ts exactly:
//   ValidationPipe (whitelist, forbidNonWhitelisted, transform)
//   global prefix 'api' (health excluded)
//   URI versioning

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

const FIXTURE_PASSWORD = 'E2eTest1234!';
const SUFFIX           = Date.now();
const FIXTURE_TENANT_CODE = `E2E-ORG-${SUFFIX}`;
const CROSS_TENANT_CODE   = `E2E-ORG-X-${SUFFIX}`;
const ADMIN_EMAIL         = `e2e-org-admin-${SUFFIX}@test.gov`;
const HR_EMAIL            = `e2e-org-hr-${SUFFIX}@test.gov`;
const WP_EMAIL            = `e2e-org-wp-${SUFFIX}@test.gov`;
const RESTRICTED_EMAIL    = `e2e-org-restricted-${SUFFIX}@test.gov`;

const EXISTING_DEPT_CODE = `E2E-DEPT-${SUFFIX}`;
const CONFLICT_CODE      = `E2E-CONFLICT-${SUFFIX}`;
const DEACT_CODE         = `E2E-DEACT-${SUFFIX}`;
const CROSS_DEPT_CODE    = `E2E-CROSS-D-${SUFFIX}`;
const SOFT_DEL_CODE      = `E2E-SDEL-${SUFFIX}`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Organization (e2e)', () => {
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

  // Pre-created departments (Prisma direct — not via API)
  let existingDeptId: string;
  let conflictDeptId: string;
  let deactivatableDeptId: string;
  let crossTenantDeptId: string;
  let softDeletedDeptId: string;

  // API-created department IDs — captured from POST responses for cleanup
  const apiCreatedDeptIds: string[] = [];

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
      data: { name: 'E2E Organization Tenant', code: FIXTURE_TENANT_CODE, status: 'ACTIVE' },
    });
    fixtureTenantId = tenant.id;

    const crossTenant = await prisma.tenant.create({
      data: { name: 'E2E Cross Tenant Org', code: CROSS_TENANT_CODE, status: 'ACTIVE' },
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
        firstName: 'E2E', lastName: 'Admin', status: 'ACTIVE', failedLoginAttempts: 0,
      },
    });
    adminUserId = adminUser.id;
    await prisma.userRole.create({ data: { userId: adminUser.id, roleId: sysAdminRole.id } });

    const hrUser = await prisma.user.create({
      data: {
        tenantId: fixtureTenantId, email: HR_EMAIL, passwordHash,
        firstName: 'E2E', lastName: 'HR', status: 'ACTIVE', failedLoginAttempts: 0,
      },
    });
    hrUserId = hrUser.id;
    await prisma.userRole.create({ data: { userId: hrUser.id, roleId: hrRole.id } });

    const wpUser = await prisma.user.create({
      data: {
        tenantId: fixtureTenantId, email: WP_EMAIL, passwordHash,
        firstName: 'E2E', lastName: 'WP', status: 'ACTIVE', failedLoginAttempts: 0,
      },
    });
    wpUserId = wpUser.id;
    await prisma.userRole.create({ data: { userId: wpUser.id, roleId: wpRole.id } });

    const restrictedUser = await prisma.user.create({
      data: {
        tenantId: fixtureTenantId, email: RESTRICTED_EMAIL, passwordHash,
        firstName: 'E2E', lastName: 'Restricted', status: 'ACTIVE', failedLoginAttempts: 0,
      },
    });
    restrictedUserId = restrictedUser.id;
    await prisma.userRole.create({ data: { userId: restrictedUser.id, roleId: recruiterRole.id } });

    // Pre-created departments
    const existingDept = await prisma.department.create({
      data: {
        tenantId: fixtureTenantId, name: 'E2E Existing Dept',
        code: EXISTING_DEPT_CODE, status: 'ACTIVE',
      },
    });
    existingDeptId = existingDept.id;

    const conflictDept = await prisma.department.create({
      data: {
        tenantId: fixtureTenantId, name: 'E2E Conflict Dept',
        code: CONFLICT_CODE, status: 'ACTIVE',
      },
    });
    conflictDeptId = conflictDept.id;

    const deactivatableDept = await prisma.department.create({
      data: {
        tenantId: fixtureTenantId, name: 'E2E Deactivatable Dept',
        code: DEACT_CODE, status: 'ACTIVE',
      },
    });
    deactivatableDeptId = deactivatableDept.id;

    const crossDept = await prisma.department.create({
      data: {
        tenantId: crossTenantId, name: 'Cross Tenant Dept',
        code: CROSS_DEPT_CODE, status: 'ACTIVE',
      },
    });
    crossTenantDeptId = crossDept.id;

    // Soft-deleted dept — deletedAt set at creation time for visibility tests
    const softDelDept = await prisma.department.create({
      data: {
        tenantId: fixtureTenantId, name: 'E2E Soft Deleted',
        code: SOFT_DEL_CODE, status: 'ACTIVE', deletedAt: new Date(),
      },
    });
    softDeletedDeptId = softDelDept.id;

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
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      // API-created departments
      for (const deptId of apiCreatedDeptIds) {
        await prisma.auditEvent.deleteMany({ where: { entityId: deptId } }).catch(() => {});
        await prisma.department.delete({ where: { id: deptId } }).catch(() => {});
      }

      // Pre-created departments (some modified by PATCH tests — delete regardless)
      for (const deptId of [
        existingDeptId, conflictDeptId, deactivatableDeptId, crossTenantDeptId, softDeletedDeptId,
      ].filter(Boolean)) {
        await prisma.auditEvent.deleteMany({ where: { entityId: deptId } }).catch(() => {});
        await prisma.department.delete({ where: { id: deptId } }).catch(() => {});
      }

      // Audit events from fixture actors (login + department write events)
      const actorIds = [adminUserId, hrUserId, wpUserId, restrictedUserId].filter(Boolean);
      if (actorIds.length > 0) {
        await prisma.auditEvent.deleteMany({ where: { userId: { in: actorIds } } }).catch(() => {});
      }

      // Fixture users (userRoles first — FK constraint)
      for (const userId of [adminUserId, hrUserId, wpUserId, restrictedUserId].filter(Boolean)) {
        await prisma.userRole.deleteMany({ where: { userId } }).catch(() => {});
        await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      }

      // Tenants — all departments removed above; ON DELETE RESTRICT requires clean slate
      if (fixtureTenantId) await prisma.tenant.delete({ where: { id: fixtureTenantId } }).catch(() => {});
      if (crossTenantId)   await prisma.tenant.delete({ where: { id: crossTenantId } }).catch(() => {});

      await prisma.$disconnect();
    }
    await app?.close();
  }, 30_000);

  // --------------------------------------------------------------------------
  // Group 1: POST /api/v1/departments
  // --------------------------------------------------------------------------

  describe('POST /api/v1/departments', () => {
    it('SA JWT + valid payload → HTTP 201 + { success: true, data: department }', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'E2E New Department', code: `E2E-NEW-${SUFFIX}` });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({ name: 'E2E New Department', status: 'ACTIVE' });
      expect(res.body.data.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      if (res.body.data?.id) apiCreatedDeptIds.push(res.body.data.id as string);
    });

    it('HR Director JWT → HTTP 201 (ORG-AUTH-001: HR Director authorized)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ name: 'HR Created Dept', code: `E2E-HR-${SUFFIX}` });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      if (res.body.data?.id) apiCreatedDeptIds.push(res.body.data.id as string);
    });

    it('Recruiter JWT → HTTP 403 (ORG-AUTH-001: write requires SA or HR Director)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set('Authorization', `Bearer ${restrictedToken}`)
        .send({ name: 'Blocked Dept', code: `E2E-BLOCKED-${SUFFIX}` });

      expect(res.status).toBe(403);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/departments')
        .send({ name: 'No Auth', code: `E2E-NOAUTH-${SUFFIX}` });

      expect(res.status).toBe(401);
    });

    it('duplicate department code in same tenant → HTTP 409 + { success: false, error: { code: "CONFLICT" } }', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Duplicate Code', code: EXISTING_DEPT_CODE });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'CONFLICT' } });
    });

    it('missing required field (name) → HTTP 400 (ValidationPipe rejects)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: `E2E-NONAME-${SUFFIX}` });

      expect(res.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // Group 2: GET /api/v1/departments
  // --------------------------------------------------------------------------

  describe('GET /api/v1/departments', () => {
    it('SA JWT → HTTP 200 + { success: true, data: { departments, total, page, pageSize, totalPages } }', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/departments')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({ page: 1, pageSize: 20 });
      expect(Array.isArray(res.body.data.departments)).toBe(true);
      expect(typeof res.body.data.total).toBe('number');
      expect(typeof res.body.data.totalPages).toBe('number');
    });

    it('HR Director JWT → HTTP 200 (ORG-AUTH-002)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/departments')
        .set('Authorization', `Bearer ${hrToken}`);

      expect(res.status).toBe(200);
    });

    it('Workforce Planner JWT → HTTP 200 (ORG-AUTH-002)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/departments')
        .set('Authorization', `Bearer ${wpToken}`);

      expect(res.status).toBe(200);
    });

    it('Recruiter JWT → HTTP 403 (ORG-AUTH-002: read requires SA, HR Director, or Workforce Planner)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/departments')
        .set('Authorization', `Bearer ${restrictedToken}`);

      expect(res.status).toBe(403);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/departments');

      expect(res.status).toBe(401);
    });

    it('response contains only fixture-tenant departments — cross-tenant dept excluded (SEC-003)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/departments')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.departments as Array<{ id: string }>).map(d => d.id);
      expect(ids).not.toContain(crossTenantDeptId);
    });

    it('search filter → returns departments matching the search term in code', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/departments?search=${encodeURIComponent(EXISTING_DEPT_CODE)}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect((res.body.data.departments as unknown[]).length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Group 3: GET /api/v1/departments/:id
  // --------------------------------------------------------------------------

  describe('GET /api/v1/departments/:id', () => {
    it('valid UUID of existing department in tenant → HTTP 200 + correct data', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/departments/${existingDeptId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(existingDeptId);
    });

    it('valid UUID of department in different tenant → HTTP 404 (SEC-003 cross-tenant isolation)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/departments/${crossTenantDeptId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    });

    it('valid UUID not present in DB → HTTP 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/departments/00000000-0000-4000-8000-000000000099')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('malformed UUID → HTTP 400 (ParseUUIDPipe rejects)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/departments/not-a-valid-uuid')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/departments/${existingDeptId}`);

      expect(res.status).toBe(401);
    });

    it('Recruiter JWT → HTTP 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/departments/${existingDeptId}`)
        .set('Authorization', `Bearer ${restrictedToken}`);

      expect(res.status).toBe(403);
    });
  });

  // --------------------------------------------------------------------------
  // Group 4: PATCH /api/v1/departments/:id
  // --------------------------------------------------------------------------

  describe('PATCH /api/v1/departments/:id', () => {
    it('SA JWT + name change → HTTP 200 + updated department', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/departments/${existingDeptId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'E2E Updated Dept Name' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('E2E Updated Dept Name');
      expect(res.body.data.id).toBe(existingDeptId);
    });

    it('HR Director JWT → HTTP 200 (ORG-AUTH-001)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/departments/${conflictDeptId}`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ name: 'HR Updated Conflict Dept' });

      expect(res.status).toBe(200);
    });

    it('Recruiter JWT → HTTP 403 (ORG-AUTH-001: write requires SA or HR Director)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/departments/${existingDeptId}`)
        .set('Authorization', `Bearer ${restrictedToken}`)
        .send({ name: 'Blocked' });

      expect(res.status).toBe(403);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/departments/${existingDeptId}`)
        .send({ name: 'No Auth' });

      expect(res.status).toBe(401);
    });

    it('non-existent department ID → HTTP 404 + { success: false, error: { code: "NOT_FOUND" } }', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/departments/00000000-0000-4000-8000-000000000099')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Ghost' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    });

    it('code conflicts with existing department in tenant → HTTP 409', async () => {
      // existingDeptId has EXISTING_DEPT_CODE; CONFLICT_CODE is already taken by conflictDeptId
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/departments/${existingDeptId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: CONFLICT_CODE });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'CONFLICT' } });
    });

    it('status=INACTIVE → HTTP 200 + department status updated to INACTIVE (DEP-004)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/departments/${deactivatableDeptId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'INACTIVE' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('INACTIVE');
    });
  });

  // --------------------------------------------------------------------------
  // Group 5: GET /api/v1/agencies/current
  // --------------------------------------------------------------------------

  describe('GET /api/v1/agencies/current', () => {
    it('SA JWT → HTTP 200 + agency shape (name, code, status, createdAt)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/agencies/current')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        name: 'E2E Organization Tenant',
        code: FIXTURE_TENANT_CODE,
        status: 'ACTIVE',
      });
      expect(typeof res.body.data.createdAt).toBe('string');
    });

    it('Workforce Planner JWT → HTTP 200 (ORG-AUTH-003: auth-only — any role allowed)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/agencies/current')
        .set('Authorization', `Bearer ${wpToken}`);

      expect(res.status).toBe(200);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/agencies/current');

      expect(res.status).toBe(401);
    });

    it('response data does not contain id field (AGY-003: no internal identifiers)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/agencies/current')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('id');
    });
  });

  // --------------------------------------------------------------------------
  // Group 6: Audit record verification (AUD-350)
  // Depends on write events from Group 1 (POST) and Group 4 (PATCH).
  // --------------------------------------------------------------------------

  describe('Audit record verification', () => {
    it('ORG_DEPARTMENT_CREATED record written after POST (AUD-350)', async () => {
      expect(apiCreatedDeptIds.length).toBeGreaterThan(0);
      const createdId = apiCreatedDeptIds[0]!;

      const record = await prisma.auditEvent.findFirst({
        where: { entityId: createdId, action: 'ORG_DEPARTMENT_CREATED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
    });

    it('ORG_DEPARTMENT_UPDATED record written after PATCH name change (AUD-350)', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: existingDeptId, action: 'ORG_DEPARTMENT_UPDATED' },
      });

      expect(record).not.toBeNull();
    });

    it('ORG_DEPARTMENT_DEACTIVATED record written after PATCH status=INACTIVE (AUD-350)', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: deactivatableDeptId, action: 'ORG_DEPARTMENT_DEACTIVATED' },
      });

      expect(record).not.toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Group 7: Soft-delete visibility (deletedAt: null filter — DEP-005)
  // --------------------------------------------------------------------------

  describe('Soft-delete visibility', () => {
    it('soft-deleted department (deletedAt set) not returned in GET /departments list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/departments')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.departments as Array<{ id: string }>).map(d => d.id);
      expect(ids).not.toContain(softDeletedDeptId);
    });

    it('soft-deleted department returns HTTP 404 on GET /departments/:id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/departments/${softDeletedDeptId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });
});
