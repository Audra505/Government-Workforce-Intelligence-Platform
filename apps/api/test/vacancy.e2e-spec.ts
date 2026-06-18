// Reference: spec/01_requirements.md — FR-103 Vacancy Management
// Reference: spec/06_api_contracts.md — Vacancy API contracts + RBAC matrix
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/03_vacancy_management_rules.md — VAC-001 through VAC-702
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
//   vacancies (→ positions via positionId) deleted before positions
//   positions (→ departments ON DELETE RESTRICT) deleted before departments
//   departments (→ tenants ON DELETE RESTRICT) deleted before tenants
//   audit events (→ users) deleted before users
//
// GD-14-1 (approved): IN_RECRUITMENT scenarios are excluded from e2e scope.
//   IN_RECRUITMENT is a valid service state but has no API trigger in Phase 2.
//   The state is accepted by closeVacancy() and covered by unit tests.
//   E2e tests only exercise states reachable through the supported API surface.

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
const FIXTURE_TENANT_CODE = `E2E-VAC-${SUFFIX}`;
const CROSS_TENANT_CODE   = `E2E-VAC-X-${SUFFIX}`;
const ADMIN_EMAIL         = `e2e-vac-admin-${SUFFIX}@test.gov`;
const HR_EMAIL            = `e2e-vac-hr-${SUFFIX}@test.gov`;
const WP_EMAIL            = `e2e-vac-wp-${SUFFIX}@test.gov`;
const RESTRICTED_EMAIL    = `e2e-vac-restricted-${SUFFIX}@test.gov`;

