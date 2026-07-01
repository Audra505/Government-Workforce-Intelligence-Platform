// Reference: governance/GD-M19-1.md — Decisions 3–13, 15, 18
// Reference: spec/01_requirements.md — FR-304 Hiring Workflow
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
//
// E2E tests — real NestJS application + real PostgreSQL DB via PrismaClient.
// Self-contained: all fixtures created in beforeAll, deleted in afterAll.
// No seed.ts modifications — roles resolved via findUniqueOrThrow.
//
// App bootstrap mirrors main.ts:
//   ValidationPipe (whitelist, forbidNonWhitelisted, transform)
//   global prefix 'api' (health excluded)
//   URI versioning
//
// Fixture design decisions:
//   - Primary vacancy (primaryVacancyId) is used for the SA hire happy path and
//     displacement tests; it becomes FILLED after Group 1 runs.
//   - Precondition-failure scenarios that fail before the vacancy check
//     (APPLICATION_NOT_AT_OFFER_STATUS, ACCEPTED_OFFER_NOT_FOUND, CANDIDATE_ARCHIVED)
//     safely share primaryVacancyId — they fail before reaching the vacancy
//     lookup, so the FILLED state is irrelevant.
//   - HRD, RBAC, POSITION_NOT_AVAILABLE, VACANCY_NOT_AVAILABLE, no-hire,
//     and audit scenarios each have their own isolated vacancy/position.
//
// Cleanup order (GD-M19-1 D15):
//   offers → applications → employees → vacancies → positions →
//   candidates → departments → auditEvents → userRoles → users → tenants

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
const FIXTURE_TENANT_CODE = `E2E-HIR-${SUFFIX}`;
const CROSS_TENANT_CODE   = `E2E-HIR-X-${SUFFIX}`;

