// Reference: spec/06_api_contracts.md — POST /api/v1/users, GET /api/v1/users, GET /api/v1/users/:id
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/08_audit_rules.md — AUD-250 User Management Audit Rules
// Reference: directives/10_role_based_access_rules.md — role set
//
// E2E tests — real NestJS application + real PostgreSQL DB via PrismaClient.
// Self-contained: all fixtures created in beforeAll, deleted in afterAll.
// Tests are ordered: POST → GET → GET/:id → audit verification.
// Audit tests depend on records written by POST Group 1 test 1.
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
const SUFFIX = Date.now();
const FIXTURE_TENANT_CODE = `E2E-USERS-${SUFFIX}`;
const CROSS_TENANT_CODE   = `E2E-CROSS-${SUFFIX}`;
const ADMIN_EMAIL         = `e2e-admin-${SUFFIX}@test.gov`;
const HR_EMAIL            = `e2e-hr-${SUFFIX}@test.gov`;
const RESTRICTED_EMAIL    = `e2e-restricted-${SUFFIX}@test.gov`;
const CROSS_TENANT_EMAIL  = `e2e-cross-${SUFFIX}@test.gov`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Users (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let adminToken: string;
  let hrToken: string;
  let restrictedToken: string;

  let fixtureTenantId: string;
  let crossTenantId: string;
  let adminUserId: string;
  let hrUserId: string;
  let restrictedUserId: string;
  let crossTenantUserId: string;
  let sysAdminRoleId: string;
  let hrDirectorRoleId: string;
  let recruiterRoleId: string;

  // IDs of users created via POST /api/v1/users during tests — captured for afterAll cleanup
  const apiCreatedUserIds: string[] = [];

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

    // Fixture tenant
    const tenant = await prisma.tenant.create({
      data: { name: 'E2E Users Tenant', code: FIXTURE_TENANT_CODE, status: 'ACTIVE' },
    });
    fixtureTenantId = tenant.id;

    // Cross-tenant (for GET /:id isolation test)
    const crossTenant = await prisma.tenant.create({
      data: { name: 'E2E Cross Tenant', code: CROSS_TENANT_CODE, status: 'ACTIVE' },
    });
    crossTenantId = crossTenant.id;

    // Resolve seeded role IDs
    const sysAdminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'System Administrator' } });
    const hrRole       = await prisma.role.findUniqueOrThrow({ where: { name: 'HR Director' } });
    const recruiterRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Recruiter' } });
    sysAdminRoleId    = sysAdminRole.id;
    hrDirectorRoleId  = hrRole.id;
    recruiterRoleId   = recruiterRole.id;

    // Admin fixture user (System Administrator — authorized for all three endpoints)
    const adminUser = await prisma.user.create({
      data: {
        tenantId: fixtureTenantId,
        email: ADMIN_EMAIL,
        passwordHash,
        firstName: 'E2E',
        lastName: 'Admin',
        status: 'ACTIVE',
        failedLoginAttempts: 0,
      },
    });
    adminUserId = adminUser.id;
    await prisma.userRole.create({ data: { userId: adminUser.id, roleId: sysAdminRoleId } });

    // HR Director fixture user (also authorized — validates dual-role guard path)
    const hrUser = await prisma.user.create({
      data: {
        tenantId: fixtureTenantId,
        email: HR_EMAIL,
        passwordHash,
        firstName: 'E2E',
        lastName: 'HR',
        status: 'ACTIVE',
        failedLoginAttempts: 0,
      },
    });
    hrUserId = hrUser.id;
    await prisma.userRole.create({ data: { userId: hrUser.id, roleId: hrDirectorRoleId } });

    // Restricted fixture user (Recruiter only — should receive 403)
    const restrictedUser = await prisma.user.create({
      data: {
        tenantId: fixtureTenantId,
        email: RESTRICTED_EMAIL,
        passwordHash,
        firstName: 'E2E',
        lastName: 'Restricted',
        status: 'ACTIVE',
        failedLoginAttempts: 0,
      },
    });
    restrictedUserId = restrictedUser.id;
    await prisma.userRole.create({ data: { userId: restrictedUser.id, roleId: recruiterRoleId } });

    // Cross-tenant fixture user (used only for GET /:id isolation test)
    const crossUser = await prisma.user.create({
      data: {
        tenantId: crossTenantId,
        email: CROSS_TENANT_EMAIL,
        passwordHash,
        firstName: 'E2E',
        lastName: 'Cross',
        status: 'ACTIVE',
        failedLoginAttempts: 0,
      },
    });
    crossTenantUserId = crossUser.id;
    await prisma.userRole.create({ data: { userId: crossUser.id, roleId: sysAdminRoleId } });

    // Authenticate all fixture users and capture JWTs
    const adminRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: FIXTURE_PASSWORD });
    adminToken = adminRes.body.data.accessToken as string;

    const hrRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: HR_EMAIL, password: FIXTURE_PASSWORD });
    hrToken = hrRes.body.data.accessToken as string;

    const restrictedRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: RESTRICTED_EMAIL, password: FIXTURE_PASSWORD });
    restrictedToken = restrictedRes.body.data.accessToken as string;
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      // Remove API-created users (captured from POST responses during tests)
      for (const userId of apiCreatedUserIds) {
        await prisma.auditEvent.deleteMany({ where: { entityId: userId } }).catch(() => {});
        await prisma.userRole.deleteMany({ where: { userId } }).catch(() => {});
        await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      }

      // Remove audit events written by fixture actor users (login + user creation events)
      const actorIds = [adminUserId, hrUserId, restrictedUserId].filter(Boolean);
      if (actorIds.length > 0) {
        await prisma.auditEvent.deleteMany({ where: { userId: { in: actorIds } } }).catch(() => {});
      }

      // Remove fixture users (in fixture tenant)
      for (const userId of [adminUserId, hrUserId, restrictedUserId].filter(Boolean)) {
        await prisma.userRole.deleteMany({ where: { userId } }).catch(() => {});
        await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      }

      // Remove cross-tenant fixture user
      if (crossTenantUserId) {
        await prisma.userRole.deleteMany({ where: { userId: crossTenantUserId } }).catch(() => {});
        await prisma.user.delete({ where: { id: crossTenantUserId } }).catch(() => {});
      }

      // Remove tenants
      if (fixtureTenantId) {
        await prisma.tenant.delete({ where: { id: fixtureTenantId } }).catch(() => {});
      }
      if (crossTenantId) {
        await prisma.tenant.delete({ where: { id: crossTenantId } }).catch(() => {});
      }

      await prisma.$disconnect();
    }
    await app?.close();
  }, 20_000);

  // --------------------------------------------------------------------------
  // Group 1: POST /api/v1/users
  // --------------------------------------------------------------------------

  describe('POST /api/v1/users', () => {
    it('valid payload + admin JWT → HTTP 201 + { success: true, data: user }', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'New',
          lastName: 'User',
          email: `new-user-${SUFFIX}@test.gov`,
          roleIds: [sysAdminRoleId],
          password: 'TempPass1234!',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        firstName: 'New',
        lastName: 'User',
        status: 'ACTIVE',
        lastLoginAt: null,
      });

      if (res.body.data?.id) apiCreatedUserIds.push(res.body.data.id as string);
    });

    it('response data.id is a valid UUID v4', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Uuid',
          lastName: 'Test',
          email: `uuid-test-${SUFFIX}@test.gov`,
          roleIds: [sysAdminRoleId],
          password: 'TempPass1234!',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      if (res.body.data?.id) apiCreatedUserIds.push(res.body.data.id as string);
    });

    it('response data.roles contains the role names for the requested roleIds', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Role',
          lastName: 'Check',
          email: `role-check-${SUFFIX}@test.gov`,
          roleIds: [sysAdminRoleId],
          password: 'TempPass1234!',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.roles).toContain('System Administrator');

      if (res.body.data?.id) apiCreatedUserIds.push(res.body.data.id as string);
    });

    it('duplicate email within same tenant → HTTP 409 + { success: false, error: { code: "CONFLICT" } }', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Dup',
          lastName: 'Email',
          email: ADMIN_EMAIL, // already exists in this tenant
          roleIds: [sysAdminRoleId],
          password: 'TempPass1234!',
        });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'CONFLICT' } });
    });

    it('non-existent roleId (valid UUID v4, no DB record) → HTTP 400 + { success: false, error: { code: "VALIDATION_ERROR" } }', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Bad',
          lastName: 'Role',
          email: `bad-role-${SUFFIX}@test.gov`,
          roleIds: ['00000000-0000-4000-8000-000000000099'],
          password: 'TempPass1234!',
        });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
    });

    it('missing email field → HTTP 400 (ValidationPipe rejects)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'No', lastName: 'Email', roleIds: [sysAdminRoleId], password: 'TempPass1234!' });

      expect(res.status).toBe(400);
    });

    it('password fails policy (no uppercase) → HTTP 400 (ValidationPipe rejects)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Bad',
          lastName: 'Pass',
          email: `bad-pass-${SUFFIX}@test.gov`,
          roleIds: [sysAdminRoleId],
          password: 'weakpassword1!',
        });

      expect(res.status).toBe(400);
    });

    it('invalid UUID format in roleIds → HTTP 400 (ValidationPipe @IsUUID)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Bad',
          lastName: 'UUID',
          email: `bad-uuid-${SUFFIX}@test.gov`,
          roleIds: ['not-a-uuid'],
          password: 'TempPass1234!',
        });

      expect(res.status).toBe(400);
    });

    it('empty roleIds array → HTTP 400 (ValidationPipe @ArrayNotEmpty)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'No',
          lastName: 'Roles',
          email: `no-roles-${SUFFIX}@test.gov`,
          roleIds: [],
          password: 'TempPass1234!',
        });

      expect(res.status).toBe(400);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .send({
          firstName: 'No',
          lastName: 'Auth',
          email: `no-auth-${SUFFIX}@test.gov`,
          roleIds: [sysAdminRoleId],
          password: 'TempPass1234!',
        });

      expect(res.status).toBe(401);
    });

    it('Recruiter JWT → HTTP 403 (RolesGuard denies non-qualifying role)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${restrictedToken}`)
        .send({
          firstName: 'Restricted',
          lastName: 'Attempt',
          email: `restricted-${SUFFIX}@test.gov`,
          roleIds: [sysAdminRoleId],
          password: 'TempPass1234!',
        });

      expect(res.status).toBe(403);
    });

    it('HR Director JWT → HTTP 201 (HR Director role is authorized)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          firstName: 'HR',
          lastName: 'Created',
          email: `hr-created-${SUFFIX}@test.gov`,
          roleIds: [recruiterRoleId],
          password: 'TempPass1234!',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      if (res.body.data?.id) apiCreatedUserIds.push(res.body.data.id as string);
    });
  });

  // --------------------------------------------------------------------------
  // Group 2: GET /api/v1/users
  // --------------------------------------------------------------------------

  describe('GET /api/v1/users', () => {
    it('admin JWT → HTTP 200 + { success: true, data: { users, total, page, pageSize, totalPages } }', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({ page: 1, pageSize: 20 });
      expect(Array.isArray(res.body.data.users)).toBe(true);
      expect(typeof res.body.data.total).toBe('number');
      expect(typeof res.body.data.totalPages).toBe('number');
    });

    it('response data.users contains only users from the authenticated tenant (tenant isolation)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const userIds = (res.body.data.users as Array<{ id: string }>).map(u => u.id);
      expect(userIds).not.toContain(crossTenantUserId);
    });

    it('pageSize=1&page=2 → returns at most 1 user with correct pagination fields', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users?pageSize=1&page=2')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect((res.body.data.users as unknown[]).length).toBeLessThanOrEqual(1);
      expect(res.body.data.pageSize).toBe(1);
      expect(res.body.data.page).toBe(2);
    });

    it('status=ACTIVE filter → all returned users have status ACTIVE', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users?status=ACTIVE')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      (res.body.data.users as Array<{ status: string }>).forEach(u => {
        expect(u.status).toBe('ACTIVE');
      });
    });

    it('search filter → returns users matching the search term', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users?search=E2E')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect((res.body.data.users as unknown[]).length).toBeGreaterThan(0);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/users');

      expect(res.status).toBe(401);
    });

    it('Recruiter JWT → HTTP 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${restrictedToken}`);

      expect(res.status).toBe(403);
    });
  });

  // --------------------------------------------------------------------------
  // Group 3: GET /api/v1/users/:id
  // --------------------------------------------------------------------------

  describe('GET /api/v1/users/:id', () => {
    it('valid UUID of existing user in tenant → HTTP 200 + { success: true, data: UserRecord }', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/users/${adminUserId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(adminUserId);
    });

    it('valid UUID of user in different tenant → HTTP 404 (cross-tenant isolation)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/users/${crossTenantUserId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    });

    it('valid UUID not present in DB → HTTP 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/00000000-0000-4000-8000-000000000099')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('malformed UUID (not UUID v4 format) → HTTP 400 (ParseUUIDPipe)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/not-a-valid-uuid')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/users/${adminUserId}`);

      expect(res.status).toBe(401);
    });

    it('Recruiter JWT → HTTP 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/users/${adminUserId}`)
        .set('Authorization', `Bearer ${restrictedToken}`);

      expect(res.status).toBe(403);
    });
  });

  // --------------------------------------------------------------------------
  // Group 4: Audit record verification
  // Depends on records written by Group 1 test 1 (first successful POST).
  // --------------------------------------------------------------------------

  describe('Audit record verification', () => {
    it('IDENTITY_USER_CREATED record exists in audit_events for the user created in Group 1', async () => {
      expect(apiCreatedUserIds.length).toBeGreaterThan(0);
      const createdId = apiCreatedUserIds[0]!;

      const record = await prisma.auditEvent.findFirst({
        where: { entityId: createdId, action: 'IDENTITY_USER_CREATED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
    });

    it('AUTHZ_ROLE_ASSIGNED record exists in audit_events for the user created in Group 1', async () => {
      expect(apiCreatedUserIds.length).toBeGreaterThan(0);
      const createdId = apiCreatedUserIds[0]!;

      const record = await prisma.auditEvent.findFirst({
        where: { entityId: createdId, action: 'AUTHZ_ROLE_ASSIGNED' },
      });

      expect(record).not.toBeNull();
    });
  });
});
