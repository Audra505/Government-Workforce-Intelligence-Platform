// Reference: spec/01_requirements.md — FR-301 through FR-306 Application Management
// Reference: spec/06_api_contracts.md — Application API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: governance/GD-M17-1.md — D6 (validation), D7 (partial unique index), D8 (VAC-301),
//            D9 (archive guard), D10 (advance state machine), D12 (response shape), D13 (RBAC)
// Reference: governance/GD-PRE-PHASE3-002.md — D1 (tenantId from JWT only), D2 (status = APPLIED on create)
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
//   applications (→ tenants, candidates, vacancies) deleted first
//   vacancies (→ positions) before positions
//   positions (→ departments) before departments
//   candidates (→ tenants) before tenants
//   audit events (→ users) before users
//   userRoles before users → users before tenants
//
// State-changing groups (advance, reject, withdraw) use dedicated pre-created application
// fixtures so no test-ordering dependencies exist across groups.
// Within Group 8, advance tests are sequentially ordered on advAppId (APPLIED→SCREENING→
// INTERVIEW→EVALUATION→OFFER) which is the only intentional intra-group state dependency.

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

const FIXTURE_PASSWORD    = 'E2eTest1234!';
const SUFFIX              = Date.now();
const FIXTURE_TENANT_CODE = `E2E-APP-${SUFFIX}`;
const CROSS_TENANT_CODE   = `E2E-APP-X-${SUFFIX}`;

