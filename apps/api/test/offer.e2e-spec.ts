// Reference: spec/01_requirements.md — FR-315 through FR-324 Offer Management
// Reference: spec/06_api_contracts.md — Offer API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: governance/GD-M18-1.md — D6 (re-offer rule), D7 (state machine), D9 (no-hire invariant),
//            D10 (active offer uniqueness), D13 (DTOs), D14 (error codes), D16 (RBAC),
//            D17 (audit events), D18 (e2e test groups)
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
//   offers (→ applications) deleted first
//   applications (→ tenants, candidates, vacancies) before vacancies
//   vacancies (→ positions) before positions
//   positions (→ departments) before departments
//   candidates (→ tenants) before tenants
//   audit events (→ users) before users
//   userRoles before users → users before tenants
//
// State-changing groups (update, submit, approve, send, record-response, withdraw, re-offer) use
// dedicated pre-created offer/application fixtures so no test-ordering dependencies exist across groups.
//
// No-hire invariant (GD-M18-1 D3, D9): offer ACCEPTED must NOT change application.status away from
// OFFER and must NOT create an Employee record. Verified via GET /applications/:id plus a tenant-scoped
// Employee count comparison (Employee has no applicationId FK — it is linked via department/position only).

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
const FIXTURE_TENANT_CODE = `E2E-OFR-${SUFFIX}`;
const CROSS_TENANT_CODE   = `E2E-OFR-X-${SUFFIX}`;

