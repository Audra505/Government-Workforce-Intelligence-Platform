// Reference: spec/01_requirements.md — FR-307 through FR-314 Interview Management
// Reference: spec/06_api_contracts.md — Interview API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: governance/GD-M18-1.md — D5 (state machine), D13 (DTOs), D14 (error codes),
//            D16 (RBAC), D17 (audit events), D18 (e2e test groups)
// Reference: governance/GD-PRE-PHASE3-002.md — D1 (tenantId from JWT only)
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
//   interviews (→ applications) deleted first
//   applications (→ tenants, candidates, vacancies) before vacancies
//   vacancies (→ positions) before positions
//   positions (→ departments) before departments
//   candidates (→ tenants) before tenants
//   audit events (→ users) before users
//   userRoles before users → users before tenants
//
// State-changing groups (update, complete, feedback, cancel, no-show) use dedicated
// pre-created interview fixtures so no test-ordering dependencies exist across groups.

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
const FIXTURE_TENANT_CODE = `E2E-INT-${SUFFIX}`;
const CROSS_TENANT_CODE   = `E2E-INT-X-${SUFFIX}`;

const ADMIN_EMAIL         = `e2e-int-admin-${SUFFIX}@test.gov`;
const HR_EMAIL            = `e2e-int-hr-${SUFFIX}@test.gov`;
const RECRUITER_EMAIL     = `e2e-int-rec-${SUFFIX}@test.gov`;
const CO_EMAIL            = `e2e-int-co-${SUFFIX}@test.gov`;
const HM_EMAIL             = `e2e-int-hm-${SUFFIX}@test.gov`;
const WP_EMAIL            = `e2e-int-wp-${SUFFIX}@test.gov`;
const EXEC_EMAIL          = `e2e-int-exec-${SUFFIX}@test.gov`;
const CROSS_ADMIN_EMAIL   = `e2e-int-xadmin-${SUFFIX}@test.gov`;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NON_EXISTENT_UUID = '00000000-0000-4000-8000-000000000099';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Interview (e2e)', () => {
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
  let primaryVacancyId: string;
  let crossVacancyId: string;

  // Applications — primary tenant (all APPLIED unless noted)
  let appCreateId: string;       // RBAC + happy-path create
  let appTerminalId: string;     // REJECTED — APPLICATION_IN_TERMINAL_STATE on create
  let appListId: string;         // list + filter tests
  let appUpdId: string;          // update flow
  let appCompleteId: string;     // complete flow
  let appFeedbackScheduledId: string; // feedback on SCHEDULED interview
  let appFeedbackCompletedId: string; // feedback on COMPLETED interview
  let appFeedbackCancelledId: string; // feedback blocked on CANCELLED interview
  let appCancelId: string;       // cancel flow
  let appNoShowId: string;       // no-show flow
  let appDetailId: string;       // detail + tenant isolation
  let appAuditId: string;        // audit event checks

  // Application — cross-tenant
  let crossAppId: string;

  // Pre-created interviews (Prisma-direct) — SCHEDULED unless noted
  let intListId: string;          // list + filter tests
  let intUpdId: string;           // update flow (SCHEDULED)
  let intUpdTerminalId: string;   // update flow — terminal block (COMPLETED)
  let intCompleteId: string;      // complete flow
  let intCompleteTerminalId: string; // complete flow — terminal block (already CANCELLED)
  let intFeedbackScheduledId: string; // feedback on SCHEDULED
  let intFeedbackCompletedId: string; // feedback on COMPLETED
  let intFeedbackCancelledId: string; // feedback blocked on CANCELLED
  let intCancelId: string;        // cancel flow
  let intCancelTerminalId: string; // cancel flow — terminal block (already NO_SHOW)
  let intNoShowId: string;        // no-show flow
  let intNoShowTerminalId: string; // no-show flow — terminal block (already COMPLETED)
  let intDetailId: string;        // detail + RBAC
  let intCrossId: string;         // cross-tenant interview (SEC-003)

  // Captured from API responses
  let createdInterviewId: string; // captured from SA create in Group 1 — used by Group 9 audit checks

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
      data: { name: 'E2E Interview Tenant', code: FIXTURE_TENANT_CODE, status: 'ACTIVE' },
    });
    fixtureTenantId = tenant.id;

    const crossTenant = await prisma.tenant.create({
      data: { name: 'E2E Interview Cross Tenant', code: CROSS_TENANT_CODE, status: 'ACTIVE' },
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

    adminUserId      = await mkUser(fixtureTenantId, ADMIN_EMAIL,      sysAdminRole.id,  'IntAdmin');
    hrUserId         = await mkUser(fixtureTenantId, HR_EMAIL,         hrRole.id,        'IntHR');
    recruiterUserId  = await mkUser(fixtureTenantId, RECRUITER_EMAIL,  recruiterRole.id, 'IntRec');
    coUserId         = await mkUser(fixtureTenantId, CO_EMAIL,         coRole.id,        'IntCO');
    hmUserId         = await mkUser(fixtureTenantId, HM_EMAIL,         hmRole.id,        'IntHM');
    wpUserId         = await mkUser(fixtureTenantId, WP_EMAIL,         wpRole.id,        'IntWP');
    execUserId       = await mkUser(fixtureTenantId, EXEC_EMAIL,       execRole.id,      'IntExec');
    crossAdminUserId = await mkUser(crossTenantId,   CROSS_ADMIN_EMAIL, sysAdminRole.id, 'IntXAdmin');

    // ---- Infrastructure ----
    const primaryDept = await prisma.department.create({
      data: { tenantId: fixtureTenantId, name: 'E2E Int Dept', code: `E2E-ID-${SUFFIX}`, status: 'ACTIVE' },
    });
    primaryDeptId = primaryDept.id;

    const crossDept = await prisma.department.create({
      data: { tenantId: crossTenantId, name: 'E2E Int Cross Dept', code: `E2E-IXD-${SUFFIX}`, status: 'ACTIVE' },
    });
    crossDeptId = crossDept.id;

    const primaryPos = await prisma.position.create({
      data: { tenantId: fixtureTenantId, departmentId: primaryDeptId, title: 'E2E Int Position', status: 'ACTIVE' },
    });
    primaryPositionId = primaryPos.id;

    const crossPos = await prisma.position.create({
      data: { tenantId: crossTenantId, departmentId: crossDeptId, title: 'E2E Int Cross Position', status: 'ACTIVE' },
    });
    crossPositionId = crossPos.id;

    const primaryVac = await prisma.vacancy.create({
      data: { tenantId: fixtureTenantId, positionId: primaryPositionId, status: 'IN_RECRUITMENT', priority: 'MEDIUM', reason: 'NEW_POSITION' },
    });
    primaryVacancyId = primaryVac.id;

    const crossVac = await prisma.vacancy.create({
      data: { tenantId: crossTenantId, positionId: crossPositionId, status: 'IN_RECRUITMENT', priority: 'MEDIUM', reason: 'NEW_POSITION' },
    });
    crossVacancyId = crossVac.id;

    // ---- Candidates + applications (Prisma-direct) ----
    const mkCand = async (tenantId: string, email: string): Promise<string> => {
      const c = await prisma.candidate.create({
        data: { tenantId, email, firstName: 'E2E', lastName: 'IntCand', status: 'ACTIVE' },
      });
      return c.id;
    };

    const mkApp = async (
      tenantId: string, candidateId: string, vacancyId: string, status: string,
    ): Promise<string> => {
      const a = await prisma.application.create({
        data: { tenantId, candidateId, vacancyId, status, submittedAt: new Date() },
      });
      return a.id;
    };

    appCreateId             = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-int-create-${SUFFIX}@test.gov`), primaryVacancyId, 'APPLIED');
    appTerminalId           = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-int-term-${SUFFIX}@test.gov`), primaryVacancyId, 'REJECTED');
    appListId               = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-int-list-${SUFFIX}@test.gov`), primaryVacancyId, 'APPLIED');
    appUpdId                = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-int-upd-${SUFFIX}@test.gov`), primaryVacancyId, 'APPLIED');
    appCompleteId            = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-int-comp-${SUFFIX}@test.gov`), primaryVacancyId, 'APPLIED');
    appFeedbackScheduledId   = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-int-fbsch-${SUFFIX}@test.gov`), primaryVacancyId, 'APPLIED');
    appFeedbackCompletedId   = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-int-fbcomp-${SUFFIX}@test.gov`), primaryVacancyId, 'APPLIED');
    appFeedbackCancelledId   = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-int-fbcan-${SUFFIX}@test.gov`), primaryVacancyId, 'APPLIED');
    appCancelId              = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-int-can-${SUFFIX}@test.gov`), primaryVacancyId, 'APPLIED');
    appNoShowId              = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-int-ns-${SUFFIX}@test.gov`), primaryVacancyId, 'APPLIED');
    appDetailId              = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-int-det-${SUFFIX}@test.gov`), primaryVacancyId, 'APPLIED');
    appAuditId               = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-int-aud-${SUFFIX}@test.gov`), primaryVacancyId, 'APPLIED');

    crossAppId = await mkApp(crossTenantId, await mkCand(crossTenantId, `e2e-int-xcand-${SUFFIX}@test.gov`), crossVacancyId, 'APPLIED');

    // ---- Pre-created interviews (Prisma-direct) ----
    const mkInterview = async (
      tenantId: string, applicationId: string, status: string, extra?: Record<string, unknown>,
    ): Promise<string> => {
      const i = await prisma.interview.create({
        data: {
          tenantId, applicationId, status,
          interviewType: 'PHONE_SCREEN',
          interviewerName: 'Fixture Interviewer',
          ...extra,
        },
      });
      return i.id;
    };

    intListId              = await mkInterview(fixtureTenantId, appListId, 'SCHEDULED');
    intUpdId               = await mkInterview(fixtureTenantId, appUpdId, 'SCHEDULED');
    intUpdTerminalId       = await mkInterview(fixtureTenantId, appUpdId, 'COMPLETED');
    intCompleteId           = await mkInterview(fixtureTenantId, appCompleteId, 'SCHEDULED');
    intCompleteTerminalId   = await mkInterview(fixtureTenantId, appCompleteId, 'CANCELLED');
    intFeedbackScheduledId  = await mkInterview(fixtureTenantId, appFeedbackScheduledId, 'SCHEDULED');
    intFeedbackCompletedId  = await mkInterview(fixtureTenantId, appFeedbackCompletedId, 'COMPLETED');
    intFeedbackCancelledId  = await mkInterview(fixtureTenantId, appFeedbackCancelledId, 'CANCELLED');
    intCancelId             = await mkInterview(fixtureTenantId, appCancelId, 'SCHEDULED');
    intCancelTerminalId     = await mkInterview(fixtureTenantId, appCancelId, 'NO_SHOW');
    intNoShowId             = await mkInterview(fixtureTenantId, appNoShowId, 'SCHEDULED');
    intNoShowTerminalId     = await mkInterview(fixtureTenantId, appNoShowId, 'COMPLETED');
    intDetailId             = await mkInterview(fixtureTenantId, appDetailId, 'SCHEDULED');
    intCrossId              = await mkInterview(crossTenantId, crossAppId, 'SCHEDULED');

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

      // Interviews before applications (FK → application)
      if (tenantIds.length > 0) {
        await prisma.interview.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
      }

      // Applications before vacancies (FK → candidate, vacancy, tenant)
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
  // Group 1: POST /api/v1/interviews — create
  // --------------------------------------------------------------------------

  describe('POST /api/v1/interviews', () => {
    it('System Administrator + valid body → 201 + status SCHEDULED; response excludes tenantId/deletedAt', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/interviews')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          applicationId: appCreateId,
          interviewType: 'PHONE_SCREEN',
          scheduledAt: '2026-07-15T10:00:00.000Z',
          interviewerName: 'Jane Smith',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        applicationId: appCreateId,
        interviewType: 'PHONE_SCREEN',
        status: 'SCHEDULED',
        interviewerName: 'Jane Smith',
      });
      expect(res.body.data.id).toMatch(UUID_V4);
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');

      createdInterviewId = res.body.data.id as string;
    });

    it('create with interviewerUserId instead of interviewerName → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/interviews')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          applicationId: appListId,
          interviewType: 'PANEL',
          interviewerUserId: hrUserId,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.interviewerUserId).toBe(hrUserId);
    });

    it('HR Director → 201 (write authorized — GD-M18-1 D16)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/interviews')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ applicationId: appDetailId, interviewType: 'TECHNICAL', interviewerName: 'HR Scheduler' });
      expect(res.status).toBe(201);
    });

    it('Recruiter → 201 (write authorized — GD-M18-1 D16)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/interviews')
        .set('Authorization', `Bearer ${recruiterToken}`)
        .send({ applicationId: appAuditId, interviewType: 'FINAL', interviewerName: 'Rec Scheduler' });
      expect(res.status).toBe(201);
    });

    it('Compliance Officer → 403 (read-only role, create forbidden — GD-M18-1 D16)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/interviews')
        .set('Authorization', `Bearer ${coToken}`)
        .send({ applicationId: appCreateId, interviewType: 'PHONE_SCREEN', interviewerName: 'X' });
      expect(res.status).toBe(403);
    });

    it('Hiring Manager → 403 (denied all M18A interview endpoints — GD-M18-1 D16)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/interviews')
        .set('Authorization', `Bearer ${hmToken}`)
        .send({ applicationId: appCreateId, interviewType: 'PHONE_SCREEN', interviewerName: 'X' });
      expect(res.status).toBe(403);
    });

    it('Workforce Planner → 403 (denied all M18A interview endpoints)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/interviews')
        .set('Authorization', `Bearer ${wpToken}`)
        .send({ applicationId: appCreateId, interviewType: 'PHONE_SCREEN', interviewerName: 'X' });
      expect(res.status).toBe(403);
    });

    it('Executive User → 403 (denied all M18A interview endpoints)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/interviews')
        .set('Authorization', `Bearer ${execToken}`)
        .send({ applicationId: appCreateId, interviewType: 'PHONE_SCREEN', interviewerName: 'X' });
      expect(res.status).toBe(403);
    });

    it('application not found → 404 APPLICATION_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/interviews')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicationId: NON_EXISTENT_UUID, interviewType: 'PHONE_SCREEN', interviewerName: 'X' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_FOUND' } });
    });

    it('application in terminal state (REJECTED) → 422 APPLICATION_IN_TERMINAL_STATE', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/interviews')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicationId: appTerminalId, interviewType: 'PHONE_SCREEN', interviewerName: 'X' });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_IN_TERMINAL_STATE' } });
    });

    it('missing both interviewerName and interviewerUserId → 422 INTERVIEWER_REQUIRED (GD-M18-1 D13)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/interviews')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicationId: appCreateId, interviewType: 'PHONE_SCREEN' });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEWER_REQUIRED' } });
    });

    it('cross-tenant interviewerUserId → 404 INTERVIEWER_NOT_FOUND (SEC-003: user enumeration prevention)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/interviews')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicationId: appCreateId, interviewType: 'PHONE_SCREEN', interviewerUserId: crossAdminUserId });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEWER_NOT_FOUND' } });
    });

    it('non-existent interviewerUserId → 404 INTERVIEWER_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/interviews')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicationId: appCreateId, interviewType: 'PHONE_SCREEN', interviewerUserId: NON_EXISTENT_UUID });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEWER_NOT_FOUND' } });
    });

    it('cross-tenant applicationId reference → 404 APPLICATION_NOT_FOUND (SEC-003 scoped lookup)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/interviews')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicationId: crossAppId, interviewType: 'PHONE_SCREEN', interviewerName: 'X' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_FOUND' } });
    });

    it('invalid interviewType → 400 (class-validator IsIn)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/interviews')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicationId: appCreateId, interviewType: 'NOT_A_TYPE', interviewerName: 'X' });

      expect(res.status).toBe(400);
    });

    it('tenantId in request body → 400 (ValidationPipe whitelist + forbidNonWhitelisted — SEC-003)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/interviews')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          applicationId: appCreateId,
          interviewType: 'PHONE_SCREEN',
          interviewerName: 'X',
          tenantId: NON_EXISTENT_UUID,
        });
      expect(res.status).toBe(400);
    });

    it('without Authorization → 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/interviews')
        .send({ applicationId: appCreateId, interviewType: 'PHONE_SCREEN', interviewerName: 'X' });
      expect(res.status).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // Group 2: GET /api/v1/interviews — list
  // --------------------------------------------------------------------------

  describe('GET /api/v1/interviews', () => {
    it('System Administrator → 200 + paginated envelope', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/interviews')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('interviews');
      expect(res.body.data).toHaveProperty('total');
      expect(res.body.data).toHaveProperty('page');
      expect(res.body.data).toHaveProperty('pageSize');
      expect(res.body.data).toHaveProperty('totalPages');
      expect(Array.isArray(res.body.data.interviews)).toBe(true);
    });

    it('Compliance Officer → 200 (read-only role, list authorized — GD-M18-1 D16)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/interviews')
        .set('Authorization', `Bearer ${coToken}`);
      expect(res.status).toBe(200);
    });

    it('Hiring Manager → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/interviews')
        .set('Authorization', `Bearer ${hmToken}`);
      expect(res.status).toBe(403);
    });

    it('Workforce Planner → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/interviews')
        .set('Authorization', `Bearer ${wpToken}`);
      expect(res.status).toBe(403);
    });

    it('Executive User → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/interviews')
        .set('Authorization', `Bearer ${execToken}`);
      expect(res.status).toBe(403);
    });

    it('applicationId filter returns only interviews for that application', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/interviews?applicationId=${appListId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.interviews.length).toBeGreaterThanOrEqual(1);
      for (const i of res.body.data.interviews as { applicationId: string }[]) {
        expect(i.applicationId).toBe(appListId);
      }
    });

    it('status filter returns only interviews with matching status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/interviews?status=SCHEDULED')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.interviews.length).toBeGreaterThan(0);
      for (const i of res.body.data.interviews as { status: string }[]) {
        expect(i.status).toBe('SCHEDULED');
      }
    });

    it('interviewType filter returns only interviews with matching type', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/interviews?applicationId=${appListId}&interviewType=PANEL`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      for (const i of res.body.data.interviews as { interviewType: string }[]) {
        expect(i.interviewType).toBe('PANEL');
      }
    });

    it('pagination — pageSize=1 returns at most one record', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/interviews?page=1&pageSize=1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.interviews.length).toBeLessThanOrEqual(1);
      expect(res.body.data.pageSize).toBe(1);
    });

    it('list records do not expose tenantId or deletedAt (SEC-003)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/interviews')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      for (const i of res.body.data.interviews as Record<string, unknown>[]) {
        expect(i).not.toHaveProperty('tenantId');
        expect(i).not.toHaveProperty('deletedAt');
      }
    });

    it('cross-tenant interviews are NOT visible in primary-tenant list (SEC-003)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/interviews')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.interviews as { id: string }[]).map((i) => i.id);
      expect(ids).not.toContain(intCrossId);
    });

    it('without Authorization → 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/interviews');
      expect(res.status).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // Group 3: GET /api/v1/interviews/:id — detail
  // --------------------------------------------------------------------------

  describe('GET /api/v1/interviews/:id', () => {
    it('System Administrator → 200 + interview shape', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/interviews/${intDetailId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(intDetailId);
      expect(res.body.data).toHaveProperty('applicationId');
      expect(res.body.data).toHaveProperty('interviewType');
      expect(res.body.data).toHaveProperty('status');
      expect(res.body.data).toHaveProperty('scheduledAt');
      expect(res.body.data).toHaveProperty('interviewerName');
      expect(res.body.data).toHaveProperty('interviewerUserId');
      expect(res.body.data).toHaveProperty('feedback');
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('Compliance Officer → 200 (read-only role, detail authorized — GD-M18-1 D16)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/interviews/${intDetailId}`)
        .set('Authorization', `Bearer ${coToken}`);
      expect(res.status).toBe(200);
    });

    it('Hiring Manager → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/interviews/${intDetailId}`)
        .set('Authorization', `Bearer ${hmToken}`);
      expect(res.status).toBe(403);
    });

    it('Workforce Planner → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/interviews/${intDetailId}`)
        .set('Authorization', `Bearer ${wpToken}`);
      expect(res.status).toBe(403);
    });

    it('Executive User → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/interviews/${intDetailId}`)
        .set('Authorization', `Bearer ${execToken}`);
      expect(res.status).toBe(403);
    });

    it('non-existent interview → 404 INTERVIEW_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/interviews/${NON_EXISTENT_UUID}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEW_NOT_FOUND' } });
    });

    it('cross-tenant interview id → 404, not 403 (SEC-003: enumeration prevention)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/interviews/${intCrossId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEW_NOT_FOUND' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 4: PUT /api/v1/interviews/:id — update
  // --------------------------------------------------------------------------

  describe('PUT /api/v1/interviews/:id', () => {
    it('System Administrator updates scheduledAt and interviewerName → 200 + updated data (excludes tenantId, deletedAt)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/interviews/${intUpdId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ scheduledAt: '2026-08-01T09:00:00.000Z', interviewerName: 'Updated Interviewer' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(intUpdId);
      expect(res.body.data.interviewerName).toBe('Updated Interviewer');
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('terminal interview (COMPLETED) update → 422 INTERVIEW_IN_TERMINAL_STATE', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/interviews/${intUpdTerminalId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ interviewerName: 'Should not apply' });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEW_IN_TERMINAL_STATE' } });
    });

    it('Hiring Manager → 403', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/interviews/${intUpdId}`)
        .set('Authorization', `Bearer ${hmToken}`)
        .send({ interviewerName: 'HM should not update' });
      expect(res.status).toBe(403);
    });

    it('Compliance Officer → 403 (read-only role, update forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/interviews/${intUpdId}`)
        .set('Authorization', `Bearer ${coToken}`)
        .send({ interviewerName: 'CO should not update' });
      expect(res.status).toBe(403);
    });

    it('non-existent interview → 404 INTERVIEW_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/interviews/${NON_EXISTENT_UUID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ interviewerName: 'X' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEW_NOT_FOUND' } });
    });

    it('status field in body → 400 (ValidationPipe whitelist rejects unknown fields)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/interviews/${intUpdId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'COMPLETED' });

      expect(res.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // Group 5: POST /api/v1/interviews/:id/complete
  // --------------------------------------------------------------------------

  describe('POST /api/v1/interviews/:id/complete', () => {
    it('Hiring Manager → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${intCompleteId}/complete`)
        .set('Authorization', `Bearer ${hmToken}`);
      expect(res.status).toBe(403);
    });

    it('non-existent interview → 404 INTERVIEW_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${NON_EXISTENT_UUID}/complete`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEW_NOT_FOUND' } });
    });

    it('terminal interview (already CANCELLED) complete → 422 INTERVIEW_IN_TERMINAL_STATE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${intCompleteTerminalId}/complete`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEW_IN_TERMINAL_STATE' } });
    });

    it('[STATE] System Administrator completes SCHEDULED interview → 200 + status COMPLETED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${intCompleteId}/complete`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(intCompleteId);
      expect(res.body.data.status).toBe('COMPLETED');
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('[STATE] complete an already-completed interview → 422 INTERVIEW_IN_TERMINAL_STATE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${intCompleteId}/complete`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEW_IN_TERMINAL_STATE' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 6: POST /api/v1/interviews/:id/feedback
  // --------------------------------------------------------------------------

  describe('POST /api/v1/interviews/:id/feedback', () => {
    it('Hiring Manager → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${intFeedbackScheduledId}/feedback`)
        .set('Authorization', `Bearer ${hmToken}`)
        .send({ feedback: 'HM should not submit feedback' });
      expect(res.status).toBe(403);
    });

    it('SCHEDULED interview accepts feedback → 200', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${intFeedbackScheduledId}/feedback`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ feedback: 'Strong communication skills. Confidential candidate notes here.' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.feedback).toBe('Strong communication skills. Confidential candidate notes here.');
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('COMPLETED interview accepts feedback → 200', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${intFeedbackCompletedId}/feedback`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ feedback: 'Met all technical requirements.' });

      expect(res.status).toBe(200);
      expect(res.body.data.feedback).toBe('Met all technical requirements.');
    });

    it('CANCELLED interview rejects feedback → 422 INTERVIEW_FEEDBACK_NOT_ALLOWED (GD-M18-1 D5)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${intFeedbackCancelledId}/feedback`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ feedback: 'Should not be allowed' });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEW_FEEDBACK_NOT_ALLOWED' } });
    });

    it('empty feedback → 400 (class-validator IsNotEmpty)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${intFeedbackScheduledId}/feedback`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ feedback: '' });

      expect(res.status).toBe(400);
    });

    it('non-existent interview → 404 INTERVIEW_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${NON_EXISTENT_UUID}/feedback`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ feedback: 'X' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEW_NOT_FOUND' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 7: POST /api/v1/interviews/:id/cancel
  // --------------------------------------------------------------------------

  describe('POST /api/v1/interviews/:id/cancel', () => {
    it('Hiring Manager → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${intCancelId}/cancel`)
        .set('Authorization', `Bearer ${hmToken}`);
      expect(res.status).toBe(403);
    });

    it('non-existent interview → 404 INTERVIEW_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${NON_EXISTENT_UUID}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEW_NOT_FOUND' } });
    });

    it('terminal interview (already NO_SHOW) cancel → 422 INTERVIEW_IN_TERMINAL_STATE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${intCancelTerminalId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEW_IN_TERMINAL_STATE' } });
    });

    it('[STATE] System Administrator cancels SCHEDULED interview → 200 + status CANCELLED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${intCancelId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(intCancelId);
      expect(res.body.data.status).toBe('CANCELLED');
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('[STATE] cancel an already-cancelled interview → 422 INTERVIEW_IN_TERMINAL_STATE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${intCancelId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEW_IN_TERMINAL_STATE' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 8: POST /api/v1/interviews/:id/no-show
  // --------------------------------------------------------------------------

  describe('POST /api/v1/interviews/:id/no-show', () => {
    it('Hiring Manager → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${intNoShowId}/no-show`)
        .set('Authorization', `Bearer ${hmToken}`);
      expect(res.status).toBe(403);
    });

    it('non-existent interview → 404 INTERVIEW_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${NON_EXISTENT_UUID}/no-show`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEW_NOT_FOUND' } });
    });

    it('terminal interview (already COMPLETED) no-show → 422 INTERVIEW_IN_TERMINAL_STATE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${intNoShowTerminalId}/no-show`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEW_IN_TERMINAL_STATE' } });
    });

    it('[STATE] System Administrator marks SCHEDULED interview NO_SHOW → 200 + status NO_SHOW', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${intNoShowId}/no-show`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(intNoShowId);
      expect(res.body.data.status).toBe('NO_SHOW');
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('[STATE] no-show on an already-no-show interview → 422 INTERVIEW_IN_TERMINAL_STATE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${intNoShowId}/no-show`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEW_IN_TERMINAL_STATE' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 9: Tenant isolation (SEC-003)
  // --------------------------------------------------------------------------

  describe('Tenant isolation (SEC-003)', () => {
    it('tenant A interview list is NOT visible to tenant B authorized user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/interviews')
        .set('Authorization', `Bearer ${crossAdminToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.interviews as { id: string }[]).map((i) => i.id);
      expect(ids).not.toContain(intDetailId);
      expect(ids).not.toContain(intListId);
    });

    it('tenant A interview detail → 404 for tenant B authorized user (enumeration prevention)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/interviews/${intDetailId}`)
        .set('Authorization', `Bearer ${crossAdminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEW_NOT_FOUND' } });
    });

    it('tenant B update attempt on tenant A interview → 404', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/interviews/${intDetailId}`)
        .set('Authorization', `Bearer ${crossAdminToken}`)
        .send({ interviewerName: 'cross-tenant update attempt' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEW_NOT_FOUND' } });
    });

    it('tenant B complete attempt on tenant A interview → 404', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interviews/${intDetailId}/complete`)
        .set('Authorization', `Bearer ${crossAdminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INTERVIEW_NOT_FOUND' } });
    });

    it('cross-tenant application reference on create → 404 APPLICATION_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/interviews')
        .set('Authorization', `Bearer ${crossAdminToken}`)
        .send({ applicationId: appDetailId, interviewType: 'PHONE_SCREEN', interviewerName: 'X' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_FOUND' } });
    });

    it('no tenantId appears anywhere in an interview detail response', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/interviews/${intDetailId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body.data)).not.toContain('tenantId');
    });
  });

  // --------------------------------------------------------------------------
  // Group 10: Audit events (GD-M18-1 D17)
  // --------------------------------------------------------------------------

  describe('Audit events (GD-M18-1 D17)', () => {
    it('RECRUITING_INTERVIEW_SCHEDULED written after POST /interviews', async () => {
      expect(createdInterviewId).toBeDefined();
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: createdInterviewId, action: 'RECRUITING_INTERVIEW_SCHEDULED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('INTERVIEW');
    });

    it('RECRUITING_INTERVIEW_SCHEDULED metadata is PII-safe — excludes interviewer name', async () => {
      expect(createdInterviewId).toBeDefined();
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: createdInterviewId, action: 'RECRUITING_INTERVIEW_SCHEDULED' },
      });

      expect(record).not.toBeNull();
      const metaStr = JSON.stringify(record!.metadata);
      expect(metaStr).not.toContain('Jane Smith');
      expect(metaStr).not.toContain('@test.gov');
    });

    it('RECRUITING_INTERVIEW_UPDATED written after PUT /interviews/:id', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: intUpdId, action: 'RECRUITING_INTERVIEW_UPDATED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('INTERVIEW');
    });

    it('RECRUITING_INTERVIEW_UPDATED metadata is PII-safe — field names only, no interviewer name value', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: intUpdId, action: 'RECRUITING_INTERVIEW_UPDATED' },
      });

      expect(record).not.toBeNull();
      const metaStr = JSON.stringify(record!.metadata);
      expect(metaStr).not.toContain('Updated Interviewer');
    });

    it('RECRUITING_INTERVIEW_COMPLETED written after POST /interviews/:id/complete', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: intCompleteId, action: 'RECRUITING_INTERVIEW_COMPLETED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('INTERVIEW');
      expect(record!.metadata).toMatchObject({ previousStatus: 'SCHEDULED' });
    });

    it('RECRUITING_INTERVIEW_FEEDBACK_RECORDED written after POST /interviews/:id/feedback', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: intFeedbackScheduledId, action: 'RECRUITING_INTERVIEW_FEEDBACK_RECORDED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('INTERVIEW');
    });

    it('RECRUITING_INTERVIEW_FEEDBACK_RECORDED metadata excludes feedback text (GD-M18-1 D17)', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: intFeedbackScheduledId, action: 'RECRUITING_INTERVIEW_FEEDBACK_RECORDED' },
      });

      expect(record).not.toBeNull();
      const metaStr = JSON.stringify(record!.metadata);
      expect(metaStr).not.toContain('Strong communication skills');
      expect(metaStr).not.toContain('Confidential candidate notes');
    });

    it('RECRUITING_INTERVIEW_CANCELLED written after POST /interviews/:id/cancel — contains previousStatus', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: intCancelId, action: 'RECRUITING_INTERVIEW_CANCELLED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('INTERVIEW');
      expect(record!.metadata).toMatchObject({ previousStatus: 'SCHEDULED' });
    });

    it('RECRUITING_INTERVIEW_NO_SHOW written after POST /interviews/:id/no-show — contains previousStatus', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: intNoShowId, action: 'RECRUITING_INTERVIEW_NO_SHOW' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('INTERVIEW');
      expect(record!.metadata).toMatchObject({ previousStatus: 'SCHEDULED' });
    });
  });
});
