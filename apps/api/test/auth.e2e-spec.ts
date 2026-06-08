// Reference: spec/06_api_contracts.md — POST /api/v1/auth/login, POST /api/v1/auth/logout, GET /api/v1/auth/me
// Reference: spec/07_security_architecture.md — Authentication Flow, SEC-003, Account Lockout
// Reference: directives/08_audit_rules.md — AUD-200 through AUD-210
//
// E2E tests — real NestJS application + real PostgreSQL DB via PrismaClient.
// Self-contained: fixture users are created in beforeAll and deleted in afterAll.
// Tests are ordered: login → me → logout → lockout → audit verification → seed check.
// Audit tests depend on records written by earlier test groups (sequential execution guaranteed).
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
const FIXTURE_EMAIL = `e2e-fixture-${SUFFIX}@test.gov`;
const LOCKOUT_EMAIL = `e2e-lockout-${SUFFIX}@test.gov`;
const FIXTURE_TENANT_CODE = `E2E-${SUFFIX}`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let accessToken: string;
  let fixtureUserId: string;
  let lockoutUserId: string;
  let fixtureTenantId: string;

  beforeAll(async () => {
    // Bootstrap NestJS app — mirrors main.ts (no listen(); supertest uses getHttpServer())
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

    // Create fixture data directly via PrismaClient (bypasses app layer)
    prisma = new PrismaClient();
    const passwordHash = await bcrypt.hash(FIXTURE_PASSWORD, 12);

    const tenant = await prisma.tenant.create({
      data: { name: 'E2E Test Tenant', code: FIXTURE_TENANT_CODE, status: 'ACTIVE' },
    });
    fixtureTenantId = tenant.id;

    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'System Administrator' } });

    const fixtureUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: FIXTURE_EMAIL,
        passwordHash,
        firstName: 'E2E',
        lastName: 'Fixture',
        status: 'ACTIVE',
        failedLoginAttempts: 0,
      },
    });
    fixtureUserId = fixtureUser.id;
    await prisma.userRole.create({ data: { userId: fixtureUser.id, roleId: role.id } });

    const lockoutUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: LOCKOUT_EMAIL,
        passwordHash,
        firstName: 'E2E',
        lastName: 'Lockout',
        status: 'ACTIVE',
        failedLoginAttempts: 0,
      },
    });
    lockoutUserId = lockoutUser.id;
    await prisma.userRole.create({ data: { userId: lockoutUser.id, roleId: role.id } });
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      // Audit events have no FK to users/tenants — delete for hygiene, order does not matter
      const userIds = [fixtureUserId, lockoutUserId].filter(Boolean);
      if (userIds.length > 0) {
        await prisma.auditEvent.deleteMany({ where: { userId: { in: userIds } } });
      }

      if (fixtureUserId) {
        await prisma.userRole.deleteMany({ where: { userId: fixtureUserId } });
        await prisma.user.delete({ where: { id: fixtureUserId } }).catch(() => {});
      }
      if (lockoutUserId) {
        await prisma.userRole.deleteMany({ where: { userId: lockoutUserId } });
        await prisma.user.delete({ where: { id: lockoutUserId } }).catch(() => {});
      }
      if (fixtureTenantId) {
        await prisma.tenant.delete({ where: { id: fixtureTenantId } }).catch(() => {});
      }
      await prisma.$disconnect();
    }
    await app?.close();
  }, 15_000);

  // --------------------------------------------------------------------------
  // Group 1: POST /api/v1/auth/login
  // --------------------------------------------------------------------------

  describe('POST /api/v1/auth/login', () => {
    it('valid credentials → HTTP 200 with success: true', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: FIXTURE_EMAIL, password: FIXTURE_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('valid credentials → response data contains accessToken (string) and expiresIn (3600)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: FIXTURE_EMAIL, password: FIXTURE_PASSWORD });

      expect(res.body.data).toMatchObject({
        accessToken: expect.any(String),
        expiresIn: 3600,
      });

      // Capture token for protected endpoint tests in Groups 2 and 3
      accessToken = res.body.data.accessToken as string;
    });

    it('wrong password → HTTP 401 with { success: false, error: { code: UNAUTHORIZED } }', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: FIXTURE_EMAIL, password: 'WrongPassword1!' });

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        success: false,
        error: { code: 'UNAUTHORIZED' },
      });
    });

    it('non-existent email → HTTP 401 with same shape as wrong password (user enumeration protection)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: `no-such-user-${SUFFIX}@test.gov`, password: FIXTURE_PASSWORD });

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        success: false,
        error: { code: 'UNAUTHORIZED' },
      });
    });

    it('missing email field → HTTP 400 (ValidationPipe rejects)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ password: FIXTURE_PASSWORD });

      expect(res.status).toBe(400);
    });

    it('missing password field → HTTP 400 (ValidationPipe rejects)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: FIXTURE_EMAIL });

      expect(res.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // Group 2: GET /api/v1/auth/me (JWT-protected)
  // --------------------------------------------------------------------------

  describe('GET /api/v1/auth/me', () => {
    it('valid JWT → HTTP 200 with success: true', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('valid JWT → response data has id, email, roles — tenantId is excluded', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.body.data).toMatchObject({
        id: fixtureUserId,
        email: FIXTURE_EMAIL,
        roles: expect.arrayContaining(['System Administrator']),
      });
      expect(res.body.data).not.toHaveProperty('tenantId');
    });

    it('no JWT → HTTP 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/me');

      expect(res.status).toBe(401);
    });

    it('invalid JWT → HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not.a.real.token');

      expect(res.status).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // Group 3: POST /api/v1/auth/logout (JWT-protected)
  // --------------------------------------------------------------------------

  describe('POST /api/v1/auth/logout', () => {
    it('valid JWT → HTTP 200 with { success: true }', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });

    it('no JWT → HTTP 401', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/logout');

      expect(res.status).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // Group 4: Lockout flow (uses lockoutUser — isolated from fixture user)
  // --------------------------------------------------------------------------

  describe('Lockout flow', () => {
    it('4 consecutive wrong attempts each return 401 and DB failedLoginAttempts reaches 4', async () => {
      for (let i = 0; i < 4; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: LOCKOUT_EMAIL, password: 'WrongPassword1!' });
        expect(res.status).toBe(401);
      }

      const user = await prisma.user.findUniqueOrThrow({ where: { id: lockoutUserId } });
      expect(user.failedLoginAttempts).toBe(4);
      expect(user.lockedUntil).toBeNull();
    });

    it('5th wrong attempt returns 401 and DB shows lockedUntil set to a future date', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: LOCKOUT_EMAIL, password: 'WrongPassword1!' });

      expect(res.status).toBe(401);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: lockoutUserId } });
      expect(user.failedLoginAttempts).toBe(5);
      expect(user.lockedUntil).not.toBeNull();
      expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it('correct password on locked account → HTTP 401 (lock prevents authentication)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: LOCKOUT_EMAIL, password: FIXTURE_PASSWORD });

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        success: false,
        error: { code: 'UNAUTHORIZED' },
      });
    });
  });

  // --------------------------------------------------------------------------
  // Group 5: Audit record verification
  // Depends on records written by Group 1 (login/failure), Group 3 (logout), Group 4 (lockout).
  // --------------------------------------------------------------------------

  describe('Audit record verification', () => {
    it('AUTH_LOGIN_SUCCESS record exists in DB for fixture user after successful login', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { userId: fixtureUserId, action: 'AUTH_LOGIN_SUCCESS' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
    });

    it('AUTH_LOGIN_FAILURE record exists in DB for fixture user after wrong password', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { userId: fixtureUserId, action: 'AUTH_LOGIN_FAILURE' },
      });

      expect(record).not.toBeNull();
    });

    it('AUTH_LOGOUT record exists in DB for fixture user after logout', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { userId: fixtureUserId, action: 'AUTH_LOGOUT' },
      });

      expect(record).not.toBeNull();
    });

    it('AUTH_ACCOUNT_LOCKOUT record exists in DB for lockout user after 5th failed attempt', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { userId: lockoutUserId, action: 'AUTH_ACCOUNT_LOCKOUT' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
    });
  });

  // --------------------------------------------------------------------------
  // Group 6: Dev seed credential
  // Conditional: meaningful only in development environment.
  // In CI / staging / production: test passes trivially (seed user does not exist).
  // --------------------------------------------------------------------------

  describe('Dev seed credential', () => {
    const isDevEnv = process.env['NODE_ENV'] === 'development';

    it(
      isDevEnv
        ? 'admin@dev.gov / DevAdmin1234! → HTTP 200 in development environment'
        : 'dev seed credential test skipped — not in development environment',
      async () => {
        if (!isDevEnv) {
          expect(true).toBe(true);
          return;
        }

        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: 'admin@dev.gov', password: 'DevAdmin1234!' });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
          accessToken: expect.any(String),
          expiresIn: 3600,
        });
      },
    );
  });
});