const ADMIN_EMAIL         = `e2e-ofr-admin-${SUFFIX}@test.gov`;
const HR_EMAIL            = `e2e-ofr-hr-${SUFFIX}@test.gov`;
const RECRUITER_EMAIL     = `e2e-ofr-rec-${SUFFIX}@test.gov`;
const CO_EMAIL            = `e2e-ofr-co-${SUFFIX}@test.gov`;
const HM_EMAIL            = `e2e-ofr-hm-${SUFFIX}@test.gov`;
const WP_EMAIL            = `e2e-ofr-wp-${SUFFIX}@test.gov`;
const EXEC_EMAIL          = `e2e-ofr-exec-${SUFFIX}@test.gov`;
const CROSS_ADMIN_EMAIL   = `e2e-ofr-xadmin-${SUFFIX}@test.gov`;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NON_EXISTENT_UUID = '00000000-0000-4000-8000-000000000099';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Offer (e2e)', () => {
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

  // Applications — primary tenant, all at OFFER status unless noted
  let appCreateId: string;        // happy-path create
  let appNotOfferId: string;      // APPLIED — APPLICATION_NOT_AT_OFFER_STATUS on create
  let appActiveExistsId: string;  // OFFER + a pre-existing active (DRAFT) offer — ACTIVE_OFFER_EXISTS
  let appListId: string;          // list + filter tests
  let appUpdId: string;           // update flow (DRAFT)
  let appSubmitId: string;        // submit flow (DRAFT)
  let appApproveId: string;       // approve flow (PENDING_APPROVAL)
  let appSendId: string;          // send flow (APPROVED)
  let appResponseAcceptId: string; // record-response ACCEPTED flow (SENT)
  let appResponseDeclineId: string; // record-response DECLINED flow (SENT)
  let appWithdrawDraftId: string; // withdraw flow (DRAFT)
  let appWithdrawSentId: string;  // withdraw flow (SENT)
  let appReofferDeclinedId: string; // re-offer after DECLINED
  let appReofferWithdrawnId: string; // re-offer after WITHDRAWN
  let appReofferAcceptedId: string;  // re-offer blocked after ACCEPTED
  let appDetailId: string;        // detail + tenant isolation
  let appAuditId: string;         // audit event checks (create)
  let appNoHireId: string;        // no-hire invariant check (SENT → ACCEPTED)
  let appRbacApproveId: string;   // Recruiter-cannot-approve check (PENDING_APPROVAL)
  let appRbacSendId: string;      // Recruiter-cannot-send check (APPROVED)

  // Second application per conflicting status-pair — the partial unique index allows only one
  // active (non-DECLINED/non-WITHDRAWN) offer per application, so each "blocked" negative-path
  // fixture below needs its own dedicated application (GD-M18-1 D10).
  let appUpdPendingId: string;       // pairs with ofrUpdPendingId (PENDING_APPROVAL)
  let appSubmitNotDraftId: string;   // pairs with ofrSubmitNotDraftId (PENDING_APPROVAL)
  let appApproveNotPendingId: string; // pairs with ofrApproveNotPendingId (DRAFT)
  let appSendNotApprovedId: string;  // pairs with ofrSendNotApprovedId (DRAFT)
  let appResponseNotSentId: string;  // pairs with ofrResponseNotSentId (DRAFT)
  let appWithdrawRbacId: string;     // pairs with ofrWithdrawRbacId (DRAFT)
  let appWithdrawAcceptedId: string; // pairs with ofrWithdrawTerminalId (ACCEPTED)

  // Application — cross-tenant (status OFFER)
  let crossAppId: string;

  // Pre-created offers (Prisma-direct) — status as named
  let ofrListId: string;             // list + filter tests (DRAFT)
  let ofrDetailId: string;           // detail + RBAC (DRAFT)
  let ofrCrossId: string;            // cross-tenant offer (SEC-003)
  let ofrUpdDraftId: string;         // update flow — success (DRAFT)
  let ofrUpdPendingId: string;       // update flow — blocked (PENDING_APPROVAL)
  let ofrSubmitDraftId: string;      // submit flow — success (DRAFT)
  let ofrSubmitNotDraftId: string;   // submit flow — blocked (PENDING_APPROVAL)
  let ofrApprovePendingId: string;   // approve flow — success (PENDING_APPROVAL)
  let ofrApproveNotPendingId: string; // approve flow — blocked (DRAFT)
  let ofrRbacApproveId: string;      // Recruiter cannot approve (PENDING_APPROVAL)
  let ofrSendApprovedId: string;     // send flow — success (APPROVED)
  let ofrSendNotApprovedId: string;  // send flow — blocked (DRAFT)
  let ofrRbacSendId: string;         // Recruiter cannot send (APPROVED)
  let ofrResponseAcceptId: string;   // record-response ACCEPTED — success (SENT)
  let ofrResponseDeclineId: string;  // record-response DECLINED — success (SENT)
  let ofrResponseNotSentId: string;  // record-response blocked (DRAFT)
  let ofrWithdrawDraftId: string;    // withdraw — success (DRAFT)
  let ofrWithdrawSentId: string;     // withdraw — success (SENT)
  let ofrWithdrawTerminalId: string; // withdraw — blocked (ACCEPTED)
  let ofrWithdrawRbacId: string;     // Hiring Manager withdraw 403 (DRAFT)
  let ofrActiveExistsId: string;     // existing active offer blocking create (DRAFT)
  let ofrReofferDeclinedId: string;  // DECLINED — re-offer allowed
  let ofrReofferWithdrawnId: string; // WITHDRAWN — re-offer allowed
  let ofrReofferAcceptedId: string;  // ACCEPTED — re-offer still blocked
  let ofrNoHireId: string;           // SENT → record-response ACCEPTED — no-hire invariant

  // Captured from API responses
  let createdOfferId: string; // captured from SA create in Group 1 — used by Group 13 audit checks

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
      data: { name: 'E2E Offer Tenant', code: FIXTURE_TENANT_CODE, status: 'ACTIVE' },
    });
    fixtureTenantId = tenant.id;

    const crossTenant = await prisma.tenant.create({
      data: { name: 'E2E Offer Cross Tenant', code: CROSS_TENANT_CODE, status: 'ACTIVE' },
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

    adminUserId      = await mkUser(fixtureTenantId, ADMIN_EMAIL,      sysAdminRole.id,  'OfrAdmin');
    hrUserId         = await mkUser(fixtureTenantId, HR_EMAIL,         hrRole.id,        'OfrHR');
    recruiterUserId  = await mkUser(fixtureTenantId, RECRUITER_EMAIL,  recruiterRole.id, 'OfrRec');
    coUserId         = await mkUser(fixtureTenantId, CO_EMAIL,         coRole.id,        'OfrCO');
    hmUserId         = await mkUser(fixtureTenantId, HM_EMAIL,         hmRole.id,        'OfrHM');
    wpUserId         = await mkUser(fixtureTenantId, WP_EMAIL,         wpRole.id,        'OfrWP');
    execUserId       = await mkUser(fixtureTenantId, EXEC_EMAIL,       execRole.id,      'OfrExec');
    crossAdminUserId = await mkUser(crossTenantId,   CROSS_ADMIN_EMAIL, sysAdminRole.id, 'OfrXAdmin');

    // ---- Infrastructure ----
    const primaryDept = await prisma.department.create({
      data: { tenantId: fixtureTenantId, name: 'E2E Ofr Dept', code: `E2E-OD-${SUFFIX}`, status: 'ACTIVE' },
    });
    primaryDeptId = primaryDept.id;

    const crossDept = await prisma.department.create({
      data: { tenantId: crossTenantId, name: 'E2E Ofr Cross Dept', code: `E2E-OXD-${SUFFIX}`, status: 'ACTIVE' },
    });
    crossDeptId = crossDept.id;

    const primaryPos = await prisma.position.create({
      data: { tenantId: fixtureTenantId, departmentId: primaryDeptId, title: 'E2E Ofr Position', status: 'ACTIVE' },
    });
    primaryPositionId = primaryPos.id;

    const crossPos = await prisma.position.create({
      data: { tenantId: crossTenantId, departmentId: crossDeptId, title: 'E2E Ofr Cross Position', status: 'ACTIVE' },
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
        data: { tenantId, email, firstName: 'E2E', lastName: 'OfrCand', status: 'ACTIVE' },
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

    appCreateId            = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-create-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appNotOfferId          = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-notofr-${SUFFIX}@test.gov`), primaryVacancyId, 'APPLIED');
    appActiveExistsId      = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-active-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appListId              = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-list-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appUpdId               = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-upd-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appSubmitId            = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-sub-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appApproveId           = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-appr-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appSendId              = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-send-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appResponseAcceptId    = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-racc-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appResponseDeclineId   = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-rdec-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appWithdrawDraftId     = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-wdrf-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appWithdrawSentId      = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-wsnt-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appReofferDeclinedId   = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-rodec-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appReofferWithdrawnId  = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-rowdr-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appReofferAcceptedId   = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-roacc-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appDetailId            = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-det-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appAuditId             = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-aud-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appNoHireId            = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-nohire-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appRbacApproveId       = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-rbappr-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appRbacSendId          = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-rbsend-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');

    appUpdPendingId        = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-updp-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appSubmitNotDraftId    = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-subnd-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appApproveNotPendingId = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-apprnp-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appSendNotApprovedId   = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-sendna-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appResponseNotSentId   = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-respns-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appWithdrawRbacId      = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-wdrbac-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');
    appWithdrawAcceptedId  = await mkApp(fixtureTenantId, await mkCand(fixtureTenantId, `e2e-ofr-wdacc-${SUFFIX}@test.gov`), primaryVacancyId, 'OFFER');

    crossAppId = await mkApp(crossTenantId, await mkCand(crossTenantId, `e2e-ofr-xcand-${SUFFIX}@test.gov`), crossVacancyId, 'OFFER');

    // ---- Pre-created offers (Prisma-direct) ----
    const mkOffer = async (
      tenantId: string, applicationId: string, status: string, extra?: Record<string, unknown>,
    ): Promise<string> => {
      const o = await prisma.offer.create({
        data: {
          tenantId, applicationId, status,
          notes: 'Fixture offer notes',
          ...extra,
        },
      });
      return o.id;
    };

    ofrActiveExistsId      = await mkOffer(fixtureTenantId, appActiveExistsId, 'DRAFT');
    ofrListId              = await mkOffer(fixtureTenantId, appListId, 'DRAFT');
    ofrDetailId            = await mkOffer(fixtureTenantId, appDetailId, 'DRAFT');
    ofrCrossId             = await mkOffer(crossTenantId, crossAppId, 'DRAFT');
    ofrUpdDraftId          = await mkOffer(fixtureTenantId, appUpdId, 'DRAFT');
    ofrUpdPendingId        = await mkOffer(fixtureTenantId, appUpdPendingId, 'PENDING_APPROVAL');
    ofrSubmitDraftId       = await mkOffer(fixtureTenantId, appSubmitId, 'DRAFT');
    ofrSubmitNotDraftId    = await mkOffer(fixtureTenantId, appSubmitNotDraftId, 'PENDING_APPROVAL');
    ofrApprovePendingId    = await mkOffer(fixtureTenantId, appApproveId, 'PENDING_APPROVAL');
    ofrApproveNotPendingId = await mkOffer(fixtureTenantId, appApproveNotPendingId, 'DRAFT');
    ofrRbacApproveId       = await mkOffer(fixtureTenantId, appRbacApproveId, 'PENDING_APPROVAL');
    ofrSendApprovedId      = await mkOffer(fixtureTenantId, appSendId, 'APPROVED');
    ofrSendNotApprovedId   = await mkOffer(fixtureTenantId, appSendNotApprovedId, 'DRAFT');
    ofrRbacSendId          = await mkOffer(fixtureTenantId, appRbacSendId, 'APPROVED');
    ofrResponseAcceptId    = await mkOffer(fixtureTenantId, appResponseAcceptId, 'SENT');
    ofrResponseDeclineId   = await mkOffer(fixtureTenantId, appResponseDeclineId, 'SENT');
    ofrResponseNotSentId   = await mkOffer(fixtureTenantId, appResponseNotSentId, 'DRAFT');
    ofrWithdrawDraftId     = await mkOffer(fixtureTenantId, appWithdrawDraftId, 'DRAFT');
    ofrWithdrawSentId      = await mkOffer(fixtureTenantId, appWithdrawSentId, 'SENT');
    ofrWithdrawTerminalId  = await mkOffer(fixtureTenantId, appWithdrawAcceptedId, 'ACCEPTED');
    ofrWithdrawRbacId      = await mkOffer(fixtureTenantId, appWithdrawRbacId, 'DRAFT');
    ofrReofferDeclinedId   = await mkOffer(fixtureTenantId, appReofferDeclinedId, 'DECLINED');
    ofrReofferWithdrawnId  = await mkOffer(fixtureTenantId, appReofferWithdrawnId, 'WITHDRAWN');
    ofrReofferAcceptedId   = await mkOffer(fixtureTenantId, appReofferAcceptedId, 'ACCEPTED');
    ofrNoHireId            = await mkOffer(fixtureTenantId, appNoHireId, 'SENT');

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

      // Offers before applications (FK → application)
      if (tenantIds.length > 0) {
        await prisma.offer.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
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
  // Group 1: POST /api/v1/offers — create
  // --------------------------------------------------------------------------

  describe('POST /api/v1/offers', () => {
    it('System Administrator + valid body → 201 + status DRAFT; response excludes tenantId/deletedAt', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          applicationId: appCreateId,
          offerDate: '2026-08-01T00:00:00.000Z',
          notes: 'Standard government benefits package.',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        applicationId: appCreateId,
        status: 'DRAFT',
      });
      expect(res.body.data.id).toMatch(UUID_V4);
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');

      createdOfferId = res.body.data.id as string;
    });

    it('HR Director → 201 (write authorized — GD-M18-1 D16)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ applicationId: appAuditId });
      expect(res.status).toBe(201);
    });

    it('Recruiter on an application with an active offer → 409 ACTIVE_OFFER_EXISTS (confirms write access, not 403)', async () => {
      // appDetailId already has a DRAFT offer (ofrDetailId) created via Prisma fixture, which counts as
      // active — a 409 here (rather than 403) confirms Recruiter passed the RBAC gate (GD-M18-1 D16).
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${recruiterToken}`)
        .send({ applicationId: appDetailId });
      expect(res.status).toBe(409);
    });

    it('Compliance Officer → 403 (read-only role, create forbidden — GD-M18-1 D16)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${coToken}`)
        .send({ applicationId: appCreateId });
      expect(res.status).toBe(403);
    });

    it('Hiring Manager → 403 (denied all M18B offer endpoints — GD-M18-1 D16)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${hmToken}`)
        .send({ applicationId: appCreateId });
      expect(res.status).toBe(403);
    });

    it('Workforce Planner → 403 (denied all M18B offer endpoints)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${wpToken}`)
        .send({ applicationId: appCreateId });
      expect(res.status).toBe(403);
    });

    it('Executive User → 403 (denied all M18B offer endpoints)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${execToken}`)
        .send({ applicationId: appCreateId });
      expect(res.status).toBe(403);
    });

    it('application not found → 404 APPLICATION_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicationId: NON_EXISTENT_UUID });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_FOUND' } });
    });

    it('application not at OFFER status (APPLIED) → 422 APPLICATION_NOT_AT_OFFER_STATUS (GD-M18-1 D7)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicationId: appNotOfferId });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_AT_OFFER_STATUS' } });
    });

    it('active offer already exists for application → 409 ACTIVE_OFFER_EXISTS (GD-M18-1 D10)', async () => {
      expect(ofrActiveExistsId).toBeDefined();
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicationId: appActiveExistsId });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'ACTIVE_OFFER_EXISTS' } });
    });

    it('cross-tenant applicationId reference → 404 APPLICATION_NOT_FOUND (SEC-003 scoped lookup)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicationId: crossAppId });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_FOUND' } });
    });

    it('invalid offerDate format → 400 (class-validator IsISO8601)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicationId: appCreateId, offerDate: 'not-a-date' });

      expect(res.status).toBe(400);
    });

    it('tenantId in request body → 400 (ValidationPipe whitelist + forbidNonWhitelisted — SEC-003)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicationId: appCreateId, tenantId: NON_EXISTENT_UUID });
      expect(res.status).toBe(400);
    });

    it('status field in body → 400 (ValidationPipe whitelist rejects unknown fields — status is service-controlled)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicationId: appCreateId, status: 'SENT' });
      expect(res.status).toBe(400);
    });

    it('without Authorization → 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .send({ applicationId: appCreateId });
      expect(res.status).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // Group 2: GET /api/v1/offers — list
  // --------------------------------------------------------------------------

  describe('GET /api/v1/offers', () => {
    it('System Administrator → 200 + paginated envelope', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/offers')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('offers');
      expect(res.body.data).toHaveProperty('total');
      expect(res.body.data).toHaveProperty('page');
      expect(res.body.data).toHaveProperty('pageSize');
      expect(res.body.data).toHaveProperty('totalPages');
      expect(Array.isArray(res.body.data.offers)).toBe(true);
    });

    it('Compliance Officer → 200 (read-only role, list authorized — GD-M18-1 D16)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/offers')
        .set('Authorization', `Bearer ${coToken}`);
      expect(res.status).toBe(200);
    });

    it('Hiring Manager → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/offers')
        .set('Authorization', `Bearer ${hmToken}`);
      expect(res.status).toBe(403);
    });

    it('Workforce Planner → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/offers')
        .set('Authorization', `Bearer ${wpToken}`);
      expect(res.status).toBe(403);
    });

    it('Executive User → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/offers')
        .set('Authorization', `Bearer ${execToken}`);
      expect(res.status).toBe(403);
    });

    it('applicationId filter returns only offers for that application', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/offers?applicationId=${appListId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.offers.length).toBeGreaterThanOrEqual(1);
      for (const o of res.body.data.offers as { applicationId: string }[]) {
        expect(o.applicationId).toBe(appListId);
      }
    });

    it('status filter returns only offers with matching status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/offers?status=DRAFT')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.offers.length).toBeGreaterThan(0);
      for (const o of res.body.data.offers as { status: string }[]) {
        expect(o.status).toBe('DRAFT');
      }
    });

    it('pagination — pageSize=1 returns at most one record', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/offers?page=1&pageSize=1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.offers.length).toBeLessThanOrEqual(1);
      expect(res.body.data.pageSize).toBe(1);
    });

    it('list records do not expose tenantId or deletedAt (SEC-003)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/offers')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      for (const o of res.body.data.offers as Record<string, unknown>[]) {
        expect(o).not.toHaveProperty('tenantId');
        expect(o).not.toHaveProperty('deletedAt');
      }
    });

    it('cross-tenant offers are NOT visible in primary-tenant list (SEC-003)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/offers')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.offers as { id: string }[]).map((o) => o.id);
      expect(ids).not.toContain(ofrCrossId);
    });

    it('without Authorization → 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/offers');
      expect(res.status).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // Group 3: GET /api/v1/offers/:id — detail
  // --------------------------------------------------------------------------

  describe('GET /api/v1/offers/:id', () => {
    it('System Administrator → 200 + offer shape', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/offers/${ofrDetailId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(ofrDetailId);
      expect(res.body.data).toHaveProperty('applicationId');
      expect(res.body.data).toHaveProperty('status');
      expect(res.body.data).toHaveProperty('offerDate');
      expect(res.body.data).toHaveProperty('acceptedAt');
      expect(res.body.data).toHaveProperty('declinedAt');
      expect(res.body.data).toHaveProperty('notes');
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('Compliance Officer → 200 (read-only role, detail authorized — GD-M18-1 D16)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/offers/${ofrDetailId}`)
        .set('Authorization', `Bearer ${coToken}`);
      expect(res.status).toBe(200);
    });

    it('Hiring Manager → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/offers/${ofrDetailId}`)
        .set('Authorization', `Bearer ${hmToken}`);
      expect(res.status).toBe(403);
    });

    it('Workforce Planner → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/offers/${ofrDetailId}`)
        .set('Authorization', `Bearer ${wpToken}`);
      expect(res.status).toBe(403);
    });

    it('Executive User → 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/offers/${ofrDetailId}`)
        .set('Authorization', `Bearer ${execToken}`);
      expect(res.status).toBe(403);
    });

    it('non-existent offer → 404 OFFER_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/offers/${NON_EXISTENT_UUID}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_NOT_FOUND' } });
    });

    it('cross-tenant offer id → 404, not 403 (SEC-003: enumeration prevention)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/offers/${ofrCrossId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_NOT_FOUND' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 4: PUT /api/v1/offers/:id — update
  // --------------------------------------------------------------------------

  describe('PUT /api/v1/offers/:id', () => {
    it('System Administrator updates notes on DRAFT offer → 200 + updated data (excludes tenantId, deletedAt)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/offers/${ofrUpdDraftId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Updated offer notes.' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(ofrUpdDraftId);
      expect(res.body.data.notes).toBe('Updated offer notes.');
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('offer not in DRAFT (PENDING_APPROVAL) update → 422 OFFER_NOT_IN_DRAFT (GD-M18-1 D7)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/offers/${ofrUpdPendingId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Should not apply' });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_NOT_IN_DRAFT' } });
    });

    it('terminal offer (ACCEPTED) update → 422 OFFER_IN_TERMINAL_STATE', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/offers/${ofrReofferAcceptedId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Should not apply' });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_IN_TERMINAL_STATE' } });
    });

    it('Hiring Manager → 403', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/offers/${ofrUpdDraftId}`)
        .set('Authorization', `Bearer ${hmToken}`)
        .send({ notes: 'HM should not update' });
      expect(res.status).toBe(403);
    });

    it('Compliance Officer → 403 (read-only role, update forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/offers/${ofrUpdDraftId}`)
        .set('Authorization', `Bearer ${coToken}`)
        .send({ notes: 'CO should not update' });
      expect(res.status).toBe(403);
    });

    it('non-existent offer → 404 OFFER_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/offers/${NON_EXISTENT_UUID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'X' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_NOT_FOUND' } });
    });

    it('status field in body → 400 (ValidationPipe whitelist rejects unknown fields)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/offers/${ofrUpdDraftId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'SENT' });

      expect(res.status).toBe(400);
    });

    it('applicationId field in body → 400 (ValidationPipe whitelist — applicationId immutable)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/offers/${ofrUpdDraftId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicationId: NON_EXISTENT_UUID });

      expect(res.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // Group 5: POST /api/v1/offers/:id/submit
  // --------------------------------------------------------------------------

  describe('POST /api/v1/offers/:id/submit', () => {
    it('Hiring Manager → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrSubmitDraftId}/submit`)
        .set('Authorization', `Bearer ${hmToken}`);
      expect(res.status).toBe(403);
    });

    it('non-existent offer → 404 OFFER_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${NON_EXISTENT_UUID}/submit`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_NOT_FOUND' } });
    });

    it('offer not in DRAFT (PENDING_APPROVAL) submit → 422 OFFER_NOT_IN_DRAFT', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrSubmitNotDraftId}/submit`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_NOT_IN_DRAFT' } });
    });

    it('[STATE] System Administrator submits DRAFT offer → 200 + status PENDING_APPROVAL', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrSubmitDraftId}/submit`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(ofrSubmitDraftId);
      expect(res.body.data.status).toBe('PENDING_APPROVAL');
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('[STATE] submit an already-submitted offer → 422 OFFER_NOT_IN_DRAFT', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrSubmitDraftId}/submit`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_NOT_IN_DRAFT' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 6: POST /api/v1/offers/:id/approve
  // --------------------------------------------------------------------------

  describe('POST /api/v1/offers/:id/approve', () => {
    it('Recruiter → 403 (approval restricted to SA/HRD — GD-M18-1 D16)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrRbacApproveId}/approve`)
        .set('Authorization', `Bearer ${recruiterToken}`);
      expect(res.status).toBe(403);
    });

    it('Hiring Manager → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrApprovePendingId}/approve`)
        .set('Authorization', `Bearer ${hmToken}`);
      expect(res.status).toBe(403);
    });

    it('Compliance Officer → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrApprovePendingId}/approve`)
        .set('Authorization', `Bearer ${coToken}`);
      expect(res.status).toBe(403);
    });

    it('non-existent offer → 404 OFFER_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${NON_EXISTENT_UUID}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_NOT_FOUND' } });
    });

    it('offer not in PENDING_APPROVAL (DRAFT) approve → 422 OFFER_NOT_PENDING_APPROVAL', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrApproveNotPendingId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_NOT_PENDING_APPROVAL' } });
    });

    it('[STATE] HR Director approves PENDING_APPROVAL offer → 200 + status APPROVED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrApprovePendingId}/approve`)
        .set('Authorization', `Bearer ${hrToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(ofrApprovePendingId);
      expect(res.body.data.status).toBe('APPROVED');
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('[STATE] approve an already-approved offer → 422 OFFER_NOT_PENDING_APPROVAL', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrApprovePendingId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_NOT_PENDING_APPROVAL' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 7: POST /api/v1/offers/:id/send
  // --------------------------------------------------------------------------

  describe('POST /api/v1/offers/:id/send', () => {
    it('Recruiter → 403 (sending restricted to SA/HRD — GD-M18-1 D16)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrRbacSendId}/send`)
        .set('Authorization', `Bearer ${recruiterToken}`);
      expect(res.status).toBe(403);
    });

    it('Hiring Manager → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrSendApprovedId}/send`)
        .set('Authorization', `Bearer ${hmToken}`);
      expect(res.status).toBe(403);
    });

    it('non-existent offer → 404 OFFER_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${NON_EXISTENT_UUID}/send`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_NOT_FOUND' } });
    });

    it('offer not in APPROVED (DRAFT) send → 422 OFFER_NOT_APPROVED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrSendNotApprovedId}/send`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_NOT_APPROVED' } });
    });

    it('[STATE] HR Director sends APPROVED offer → 200 + status SENT', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrSendApprovedId}/send`)
        .set('Authorization', `Bearer ${hrToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(ofrSendApprovedId);
      expect(res.body.data.status).toBe('SENT');
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('[STATE] send an already-sent offer → 422 OFFER_NOT_APPROVED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrSendApprovedId}/send`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_NOT_APPROVED' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 8: POST /api/v1/offers/:id/record-response
  // --------------------------------------------------------------------------

  describe('POST /api/v1/offers/:id/record-response', () => {
    it('Hiring Manager → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrResponseAcceptId}/record-response`)
        .set('Authorization', `Bearer ${hmToken}`)
        .send({ response: 'ACCEPTED' });
      expect(res.status).toBe(403);
    });

    it('Compliance Officer → 403 (read-only role)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrResponseAcceptId}/record-response`)
        .set('Authorization', `Bearer ${coToken}`)
        .send({ response: 'ACCEPTED' });
      expect(res.status).toBe(403);
    });

    it('non-existent offer → 404 OFFER_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${NON_EXISTENT_UUID}/record-response`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ response: 'ACCEPTED' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_NOT_FOUND' } });
    });

    it('offer not in SENT (DRAFT) record-response → 422 OFFER_NOT_SENT', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrResponseNotSentId}/record-response`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ response: 'ACCEPTED' });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_NOT_SENT' } });
    });

    it('invalid response value → 400 (class-validator IsIn)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrResponseAcceptId}/record-response`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ response: 'MAYBE' });

      expect(res.status).toBe(400);
    });

    it('[STATE] record ACCEPTED on SENT offer → 200 + status ACCEPTED + acceptedAt set', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrResponseAcceptId}/record-response`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ response: 'ACCEPTED' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(ofrResponseAcceptId);
      expect(res.body.data.status).toBe('ACCEPTED');
      expect(res.body.data.acceptedAt).not.toBeNull();
      expect(res.body.data.declinedAt).toBeNull();
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('[STATE] record-response on already-ACCEPTED offer → 422 OFFER_IN_TERMINAL_STATE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrResponseAcceptId}/record-response`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ response: 'DECLINED' });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_IN_TERMINAL_STATE' } });
    });

    it('[STATE] record DECLINED on SENT offer → 200 + status DECLINED + declinedAt set', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrResponseDeclineId}/record-response`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ response: 'DECLINED' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(ofrResponseDeclineId);
      expect(res.body.data.status).toBe('DECLINED');
      expect(res.body.data.declinedAt).not.toBeNull();
      expect(res.body.data.acceptedAt).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Group 9: POST /api/v1/offers/:id/withdraw
  // --------------------------------------------------------------------------

  describe('POST /api/v1/offers/:id/withdraw', () => {
    it('Hiring Manager → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrWithdrawRbacId}/withdraw`)
        .set('Authorization', `Bearer ${hmToken}`);
      expect(res.status).toBe(403);
    });

    it('non-existent offer → 404 OFFER_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${NON_EXISTENT_UUID}/withdraw`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_NOT_FOUND' } });
    });

    it('terminal offer (already ACCEPTED) withdraw → 422 OFFER_IN_TERMINAL_STATE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrWithdrawTerminalId}/withdraw`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_IN_TERMINAL_STATE' } });
    });

    it('[STATE] System Administrator withdraws DRAFT offer → 200 + status WITHDRAWN', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrWithdrawDraftId}/withdraw`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(ofrWithdrawDraftId);
      expect(res.body.data.status).toBe('WITHDRAWN');
      expect(res.body.data).not.toHaveProperty('tenantId');
      expect(res.body.data).not.toHaveProperty('deletedAt');
    });

    it('[STATE] withdraw an already-withdrawn offer → 422 OFFER_IN_TERMINAL_STATE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrWithdrawDraftId}/withdraw`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_IN_TERMINAL_STATE' } });
    });

    it('[STATE] Recruiter withdraws SENT offer → 200 + status WITHDRAWN (write authorized — GD-M18-1 D16)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrWithdrawSentId}/withdraw`)
        .set('Authorization', `Bearer ${recruiterToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('WITHDRAWN');
    });
  });

  // --------------------------------------------------------------------------
  // Group 10: Re-offer behavior (GD-M18-1 D6, D10)
  // --------------------------------------------------------------------------

  describe('Re-offer behavior (GD-M18-1 D6, D10)', () => {
    it('re-offer blocked while an active (non-terminal) offer exists → 409 ACTIVE_OFFER_EXISTS', async () => {
      expect(ofrActiveExistsId).toBeDefined();
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicationId: appActiveExistsId });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'ACTIVE_OFFER_EXISTS' } });
    });

    it('[STATE] re-offer succeeds after prior offer is DECLINED', async () => {
      expect(ofrReofferDeclinedId).toBeDefined();
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicationId: appReofferDeclinedId });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('DRAFT');
      expect(res.body.data.applicationId).toBe(appReofferDeclinedId);
    });

    it('[STATE] re-offer succeeds after prior offer is WITHDRAWN', async () => {
      expect(ofrReofferWithdrawnId).toBeDefined();
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicationId: appReofferWithdrawnId });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('DRAFT');
      expect(res.body.data.applicationId).toBe(appReofferWithdrawnId);
    });

    it('re-offer is still blocked after prior offer is ACCEPTED (GD-M18-1 D10 — ACCEPTED excluded from re-offer exclusion list)', async () => {
      expect(ofrReofferAcceptedId).toBeDefined();
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicationId: appReofferAcceptedId });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'ACTIVE_OFFER_EXISTS' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 11: No-hire invariant (GD-M18-1 D3, D9)
  // --------------------------------------------------------------------------

  describe('No-hire invariant (GD-M18-1 D3, D9)', () => {
    it('[STATE] offer acceptance keeps application.status = OFFER (no auto-transition to HIRED)', async () => {
      expect(ofrNoHireId).toBeDefined();

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
      expect(appRes.body.data.status).toBe('OFFER');

      const employeeCountAfter = await prisma.employee.count({ where: { tenantId: fixtureTenantId } });
      expect(employeeCountAfter).toBe(employeeCountBefore);
    });

    it('no employee record references the no-hire-invariant application or candidate', async () => {
      const app = await prisma.application.findUniqueOrThrow({ where: { id: appNoHireId } });
      expect(app.status).toBe('OFFER');

      const employees = await prisma.employee.findMany({ where: { tenantId: fixtureTenantId } });
      expect(employees.length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Group 12: Tenant isolation (SEC-003)
  // --------------------------------------------------------------------------

  describe('Tenant isolation (SEC-003)', () => {
    it('tenant A offer list is NOT visible to tenant B authorized user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/offers')
        .set('Authorization', `Bearer ${crossAdminToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.offers as { id: string }[]).map((o) => o.id);
      expect(ids).not.toContain(ofrDetailId);
      expect(ids).not.toContain(ofrListId);
    });

    it('tenant A offer detail → 404 for tenant B authorized user (enumeration prevention)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/offers/${ofrDetailId}`)
        .set('Authorization', `Bearer ${crossAdminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_NOT_FOUND' } });
    });

    it('tenant B update attempt on tenant A offer → 404', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/offers/${ofrDetailId}`)
        .set('Authorization', `Bearer ${crossAdminToken}`)
        .send({ notes: 'cross-tenant update attempt' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_NOT_FOUND' } });
    });

    it('tenant B submit attempt on tenant A offer → 404', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offers/${ofrDetailId}/submit`)
        .set('Authorization', `Bearer ${crossAdminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'OFFER_NOT_FOUND' } });
    });

    it('cross-tenant application reference on create → 404 APPLICATION_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${crossAdminToken}`)
        .send({ applicationId: appDetailId });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPLICATION_NOT_FOUND' } });
    });

    it('no tenantId appears anywhere in an offer detail response', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/offers/${ofrDetailId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body.data)).not.toContain('tenantId');
    });
  });

  // --------------------------------------------------------------------------
  // Group 13: Audit events (GD-M18-1 D17)
  // --------------------------------------------------------------------------

  describe('Audit events (GD-M18-1 D17)', () => {
    it('RECRUITING_OFFER_CREATED written after POST /offers', async () => {
      expect(createdOfferId).toBeDefined();
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: createdOfferId, action: 'RECRUITING_OFFER_CREATED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('OFFER');
    });

    it('RECRUITING_OFFER_CREATED metadata is PII-safe — excludes notes text and offerDate value', async () => {
      expect(createdOfferId).toBeDefined();
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: createdOfferId, action: 'RECRUITING_OFFER_CREATED' },
      });

      expect(record).not.toBeNull();
      const metaStr = JSON.stringify(record!.metadata);
      expect(metaStr).not.toContain('Standard government benefits package');
      expect(metaStr).not.toContain('2026-08-01');
    });

    it('RECRUITING_OFFER_UPDATED written after PUT /offers/:id', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: ofrUpdDraftId, action: 'RECRUITING_OFFER_UPDATED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('OFFER');
    });

    it('RECRUITING_OFFER_UPDATED metadata is PII-safe — field names only, no notes text value', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: ofrUpdDraftId, action: 'RECRUITING_OFFER_UPDATED' },
      });

      expect(record).not.toBeNull();
      const metaStr = JSON.stringify(record!.metadata);
      expect(metaStr).not.toContain('Updated offer notes.');
    });

    it('RECRUITING_OFFER_SUBMITTED written after POST /offers/:id/submit — contains previousStatus', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: ofrSubmitDraftId, action: 'RECRUITING_OFFER_SUBMITTED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('OFFER');
      expect(record!.metadata).toMatchObject({ previousStatus: 'DRAFT' });
    });

    it('RECRUITING_OFFER_APPROVED written after POST /offers/:id/approve — contains previousStatus', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: ofrApprovePendingId, action: 'RECRUITING_OFFER_APPROVED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('OFFER');
      expect(record!.metadata).toMatchObject({ previousStatus: 'PENDING_APPROVAL' });
    });

    it('RECRUITING_OFFER_SENT written after POST /offers/:id/send — contains previousStatus', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: ofrSendApprovedId, action: 'RECRUITING_OFFER_SENT' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('OFFER');
      expect(record!.metadata).toMatchObject({ previousStatus: 'APPROVED' });
    });

    it('RECRUITING_OFFER_ACCEPTED written after POST /offers/:id/record-response (ACCEPTED)', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: ofrResponseAcceptId, action: 'RECRUITING_OFFER_ACCEPTED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('OFFER');
      expect(record!.metadata).toMatchObject({ previousStatus: 'SENT' });
    });

    it('RECRUITING_OFFER_DECLINED written after POST /offers/:id/record-response (DECLINED)', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: ofrResponseDeclineId, action: 'RECRUITING_OFFER_DECLINED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('OFFER');
      expect(record!.metadata).toMatchObject({ previousStatus: 'SENT' });
    });

    it('RECRUITING_OFFER_WITHDRAWN written after POST /offers/:id/withdraw — contains previousStatus', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: ofrWithdrawDraftId, action: 'RECRUITING_OFFER_WITHDRAWN' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('OFFER');
      expect(record!.metadata).toMatchObject({ previousStatus: 'DRAFT' });
    });

    it('no audit metadata for any offer event in this tenant contains free-text notes content', async () => {
      const records = await prisma.auditEvent.findMany({
        where: { tenantId: fixtureTenantId, entityType: 'OFFER' },
      });

      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        const metaStr = JSON.stringify(record.metadata);
        expect(metaStr).not.toContain('Fixture offer notes');
        expect(metaStr).not.toContain('Updated offer notes.');
      }
    });
  });
});