const VALID_FILL_DATE     = '2027-12-01';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Vacancy (e2e)', () => {
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

  // Departments
  let primaryDeptId: string;
  let crossTenantDeptId: string;

  // Positions used for vacancy creation
  let activePositionId: string;     // ACTIVE — valid for vacancy creation (VAC-102)
  let draftPositionId: string;      // DRAFT — invalid for vacancy creation (VAC-102)
  let crossTenantPositionId: string; // ACTIVE in cross-tenant

  // Pre-created vacancies (Prisma-direct, not via API)
  let draftVacancyId: string;              // DRAFT — GET/update/open source
  let openVacancyId: string;              // OPEN — used in close FILLED and close CANCELLED from OPEN
  let closedVacancyId: string;            // CLOSED — read-only, already-closed tests
  let crossTenantVacancyId: string;       // DRAFT in cross-tenant — SEC-003 tests
  let softDeletedVacancyId: string;       // DRAFT + deletedAt — soft-delete filter tests
  let openTargetSAId: string;             // DRAFT — SA opens this in Group 5
  let openTargetHRId: string;             // DRAFT — HR opens this in Group 5
  let closeFilledTargetId: string;        // OPEN — SA closes as FILLED in Group 6
  let closeCancelledFromDraftTargetId: string; // DRAFT — SA closes as CANCELLED in Group 7
  let closeCancelledFromOpenTargetId: string;  // OPEN — HR closes as CANCELLED in Group 7

  // API-created vacancy IDs — captured from POST responses for cleanup
  const apiCreatedVacancyIds: string[] = [];

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
      data: { name: 'E2E Vacancy Tenant', code: FIXTURE_TENANT_CODE, status: 'ACTIVE' },
    });
    fixtureTenantId = tenant.id;

    const crossTenant = await prisma.tenant.create({
      data: { name: 'E2E Cross Tenant Vac', code: CROSS_TENANT_CODE, status: 'ACTIVE' },
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
        firstName: 'E2E', lastName: 'VacAdmin', status: 'ACTIVE', failedLoginAttempts: 0,
      },
    });
    adminUserId = adminUser.id;
    await prisma.userRole.create({ data: { userId: adminUser.id, roleId: sysAdminRole.id } });

    const hrUser = await prisma.user.create({
      data: {
        tenantId: fixtureTenantId, email: HR_EMAIL, passwordHash,
        firstName: 'E2E', lastName: 'VacHR', status: 'ACTIVE', failedLoginAttempts: 0,
      },
    });
    hrUserId = hrUser.id;
    await prisma.userRole.create({ data: { userId: hrUser.id, roleId: hrRole.id } });

    const wpUser = await prisma.user.create({
      data: {
        tenantId: fixtureTenantId, email: WP_EMAIL, passwordHash,
        firstName: 'E2E', lastName: 'VacWP', status: 'ACTIVE', failedLoginAttempts: 0,
      },
    });
    wpUserId = wpUser.id;
    await prisma.userRole.create({ data: { userId: wpUser.id, roleId: wpRole.id } });

    const restrictedUser = await prisma.user.create({
      data: {
        tenantId: fixtureTenantId, email: RESTRICTED_EMAIL, passwordHash,
        firstName: 'E2E', lastName: 'VacRestricted', status: 'ACTIVE', failedLoginAttempts: 0,
      },
    });
    restrictedUserId = restrictedUser.id;
    await prisma.userRole.create({ data: { userId: restrictedUser.id, roleId: recruiterRole.id } });

    // Departments
    const primaryDept = await prisma.department.create({
      data: { tenantId: fixtureTenantId, name: 'E2E Vac Dept', code: `E2E-VD-${SUFFIX}`, status: 'ACTIVE' },
    });
    primaryDeptId = primaryDept.id;

    const crossDept = await prisma.department.create({
      data: { tenantId: crossTenantId, name: 'E2E Vac Cross Dept', code: `E2E-VCD-${SUFFIX}`, status: 'ACTIVE' },
    });
    crossTenantDeptId = crossDept.id;

    // Positions
    const activePos = await prisma.position.create({
      data: { tenantId: fixtureTenantId, departmentId: primaryDeptId, title: 'E2E Vac Active Pos', status: 'ACTIVE' },
    });
    activePositionId = activePos.id;

    const draftPos = await prisma.position.create({
      data: { tenantId: fixtureTenantId, departmentId: primaryDeptId, title: 'E2E Vac Draft Pos', status: 'DRAFT' },
    });
    draftPositionId = draftPos.id;

    const crossPos = await prisma.position.create({
      data: { tenantId: crossTenantId, departmentId: crossTenantDeptId, title: 'E2E Cross Pos', status: 'ACTIVE' },
    });
    crossTenantPositionId = crossPos.id;

    // Pre-created vacancies — Prisma-direct (not via API)
    const draftVac = await prisma.vacancy.create({
      data: { tenantId: fixtureTenantId, positionId: activePositionId, status: 'DRAFT', priority: 'HIGH', reason: 'RETIREMENT' },
    });
    draftVacancyId = draftVac.id;

    const openVac = await prisma.vacancy.create({
      data: { tenantId: fixtureTenantId, positionId: activePositionId, status: 'OPEN', priority: 'MEDIUM', reason: 'EXPANSION' },
    });
    openVacancyId = openVac.id;

    const closedVac = await prisma.vacancy.create({
      data: { tenantId: fixtureTenantId, positionId: activePositionId, status: 'CLOSED', priority: 'LOW', reason: 'RESIGNATION' },
    });
    closedVacancyId = closedVac.id;

    const crossVac = await prisma.vacancy.create({
      data: { tenantId: crossTenantId, positionId: crossTenantPositionId, status: 'DRAFT', priority: 'LOW', reason: 'TRANSFER' },
    });
    crossTenantVacancyId = crossVac.id;

    const softDeletedVac = await prisma.vacancy.create({
      data: {
        tenantId: fixtureTenantId, positionId: activePositionId, status: 'DRAFT',
        priority: 'LOW', reason: 'EXPANSION', deletedAt: new Date(),
      },
    });
    softDeletedVacancyId = softDeletedVac.id;

    const openTargetSA = await prisma.vacancy.create({
      data: { tenantId: fixtureTenantId, positionId: activePositionId, status: 'DRAFT', priority: 'MEDIUM', reason: 'NEW_POSITION' },
    });
    openTargetSAId = openTargetSA.id;

    const openTargetHR = await prisma.vacancy.create({
      data: { tenantId: fixtureTenantId, positionId: activePositionId, status: 'DRAFT', priority: 'LOW', reason: 'TRANSFER' },
    });
    openTargetHRId = openTargetHR.id;

    const closeFilledTarget = await prisma.vacancy.create({
      data: { tenantId: fixtureTenantId, positionId: activePositionId, status: 'OPEN', priority: 'CRITICAL', reason: 'RETIREMENT' },
    });
    closeFilledTargetId = closeFilledTarget.id;

    const closeCancelledFromDraft = await prisma.vacancy.create({
      data: { tenantId: fixtureTenantId, positionId: activePositionId, status: 'DRAFT', priority: 'LOW', reason: 'TERMINATION' },
    });
    closeCancelledFromDraftTargetId = closeCancelledFromDraft.id;

    const closeCancelledFromOpen = await prisma.vacancy.create({
      data: { tenantId: fixtureTenantId, positionId: activePositionId, status: 'OPEN', priority: 'MEDIUM', reason: 'EXPANSION' },
    });
    closeCancelledFromOpenTargetId = closeCancelledFromOpen.id;

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
      const tenantIds = [fixtureTenantId, crossTenantId].filter(Boolean);

      // Vacancies must be deleted before positions (FK on positionId)
      if (tenantIds.length > 0) {
        await prisma.vacancy.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
      }

      // Positions must be deleted before departments
      if (tenantIds.length > 0) {
        await prisma.position.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
      }

      // Departments
      for (const deptId of [primaryDeptId, crossTenantDeptId].filter(Boolean)) {
        await prisma.department.delete({ where: { id: deptId } }).catch(() => {});
      }

      // Audit events for fixture actors — must precede user deletion
      const actorIds = [adminUserId, hrUserId, wpUserId, restrictedUserId].filter(Boolean);
      if (actorIds.length > 0) {
        await prisma.auditEvent.deleteMany({ where: { userId: { in: actorIds } } }).catch(() => {});
      }

      // Users (userRoles first — FK constraint)
      for (const userId of actorIds) {
        await prisma.userRole.deleteMany({ where: { userId } }).catch(() => {});
        await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      }

      // Tenants — all vacancies, positions, departments, and users removed above
      if (fixtureTenantId) await prisma.tenant.delete({ where: { id: fixtureTenantId } }).catch(() => {});
      if (crossTenantId)   await prisma.tenant.delete({ where: { id: crossTenantId } }).catch(() => {});

      await prisma.$disconnect();
    }
    await app?.close();
  }, 30_000);

  // --------------------------------------------------------------------------
  // Group 1: POST /api/v1/vacancies
  // --------------------------------------------------------------------------

  describe('POST /api/v1/vacancies', () => {
    it('SA JWT + valid payload (ACTIVE position) → HTTP 201 + { success: true, data: vacancy }', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/vacancies')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          positionId: activePositionId,
          priority: 'HIGH',
          reason: 'NEW_POSITION',
          expectedFillDate: VALID_FILL_DATE,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        status: 'DRAFT',
        priority: 'HIGH',
        reason: 'NEW_POSITION',
        positionId: activePositionId,
      });
      expect(res.body.data.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      // tenantId must NOT be present in response (SEC-003)
      expect(res.body.data).not.toHaveProperty('tenantId');

      if (res.body.data?.id) apiCreatedVacancyIds.push(res.body.data.id as string);
    });

    it('HR Director JWT → HTTP 201 (write authorized for HR Director)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/vacancies')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          positionId: activePositionId,
          priority: 'MEDIUM',
          reason: 'EXPANSION',
          expectedFillDate: VALID_FILL_DATE,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      if (res.body.data?.id) apiCreatedVacancyIds.push(res.body.data.id as string);
    });

    it('Workforce Planner JWT → HTTP 403 (write restricted to SA and HR Director)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/vacancies')
        .set('Authorization', `Bearer ${wpToken}`)
        .send({
          positionId: activePositionId,
          priority: 'LOW',
          reason: 'TRANSFER',
          expectedFillDate: VALID_FILL_DATE,
        });

      expect(res.status).toBe(403);
    });

    it('Recruiter JWT → HTTP 403 (write restricted to SA and HR Director)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/vacancies')
        .set('Authorization', `Bearer ${restrictedToken}`)
        .send({
          positionId: activePositionId,
          priority: 'LOW',
          reason: 'TRANSFER',
          expectedFillDate: VALID_FILL_DATE,
        });

      expect(res.status).toBe(403);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/vacancies')
        .send({
          positionId: activePositionId,
          priority: 'LOW',
          reason: 'TRANSFER',
          expectedFillDate: VALID_FILL_DATE,
        });

      expect(res.status).toBe(401);
    });

    it('DRAFT position → HTTP 422 + POSITION_NOT_ELIGIBLE (VAC-102: position must be ACTIVE)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/vacancies')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          positionId: draftPositionId,
          priority: 'LOW',
          reason: 'TRANSFER',
          expectedFillDate: VALID_FILL_DATE,
        });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'POSITION_NOT_ELIGIBLE' } });
    });

    it('cross-tenant ACTIVE position → HTTP 422 + POSITION_NOT_ELIGIBLE (SEC-003 prevents enumeration)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/vacancies')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          positionId: crossTenantPositionId,
          priority: 'LOW',
          reason: 'TRANSFER',
          expectedFillDate: VALID_FILL_DATE,
        });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'POSITION_NOT_ELIGIBLE' } });
    });

    it('non-existent positionId → HTTP 422 + POSITION_NOT_ELIGIBLE (SEC-003: same response for absent and cross-tenant)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/vacancies')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          positionId: '00000000-0000-4000-8000-000000000099',
          priority: 'LOW',
          reason: 'TRANSFER',
          expectedFillDate: VALID_FILL_DATE,
        });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'POSITION_NOT_ELIGIBLE' } });
    });

    it('missing required field (priority) → HTTP 400 (ValidationPipe rejects)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/vacancies')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ positionId: activePositionId, reason: 'EXPANSION', expectedFillDate: VALID_FILL_DATE });

      expect(res.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // Group 2: GET /api/v1/vacancies
  // --------------------------------------------------------------------------

  describe('GET /api/v1/vacancies', () => {
    it('SA JWT → HTTP 200 + { success: true, data: { vacancies, total, page, pageSize, totalPages } }', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/vacancies')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({ page: 1, pageSize: 20 });
      expect(Array.isArray(res.body.data.vacancies)).toBe(true);
      expect(typeof res.body.data.total).toBe('number');
      expect(typeof res.body.data.totalPages).toBe('number');
    });

    it('HR Director JWT → HTTP 200 (read authorized for HR Director)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/vacancies')
        .set('Authorization', `Bearer ${hrToken}`);

      expect(res.status).toBe(200);
    });

    it('Workforce Planner JWT → HTTP 200 (Workforce Planner has read-only access)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/vacancies')
        .set('Authorization', `Bearer ${wpToken}`);

      expect(res.status).toBe(200);
    });

    it('Recruiter JWT → HTTP 403 (read restricted to SA, HR Director, Workforce Planner)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/vacancies')
        .set('Authorization', `Bearer ${restrictedToken}`);

      expect(res.status).toBe(403);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/vacancies');

      expect(res.status).toBe(401);
    });

    it('response excludes cross-tenant vacancy (SEC-003 tenant isolation)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/vacancies')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.vacancies as Array<{ id: string }>).map(v => v.id);
      expect(ids).not.toContain(crossTenantVacancyId);
    });

    it('status filter → returns only vacancies matching the specified status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/vacancies?status=CLOSED')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const vacancies = res.body.data.vacancies as Array<{ id: string; status: string }>;
      expect(vacancies.every(v => v.status === 'CLOSED')).toBe(true);
      expect(vacancies.map(v => v.id)).toContain(closedVacancyId);
    });

    it('priority filter → returns only vacancies matching the specified priority', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/vacancies?priority=HIGH')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const vacancies = res.body.data.vacancies as Array<{ id: string; priority: string }>;
      expect(vacancies.every(v => v.priority === 'HIGH')).toBe(true);
    });

    it('response includes ageInDays and agingStatus fields (VAC-701, VAC-702)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/vacancies?status=DRAFT`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const first = (res.body.data.vacancies as Array<Record<string, unknown>>)[0];
      if (first) {
        expect(typeof first['ageInDays']).toBe('number');
        expect(['OK', 'WARNING', 'HIGH_RISK']).toContain(first['agingStatus']);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Group 3: GET /api/v1/vacancies/:id
  // --------------------------------------------------------------------------

  describe('GET /api/v1/vacancies/:id', () => {
    it('valid UUID of existing vacancy in tenant → HTTP 200 + correct data', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/vacancies/${draftVacancyId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(draftVacancyId);
      expect(res.body.data.status).toBe('DRAFT');
      expect(res.body.data).not.toHaveProperty('tenantId');
    });

    it('Workforce Planner JWT → HTTP 200 (read includes Workforce Planner)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/vacancies/${draftVacancyId}`)
        .set('Authorization', `Bearer ${wpToken}`);

      expect(res.status).toBe(200);
    });

    it('Recruiter JWT → HTTP 403 (read restricted to SA, HR Director, Workforce Planner)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/vacancies/${draftVacancyId}`)
        .set('Authorization', `Bearer ${restrictedToken}`);

      expect(res.status).toBe(403);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/vacancies/${draftVacancyId}`);

      expect(res.status).toBe(401);
    });

    it('valid UUID of vacancy in different tenant → HTTP 404 (SEC-003 cross-tenant isolation)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/vacancies/${crossTenantVacancyId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    });

    it('valid UUID not present in DB → HTTP 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/vacancies/00000000-0000-4000-8000-000000000099')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('malformed UUID → HTTP 400 (ParseUUIDPipe rejects)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/vacancies/not-a-valid-uuid')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('CLOSED vacancy is readable (VAC-501: read-only, not hidden)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/vacancies/${closedVacancyId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CLOSED');
    });
  });

  // --------------------------------------------------------------------------
  // Group 4: PUT /api/v1/vacancies/:id — field updates (no lifecycle transition)
  // --------------------------------------------------------------------------

  describe('PUT /api/v1/vacancies/:id — field updates', () => {
    it('SA JWT + priority change → HTTP 200 + updated priority (WORKFORCE_VACANCY_UPDATED emitted)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/vacancies/${draftVacancyId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ priority: 'CRITICAL' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.priority).toBe('CRITICAL');
      expect(res.body.data.id).toBe(draftVacancyId);
    });

    it('HR Director JWT + field update → HTTP 200 (write authorized for HR Director)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/vacancies/${draftVacancyId}`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ priority: 'HIGH' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('Workforce Planner JWT → HTTP 403 (update restricted to SA and HR Director)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/vacancies/${draftVacancyId}`)
        .set('Authorization', `Bearer ${wpToken}`)
        .send({ priority: 'LOW' });

      expect(res.status).toBe(403);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/vacancies/${draftVacancyId}`)
        .send({ priority: 'LOW' });

      expect(res.status).toBe(401);
    });

    it('non-existent vacancy UUID → HTTP 404 + NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/vacancies/00000000-0000-4000-8000-000000000099')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ priority: 'LOW' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    });

    it('CLOSED vacancy → HTTP 409 + VACANCY_CLOSED (VAC-501: closed vacancies are read-only)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/vacancies/${closedVacancyId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ priority: 'MEDIUM' });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'VACANCY_CLOSED' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 5: PUT /api/v1/vacancies/:id — status=OPEN (DRAFT→OPEN lifecycle transition)
  // --------------------------------------------------------------------------

  describe('PUT /api/v1/vacancies/:id — DRAFT→OPEN transition', () => {
    it('SA JWT + DRAFT vacancy + { status: "OPEN" } → HTTP 200 + status OPEN', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/vacancies/${openTargetSAId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'OPEN' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('OPEN');
      expect(res.body.data.id).toBe(openTargetSAId);
    });

    it('HR Director JWT + DRAFT vacancy → HTTP 200 + status OPEN', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/vacancies/${openTargetHRId}`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ status: 'OPEN' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('OPEN');
    });

    it('Workforce Planner JWT → HTTP 403 (lifecycle write restricted to SA and HR Director)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/vacancies/${draftVacancyId}`)
        .set('Authorization', `Bearer ${wpToken}`)
        .send({ status: 'OPEN' });

      expect(res.status).toBe(403);
    });

    it('OPEN vacancy + { status: "OPEN" } → HTTP 409 + INVALID_TRANSITION (not DRAFT)', async () => {
      // openTargetSAId is now OPEN from the test above
      const res = await request(app.getHttpServer())
        .put(`/api/v1/vacancies/${openTargetSAId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'OPEN' });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INVALID_TRANSITION' } });
    });

    it('CLOSED vacancy + { status: "OPEN" } → HTTP 409 + VACANCY_CLOSED (VAC-501)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/vacancies/${closedVacancyId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'OPEN' });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'VACANCY_CLOSED' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 6: POST /api/v1/vacancies/:id/close — FILLED closure (VAC-402)
  // --------------------------------------------------------------------------

  describe('POST /api/v1/vacancies/:id/close — FILLED', () => {
    it('SA JWT + OPEN vacancy + FILLED → HTTP 200 + status CLOSED + filledAt set (VAC-402)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/vacancies/${closeFilledTargetId}/close`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ closureType: 'FILLED' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('CLOSED');
      expect(res.body.data.filledAt).not.toBeNull();
      expect(res.body.data.id).toBe(closeFilledTargetId);
    });

    it('DRAFT vacancy + FILLED → HTTP 409 + INVALID_TRANSITION (VAC-300: FILLED requires OPEN source state)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/vacancies/${draftVacancyId}/close`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ closureType: 'FILLED' });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INVALID_TRANSITION' } });
    });

    it('Workforce Planner JWT → HTTP 403 (close restricted to SA and HR Director)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/vacancies/${openVacancyId}/close`)
        .set('Authorization', `Bearer ${wpToken}`)
        .send({ closureType: 'FILLED' });

      expect(res.status).toBe(403);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/vacancies/${openVacancyId}/close`)
        .send({ closureType: 'FILLED' });

      expect(res.status).toBe(401);
    });

    it('non-existent vacancy UUID → HTTP 404', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/vacancies/00000000-0000-4000-8000-000000000099/close')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ closureType: 'FILLED' });

      expect(res.status).toBe(404);
    });

    it('already CLOSED vacancy → HTTP 409 + VACANCY_CLOSED (VAC-501)', async () => {
      // closeFilledTargetId is now CLOSED from the test above
      const res = await request(app.getHttpServer())
        .post(`/api/v1/vacancies/${closeFilledTargetId}/close`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ closureType: 'FILLED' });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'VACANCY_CLOSED' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 7: POST /api/v1/vacancies/:id/close — CANCELLED closure (VAC-500)
  // --------------------------------------------------------------------------

  describe('POST /api/v1/vacancies/:id/close — CANCELLED', () => {
    it('SA JWT + DRAFT vacancy + CANCELLED → HTTP 200 + status CLOSED + filledAt null (VAC-500)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/vacancies/${closeCancelledFromDraftTargetId}/close`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ closureType: 'CANCELLED' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('CLOSED');
      expect(res.body.data.filledAt).toBeNull();
    });

    it('HR Director JWT + OPEN vacancy + CANCELLED → HTTP 200 + status CLOSED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/vacancies/${closeCancelledFromOpenTargetId}/close`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ closureType: 'CANCELLED' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('CLOSED');
      expect(res.body.data.filledAt).toBeNull();
    });

    it('Workforce Planner JWT → HTTP 403 (close restricted to SA and HR Director)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/vacancies/${draftVacancyId}/close`)
        .set('Authorization', `Bearer ${wpToken}`)
        .send({ closureType: 'CANCELLED' });

      expect(res.status).toBe(403);
    });

    it('already CLOSED vacancy → HTTP 409 + VACANCY_CLOSED (VAC-501)', async () => {
      // closedVacancyId was pre-created as CLOSED
      const res = await request(app.getHttpServer())
        .post(`/api/v1/vacancies/${closedVacancyId}/close`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ closureType: 'CANCELLED' });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'VACANCY_CLOSED' } });
    });

    it('missing closureType → HTTP 400 (ValidationPipe rejects empty body)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/vacancies/${openVacancyId}/close`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('invalid closureType value → HTTP 400 (ValidationPipe rejects non-enum value)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/vacancies/${openVacancyId}/close`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ closureType: 'INVALID_VALUE' });

      expect(res.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // Group 8: Audit record verification (AUD-400)
  // Depends on write events from Groups 1, 4, 5, 6, 7.
  // --------------------------------------------------------------------------

  describe('Audit record verification (AUD-400)', () => {
    it('WORKFORCE_VACANCY_CREATED record written after POST /vacancies (AUD-400)', async () => {
      expect(apiCreatedVacancyIds.length).toBeGreaterThan(0);
      const createdId = apiCreatedVacancyIds[0]!;

      const record = await prisma.auditEvent.findFirst({
        where: { entityId: createdId, action: 'WORKFORCE_VACANCY_CREATED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
    });

    it('WORKFORCE_VACANCY_UPDATED record written after PUT field change (AUD-400)', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: draftVacancyId, action: 'WORKFORCE_VACANCY_UPDATED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
    });

    it('WORKFORCE_VACANCY_OPENED record written after PUT status=OPEN (AUD-400)', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: openTargetSAId, action: 'WORKFORCE_VACANCY_OPENED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
    });

    it('WORKFORCE_VACANCY_FILLED record written after close with FILLED (AUD-400)', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: closeFilledTargetId, action: 'WORKFORCE_VACANCY_FILLED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
    });

    it('WORKFORCE_VACANCY_CLOSED record written after close with FILLED (AUD-400 — both events emitted)', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: closeFilledTargetId, action: 'WORKFORCE_VACANCY_CLOSED' },
      });

      expect(record).not.toBeNull();
    });

    it('WORKFORCE_VACANCY_CANCELLED record written after close with CANCELLED (AUD-400)', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: closeCancelledFromDraftTargetId, action: 'WORKFORCE_VACANCY_CANCELLED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
    });

    it('WORKFORCE_VACANCY_CLOSED record written after close with CANCELLED (AUD-400)', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: closeCancelledFromDraftTargetId, action: 'WORKFORCE_VACANCY_CLOSED' },
      });

      expect(record).not.toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Group 9: Soft-delete visibility (deletedAt: null filter — SEC-003)
  // --------------------------------------------------------------------------

  describe('Soft-delete visibility', () => {
    it('soft-deleted vacancy not returned in GET /vacancies list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/vacancies')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.vacancies as Array<{ id: string }>).map(v => v.id);
      expect(ids).not.toContain(softDeletedVacancyId);
    });

    it('soft-deleted vacancy returns HTTP 404 on GET /vacancies/:id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/vacancies/${softDeletedVacancyId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });
});