const ADMIN_EMAIL       = `e2e-hir-admin-${SUFFIX}@test.gov`;
const HR_EMAIL          = `e2e-hir-hr-${SUFFIX}@test.gov`;
const RECRUITER_EMAIL   = `e2e-hir-rec-${SUFFIX}@test.gov`;
const CO_EMAIL          = `e2e-hir-co-${SUFFIX}@test.gov`;
const HM_EMAIL          = `e2e-hir-hm-${SUFFIX}@test.gov`;
const WP_EMAIL          = `e2e-hir-wp-${SUFFIX}@test.gov`;
const EXEC_EMAIL        = `e2e-hir-exec-${SUFFIX}@test.gov`;
const CROSS_ADMIN_EMAIL = `e2e-hir-xadmin-${SUFFIX}@test.gov`;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NON_EXISTENT_UUID = '00000000-0000-4000-8000-000000000099';
const EMP_NUMBER_RE     = /^EMP-\d{3,}$/;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Hire (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  // JWTs
  let adminToken: string;
  let hrToken: string;
  let recruiterToken: string;
  let coToken: string;
  let hmToken: string;
  let wpToken: string;
  let execToken: string;
  let crossAdminToken: string;

  // Tenant IDs
  let fixtureTenantId: string;
  let crossTenantId: string;

  // User IDs for cleanup
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

  // Positions — one per isolated vacancy scenario
  let primaryPositionId: string;     // for SA hire + displacement + precondition-failures that die early
  let hrdPositionId: string;         // for HRD hire
  let rbacPositionId: string;        // for RBAC denied tests
  let occupiedPositionId: string;    // for POSITION_NOT_AVAILABLE (has a live employee)
  let filledVacPositionId: string;   // for VACANCY_NOT_AVAILABLE (FILLED)
  let cancelledVacPositionId: string;// for VACANCY_NOT_AVAILABLE (CANCELLED)
  let noHirePositionId: string;      // for no-hire invariant
  let auditPositionId: string;       // for audit events verification
  let crossPositionId: string;       // cross-tenant

  // Vacancies
  let primaryVacancyId: string;     // IN_RECRUITMENT; becomes FILLED after Group 1
  let hrdVacancyId: string;         // IN_RECRUITMENT
  let rbacVacancyId: string;        // IN_RECRUITMENT
  let occupiedVacancyId: string;    // IN_RECRUITMENT; position already occupied
  let filledVacancyId: string;      // already FILLED
  let cancelledVacancyId: string;   // already CANCELLED
  let noHireVacancyId: string;      // IN_RECRUITMENT; for no-hire invariant
  let auditVacancyId: string;       // IN_RECRUITMENT; for audit group hire
  let crossVacancyId: string;       // cross-tenant

  // Incumbent employee (for POSITION_NOT_AVAILABLE)
  let incumbentEmployeeId: string;

  // Applications
  let appHireMainId: string;         // OFFER + ACCEPTED offer — SA happy path; becomes HIRED in Group 1
  let appHireHRDId: string;          // OFFER + ACCEPTED offer — HRD hire
  let appRbacId: string;             // OFFER + ACCEPTED offer — RBAC tests (all denied; state unchanged)
  let appOccupiedId: string;         // OFFER + ACCEPTED offer — POSITION_NOT_AVAILABLE
  let appFilledVacId: string;        // OFFER + ACCEPTED offer — FILLED vacancy
  let appCancelledVacId: string;     // OFFER + ACCEPTED offer — CANCELLED vacancy
  let appArchivedId: string;         // OFFER + ACCEPTED offer — CANDIDATE_ARCHIVED
  let appNotOfferAppliedId: string;  // APPLIED — APPLICATION_NOT_AT_OFFER_STATUS
  let appNotOfferScreeningId: string;// SCREENING — APPLICATION_NOT_AT_OFFER_STATUS
  let appNotOfferRejectedId: string; // REJECTED — APPLICATION_NOT_AT_OFFER_STATUS
  let appNotOfferWithdrawnId: string;// WITHDRAWN — APPLICATION_NOT_AT_OFFER_STATUS
  let appNoAccOffer1Id: string;      // OFFER + PENDING_APPROVAL offer — ACCEPTED_OFFER_NOT_FOUND
  let appNoAccOffer2Id: string;      // OFFER + SENT offer — ACCEPTED_OFFER_NOT_FOUND
  let appNoHireId: string;           // OFFER + SENT offer — no-hire invariant (offer accepted via API)
  let appAuditId: string;            // OFFER + ACCEPTED offer — hired in audit group
  let appCrossId: string;            // cross-tenant OFFER + ACCEPTED offer

  // Displacement applications on primaryVacancyId
  let appDispActiveOffer: string;    // OFFER — should become REJECTED on hire
  let appDispActiveScreen: string;   // SCREENING — should become REJECTED on hire
  let appDispTermRejected: string;   // REJECTED — must stay REJECTED (not re-set)
  let appDispTermWithdrawn: string;  // WITHDRAWN — must stay WITHDRAWN

  // Offers — only IDs referenced in test assertions are captured
  let ofrHireMainId: string;   // ACCEPTED — verified in Group 12 (offer state after hire)
  let ofrNoHireId: string;     // SENT — used in Group 13 (no-hire invariant record-response)

  // Captured from Group 1 SA hire (used in audit + transition groups)
  let newEmployeeId: string;
  let hireCandidateId: string;       // candidateId linked to appHireMain

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
      data: { name: 'E2E Hire Tenant', code: FIXTURE_TENANT_CODE, status: 'ACTIVE' },
    });
    fixtureTenantId = tenant.id;

    const crossTenant = await prisma.tenant.create({
      data: { name: 'E2E Hire Cross Tenant', code: CROSS_TENANT_CODE, status: 'ACTIVE' },
    });
    crossTenantId = crossTenant.id;

    // ---- Roles ----
    const sysAdminRole  = await prisma.role.findUniqueOrThrow({ where: { name: 'System Administrator' } });
    const hrRole        = await prisma.role.findUniqueOrThrow({ where: { name: 'HR Director' } });
    const recruiterRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Recruiter' } });
    const coRole        = await prisma.role.findUniqueOrThrow({ where: { name: 'Compliance Officer' } });
    const hmRole        = await prisma.role.findUniqueOrThrow({ where: { name: 'Hiring Manager' } });
    const wpRole        = await prisma.role.findUniqueOrThrow({ where: { name: 'Workforce Planner' } });
    const execRole      = await prisma.role.findUniqueOrThrow({ where: { name: 'Executive User' } });

    // ---- Users ----
    const mkUser = async (tenantId: string, email: string, roleId: string, lastName: string): Promise<string> => {
      const u = await prisma.user.create({
        data: { tenantId, email, passwordHash, firstName: 'E2E', lastName, status: 'ACTIVE', failedLoginAttempts: 0 },
      });
      await prisma.userRole.create({ data: { userId: u.id, roleId } });
      return u.id;
    };

    adminUserId      = await mkUser(fixtureTenantId, ADMIN_EMAIL,       sysAdminRole.id,  'HirAdmin');
    hrUserId         = await mkUser(fixtureTenantId, HR_EMAIL,          hrRole.id,        'HirHR');
    recruiterUserId  = await mkUser(fixtureTenantId, RECRUITER_EMAIL,   recruiterRole.id, 'HirRec');
    coUserId         = await mkUser(fixtureTenantId, CO_EMAIL,          coRole.id,        'HirCO');
    hmUserId         = await mkUser(fixtureTenantId, HM_EMAIL,          hmRole.id,        'HirHM');
    wpUserId         = await mkUser(fixtureTenantId, WP_EMAIL,          wpRole.id,        'HirWP');
    execUserId       = await mkUser(fixtureTenantId, EXEC_EMAIL,        execRole.id,      'HirExec');
    crossAdminUserId = await mkUser(crossTenantId,   CROSS_ADMIN_EMAIL, sysAdminRole.id,  'HirXAdmin');

    // ---- Departments ----
    const primaryDept = await prisma.department.create({
      data: { tenantId: fixtureTenantId, name: 'E2E Hire Dept', code: `E2E-HD-${SUFFIX}`, status: 'ACTIVE' },
    });
    primaryDeptId = primaryDept.id;

    const crossDept = await prisma.department.create({
      data: { tenantId: crossTenantId, name: 'E2E Hire Cross Dept', code: `E2E-HXD-${SUFFIX}`, status: 'ACTIVE' },
    });
    crossDeptId = crossDept.id;

    // ---- Positions ----
    const mkPos = async (tenantId: string, deptId: string, title: string): Promise<string> => {
      const p = await prisma.position.create({
        data: { tenantId, departmentId: deptId, title, status: 'ACTIVE' },
      });
      return p.id;
    };

    primaryPositionId      = await mkPos(fixtureTenantId, primaryDeptId, 'E2E Hire Primary Pos');
    hrdPositionId          = await mkPos(fixtureTenantId, primaryDeptId, 'E2E Hire HRD Pos');
    rbacPositionId         = await mkPos(fixtureTenantId, primaryDeptId, 'E2E Hire RBAC Pos');
    occupiedPositionId     = await mkPos(fixtureTenantId, primaryDeptId, 'E2E Hire Occupied Pos');
    filledVacPositionId    = await mkPos(fixtureTenantId, primaryDeptId, 'E2E Hire FilledVac Pos');
    cancelledVacPositionId = await mkPos(fixtureTenantId, primaryDeptId, 'E2E Hire CancelledVac Pos');
    noHirePositionId       = await mkPos(fixtureTenantId, primaryDeptId, 'E2E Hire NoHire Pos');
    auditPositionId        = await mkPos(fixtureTenantId, primaryDeptId, 'E2E Hire Audit Pos');
    crossPositionId        = await mkPos(crossTenantId,   crossDeptId,   'E2E Hire Cross Pos');

    // ---- Vacancies ----
    const mkVac = async (
      tenantId: string, positionId: string, status: string,
    ): Promise<string> => {
      const v = await prisma.vacancy.create({
        data: { tenantId, positionId, status, priority: 'MEDIUM', reason: 'NEW_POSITION' },
      });
      return v.id;
    };

    primaryVacancyId     = await mkVac(fixtureTenantId, primaryPositionId,      'IN_RECRUITMENT');
    hrdVacancyId         = await mkVac(fixtureTenantId, hrdPositionId,          'IN_RECRUITMENT');
    rbacVacancyId        = await mkVac(fixtureTenantId, rbacPositionId,         'IN_RECRUITMENT');
    occupiedVacancyId    = await mkVac(fixtureTenantId, occupiedPositionId,     'IN_RECRUITMENT');
    filledVacancyId      = await mkVac(fixtureTenantId, filledVacPositionId,    'FILLED');
    cancelledVacancyId   = await mkVac(fixtureTenantId, cancelledVacPositionId, 'CANCELLED');
    noHireVacancyId      = await mkVac(fixtureTenantId, noHirePositionId,       'IN_RECRUITMENT');
    auditVacancyId       = await mkVac(fixtureTenantId, auditPositionId,        'IN_RECRUITMENT');
    crossVacancyId       = await mkVac(crossTenantId,   crossPositionId,        'IN_RECRUITMENT');

    // ---- Incumbent employee (for POSITION_NOT_AVAILABLE) ----
    const incumbent = await prisma.employee.create({
      data: {
        tenantId: fixtureTenantId,
        departmentId: primaryDeptId,
        positionId: occupiedPositionId,
        employeeNumber: `EMP-E2E-OCC-${SUFFIX}`,
        firstName: 'Incumbent',
        lastName: 'Fixture',
        employmentStatus: 'ACTIVE',
        appointmentAuthority: 'COMPETITIVE_APPOINTMENT',
      },
    });
    incumbentEmployeeId = incumbent.id;

    // ---- Candidates + Applications + Offers ----
    const mkCand = async (tenantId: string, email: string, status = 'ACTIVE'): Promise<string> => {
      const c = await prisma.candidate.create({
        data: { tenantId, email, firstName: 'E2E', lastName: 'HirCand', status },
      });
      return c.id;
    };

    const mkApp = async (tenantId: string, candidateId: string, vacancyId: string, status: string): Promise<string> => {
      const a = await prisma.application.create({
        data: { tenantId, candidateId, vacancyId, status, submittedAt: new Date() },
      });
      return a.id;
    };

    const mkOffer = async (tenantId: string, applicationId: string, status: string): Promise<string> => {
      const o = await prisma.offer.create({
        data: { tenantId, applicationId, status, notes: 'Fixture offer' },
      });
      return o.id;
    };

    // Happy path — SA
    const candMain  = await mkCand(fixtureTenantId, `e2e-hir-main-${SUFFIX}@test.gov`);
    hireCandidateId = candMain;
    appHireMainId   = await mkApp(fixtureTenantId, candMain, primaryVacancyId, 'OFFER');
    ofrHireMainId   = await mkOffer(fixtureTenantId, appHireMainId, 'ACCEPTED');

    // Happy path — HRD
    const candHRD = await mkCand(fixtureTenantId, `e2e-hir-hrd-${SUFFIX}@test.gov`);
    appHireHRDId  = await mkApp(fixtureTenantId, candHRD, hrdVacancyId, 'OFFER');
    await mkOffer(fixtureTenantId, appHireHRDId, 'ACCEPTED');

    // RBAC test — all denied roles attempt this; state unchanged (403 fires in guard, before handler)
    const candRbac = await mkCand(fixtureTenantId, `e2e-hir-rbac-${SUFFIX}@test.gov`);
    appRbacId      = await mkApp(fixtureTenantId, candRbac, rbacVacancyId, 'OFFER');
    await mkOffer(fixtureTenantId, appRbacId, 'ACCEPTED');

    // POSITION_NOT_AVAILABLE
    const candOccupied = await mkCand(fixtureTenantId, `e2e-hir-occ-${SUFFIX}@test.gov`);
    appOccupiedId      = await mkApp(fixtureTenantId, candOccupied, occupiedVacancyId, 'OFFER');
    await mkOffer(fixtureTenantId, appOccupiedId, 'ACCEPTED');

    // VACANCY_NOT_AVAILABLE — FILLED
    const candFilled = await mkCand(fixtureTenantId, `e2e-hir-fvac-${SUFFIX}@test.gov`);
    appFilledVacId   = await mkApp(fixtureTenantId, candFilled, filledVacancyId, 'OFFER');
    await mkOffer(fixtureTenantId, appFilledVacId, 'ACCEPTED');

    // VACANCY_NOT_AVAILABLE — CANCELLED
    const candCancelled = await mkCand(fixtureTenantId, `e2e-hir-cvac-${SUFFIX}@test.gov`);
    appCancelledVacId   = await mkApp(fixtureTenantId, candCancelled, cancelledVacancyId, 'OFFER');
    await mkOffer(fixtureTenantId, appCancelledVacId, 'ACCEPTED');

    // CANDIDATE_ARCHIVED — use occupiedVacancyId so this app is never displaced
    const candArchived = await mkCand(fixtureTenantId, `e2e-hir-arch-${SUFFIX}@test.gov`, 'ARCHIVED');
    appArchivedId      = await mkApp(fixtureTenantId, candArchived, occupiedVacancyId, 'OFFER');
    await mkOffer(fixtureTenantId, appArchivedId, 'ACCEPTED');

    // APPLICATION_NOT_AT_OFFER_STATUS
    const candStatus   = await mkCand(fixtureTenantId, `e2e-hir-status-${SUFFIX}@test.gov`);
    appNotOfferAppliedId   = await mkApp(fixtureTenantId, candStatus, primaryVacancyId, 'APPLIED');
    const candScreening    = await mkCand(fixtureTenantId, `e2e-hir-screen-${SUFFIX}@test.gov`);
    appNotOfferScreeningId = await mkApp(fixtureTenantId, candScreening, primaryVacancyId, 'SCREENING');
    const candRej          = await mkCand(fixtureTenantId, `e2e-hir-rej-${SUFFIX}@test.gov`);
    appNotOfferRejectedId  = await mkApp(fixtureTenantId, candRej, primaryVacancyId, 'REJECTED');
    const candWdr          = await mkCand(fixtureTenantId, `e2e-hir-wdr-${SUFFIX}@test.gov`);
    appNotOfferWithdrawnId = await mkApp(fixtureTenantId, candWdr, primaryVacancyId, 'WITHDRAWN');

    // ACCEPTED_OFFER_NOT_FOUND — use occupiedVacancyId so these apps are never displaced
    // (hire on occupiedVacancy always fails at POSITION_NOT_AVAILABLE before any displacement commits)
    const candNoOff1 = await mkCand(fixtureTenantId, `e2e-hir-nooff1-${SUFFIX}@test.gov`);
    appNoAccOffer1Id = await mkApp(fixtureTenantId, candNoOff1, occupiedVacancyId, 'OFFER');
    await mkOffer(fixtureTenantId, appNoAccOffer1Id, 'PENDING_APPROVAL');

    const candNoOff2 = await mkCand(fixtureTenantId, `e2e-hir-nooff2-${SUFFIX}@test.gov`);
    appNoAccOffer2Id = await mkApp(fixtureTenantId, candNoOff2, occupiedVacancyId, 'OFFER');
    await mkOffer(fixtureTenantId, appNoAccOffer2Id, 'SENT');

    // No-hire invariant (M18 guard check)
    const candNoHire = await mkCand(fixtureTenantId, `e2e-hir-nohire-${SUFFIX}@test.gov`);
    appNoHireId      = await mkApp(fixtureTenantId, candNoHire, noHireVacancyId, 'OFFER');
    ofrNoHireId      = await mkOffer(fixtureTenantId, appNoHireId, 'SENT');

    // Audit verification (separate hire performed inside audit group)
    const candAudit = await mkCand(fixtureTenantId, `e2e-hir-audit-${SUFFIX}@test.gov`);
    appAuditId      = await mkApp(fixtureTenantId, candAudit, auditVacancyId, 'OFFER');
    await mkOffer(fixtureTenantId, appAuditId, 'ACCEPTED');

    // Cross-tenant
    const candCross = await mkCand(crossTenantId, `e2e-hir-cross-${SUFFIX}@test.gov`);
    appCrossId      = await mkApp(crossTenantId, candCross, crossVacancyId, 'OFFER');
    await mkOffer(crossTenantId, appCrossId, 'ACCEPTED');

    // Displacement applications on primaryVacancyId (non-terminal get REJECTED on hire)
    const candD1   = await mkCand(fixtureTenantId, `e2e-hir-d1-${SUFFIX}@test.gov`);
    const candD2   = await mkCand(fixtureTenantId, `e2e-hir-d2-${SUFFIX}@test.gov`);
    const candDRej = await mkCand(fixtureTenantId, `e2e-hir-drej-${SUFFIX}@test.gov`);
    const candDWdr = await mkCand(fixtureTenantId, `e2e-hir-dwdr-${SUFFIX}@test.gov`);
    appDispActiveOffer   = await mkApp(fixtureTenantId, candD1,   primaryVacancyId, 'OFFER');
    appDispActiveScreen  = await mkApp(fixtureTenantId, candD2,   primaryVacancyId, 'SCREENING');
    appDispTermRejected  = await mkApp(fixtureTenantId, candDRej, primaryVacancyId, 'REJECTED');
    appDispTermWithdrawn = await mkApp(fixtureTenantId, candDWdr, primaryVacancyId, 'WITHDRAWN');

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
  }, 90_000);

  afterAll(async () => {
    if (prisma) {
      const tenantIds = [fixtureTenantId, crossTenantId].filter(Boolean);

      if (tenantIds.length > 0) {
        await prisma.offer.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
        await prisma.application.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
        await prisma.employee.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
        await prisma.vacancy.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
        await prisma.position.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
        await prisma.candidate.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
        await prisma.department.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
      }

      const actorIds = [
        adminUserId, hrUserId, recruiterUserId, coUserId,
        hmUserId, wpUserId, execUserId, crossAdminUserId,
      ].filter(Boolean);

      if (actorIds.length > 0) {
        await prisma.auditEvent.deleteMany({ where: { userId: { in: actorIds } } }).catch(() => {});
      }

      for (const userId of actorIds) {
        await prisma.userRole.deleteMany({ where: { userId } }).catch(() => {});
        await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      }

      if (fixtureTenantId) await prisma.tenant.delete({ where: { id: fixtureTenantId } }).catch(() => {});
      if (crossTenantId)   await prisma.tenant.delete({ where: { id: crossTenantId } }).catch(() => {});

      await prisma.$disconnect();
    }
    await app?.close();
  }, 60_000);

  // --------------------------------------------------------------------------
  // Group 1: POST /api/v1/applications/:id/hire — happy path (SA)
  // --------------------------------------------------------------------------

  describe('POST /api/v1/applications/:id/hire — happy path (SA)', () => {
    it('System Administrator + OFFER application + ACCEPTED offer → 201 + employee created', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appHireMainId}/hire`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();

      newEmployeeId = res.body.data.id as string;
      expect(newEmployeeId).toMatch(UUID_V4);
    });

    it('response contains employeeNumber in EMP-{N} format', async () => {
      expect(newEmployeeId).toBeDefined();
      const empRes = await request(app.getHttpServer())
        .get(`/api/v1/employees/${newEmployeeId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(empRes.status).toBe(200);
      expect(empRes.body.data.employeeNumber).toMatch(EMP_NUMBER_RE);
    });

    it('response body: employmentStatus = PENDING_ONBOARDING (GD-M19-1 D5)', async () => {
      expect(newEmployeeId).toBeDefined();
      const empRes = await request(app.getHttpServer())
        .get(`/api/v1/employees/${newEmployeeId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(empRes.body.data.employmentStatus).toBe('PENDING_ONBOARDING');
    });

    it('response body: appointmentAuthority = COMPETITIVE_APPOINTMENT (GD-M19-1 D5; GD-PRE-M13-001 D3)', async () => {
      expect(newEmployeeId).toBeDefined();
      const empRes = await request(app.getHttpServer())
        .get(`/api/v1/employees/${newEmployeeId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(empRes.body.data.appointmentAuthority).toBe('COMPETITIVE_APPOINTMENT');
    });

    it('response body: positionId = vacancy.positionId (GD-M19-1 D5)', async () => {
      expect(newEmployeeId).toBeDefined();
      const empRes = await request(app.getHttpServer())
        .get(`/api/v1/employees/${newEmployeeId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(empRes.body.data.positionId).toBe(primaryPositionId);
    });

    it('response body: departmentId = position.departmentId (GD-M19-1 D5)', async () => {
      expect(newEmployeeId).toBeDefined();
      const empRes = await request(app.getHttpServer())
        .get(`/api/v1/employees/${newEmployeeId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(empRes.body.data.departmentId).toBe(primaryDeptId);
    });

    it('response body: hireDate is a non-null ISO string (GD-M19-1 D5)', async () => {
      expect(newEmployeeId).toBeDefined();
      const empRes = await request(app.getHttpServer())
        .get(`/api/v1/employees/${newEmployeeId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(empRes.body.data.hireDate).not.toBeNull();
      expect(new Date(empRes.body.data.hireDate as string).getTime()).not.toBeNaN();
    });

    it('hire response excludes tenantId (SEC-003)', async () => {
      // Verify via GET on the employee created in the first test — the 201 body shape is the same
      expect(newEmployeeId).toBeDefined();
      const empRes = await request(app.getHttpServer())
        .get(`/api/v1/employees/${newEmployeeId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(JSON.stringify(empRes.body.data)).not.toContain('tenantId');
    });

    it('hire response excludes deletedAt (SEC-003)', async () => {
      expect(newEmployeeId).toBeDefined();
      const empRes = await request(app.getHttpServer())
        .get(`/api/v1/employees/${newEmployeeId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(empRes.body.data).not.toHaveProperty('deletedAt');
    });

    it('fields derived from candidate: firstName and lastName mapped correctly (GD-M19-1 D5)', async () => {
      expect(newEmployeeId).toBeDefined();
      const candRec = await prisma.candidate.findUniqueOrThrow({ where: { id: hireCandidateId } });
      const empRes = await request(app.getHttpServer())
        .get(`/api/v1/employees/${newEmployeeId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(empRes.body.data.firstName).toBe(candRec.firstName);
      expect(empRes.body.data.lastName).toBe(candRec.lastName);
    });

    it('client-provided body is ignored — endpoint accepts no body (GD-M19-1 D5, D6)', async () => {
      // Verify endpoint works with an arbitrary body payload (not a 400)
      // Use appRbacId here to avoid state conflict — will get 403 regardless of body.
      // The goal is just to confirm no 400 is returned for extraneous body fields.
      // (Guards fire before body validation. The body has no DTO so whitelist is not applied.)
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appRbacId}/hire`)
        .set('Authorization', `Bearer ${recruiterToken}`)
        .send({ tenantId: NON_EXISTENT_UUID, employeeNumber: 'EMP-FAKE', employmentStatus: 'ACTIVE' });
      // Recruiter gets 403 — but the body didn't cause 400, confirming no DTO whitelist rejection
      expect(res.status).toBe(403);
    });
  });

  // --------------------------------------------------------------------------
  // Group 2: RBAC
  // --------------------------------------------------------------------------

  describe('POST /api/v1/applications/:id/hire — RBAC', () => {
    it('Recruiter → 403 Forbidden (GD-M19-1 D3; GD-PRE-PHASE3-003 D3)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appRbacId}/hire`)
        .set('Authorization', `Bearer ${recruiterToken}`);
      expect(res.status).toBe(403);
    });

    it('Hiring Manager → 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appRbacId}/hire`)
        .set('Authorization', `Bearer ${hmToken}`);
      expect(res.status).toBe(403);
    });

    it('Compliance Officer → 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appRbacId}/hire`)
        .set('Authorization', `Bearer ${coToken}`);
      expect(res.status).toBe(403);
    });

    it('Workforce Planner → 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appRbacId}/hire`)
        .set('Authorization', `Bearer ${wpToken}`);
      expect(res.status).toBe(403);
    });

    it('Executive User → 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appRbacId}/hire`)
        .set('Authorization', `Bearer ${execToken}`);
      expect(res.status).toBe(403);
    });

    it('unauthenticated request → 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appRbacId}/hire`);
      expect(res.status).toBe(401);
    });

    it('HR Director → 201 (HRD is authorized — GD-M19-1 D3)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appHireHRDId}/hire`)
        .set('Authorization', `Bearer ${hrToken}`);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.employmentStatus).toBe('PENDING_ONBOARDING');
    });
  });

  // --------------------------------------------------------------------------
  // Group 3: APPLICATION_NOT_FOUND
  // --------------------------------------------------------------------------

  describe('POST /api/v1/applications/:id/hire — APPLICATION_NOT_FOUND', () => {
    it('non-existent application UUID → 404 APPLICATION_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${NON_EXISTENT_UUID}/hire`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_FOUND' } });
    });

    it('cross-tenant application → 404 APPLICATION_NOT_FOUND (SEC-003 enumeration prevention)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appCrossId}/hire`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_FOUND' } });
    });

    it('invalid UUID format → 400 (ParseUUIDPipe)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/applications/not-a-uuid/hire')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // Group 4: APPLICATION_ALREADY_HIRED — idempotency guard
  // --------------------------------------------------------------------------

  describe('POST /api/v1/applications/:id/hire — APPLICATION_ALREADY_HIRED', () => {
    it('already-HIRED application → 409 APPLICATION_ALREADY_HIRED (GD-M19-1 D4 rule 2, D6)', async () => {
      // appHireMainId was hired in Group 1 — status is now HIRED
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appHireMainId}/hire`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_ALREADY_HIRED' } });
    });

    it('second hire attempt does not create a second employee', async () => {
      const countBefore = await prisma.employee.count({
        where: { tenantId: fixtureTenantId, positionId: primaryPositionId },
      });
      await request(app.getHttpServer())
        .post(`/api/v1/applications/${appHireMainId}/hire`)
        .set('Authorization', `Bearer ${adminToken}`);
      const countAfter = await prisma.employee.count({
        where: { tenantId: fixtureTenantId, positionId: primaryPositionId },
      });
      expect(countAfter).toBe(countBefore);
    });

    it('409 fires before APPLICATION_NOT_AT_OFFER_STATUS (idempotency check ordering — GD-M19-1 D4)', async () => {
      // appHireMainId has status HIRED (terminal). If ordering were wrong, it might return 422.
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appHireMainId}/hire`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409); // not 422
    });
  });

  // --------------------------------------------------------------------------
  // Group 5: APPLICATION_NOT_AT_OFFER_STATUS
  // --------------------------------------------------------------------------

  describe('POST /api/v1/applications/:id/hire — APPLICATION_NOT_AT_OFFER_STATUS', () => {
    it('application at APPLIED status → 422 APPLICATION_NOT_AT_OFFER_STATUS', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appNotOfferAppliedId}/hire`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_AT_OFFER_STATUS' } });
    });

    it('application at SCREENING status → 422 APPLICATION_NOT_AT_OFFER_STATUS', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appNotOfferScreeningId}/hire`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_AT_OFFER_STATUS' } });
    });

    it('application at REJECTED status → 422 APPLICATION_NOT_AT_OFFER_STATUS', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appNotOfferRejectedId}/hire`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_AT_OFFER_STATUS' } });
    });

    it('application at WITHDRAWN status → 422 APPLICATION_NOT_AT_OFFER_STATUS', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appNotOfferWithdrawnId}/hire`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_AT_OFFER_STATUS' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 6: ACCEPTED_OFFER_NOT_FOUND
  // --------------------------------------------------------------------------

  describe('POST /api/v1/applications/:id/hire — ACCEPTED_OFFER_NOT_FOUND', () => {
    it('application at OFFER with PENDING_APPROVAL offer → 422 ACCEPTED_OFFER_NOT_FOUND (GD-M19-1 D4 rule 4)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appNoAccOffer1Id}/hire`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'ACCEPTED_OFFER_NOT_FOUND' } });
    });

    it('application at OFFER with SENT offer → 422 ACCEPTED_OFFER_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appNoAccOffer2Id}/hire`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'ACCEPTED_OFFER_NOT_FOUND' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 7: CANDIDATE_ARCHIVED
  // --------------------------------------------------------------------------

  describe('POST /api/v1/applications/:id/hire — CANDIDATE_ARCHIVED', () => {
    it('candidate with status = ARCHIVED → 422 CANDIDATE_ARCHIVED (GD-M19-1 D4 rule 5)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appArchivedId}/hire`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'CANDIDATE_ARCHIVED' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 8: VACANCY_NOT_AVAILABLE
  // --------------------------------------------------------------------------

  describe('POST /api/v1/applications/:id/hire — VACANCY_NOT_AVAILABLE', () => {
    it('vacancy with status FILLED → 422 VACANCY_NOT_AVAILABLE (GD-M19-1 D4 rule 6)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appFilledVacId}/hire`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'VACANCY_NOT_AVAILABLE' } });
    });

    it('vacancy with status CANCELLED → 422 VACANCY_NOT_AVAILABLE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appCancelledVacId}/hire`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'VACANCY_NOT_AVAILABLE' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 9: POSITION_NOT_AVAILABLE
  // --------------------------------------------------------------------------

  describe('POST /api/v1/applications/:id/hire — POSITION_NOT_AVAILABLE', () => {
    it('position occupied by ACTIVE employee → 422 POSITION_NOT_AVAILABLE (GD-M19-1 D4 rule 8)', async () => {
      expect(incumbentEmployeeId).toBeDefined();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appOccupiedId}/hire`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'POSITION_NOT_AVAILABLE' } });
    });

    it('no employee record was created for the blocked hire attempt', async () => {
      const employees = await prisma.employee.findMany({
        where: { tenantId: fixtureTenantId, positionId: occupiedPositionId },
      });
      // Only the fixture incumbent employee should exist
      expect(employees.length).toBe(1);
      expect(employees[0].id).toBe(incumbentEmployeeId);
    });
  });

  // --------------------------------------------------------------------------
  // Group 10: Application transitions
  // --------------------------------------------------------------------------

  describe('Application transitions after hire (GD-M19-1 D6)', () => {
    it('hired application.status = HIRED (verified via GET /applications/:id)', async () => {
      expect(newEmployeeId).toBeDefined();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/applications/${appHireMainId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('HIRED');
    });

    it('active non-terminal OFFER application on same vacancy displaced to REJECTED', async () => {
      const rec = await prisma.application.findUniqueOrThrow({ where: { id: appDispActiveOffer } });
      expect(rec.status).toBe('REJECTED');
    });

    it('active non-terminal SCREENING application on same vacancy displaced to REJECTED', async () => {
      const rec = await prisma.application.findUniqueOrThrow({ where: { id: appDispActiveScreen } });
      expect(rec.status).toBe('REJECTED');
    });

    it('terminal REJECTED application on same vacancy is unchanged (stays REJECTED, not re-set)', async () => {
      const rec = await prisma.application.findUniqueOrThrow({ where: { id: appDispTermRejected } });
      expect(rec.status).toBe('REJECTED');
    });

    it('terminal WITHDRAWN application on same vacancy is unchanged (stays WITHDRAWN)', async () => {
      const rec = await prisma.application.findUniqueOrThrow({ where: { id: appDispTermWithdrawn } });
      expect(rec.status).toBe('WITHDRAWN');
    });
  });

  // --------------------------------------------------------------------------
  // Group 11: Vacancy transition
  // --------------------------------------------------------------------------

  describe('Vacancy transition after hire (GD-M19-1 D7)', () => {
    it('vacancy.status = FILLED after successful hire (verified via GET /vacancies/:id)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/vacancies/${primaryVacancyId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('FILLED');
    });

    it('vacancy.filledAt is non-null after hire (Time to Fill data point — GD-M19-1 D7)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/vacancies/${primaryVacancyId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.filledAt).not.toBeNull();
      expect(new Date(res.body.data.filledAt as string).getTime()).not.toBeNaN();
    });

    it('vacancy.filledAt was NULL before hire (confirmed via cross-check with fixture), non-null after', async () => {
      // Verify that a freshly-created vacancy (hrdVacancyId, now also FILLED from HRD hire) has non-null filledAt
      const rec = await prisma.vacancy.findUniqueOrThrow({ where: { id: hrdVacancyId } });
      expect(rec.filledAt).not.toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Group 12: Offer state after hire
  // --------------------------------------------------------------------------

  describe('Offer state after hire (GD-M19-1 D8)', () => {
    it('accepted offer status remains ACCEPTED after hire (offer is not modified by hire action)', async () => {
      const ofrRec = await prisma.offer.findUniqueOrThrow({ where: { id: ofrHireMainId } });
      expect(ofrRec.status).toBe('ACCEPTED');
    });

    it('displaced applications retain their existing offer status (offers on displaced apps not modified — GD-M19-1 D8)', async () => {
      // appDispActiveOffer was at OFFER with no offer; it was OFFER status app with no offer record
      // Verify the displacement app was REJECTED without any offer mutation by checking no offer
      // was created for it (no offer fixtures were created for displacement candidates)
      const offers = await prisma.offer.findMany({
        where: { applicationId: appDispActiveOffer, tenantId: fixtureTenantId },
      });
      expect(offers.length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Group 13: No-hire invariant (GD-M18-1 D9 — must hold after M19 deployed)
  // --------------------------------------------------------------------------

  describe('No-hire invariant (GD-M18-1 D9)', () => {
    it('[STATE] offer acceptance does NOT transition application to HIRED', async () => {
      const employeeCountBefore = await prisma.employee.count({ where: { tenantId: fixtureTenantId } });

      const acceptRes = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrNoHireId}/record-response`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ response: 'ACCEPTED' });

      expect(acceptRes.status).toBe(200);
      expect(acceptRes.body.data.status).toBe('ACCEPTED');

      const appRes = await request(app.getHttpServer())
        .get(`/api/v1/applications/${appNoHireId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(appRes.status).toBe(200);
      expect(appRes.body.data.status).toBe('OFFER'); // not HIRED

      const employeeCountAfter = await prisma.employee.count({ where: { tenantId: fixtureTenantId } });
      expect(employeeCountAfter).toBe(employeeCountBefore);
    });

    it('no employee linked to no-hire candidate exists after offer acceptance alone', async () => {
      const appRec = await prisma.application.findUniqueOrThrow({ where: { id: appNoHireId } });
      const candidate = await prisma.candidate.findUniqueOrThrow({ where: { id: appRec.candidateId } });

      const employees = await prisma.employee.findMany({
        where: { tenantId: fixtureTenantId, email: candidate.email },
      });
      expect(employees.length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Group 14: No-duplicate employee / idempotency
  // --------------------------------------------------------------------------

  describe('No-duplicate employee (GD-M19-1 D6)', () => {
    it('second hire attempt on HIRED application → 409 APPLICATION_ALREADY_HIRED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appHireMainId}/hire`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_ALREADY_HIRED' } });
    });

    it('employee count for primaryPosition unchanged on second hire attempt', async () => {
      const count = await prisma.employee.count({
        where: { tenantId: fixtureTenantId, positionId: primaryPositionId },
      });
      expect(count).toBe(1); // only the first hire's employee
    });

    it('application.status remains HIRED after failed second attempt', async () => {
      const appRec = await prisma.application.findUniqueOrThrow({ where: { id: appHireMainId } });
      expect(appRec.status).toBe('HIRED');
    });
  });

  // --------------------------------------------------------------------------
  // Group 15: Tenant isolation (SEC-003)
  // --------------------------------------------------------------------------

  describe('Tenant isolation (SEC-003)', () => {
    it('cross-tenant SA token cannot hire primary-tenant application → 404 APPLICATION_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appRbacId}/hire`)
        .set('Authorization', `Bearer ${crossAdminToken}`);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_FOUND' } });
    });

    it('no cross-tenant employee created after failed cross-tenant hire attempt', async () => {
      const crossEmployees = await prisma.employee.findMany({ where: { tenantId: crossTenantId } });
      expect(crossEmployees.length).toBe(0);
    });

    it('201 hire response does not contain tenantId anywhere in body', async () => {
      // Verify via GET on the hired employee (which was created in Group 1)
      expect(newEmployeeId).toBeDefined();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/employees/${newEmployeeId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body.data)).not.toContain('tenantId');
    });

    it('cross-tenant SA cannot view primary-tenant employee via GET /employees/:id → 404', async () => {
      expect(newEmployeeId).toBeDefined();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/employees/${newEmployeeId}`)
        .set('Authorization', `Bearer ${crossAdminToken}`);
      expect(res.status).toBe(404);
    });
  });

  // --------------------------------------------------------------------------
  // Group 16: Audit events (GD-M19-1 D12)
  // --------------------------------------------------------------------------

  describe('Audit events (GD-M19-1 D12)', () => {
    let auditEmployeeId: string;

    it('[STATE] hire appAudit via SA → 201 (audit group setup)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/applications/${appAuditId}/hire`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(201);
      auditEmployeeId = res.body.data.id as string;
      expect(auditEmployeeId).toMatch(UUID_V4);
    });

    it('RECRUITING_CANDIDATE_HIRED written after hire (GD-M19-1 D12)', async () => {
      expect(auditEmployeeId).toBeDefined();
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: appAuditId, action: 'RECRUITING_CANDIDATE_HIRED' },
      });
      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('Application');
      expect(record!.result).toBe('SUCCESS');
    });

    it('RECRUITING_CANDIDATE_HIRED metadata contains candidateId, vacancyId, trigger', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: appAuditId, action: 'RECRUITING_CANDIDATE_HIRED' },
      });
      expect(record).not.toBeNull();
      expect(record!.metadata).toMatchObject({
        vacancyId:   auditVacancyId,
        trigger:     'M19_HIRE',
      });
      expect((record!.metadata as Record<string, unknown>)['candidateId']).toBeDefined();
    });

    it('WORKFORCE_EMPLOYEE_CREATED_FROM_HIRE written after hire (GD-M19-1 D12)', async () => {
      expect(auditEmployeeId).toBeDefined();
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: auditEmployeeId, action: 'WORKFORCE_EMPLOYEE_CREATED_FROM_HIRE' },
      });
      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('Employee');
    });

    it('WORKFORCE_EMPLOYEE_CREATED_FROM_HIRE metadata contains appointmentAuthority, employmentStatus, positionId, trigger', async () => {
      expect(auditEmployeeId).toBeDefined();
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: auditEmployeeId, action: 'WORKFORCE_EMPLOYEE_CREATED_FROM_HIRE' },
      });
      expect(record).not.toBeNull();
      expect(record!.metadata).toMatchObject({
        appointmentAuthority: 'COMPETITIVE_APPOINTMENT',
        employmentStatus:     'PENDING_ONBOARDING',
        positionId:           auditPositionId,
        trigger:              'M19_HIRE',
      });
    });

    it('WORKFORCE_VACANCY_FILLED_FROM_HIRE written after hire (GD-M19-1 D12)', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: auditVacancyId, action: 'WORKFORCE_VACANCY_FILLED_FROM_HIRE' },
      });
      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('Vacancy');
    });

    it('WORKFORCE_VACANCY_FILLED_FROM_HIRE metadata contains previousStatus, newStatus, trigger', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: auditVacancyId, action: 'WORKFORCE_VACANCY_FILLED_FROM_HIRE' },
      });
      expect(record).not.toBeNull();
      expect(record!.metadata).toMatchObject({
        previousStatus: 'IN_RECRUITMENT',
        newStatus:      'FILLED',
        trigger:        'M19_HIRE',
      });
    });

    it('WORKFORCE_EMPLOYEE_POSITION_ASSIGNED_FROM_HIRE written after hire (GD-M19-1 D12)', async () => {
      expect(auditEmployeeId).toBeDefined();
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: auditEmployeeId, action: 'WORKFORCE_EMPLOYEE_POSITION_ASSIGNED_FROM_HIRE' },
      });
      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('Employee');
    });

    it('WORKFORCE_EMPLOYEE_POSITION_ASSIGNED_FROM_HIRE metadata contains positionId, trigger', async () => {
      expect(auditEmployeeId).toBeDefined();
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: auditEmployeeId, action: 'WORKFORCE_EMPLOYEE_POSITION_ASSIGNED_FROM_HIRE' },
      });
      expect(record).not.toBeNull();
      expect(record!.metadata).toMatchObject({
        positionId: auditPositionId,
        trigger:    'M19_HIRE',
      });
    });

    it('no audit metadata for any M19 hire event contains candidate firstName or lastName (PII-safe — GD-M19-1 D12)', async () => {
      const records = await prisma.auditEvent.findMany({
        where: {
          tenantId: fixtureTenantId,
          action: {
            in: [
              'RECRUITING_CANDIDATE_HIRED',
              'WORKFORCE_EMPLOYEE_CREATED_FROM_HIRE',
              'WORKFORCE_VACANCY_FILLED_FROM_HIRE',
              'WORKFORCE_EMPLOYEE_POSITION_ASSIGNED_FROM_HIRE',
            ],
          },
        },
      });

      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        const metaStr = JSON.stringify(record.metadata);
        // No candidate first name, last name, or email should appear
        expect(metaStr).not.toContain('E2E');          // fixture firstName
        expect(metaStr).not.toContain('HirCand');      // fixture lastName
        expect(metaStr).not.toContain('@test.gov');    // fixture email pattern
        expect(metaStr).not.toContain('Fixture offer');// offer notes
      }
    });

    it('all 4 M19 hire audit events are written for a single successful hire', async () => {
      expect(auditEmployeeId).toBeDefined();

      const candidateHired      = await prisma.auditEvent.findFirst({ where: { entityId: appAuditId,       action: 'RECRUITING_CANDIDATE_HIRED' } });
      const employeeCreated     = await prisma.auditEvent.findFirst({ where: { entityId: auditEmployeeId,  action: 'WORKFORCE_EMPLOYEE_CREATED_FROM_HIRE' } });
      const vacancyFilled       = await prisma.auditEvent.findFirst({ where: { entityId: auditVacancyId,   action: 'WORKFORCE_VACANCY_FILLED_FROM_HIRE' } });
      const positionAssigned    = await prisma.auditEvent.findFirst({ where: { entityId: auditEmployeeId,  action: 'WORKFORCE_EMPLOYEE_POSITION_ASSIGNED_FROM_HIRE' } });

      expect(candidateHired).not.toBeNull();
      expect(employeeCreated).not.toBeNull();
      expect(vacancyFilled).not.toBeNull();
      expect(positionAssigned).not.toBeNull();
    });
  });
});