const ADMIN_EMAIL         = `e2e-app-admin-${SUFFIX}@test.gov`;
const HR_EMAIL            = `e2e-app-hr-${SUFFIX}@test.gov`;
const RECRUITER_EMAIL     = `e2e-app-rec-${SUFFIX}@test.gov`;
const CO_EMAIL            = `e2e-app-co-${SUFFIX}@test.gov`;
const HM_EMAIL            = `e2e-app-hm-${SUFFIX}@test.gov`;
const WP_EMAIL            = `e2e-app-wp-${SUFFIX}@test.gov`;
const EXEC_EMAIL          = `e2e-app-exec-${SUFFIX}@test.gov`;
const CROSS_ADMIN_EMAIL   = `e2e-app-xadmin-${SUFFIX}@test.gov`;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Application (e2e)', () => {
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
  let crossAdminToken: string;

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
  let crossAdminUserId: string;

  // Infrastructure
  let primaryDeptId: string;
  let crossDeptId: string;
  let primaryPositionId: string;
  let crossPositionId: string;

  // Vacancies — primary tenant
  // vacBulkId is IN_RECRUITMENT throughout — safe for multiple candidates to apply
  let vacBulkId: string;
  let vacVac301Id: string;     // OPEN — VAC-301 first-application transition test
  let vacAdvId: string;        // IN_RECRUITMENT — advance workflow
  let vacRejId: string;        // IN_RECRUITMENT — reject flow
  let vacWithId: string;       // IN_RECRUITMENT — withdraw flow
  let vacUpdId: string;        // IN_RECRUITMENT — update flow
  let vacListId: string;       // IN_RECRUITMENT — list + filter tests
  let vacDupId: string;        // IN_RECRUITMENT — duplicate prevention
  let vacDiffId: string;       // IN_RECRUITMENT — same candidate different vacancy
  let vacReapRejId: string;    // OPEN — re-apply after REJECTED
  let vacReapWithId: string;   // OPEN — re-apply after WITHDRAWN
  let vacTermId: string;       // IN_RECRUITMENT — terminal state tests
  let vacSkipId: string;       // IN_RECRUITMENT — invalid advance skip test
  let vacArchId: string;       // IN_RECRUITMENT — archive guard
  let vacClosedId: string;     // CLOSED — VACANCY_NOT_OPEN error test

  // Vacancy — cross-tenant
  let vacCrossId: string;

  // Candidates — primary tenant
  let candCreateSAId: string;    // ACTIVE — SA RBAC create
  let candCreateHRId: string;    // ACTIVE — HR RBAC create
  let candCreateRecId: string;   // ACTIVE — Recruiter RBAC create
  let candAdvId: string;         // ACTIVE — advance workflow
  let candRejId: string;         // ACTIVE — reject flow
  let candWithId: string;        // ACTIVE — withdraw flow
  let candUpdId: string;         // ACTIVE — update flow
  let candListId: string;        // ACTIVE — list + filter tests
  let candDupId: string;         // ACTIVE — duplicate prevention
  let candReapplyId: string;     // ACTIVE — re-application tests
  let candTermId: string;        // ACTIVE — terminal state tests (pre-created REJECTED app)
  let candSkipId: string;        // ACTIVE — invalid skip advance test
  let candArchId: string;        // ACTIVE — archive guard (blocked by active app)
  let archivedCandId: string;    // ARCHIVED — CANDIDATE_ARCHIVED error test

  // Candidate — cross-tenant
  let crossCandId: string;

  // Pre-created applications (Prisma-direct)
  let advAppId: string;          // (candAdvId, vacAdvId, APPLIED) — advance workflow
  let rejAppId: string;          // (candRejId, vacRejId, APPLIED) — reject test
  let withAppId: string;         // (candWithId, vacWithId, APPLIED) — withdraw test
  let updAppId: string;          // (candUpdId, vacUpdId, APPLIED) — update + detail + list
  let listAppId: string;         // (candListId, vacListId, APPLIED) — list/filter tests
  let dupBlockId: string;        // (candDupId, vacDupId, APPLIED) — blocks duplicate create
  let reapRejAppId: string;      // (candReapplyId, vacReapRejId, REJECTED) — allows re-apply
  let reapWithAppId: string;     // (candReapplyId, vacReapWithId, WITHDRAWN) — allows re-apply
  let termAppId: string;         // (candTermId, vacTermId, REJECTED) — terminal state tests
  let skipAppId: string;         // (candSkipId, vacSkipId, APPLIED) — skip advance test
  let archGuardAppId: string;    // (candArchId, vacArchId, APPLIED) — blocks archive
  let crossAppId: string;        // (crossCandId, vacCrossId, APPLIED) — SEC-003 tests

  // Captured from API responses
  let createSAResponseId: string;  // from SA create in Group 2 — audit event checks in Group 15

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
      data: { name: 'E2E Application Tenant', code: FIXTURE_TENANT_CODE, status: 'ACTIVE' },
    });
    fixtureTenantId = tenant.id;

    const crossTenant = await prisma.tenant.create({
      data: { name: 'E2E Application Cross Tenant', code: CROSS_TENANT_CODE, status: 'ACTIVE' },
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

    adminUserId      = await mkUser(fixtureTenantId, ADMIN_EMAIL,        sysAdminRole.id,  'AppAdmin');
    hrUserId         = await mkUser(fixtureTenantId, HR_EMAIL,            hrRole.id,        'AppHR');
    recruiterUserId  = await mkUser(fixtureTenantId, RECRUITER_EMAIL,     recruiterRole.id, 'AppRec');
    coUserId         = await mkUser(fixtureTenantId, CO_EMAIL,            coRole.id,        'AppCO');
    hmUserId         = await mkUser(fixtureTenantId, HM_EMAIL,            hmRole.id,        'AppHM');
    wpUserId         = await mkUser(fixtureTenantId, WP_EMAIL,            wpRole.id,        'AppWP');
    execUserId       = await mkUser(fixtureTenantId, EXEC_EMAIL,          execRole.id,      'AppExec');
    crossAdminUserId = await mkUser(crossTenantId,   CROSS_ADMIN_EMAIL,   sysAdminRole.id,  'AppXAdmin');

    // ---- Infrastructure ----
    const primaryDept = await prisma.department.create({
      data: { tenantId: fixtureTenantId, name: 'E2E App Dept', code: `E2E-AD-${SUFFIX}`, status: 'ACTIVE' },
    });
    primaryDeptId = primaryDept.id;

    const crossDept = await prisma.department.create({
      data: { tenantId: crossTenantId, name: 'E2E App Cross Dept', code: `E2E-AXD-${SUFFIX}`, status: 'ACTIVE' },
    });
    crossDeptId = crossDept.id;

    const primaryPos = await prisma.position.create({
      data: { tenantId: fixtureTenantId, departmentId: primaryDeptId, title: 'E2E App Position', status: 'ACTIVE' },
    });
    primaryPositionId = primaryPos.id;

    const crossPos = await prisma.position.create({
      data: { tenantId: crossTenantId, departmentId: crossDeptId, title: 'E2E App Cross Position', status: 'ACTIVE' },
    });
    crossPositionId = crossPos.id;

    // ---- Vacancies — primary tenant ----
    const mkVac = async (tenantId: string, positionId: string, status: string): Promise<string> => {
      const v = await prisma.vacancy.create({
        data: { tenantId, positionId, status, priority: 'MEDIUM', reason: 'NEW_POSITION' },
      });
      return v.id;
    };

    vacBulkId     = await mkVac(fixtureTenantId, primaryPositionId, 'IN_RECRUITMENT');
    vacVac301Id   = await mkVac(fixtureTenantId, primaryPositionId, 'OPEN');
    vacAdvId      = await mkVac(fixtureTenantId, primaryPositionId, 'IN_RECRUITMENT');
    vacRejId      = await mkVac(fixtureTenantId, primaryPositionId, 'IN_RECRUITMENT');
    vacWithId     = await mkVac(fixtureTenantId, primaryPositionId, 'IN_RECRUITMENT');
    vacUpdId      = await mkVac(fixtureTenantId, primaryPositionId, 'IN_RECRUITMENT');
    vacListId     = await mkVac(fixtureTenantId, primaryPositionId, 'IN_RECRUITMENT');
    vacDupId      = await mkVac(fixtureTenantId, primaryPositionId, 'IN_RECRUITMENT');
    vacDiffId     = await mkVac(fixtureTenantId, primaryPositionId, 'IN_RECRUITMENT');
    vacReapRejId  = await mkVac(fixtureTenantId, primaryPositionId, 'OPEN');
    vacReapWithId = await mkVac(fixtureTenantId, primaryPositionId, 'OPEN');
    vacTermId     = await mkVac(fixtureTenantId, primaryPositionId, 'IN_RECRUITMENT');
    vacSkipId     = await mkVac(fixtureTenantId, primaryPositionId, 'IN_RECRUITMENT');
    vacArchId     = await mkVac(fixtureTenantId, primaryPositionId, 'IN_RECRUITMENT');

    const closedVac = await prisma.vacancy.create({
      data: {
        tenantId: fixtureTenantId, positionId: primaryPositionId,
        status: 'CLOSED', priority: 'LOW', reason: 'RETIREMENT',
      },
    });
    vacClosedId = closedVac.id;

    // ---- Vacancy — cross-tenant ----
    vacCrossId = await mkVac(crossTenantId, crossPositionId, 'OPEN');

    // ---- Candidates — primary tenant ----
    const mkCand = async (
      tenantId: string, email: string, status?: string,
    ): Promise<string> => {
      const c = await prisma.candidate.create({
        data: {
          tenantId, email, firstName: 'E2E', lastName: 'AppCand',
          status: status ?? 'ACTIVE',
          ...(status === 'ARCHIVED' ? { deletedAt: new Date() } : {}),
        },
      });
      return c.id;
    };

    candCreateSAId  = await mkCand(fixtureTenantId, `e2e-app-csa-${SUFFIX}@test.gov`);
    candCreateHRId  = await mkCand(fixtureTenantId, `e2e-app-chr-${SUFFIX}@test.gov`);
    candCreateRecId = await mkCand(fixtureTenantId, `e2e-app-crec-${SUFFIX}@test.gov`);
    candAdvId       = await mkCand(fixtureTenantId, `e2e-app-adv-${SUFFIX}@test.gov`);
    candRejId       = await mkCand(fixtureTenantId, `e2e-app-rej-${SUFFIX}@test.gov`);
    candWithId      = await mkCand(fixtureTenantId, `e2e-app-with-${SUFFIX}@test.gov`);
    candUpdId       = await mkCand(fixtureTenantId, `e2e-app-upd-${SUFFIX}@test.gov`);
    candListId      = await mkCand(fixtureTenantId, `e2e-app-list-${SUFFIX}@test.gov`);
    candDupId       = await mkCand(fixtureTenantId, `e2e-app-dup-${SUFFIX}@test.gov`);
    candReapplyId   = await mkCand(fixtureTenantId, `e2e-app-reap-${SUFFIX}@test.gov`);
    candTermId      = await mkCand(fixtureTenantId, `e2e-app-term-${SUFFIX}@test.gov`);
    candSkipId      = await mkCand(fixtureTenantId, `e2e-app-skip-${SUFFIX}@test.gov`);
    candArchId      = await mkCand(fixtureTenantId, `e2e-app-arch-${SUFFIX}@test.gov`);
    archivedCandId  = await mkCand(fixtureTenantId, `e2e-app-archd-${SUFFIX}@test.gov`, 'ARCHIVED');

    // ---- Candidate — cross-tenant ----
    crossCandId = await mkCand(crossTenantId, `e2e-app-xcand-${SUFFIX}@test.gov`);

    // ---- Pre-created applications (Prisma-direct) ----
    const mkApp = async (
      tenantId: string, candidateId: string, vacancyId: string, status: string,
    ): Promise<string> => {
      const a = await prisma.application.create({
        data: { tenantId, candidateId, vacancyId, status, submittedAt: new Date() },
      });
      return a.id;
    };

    advAppId       = await mkApp(fixtureTenantId, candAdvId,      vacAdvId,      'APPLIED');
    rejAppId       = await mkApp(fixtureTenantId, candRejId,      vacRejId,      'APPLIED');
    withAppId      = await mkApp(fixtureTenantId, candWithId,     vacWithId,     'APPLIED');
    updAppId       = await mkApp(fixtureTenantId, candUpdId,      vacUpdId,      'APPLIED');
    listAppId      = await mkApp(fixtureTenantId, candListId,     vacListId,     'APPLIED');
    dupBlockId     = await mkApp(fixtureTenantId, candDupId,      vacDupId,      'APPLIED');
    reapRejAppId   = await mkApp(fixtureTenantId, candReapplyId,  vacReapRejId,  'REJECTED');
    reapWithAppId  = await mkApp(fixtureTenantId, candReapplyId,  vacReapWithId, 'WITHDRAWN');
    termAppId      = await mkApp(fixtureTenantId, candTermId,     vacTermId,     'REJECTED');
    skipAppId      = await mkApp(fixtureTenantId, candSkipId,     vacSkipId,     'APPLIED');
    archGuardAppId = await mkApp(fixtureTenantId, candArchId,     vacArchId,     'APPLIED');
    crossAppId     = await mkApp(crossTenantId,   crossCandId,    vacCrossId,    'APPLIED');

    // Suppress unused-variable lint warnings for pre-created IDs not referenced in tests
    void dupBlockId;
    void reapRejAppId;
    void reapWithAppId;

    // ---- Authenticate all fixture users ----
    const login = async (email: string): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: FIXTURE_PASSWORD });
      return res.body.data.accessToken as string;
    };

    adminToken      = await login(ADMIN_EMAIL);
    hrToken         = await login(HR_EMAIL);
    recruiterToken  = await login(RECRUITER_EMAIL);
    coToken         = await login(CO_EMAIL);
    hmToken         = await login(HM_EMAIL);
    wpToken         = await login(WP_EMAIL);
    execToken       = await login(EXEC_EMAIL);
    crossAdminToken = await login(CROSS_ADMIN_EMAIL);
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      const tenantIds = [fixtureTenantId, crossTenantId].filter(Boolean);

      // Applications before candidates and vacancies (FK → candidate, vacancy, tenant)
      if (tenantIds.length > 0) {
        await prisma.application.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
      }

      // Vacancies before positions (FK → position)
      if (tenantIds.length > 0) {
        await prisma.vacancy.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
      }

      // Positions before departments (FK → department)
      if (tenantIds.length > 0) {
        await prisma.position.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
      }

      // Departments before tenants
      for (const deptId of [primaryDeptId, crossDeptId].filter(Boolean)) {
        await prisma.department.delete({ where: { id: deptId } }).catch(() => {});
      }

      // Candidates before tenants
      if (tenantIds.length > 0) {
        await prisma.candidate.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
      }

      // Audit events before users (FK → user)
      const actorIds = [
        adminUserId, hrUserId, recruiterUserId, coUserId,
        hmUserId, wpUserId, execUserId, crossAdminUserId,
      ].filter(Boolean);
      if (actorIds.length > 0) {
        await prisma.auditEvent.deleteMany({ where: { userId: { in: actorIds } } }).catch(() => {});
      }

      // Users + roles
      for (const userId of actorIds) {
        await prisma.userRole.deleteMany({ where: { userId } }).catch(() => {});
        await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      }

      // Tenants last
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
    it('GET /api/v1/applications without Authorization → 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/applications');
      expect(res.status).toBe(401);
    });

    it('POST /api/v1/applications without Authorization → 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .send({ candidateId: candCreateSAId, vacancyId: vacBulkId });
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/applications/:id without Authorization → 401', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/applications/${advAppId}`);
      expect(res.status).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // Group 2: POST /api/v1/applications — RBAC + response shape
  // --------------------------------------------------------------------------

  describe('POST /api/v1/applications', () => {
    it('System Administrator + valid body → 201 + { success, data }; status = APPLIED (GD-PRE-PHASE3-002 D2)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          candidateId: candCreateSAId,
          vacancyId:   vacBulkId,
          notes:       'SA e2e test application',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        candidateId: candCreateSAId,
        vacancyId:   vacBulkId,
        status:      'APPLIED',
      });
      expect(res.body.data.id).toMatch(UUID_V4);
      expect(typeof res.body.data.submittedAt).toBe('string');
      expect(typeof res.body.data.createdAt).toBe('string');
      expect(typeof res.body.data.updatedAt).toBe('string');
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');

      createSAResponseId = res.body.data.id as string;
    });

    it('HR Director → 201 (write authorized — GD-M17-1 D13)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ candidateId: candCreateHRId, vacancyId: vacBulkId });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).not.toHaveProperty('tenantId');
    });

    it('Recruiter → 201 (write authorized — GD-M17-1 D13)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${recruiterToken}`)
        .send({ candidateId: candCreateRecId, vacancyId: vacBulkId });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('Compliance Officer → 403 (read-only role, create forbidden — GD-M17-1 D13)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${coToken}`)
        .send({ candidateId: candCreateSAId, vacancyId: vacBulkId });
      expect(res.status).toBe(403);
    });

    it('Hiring Manager → 403 (denied all M17 application endpoints — GD-M17-1 D13)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${hmToken}`)
        .send({ candidateId: candCreateSAId, vacancyId: vacBulkId });
      expect(res.status).toBe(403);
    });

    it('Workforce Planner → 403 (denied all M17 application endpoints)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${wpToken}`)
        .send({ candidateId: candCreateSAId, vacancyId: vacBulkId });
      expect(res.status).toBe(403);
    });

    it('Executive User → 403 (denied all M17 application endpoints)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${execToken}`)
        .send({ candidateId: candCreateSAId, vacancyId: vacBulkId });
      expect(res.status).toBe(403);
    });

    it('initial status is APPLIED regardless of caller input (GD-PRE-PHASE3-002 D2)', async () => {
      expect(createSAResponseId).toBeDefined();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/applications/${createSAResponseId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('APPLIED');
    });

    it('response does not expose tenantId (SEC-003)', async () => {
      expect(createSAResponseId).toBeDefined();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/applications/${createSAResponseId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('tenantId');
    });

    it('response does not expose deletedAt', async () => {
      expect(createSAResponseId).toBeDefined();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/applications/${createSAResponseId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('tenantId in request body → 400 (ValidationPipe whitelist + forbidNonWhitelisted — SEC-003)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          candidateId: candCreateSAId,
          vacancyId:   vacBulkId,
          tenantId:    '00000000-0000-4000-8000-000000000099',
        });
      expect(res.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // Group 3: Candidate and vacancy validation (GD-M17-1 D6)
  // --------------------------------------------------------------------------

  describe('Candidate and vacancy validation (GD-M17-1 D6)', () => {
    it('candidate not found → 404 CANDIDATE_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ candidateId: '00000000-0000-4000-8000-000000000099', vacancyId: vacBulkId });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'CANDIDATE_NOT_FOUND' } });
    });

    it('archived candidate → 422 CANDIDATE_ARCHIVED', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ candidateId: archivedCandId, vacancyId: vacBulkId });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'CANDIDATE_ARCHIVED' } });
    });

    it('vacancy not found → 404 VACANCY_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          candidateId: candCreateSAId,
          vacancyId:   '00000000-0000-4000-8000-000000000099',
        });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'VACANCY_NOT_FOUND' } });
    });

    it('non-open vacancy (CLOSED) → 422 VACANCY_NOT_OPEN', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ candidateId: candCreateSAId, vacancyId: vacClosedId });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'VACANCY_NOT_OPEN' } });
    });

    it('cross-tenant candidate reference → 404 CANDIDATE_NOT_FOUND (SEC-003: tenantId scoped lookup)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ candidateId: crossCandId, vacancyId: vacBulkId });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'CANDIDATE_NOT_FOUND' } });
    });

    it('cross-tenant vacancy reference → 404 VACANCY_NOT_FOUND (SEC-003: tenantId scoped lookup)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ candidateId: candCreateSAId, vacancyId: vacCrossId });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'VACANCY_NOT_FOUND' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 4: Duplicate application prevention (GD-M17-1 D7; partial unique index)
  // --------------------------------------------------------------------------

  describe('Duplicate application prevention (GD-M17-1 D7)', () => {
    it('duplicate active application for same candidate + vacancy + tenant → 409 APPLICATION_ALREADY_EXISTS', async () => {
      // dupBlockId = (candDupId, vacDupId, APPLIED) pre-created — blocks this request
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ candidateId: candDupId, vacancyId: vacDupId });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_ALREADY_EXISTS' } });
    });

    it('same candidate, different vacancy → 201 (distinct pair is not a duplicate)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ candidateId: candDupId, vacancyId: vacDiffId });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('different candidate, same vacancy → 201 (distinct pair is not a duplicate)', async () => {
      // candCreateSAId already applied to vacBulkId (Group 2), but NOT to vacDupId
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ candidateId: candCreateSAId, vacancyId: vacDupId });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('cross-tenant create attempt with cross-tenant candidate → 404 not 409 (SEC-003 scoping prevents cross-tenant conflict detection)', async () => {
      // crossCandId exists in cross-tenant with crossAppId on vacCrossId.
      // Primary-tenant admin cannot see crossCandId → CANDIDATE_NOT_FOUND, not APPLICATION_ALREADY_EXISTS.
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ candidateId: crossCandId, vacancyId: vacCrossId });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'CANDIDATE_NOT_FOUND' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 5: GET /api/v1/applications — RBAC + list envelope + SEC-003 + filters
  // --------------------------------------------------------------------------

  describe('GET /api/v1/applications', () => {
    it('System Administrator → 200 + paginated envelope with applications array', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('applications');
      expect(res.body.data).toHaveProperty('total');
      expect(res.body.data).toHaveProperty('page');
      expect(res.body.data).toHaveProperty('pageSize');
      expect(res.body.data).toHaveProperty('totalPages');
      expect(Array.isArray(res.body.data.applications)).toBe(true);
    });

    it('HR Director → 200 (read authorized — GD-M17-1 D13)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/applications')
        .set('Authorization', `Bearer ${hrToken}`);
      expect(res.status).toBe(200);
    });

    it('Recruiter → 200 (read authorized — GD-M17-1 D13)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/applications')
        .set('Authorization', `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
    });

    it('Compliance Officer → 200 (read-only role, list authorized — GD-M17-1 D13)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/applications')
        .set('Authorization', `Bearer ${coToken}`);
      expect(res.status).toBe(200);
    });

    it('Hiring Manager → 403 (denied all M17 application endpoints)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/applications')
        .set('Authorization', `Bearer ${hmToken}`);
      expect(res.status).toBe(403);
    });

    it('Workforce Planner → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/applications')
        .set('Authorization', `Bearer ${wpToken}`);
      expect(res.status).toBe(403);
    });

    it('Executive User → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/applications')
        .set('Authorization', `Bearer ${execToken}`);
      expect(res.status).toBe(403);
    });

    it('application records in list do not expose tenantId (SEC-003)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      for (const a of res.body.data.applications as Record<string, unknown>[]) {
        expect(a).not.toHaveProperty('tenantId');
      }
    });

    it('application records in list do not expose deletedAt', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      for (const a of res.body.data.applications as Record<string, unknown>[]) {
        expect(a).not.toHaveProperty('deletedAt');
      }
    });

    it('status filter returns only applications with matching status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/applications?status=APPLIED')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.applications.length).toBeGreaterThan(0);
      for (const a of res.body.data.applications as { status: string }[]) {
        expect(a.status).toBe('APPLIED');
      }
    });

    it('candidateId filter returns only applications for that candidate', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/applications?candidateId=${candListId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.applications.length).toBeGreaterThanOrEqual(1);
      const found = (res.body.data.applications as { id: string }[]).find((a) => a.id === listAppId);
      expect(found).toBeDefined();
      for (const a of res.body.data.applications as { candidateId: string }[]) {
        expect(a.candidateId).toBe(candListId);
      }
    });

    it('vacancyId filter returns only applications for that vacancy', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/applications?vacancyId=${vacListId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.applications.length).toBeGreaterThanOrEqual(1);
      const found = (res.body.data.applications as { id: string }[]).find((a) => a.id === listAppId);
      expect(found).toBeDefined();
    });

    it('cross-tenant applications are NOT visible in primary-tenant list (SEC-003)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.applications as { id: string }[]).map((a) => a.id);
      expect(ids).not.toContain(crossAppId);
    });
  });

  // --------------------------------------------------------------------------
  // Group 6: GET /api/v1/applications/:id — RBAC + shape + SEC-003
  // --------------------------------------------------------------------------

  describe('GET /api/v1/applications/:id', () => {
    it('System Administrator → 200 + application shape', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/applications/${updAppId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(updAppId);
      expect(res.body.data).toHaveProperty('candidateId');
      expect(res.body.data).toHaveProperty('vacancyId');
      expect(res.body.data).toHaveProperty('status');
      expect(res.body.data).toHaveProperty('submittedAt');
    });

    it('Compliance Officer → 200 (read-only role, detail authorized — GD-M17-1 D13)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/applications/${updAppId}`)
        .set('Authorization', `Bearer ${coToken}`);
      expect(res.status).toBe(200);
    });

    it('Hiring Manager → 403 (denied — GD-M17-1 D13)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/applications/${updAppId}`)
        .set('Authorization', `Bearer ${hmToken}`);
      expect(res.status).toBe(403);
    });

    it('Workforce Planner → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/applications/${updAppId}`)
        .set('Authorization', `Bearer ${wpToken}`);
      expect(res.status).toBe(403);
    });

    it('Executive User → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/applications/${updAppId}`)
        .set('Authorization', `Bearer ${execToken}`);
      expect(res.status).toBe(403);
    });

    it('non-existent application → 404 APPLICATION_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/applications/00000000-0000-4000-8000-000000000099')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_FOUND' } });
    });

    it('cross-tenant application id → 404, not 403 (SEC-003: enumeration prevention)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/applications/${crossAppId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_FOUND' } });
    });

    it('response does not expose tenantId (SEC-003)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/applications/${updAppId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('tenantId');
    });

    it('response does not expose deletedAt', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/applications/${updAppId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });
  });

  // --------------------------------------------------------------------------
  // Group 7: PUT /api/v1/applications/:id — RBAC + update shape + SEC-003
  // --------------------------------------------------------------------------

  describe('PUT /api/v1/applications/:id', () => {
    it('System Administrator updates notes and currentStage → 200 + updated data (response excludes tenantId, deletedAt)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/applications/${updAppId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Updated by SA e2e', currentStage: 'Phone Screen' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(updAppId);
      expect(res.body.data.notes).toBe('Updated by SA e2e');
      expect(res.body.data.currentStage).toBe('Phone Screen');
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('HR Director → 200 (write authorized — GD-M17-1 D13)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/applications/${updAppId}`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ notes: 'Updated by HR' });
      expect(res.status).toBe(200);
    });

    it('Recruiter → 200 (write authorized — GD-M17-1 D13)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/applications/${updAppId}`)
        .set('Authorization', `Bearer ${recruiterToken}`)
        .send({ currentStage: 'Technical Screen' });
      expect(res.status).toBe(200);
    });

    it('Compliance Officer → 403 (read-only role, update forbidden — GD-M17-1 D13)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/applications/${updAppId}`)
        .set('Authorization', `Bearer ${coToken}`)
        .send({ notes: 'CO should not update' });
      expect(res.status).toBe(403);
    });

    it('Hiring Manager → 403', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/applications/${updAppId}`)
        .set('Authorization', `Bearer ${hmToken}`)
        .send({ notes: 'HM should not update' });
      expect(res.status).toBe(403);
    });

    it('Workforce Planner → 403', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/applications/${updAppId}`)
        .set('Authorization', `Bearer ${wpToken}`)
        .send({ notes: 'WP should not update' });
      expect(res.status).toBe(403);
    });

    it('Executive User → 403', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/applications/${updAppId}`)
        .set('Authorization', `Bearer ${execToken}`)
        .send({ notes: 'Exec should not update' });
      expect(res.status).toBe(403);
    });

    it('terminal application update → 422 APPLICATION_IN_TERMINAL_STATE', async () => {
      // termAppId was pre-created with status REJECTED
      const res = await request(app.getHttpServer())
        .put(`/api/v1/applications/${termAppId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Trying to update rejected app' });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_IN_TERMINAL_STATE' } });
    });

    it('status field in PUT body → 400 (ValidationPipe whitelist rejects unknown fields — GD-M17-1 D12)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/applications/${updAppId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'SCREENING' });

      expect(res.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // Group 8: POST /api/v1/applications/:id/advance — state machine (GD-M17-1 D10)
  // Tests 1–5 are sequentially ordered on advAppId (APPLIED→SCREENING→INTERVIEW→EVALUATION→OFFER).
  // Tests 6–9 use separate fixtures and are order-independent.
  // --------------------------------------------------------------------------

  describe('POST /api/v1/applications/:id/advance', () => {
    it('[STATE 1/5] APPLIED → SCREENING succeeds; response has status SCREENING and excludes tenantId/deletedAt', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${advAppId}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ targetStatus: 'SCREENING' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SCREENING');
      expect(res.body.data.id).toBe(advAppId);
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('[STATE 2/5] SCREENING → INTERVIEW succeeds', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${advAppId}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ targetStatus: 'INTERVIEW' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('INTERVIEW');
    });

    it('[STATE 3/5] INTERVIEW → EVALUATION succeeds', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${advAppId}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ targetStatus: 'EVALUATION' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('EVALUATION');
    });

    it('[STATE 4/5] EVALUATION → OFFER succeeds', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${advAppId}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ targetStatus: 'OFFER' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('OFFER');
    });

    it('[STATE 5/5] OFFER → advance → 422 APPLICATION_AWAITING_HIRE (hire managed in M19 — GD-M17-1 D10)', async () => {
      // Service returns APPLICATION_AWAITING_HIRE for any advance attempt from OFFER
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${advAppId}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ targetStatus: 'SCREENING' });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_AWAITING_HIRE' } });
    });

    it('invalid skip (APPLIED → INTERVIEW, skipping SCREENING) → 422 INVALID_APPLICATION_TRANSITION', async () => {
      // skipAppId is pre-created at APPLIED status
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${skipAppId}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ targetStatus: 'INTERVIEW' });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INVALID_APPLICATION_TRANSITION' } });
    });

    it('terminal application (REJECTED) advance → 422 APPLICATION_IN_TERMINAL_STATE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${termAppId}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ targetStatus: 'SCREENING' });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_IN_TERMINAL_STATE' } });
    });

    it('Compliance Officer → 403 (advance forbidden — GD-M17-1 D13)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${updAppId}/advance`)
        .set('Authorization', `Bearer ${coToken}`)
        .send({ targetStatus: 'SCREENING' });
      expect(res.status).toBe(403);
    });

    it('Hiring Manager → 403 (advance forbidden — GD-M17-1 D13)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${updAppId}/advance`)
        .set('Authorization', `Bearer ${hmToken}`)
        .send({ targetStatus: 'SCREENING' });
      expect(res.status).toBe(403);
    });
  });

  // --------------------------------------------------------------------------
  // Group 9: POST /api/v1/applications/:id/reject
  // RBAC denial tests run first (rejAppId unmodified). State tests run after.
  // --------------------------------------------------------------------------

  describe('POST /api/v1/applications/:id/reject', () => {
    it('Compliance Officer → 403 (read-only role, reject forbidden — GD-M17-1 D13)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${rejAppId}/reject`)
        .set('Authorization', `Bearer ${coToken}`);
      expect(res.status).toBe(403);
    });

    it('Hiring Manager → 403 (reject forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${rejAppId}/reject`)
        .set('Authorization', `Bearer ${hmToken}`);
      expect(res.status).toBe(403);
    });

    it('Workforce Planner → 403 (reject forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${rejAppId}/reject`)
        .set('Authorization', `Bearer ${wpToken}`);
      expect(res.status).toBe(403);
    });

    it('Executive User → 403 (reject forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${rejAppId}/reject`)
        .set('Authorization', `Bearer ${execToken}`);
      expect(res.status).toBe(403);
    });

    it('[STATE] System Administrator rejects active application → 200 + updated ApplicationResponse with status REJECTED (GD-M17-1 D12)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${rejAppId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(rejAppId);
      expect(res.body.data.status).toBe('REJECTED');
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('[STATE] reject already-rejected application → 422 APPLICATION_IN_TERMINAL_STATE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${rejAppId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_IN_TERMINAL_STATE' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 10: POST /api/v1/applications/:id/withdraw
  // RBAC denial tests run first (withAppId unmodified). State tests run after.
  // --------------------------------------------------------------------------

  describe('POST /api/v1/applications/:id/withdraw', () => {
    it('Compliance Officer → 403 (read-only role, withdraw forbidden — GD-M17-1 D13)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${withAppId}/withdraw`)
        .set('Authorization', `Bearer ${coToken}`);
      expect(res.status).toBe(403);
    });

    it('Hiring Manager → 403 (withdraw forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${withAppId}/withdraw`)
        .set('Authorization', `Bearer ${hmToken}`);
      expect(res.status).toBe(403);
    });

    it('Workforce Planner → 403 (withdraw forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${withAppId}/withdraw`)
        .set('Authorization', `Bearer ${wpToken}`);
      expect(res.status).toBe(403);
    });

    it('Executive User → 403 (withdraw forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${withAppId}/withdraw`)
        .set('Authorization', `Bearer ${execToken}`);
      expect(res.status).toBe(403);
    });

    it('[STATE] System Administrator withdraws active application → 200 + updated ApplicationResponse with status WITHDRAWN (GD-M17-1 D12)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${withAppId}/withdraw`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(withAppId);
      expect(res.body.data.status).toBe('WITHDRAWN');
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('[STATE] withdraw already-withdrawn application → 422 APPLICATION_IN_TERMINAL_STATE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${withAppId}/withdraw`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_IN_TERMINAL_STATE' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 11: Re-application after terminal state
  // Confirms partial unique index: WHERE deleted_at IS NULL AND status NOT IN ('REJECTED','WITHDRAWN')
  // --------------------------------------------------------------------------

  describe('Re-application after terminal state (GD-M17-1 D7 — partial unique index)', () => {
    it('same candidate/vacancy can reapply after REJECTED → 201 with status APPLIED', async () => {
      // reapRejAppId = (candReapplyId, vacReapRejId, REJECTED) pre-created — not blocked by index
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ candidateId: candReapplyId, vacancyId: vacReapRejId });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('APPLIED');
    });

    it('same candidate/vacancy can reapply after WITHDRAWN → 201 with status APPLIED', async () => {
      // reapWithAppId = (candReapplyId, vacReapWithId, WITHDRAWN) pre-created — not blocked by index
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ candidateId: candReapplyId, vacancyId: vacReapWithId });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('APPLIED');
    });

    it('new APPLIED app after REJECTED re-apply blocks a further duplicate → 409 APPLICATION_ALREADY_EXISTS', async () => {
      // The re-apply above created a new APPLIED app for (candReapplyId, vacReapRejId).
      // Now the pair has an active app → duplicate prevention kicks back in.
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ candidateId: candReapplyId, vacancyId: vacReapRejId });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_ALREADY_EXISTS' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 12: VAC-301 vacancy status interaction (GD-M17-1 D8)
  // --------------------------------------------------------------------------

  describe('VAC-301 vacancy status interaction (GD-M17-1 D8)', () => {
    it('[STATE] first application to OPEN vacancy transitions vacancy to IN_RECRUITMENT', async () => {
      const vacBefore = await prisma.vacancy.findUniqueOrThrow({ where: { id: vacVac301Id } });
      expect(vacBefore.status).toBe('OPEN');

      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ candidateId: candCreateSAId, vacancyId: vacVac301Id });

      expect(res.status).toBe(201);

      const vacAfter = await prisma.vacancy.findUniqueOrThrow({ where: { id: vacVac301Id } });
      expect(vacAfter.status).toBe('IN_RECRUITMENT');
    });

    it('[STATE] application to already IN_RECRUITMENT vacancy succeeds — no duplicate transition (VAC-301 idempotent)', async () => {
      // Create a fresh candidate to apply to vacVac301Id (now IN_RECRUITMENT after first test)
      const freshCand = await prisma.candidate.create({
        data: {
          tenantId: fixtureTenantId, email: `e2e-app-vac301-${SUFFIX}@test.gov`,
          firstName: 'E2E', lastName: 'Vac301', status: 'ACTIVE',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ candidateId: freshCand.id, vacancyId: vacVac301Id });

      expect(res.status).toBe(201);

      // Vacancy remains IN_RECRUITMENT — no further state change
      const vacAfter = await prisma.vacancy.findUniqueOrThrow({ where: { id: vacVac301Id } });
      expect(vacAfter.status).toBe('IN_RECRUITMENT');
    });

    it('WORKFORCE_VACANCY_UPDATED audit event emitted when VAC-301 transition occurred (GD-M17-1 D8)', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: {
          tenantId:   fixtureTenantId,
          entityId:   vacVac301Id,
          action:     'WORKFORCE_VACANCY_UPDATED',
          entityType: 'VACANCY',
        },
      });

      expect(record).not.toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Group 13: Candidate archive active-application guard (GD-M17-1 D9)
  // Depends on Group 9 (candRejId has REJECTED app) and Group 10 (candWithId has WITHDRAWN app).
  // --------------------------------------------------------------------------

  describe('Candidate archive active-application guard (GD-M17-1 D9)', () => {
    it('candidate with APPLIED application cannot be archived → 422 CANDIDATE_HAS_ACTIVE_APPLICATIONS', async () => {
      // archGuardAppId = (candArchId, vacArchId, APPLIED) pre-created — blocks archive
      const res = await request(app.getHttpServer())
        .post(`/api/v1/candidates/${candArchId}/archive`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'CANDIDATE_HAS_ACTIVE_APPLICATIONS' } });
    });

    it('candidate with only REJECTED application can be archived (terminal apps do not block — D9)', async () => {
      // candRejId: rejAppId was REJECTED in Group 9; no other active apps
      const res = await request(app.getHttpServer())
        .post(`/api/v1/candidates/${candRejId}/archive`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(204);
    });

    it('candidate with only WITHDRAWN application can be archived (terminal apps do not block — D9)', async () => {
      // candWithId: withAppId was WITHDRAWN in Group 10; no other active apps
      const res = await request(app.getHttpServer())
        .post(`/api/v1/candidates/${candWithId}/archive`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(204);
    });

    it('[STATE] after withdrawing the blocking application, candidate can be archived', async () => {
      // Withdraw the active app on candArchId first
      const withdrawRes = await request(app.getHttpServer())
        .post(`/api/v1/applications/${archGuardAppId}/withdraw`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(withdrawRes.status).toBe(200);

      // Now archive should succeed (no active apps remain)
      const archiveRes = await request(app.getHttpServer())
        .post(`/api/v1/candidates/${candArchId}/archive`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(archiveRes.status).toBe(204);
    });

    it('candidate with active APPLIED application on list vacancy still blocked → 422 (confirmatory)', async () => {
      // candListId has listAppId (APPLIED) — never transitioned in any test group
      const res = await request(app.getHttpServer())
        .post(`/api/v1/candidates/${candListId}/archive`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('CANDIDATE_HAS_ACTIVE_APPLICATIONS');
    });
  });

  // --------------------------------------------------------------------------
  // Group 14: Tenant isolation (SEC-003)
  // --------------------------------------------------------------------------

  describe('Tenant isolation (SEC-003)', () => {
    it('tenant A application list is NOT visible to tenant B authorized user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/applications')
        .set('Authorization', `Bearer ${crossAdminToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.applications as { id: string }[]).map((a) => a.id);
      expect(ids).not.toContain(listAppId);
      expect(ids).not.toContain(updAppId);
      expect(ids).not.toContain(advAppId);
    });

    it('tenant A application detail → 404 for tenant B authorized user (enumeration prevention)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/applications/${listAppId}`)
        .set('Authorization', `Bearer ${crossAdminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_FOUND' } });
    });

    it('tenant B update attempt on tenant A application → 404', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/applications/${updAppId}`)
        .set('Authorization', `Bearer ${crossAdminToken}`)
        .send({ notes: 'cross-tenant update attempt' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_FOUND' } });
    });

    it('tenant B advance attempt on tenant A application → 404', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${skipAppId}/advance`)
        .set('Authorization', `Bearer ${crossAdminToken}`)
        .send({ targetStatus: 'SCREENING' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_FOUND' } });
    });

    it('tenant B reject attempt on tenant A application → 404', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${skipAppId}/reject`)
        .set('Authorization', `Bearer ${crossAdminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_FOUND' } });
    });

    it('no tenantId appears in any application detail response', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/applications/${listAppId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body.data)).not.toContain('tenantId');
    });
  });

  // --------------------------------------------------------------------------
  // Group 15: Audit events (GD-M17-1 D9; EMP-700 pattern)
  // --------------------------------------------------------------------------

  describe('Audit events (GD-M17-1 D9; EMP-700 pattern)', () => {
    it('RECRUITING_APPLICATION_SUBMITTED written after POST /applications', async () => {
      expect(createSAResponseId).toBeDefined();
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: createSAResponseId, action: 'RECRUITING_APPLICATION_SUBMITTED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('APPLICATION');
    });

    it('RECRUITING_APPLICATION_SUBMITTED metadata is PII-safe (no candidate name, email, or notes text)', async () => {
      expect(createSAResponseId).toBeDefined();
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: createSAResponseId, action: 'RECRUITING_APPLICATION_SUBMITTED' },
      });

      expect(record).not.toBeNull();
      const metaStr = JSON.stringify(record!.metadata);
      expect(metaStr).not.toContain('@test.gov');
      expect(metaStr).not.toContain('SA e2e test application');
      expect(metaStr).not.toContain('AppCand');
    });

    it('RECRUITING_APPLICATION_STATUS_CHANGED written after PUT /applications/:id', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: updAppId, action: 'RECRUITING_APPLICATION_STATUS_CHANGED' },
        orderBy: { createdAt: 'desc' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('APPLICATION');
    });

    it('RECRUITING_APPLICATION_STATUS_CHANGED metadata is PII-safe (field names only, no notes text)', async () => {
      const records = await prisma.auditEvent.findMany({
        where: { entityId: updAppId, action: 'RECRUITING_APPLICATION_STATUS_CHANGED' },
        orderBy: { createdAt: 'asc' },
      });

      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        const metaStr = JSON.stringify(record.metadata);
        expect(metaStr).not.toContain('Updated by SA e2e');
        expect(metaStr).not.toContain('@test.gov');
      }
    });

    it('RECRUITING_APPLICATION_ADVANCED written after POST /applications/:id/advance', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: advAppId, action: 'RECRUITING_APPLICATION_ADVANCED' },
        orderBy: { createdAt: 'desc' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('APPLICATION');
    });

    it('RECRUITING_APPLICATION_REJECTED written after POST /applications/:id/reject', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: rejAppId, action: 'RECRUITING_APPLICATION_REJECTED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('APPLICATION');
    });

    it('RECRUITING_APPLICATION_REJECTED metadata is PII-safe — contains previousStatus, no candidate data', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: rejAppId, action: 'RECRUITING_APPLICATION_REJECTED' },
      });

      expect(record).not.toBeNull();
      const metaStr = JSON.stringify(record!.metadata);
      expect(metaStr).not.toContain('@test.gov');
      expect(metaStr).not.toContain('AppCand');
      expect(record!.metadata).toMatchObject({ previousStatus: 'APPLIED' });
    });

    it('RECRUITING_APPLICATION_WITHDRAWN written after POST /applications/:id/withdraw — contains previousStatus', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: withAppId, action: 'RECRUITING_APPLICATION_WITHDRAWN' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('APPLICATION');
      expect(record!.metadata).toMatchObject({ previousStatus: 'APPLIED' });
    });
  });
});
