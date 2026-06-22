// Reference: spec/01_requirements.md — FR-153 Certification Expiration Tracking
// Reference: governance/GD-M14-1.md — Decisions 3–5 (namespace; endpoint; RBAC)
// Reference: directives/15_certification_management_rules.md — CRT-400 (expiration tracking)
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
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
// Fixture layout (Tenant A / Tenant B):
//
//   Tenant A — primary test tenant (all actor tokens are on Tenant A)
//     Employee A1 (ACTIVE):
//       certA1  ACTIVE   expirationDate = day+15   (inside default 30-day window; has issueDate)
//       certA2  ACTIVE   expirationDate = day+45   (outside window — absent)
//       certA3  ACTIVE   expirationDate = day-5    (past-due ACTIVE — CRT-400 — appears)
//       certA4  EXPIRED  expirationDate = day+10   (status != ACTIVE — absent)
//       certA5  REVOKED  expirationDate = day+10   (status != ACTIVE — absent)
//       certA6  ACTIVE   expirationDate = null      (null expirationDate — absent)
//       certA8  ACTIVE   expirationDate = day+3    (withinDays=7 variation positive case)
//     Employee A2 (ACTIVE):
//       certA7  ACTIVE   expirationDate = day+5    (pagination / withinDays=30 count)
//
//   Tenant B — isolation test + empty-result test
//     Employee B1 (ACTIVE):
//       certB1  ACTIVE   expirationDate = day+10   (Tenant B — absent from Tenant A query)
//     crossTenantAdmin (SA, Tenant B) — used for LEC-E-8 empty-result test
//       withinDays=2: certB1 at day+10 > today+2 → empty response
//
// Date computation: daysFromNow(n) uses setDate(getDate() + n) matching the service
// convention (avoids DST ms-arithmetic skew on @db.Date calendar-day fields).
// NOW is captured at module load — stable across beforeAll + all test groups.
//
// Cleanup order respects FK constraints:
//   employeeCertification (junction) → before employees + certifications
//   employees                         → before departments
//   certifications                    → before tenants
//   departments                       → before tenants
//   auditEvents                       → before users  (login writes audit rows)
//   userRoles + users                 → before tenants
//   tenants                           → last

import 'reflect-metadata';
import request from 'supertest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RequestMethod, ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

import { AppModule } from '../src/app.module';

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

const NOW = new Date();

const daysFromNow = (n: number): Date => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + n);
  return d;
};

// Fixture expiration dates — computed once, stable across all test groups
const EXP_INSIDE_WINDOW  = daysFromNow(15);   // within 30-day window — appears
const EXP_OUTSIDE_WINDOW = daysFromNow(45);   // outside 30-day window — absent
const EXP_PAST_DUE       = daysFromNow(-5);   // past-due ACTIVE (CRT-400) — appears
const EXP_WRONG_STATUS   = daysFromNow(10);   // future date; used by EXPIRED + REVOKED certs
const EXP_CROSS_TENANT   = daysFromNow(10);   // Tenant B cert — within 30-day window for Tenant B
const EXP_PAGINATION     = daysFromNow(5);    // within window; drives pagination count (empA2)
const EXP_DAY3           = daysFromNow(3);    // within 7-day window; positive case for LEC-E-19
// null expirationDate — literal null used inline in mkEC call

// Fixed past issueDate — stored once on certA1 to validate YYYY-MM-DD serialization (LEC-E-17)
const FIXED_ISSUE_DATE = new Date('2025-03-15T00:00:00.000Z');

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const FIXTURE_PASSWORD          = 'E2eTest1234!';
const SUFFIX                    = Date.now();
const FIXTURE_TENANT_CODE       = `E2E-EC-${SUFFIX}`;
const CROSS_TENANT_CODE         = `E2E-EC-X-${SUFFIX}`;

const ADMIN_EMAIL               = `e2e-ec-admin-${SUFFIX}@test.gov`;
const HR_EMAIL                  = `e2e-ec-hr-${SUFFIX}@test.gov`;
const WP_EMAIL                  = `e2e-ec-wp-${SUFFIX}@test.gov`;
const CO_EMAIL                  = `e2e-ec-co-${SUFFIX}@test.gov`;
const RECRUITER_EMAIL           = `e2e-ec-recruiter-${SUFFIX}@test.gov`;
const EXEC_EMAIL                = `e2e-ec-exec-${SUFFIX}@test.gov`;
const CROSS_TENANT_ADMIN_EMAIL  = `e2e-ec-xadmin-${SUFFIX}@test.gov`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmployeeCertifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  // JWT tokens — Tenant A actors
  let adminToken: string;
  let hrToken: string;
  let wpToken: string;
  let coToken: string;
  let recruiterToken: string;
  let execToken: string;
  // JWT — Tenant B actor (empty-result test LEC-E-8)
  let crossTenantAdminToken: string;

  // IDs for afterAll cleanup
  let tenantAId: string;
  let tenantBId: string;

  let adminUserId: string;
  let hrUserId: string;
  let wpUserId: string;
  let coUserId: string;
  let recruiterUserId: string;
  let execUserId: string;
  let crossTenantAdminUserId: string;

  let deptAId: string;
  let deptBId: string;

  let empA1Id: string;   // Tenant A ACTIVE — most filter-case assignments
  let empA2Id: string;   // Tenant A ACTIVE — pagination
  let empB1Id: string;   // Tenant B ACTIVE — cross-tenant isolation

  // Certification IDs — needed in assertions
  let certA1Id: string;  // ACTIVE, day+15, with issueDate
  let certA2Id: string;  // ACTIVE, day+45 (outside window)
  let certA3Id: string;  // ACTIVE, past-due day-5
  let certA4Id: string;  // EXPIRED status
  let certA5Id: string;  // REVOKED status
  let certA6Id: string;  // ACTIVE, null expirationDate
  let certA7Id: string;  // ACTIVE, day+5 (empA2, pagination)
  let certA8Id: string;  // ACTIVE, day+3 (withinDays=7 variation)

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
    const tenantA = await prisma.tenant.create({
      data: { name: 'E2E EmployeeCert Tenant A', code: FIXTURE_TENANT_CODE, status: 'ACTIVE' },
    });
    tenantAId = tenantA.id;

    const tenantB = await prisma.tenant.create({
      data: { name: 'E2E EmployeeCert Tenant B', code: CROSS_TENANT_CODE, status: 'ACTIVE' },
    });
    tenantBId = tenantB.id;

    // ---- Roles (must exist from seed) ----
    const sysAdminRole  = await prisma.role.findUniqueOrThrow({ where: { name: 'System Administrator' } });
    const hrRole        = await prisma.role.findUniqueOrThrow({ where: { name: 'HR Director' } });
    const wpRole        = await prisma.role.findUniqueOrThrow({ where: { name: 'Workforce Planner' } });
    const coRole        = await prisma.role.findUniqueOrThrow({ where: { name: 'Compliance Officer' } });
    const recruiterRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Recruiter' } });
    const execRole      = await prisma.role.findUniqueOrThrow({ where: { name: 'Executive User' } });

    // ---- Users ----
    const mkUser = async (tenantId: string, email: string, roleId: string): Promise<string> => {
      const u = await prisma.user.create({
        data: {
          tenantId, email, passwordHash,
          firstName: 'E2E', lastName: 'ECert', status: 'ACTIVE', failedLoginAttempts: 0,
        },
      });
      await prisma.userRole.create({ data: { userId: u.id, roleId } });
      return u.id;
    };

    adminUserId            = await mkUser(tenantAId, ADMIN_EMAIL,            sysAdminRole.id);
    hrUserId               = await mkUser(tenantAId, HR_EMAIL,               hrRole.id);
    wpUserId               = await mkUser(tenantAId, WP_EMAIL,               wpRole.id);
    coUserId               = await mkUser(tenantAId, CO_EMAIL,               coRole.id);
    recruiterUserId        = await mkUser(tenantAId, RECRUITER_EMAIL,        recruiterRole.id);
    execUserId             = await mkUser(tenantAId, EXEC_EMAIL,             execRole.id);
    crossTenantAdminUserId = await mkUser(tenantBId, CROSS_TENANT_ADMIN_EMAIL, sysAdminRole.id);

    // ---- Departments ----
    const deptA = await prisma.department.create({
      data: { tenantId: tenantAId, name: 'E2E EC Dept A', code: `E2E-ECA-${SUFFIX}`, status: 'ACTIVE' },
    });
    deptAId = deptA.id;

    const deptB = await prisma.department.create({
      data: { tenantId: tenantBId, name: 'E2E EC Dept B', code: `E2E-ECB-${SUFFIX}`, status: 'ACTIVE' },
    });
    deptBId = deptB.id;

    // ---- Employees ----
    const mkEmp = async (tenantId: string, deptId: string, empNum: string): Promise<string> => {
      const e = await prisma.employee.create({
        data: {
          tenantId, departmentId: deptId, employeeNumber: empNum,
          firstName: 'E2E', lastName: 'ECert', employmentStatus: 'ACTIVE',
        },
      });
      return e.id;
    };

    empA1Id = await mkEmp(tenantAId, deptAId, `EC-${SUFFIX}-A1`);
    empA2Id = await mkEmp(tenantAId, deptAId, `EC-${SUFFIX}-A2`);
    empB1Id = await mkEmp(tenantBId, deptBId, `EC-${SUFFIX}-B1`);

    // ---- Certifications ----
    const mkCert = async (tenantId: string, name: string): Promise<string> => {
      const c = await prisma.certification.create({
        data: { tenantId, name, expirationRequired: false },
      });
      return c.id;
    };

    // Tenant A catalog
    certA1Id = await mkCert(tenantAId, `EC-E2E-inside-${SUFFIX}`);      // inside window, has issueDate
    certA2Id = await mkCert(tenantAId, `EC-E2E-outside-${SUFFIX}`);     // outside window
    certA3Id = await mkCert(tenantAId, `EC-E2E-pastdue-${SUFFIX}`);     // past-due ACTIVE
    certA4Id = await mkCert(tenantAId, `EC-E2E-exp-status-${SUFFIX}`);  // EXPIRED status
    certA5Id = await mkCert(tenantAId, `EC-E2E-rev-status-${SUFFIX}`);  // REVOKED status
    certA6Id = await mkCert(tenantAId, `EC-E2E-null-exp-${SUFFIX}`);    // null expirationDate
    certA7Id = await mkCert(tenantAId, `EC-E2E-page-${SUFFIX}`);        // pagination (empA2, day+5)
    certA8Id = await mkCert(tenantAId, `EC-E2E-day3-${SUFFIX}`);        // withinDays=7 variation (day+3)

    // Tenant B catalog
    const certB1Id = await mkCert(tenantBId, `EC-E2E-cross-${SUFFIX}`); // cross-tenant + LEC-E-8

    // ---- EmployeeCertification assignments (Prisma-direct) ----
    const mkEC = async (
      employeeId: string,
      certificationId: string,
      status: string,
      expirationDate: Date | null,
      issueDate: Date | null = null,
    ): Promise<void> => {
      await prisma.employeeCertification.create({
        data: { employeeId, certificationId, status, expirationDate, issueDate },
      });
    };

    // Employee A1 — all single-filter scenarios
    await mkEC(empA1Id, certA1Id, 'ACTIVE',   EXP_INSIDE_WINDOW,  FIXED_ISSUE_DATE);
    await mkEC(empA1Id, certA2Id, 'ACTIVE',   EXP_OUTSIDE_WINDOW);
    await mkEC(empA1Id, certA3Id, 'ACTIVE',   EXP_PAST_DUE);
    await mkEC(empA1Id, certA4Id, 'EXPIRED',  EXP_WRONG_STATUS);
    await mkEC(empA1Id, certA5Id, 'REVOKED',  EXP_WRONG_STATUS);
    await mkEC(empA1Id, certA6Id, 'ACTIVE',   null);
    await mkEC(empA1Id, certA8Id, 'ACTIVE',   EXP_DAY3);

    // Employee A2 — pagination second record (different employee to vary the result set)
    await mkEC(empA2Id, certA7Id, 'ACTIVE',   EXP_PAGINATION);

    // Employee B1 — cross-tenant isolation (LEC-E-15) and empty-result (LEC-E-8)
    await mkEC(empB1Id, certB1Id, 'ACTIVE',   EXP_CROSS_TENANT);

    // ---- Authenticate all fixture users ----
    const login = async (email: string): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: FIXTURE_PASSWORD });
      return res.body.data.accessToken as string;
    };

    adminToken            = await login(ADMIN_EMAIL);
    hrToken               = await login(HR_EMAIL);
    wpToken               = await login(WP_EMAIL);
    coToken               = await login(CO_EMAIL);
    recruiterToken        = await login(RECRUITER_EMAIL);
    execToken             = await login(EXEC_EMAIL);
    crossTenantAdminToken = await login(CROSS_TENANT_ADMIN_EMAIL);
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      const tenantIds   = [tenantAId, tenantBId].filter(Boolean);
      const allEmpIds   = [empA1Id, empA2Id, empB1Id].filter(Boolean);
      const allActorIds = [adminUserId, hrUserId, wpUserId, coUserId, recruiterUserId, execUserId, crossTenantAdminUserId].filter(Boolean);

      // EmployeeCertification junction rows — before employees + certifications (FK cascade)
      if (allEmpIds.length > 0) {
        await prisma.employeeCertification.deleteMany({
          where: { employeeId: { in: allEmpIds } },
        }).catch(() => {});
      }

      // Employees — before departments
      if (tenantIds.length > 0) {
        await prisma.employee.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
      }

      // Certifications — before tenants
      if (tenantIds.length > 0) {
        await prisma.certification.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
      }

      // Departments — before tenants
      for (const deptId of [deptAId, deptBId].filter(Boolean)) {
        await prisma.department.delete({ where: { id: deptId } }).catch(() => {});
      }

      // Audit events (login creates rows) — before users
      if (allActorIds.length > 0) {
        await prisma.auditEvent.deleteMany({ where: { userId: { in: allActorIds } } }).catch(() => {});
      }

      // UserRoles + Users
      for (const userId of allActorIds) {
        await prisma.userRole.deleteMany({ where: { userId } }).catch(() => {});
        await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      }

      // Tenants — last
      if (tenantAId) await prisma.tenant.delete({ where: { id: tenantAId } }).catch(() => {});
      if (tenantBId) await prisma.tenant.delete({ where: { id: tenantBId } }).catch(() => {});

      await prisma.$disconnect();
    }
    await app?.close();
  }, 30_000);

  // --------------------------------------------------------------------------
  // Group 1 — Authentication gate
  // --------------------------------------------------------------------------

  describe('GET /api/v1/employee-certifications/expiring — auth gate', () => {
    it('LEC-E-1: no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employee-certifications/expiring');

      expect(res.status).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // Group 2 — RBAC: denied roles (GD-M14-1 D5; RBAC-952)
  // --------------------------------------------------------------------------

  describe('GET /api/v1/employee-certifications/expiring — RBAC denied', () => {
    it('LEC-E-2: Recruiter JWT → HTTP 403 (RBAC-952)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employee-certifications/expiring')
        .set('Authorization', `Bearer ${recruiterToken}`);

      expect(res.status).toBe(403);
    });

    it('LEC-E-3: Executive User JWT → HTTP 403 (RBAC-952)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employee-certifications/expiring')
        .set('Authorization', `Bearer ${execToken}`);

      expect(res.status).toBe(403);
    });
  });

  // --------------------------------------------------------------------------
  // Group 3 — RBAC: authorized roles (GD-M14-1 D5)
  // --------------------------------------------------------------------------

  describe('GET /api/v1/employee-certifications/expiring — RBAC authorized', () => {
    it('LEC-E-4: System Administrator JWT → HTTP 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employee-certifications/expiring')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('LEC-E-5: HR Director JWT → HTTP 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employee-certifications/expiring')
        .set('Authorization', `Bearer ${hrToken}`);

      expect(res.status).toBe(200);
    });

    it('LEC-E-6: Workforce Planner JWT → HTTP 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employee-certifications/expiring')
        .set('Authorization', `Bearer ${wpToken}`);

      expect(res.status).toBe(200);
    });

    it('LEC-E-7: Compliance Officer JWT → HTTP 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employee-certifications/expiring')
        .set('Authorization', `Bearer ${coToken}`);

      expect(res.status).toBe(200);
    });
  });

  // --------------------------------------------------------------------------
  // Group 4 — Empty result
  // --------------------------------------------------------------------------

  describe('GET /api/v1/employee-certifications/expiring — empty result', () => {
    it('LEC-E-8: Tenant B with withinDays=2; only cert at day+10 → HTTP 200 + empty array', async () => {
      // Tenant B has CERT_B1 at EXP_CROSS_TENANT = day+10.
      // cutoff = today + 2. day+10 > today+2 → outside window.
      // No past-due Tenant B certs exist → total = 0.
      const res = await request(app.getHttpServer())
        .get('/api/v1/employee-certifications/expiring')
        .query({ withinDays: 2 })
        .set('Authorization', `Bearer ${crossTenantAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.expiringCertifications).toEqual([]);
      expect(res.body.data.total).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Group 5 — Business logic filtering (default withinDays=30, Tenant A)
  //
  // Matching records under withinDays=30 from Tenant A:
  //   certA3 (day-5, past-due)   ← ordered 1st (ASC by expirationDate)
  //   certA8 (day+3)             ← ordered 2nd
  //   certA7 (day+5)             ← ordered 3rd (on empA2)
  //   certA1 (day+15)            ← ordered 4th
  // Total: 4 records
  // --------------------------------------------------------------------------

  describe('GET /api/v1/employee-certifications/expiring — business logic filtering', () => {
    const ENDPOINT = '/api/v1/employee-certifications/expiring';

    it('LEC-E-9: ACTIVE cert expiring within 30-day window appears in results', async () => {
      const res = await request(app.getHttpServer())
        .get(ENDPOINT)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const items = res.body.data.expiringCertifications as Array<Record<string, unknown>>;
      expect(items.some(i => i['certificationId'] === certA1Id)).toBe(true);
    });

    it('LEC-E-10: ACTIVE cert expiring outside 30-day window is absent', async () => {
      const res = await request(app.getHttpServer())
        .get(ENDPOINT)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const items = res.body.data.expiringCertifications as Array<Record<string, unknown>>;
      expect(items.some(i => i['certificationId'] === certA2Id)).toBe(false);
    });

    it('LEC-E-11: Past-due ACTIVE cert appears in results (CRT-400 — past-due is compliance risk)', async () => {
      const res = await request(app.getHttpServer())
        .get(ENDPOINT)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const items = res.body.data.expiringCertifications as Array<Record<string, unknown>>;
      expect(items.some(i => i['certificationId'] === certA3Id)).toBe(true);
    });

    it('LEC-E-12: EXPIRED status cert is absent (query filters status = ACTIVE only)', async () => {
      const res = await request(app.getHttpServer())
        .get(ENDPOINT)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const items = res.body.data.expiringCertifications as Array<Record<string, unknown>>;
      expect(items.some(i => i['certificationId'] === certA4Id)).toBe(false);
    });

    it('LEC-E-13: REVOKED status cert is absent (query filters status = ACTIVE only)', async () => {
      const res = await request(app.getHttpServer())
        .get(ENDPOINT)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const items = res.body.data.expiringCertifications as Array<Record<string, unknown>>;
      expect(items.some(i => i['certificationId'] === certA5Id)).toBe(false);
    });

    it('LEC-E-14: ACTIVE cert with null expirationDate is absent (expirationDate IS NOT NULL required)', async () => {
      const res = await request(app.getHttpServer())
        .get(ENDPOINT)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const items = res.body.data.expiringCertifications as Array<Record<string, unknown>>;
      expect(items.some(i => i['certificationId'] === certA6Id)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Group 6 — Tenant isolation (SEC-003; GD-M14-1 D4)
  // --------------------------------------------------------------------------

  describe('GET /api/v1/employee-certifications/expiring — tenant isolation', () => {
    it('LEC-E-15: Tenant B employee-certification absent from Tenant A query results (SEC-003)', async () => {
      // EMP_CROSS_TENANT = day+10 is within the default 30-day window, so it WOULD
      // appear if tenant isolation were broken. Verify it does not.
      const res = await request(app.getHttpServer())
        .get('/api/v1/employee-certifications/expiring')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const items = res.body.data.expiringCertifications as Array<Record<string, unknown>>;
      expect(items.some(i => i['employeeId'] === empB1Id)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Group 7 — Response shape and date serialization
  // --------------------------------------------------------------------------

  describe('GET /api/v1/employee-certifications/expiring — response shape and serialization', () => {
    let items: Array<Record<string, unknown>>;
    let data: Record<string, unknown>;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employee-certifications/expiring')
        .set('Authorization', `Bearer ${adminToken}`);
      data  = res.body.data as Record<string, unknown>;
      items = data['expiringCertifications'] as Array<Record<string, unknown>>;
    });

    it('LEC-E-16: Response has success, data.expiringCertifications, total, page, pageSize, totalPages', () => {
      expect(data['expiringCertifications']).toBeDefined();
      expect(Array.isArray(data['expiringCertifications'])).toBe(true);
      expect(typeof data['total']).toBe('number');
      expect(typeof data['page']).toBe('number');
      expect(typeof data['pageSize']).toBe('number');
      expect(typeof data['totalPages']).toBe('number');
    });

    it('LEC-E-17: issueDate serializes as YYYY-MM-DD when present; null when absent', () => {
      // certA1 has FIXED_ISSUE_DATE = 2025-03-15; certA3 (past-due) has no issueDate
      const withIssue    = items.find(i => i['certificationId'] === certA1Id);
      const withoutIssue = items.find(i => i['certificationId'] === certA3Id);

      expect(withIssue).toBeDefined();
      expect(withIssue!['issueDate']).toBe('2025-03-15');

      expect(withoutIssue).toBeDefined();
      expect(withoutIssue!['issueDate']).toBeNull();
    });

    it('LEC-E-18: expirationDate serializes as YYYY-MM-DD string on all returned records', () => {
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(typeof item['expirationDate']).toBe('string');
        expect(item['expirationDate']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Group 8 — Query parameter variation
  // --------------------------------------------------------------------------

  describe('GET /api/v1/employee-certifications/expiring — query parameters', () => {
    it('LEC-E-19: withinDays=7 — cert at day+15 absent; cert at day-5 (past-due) present; cert at day+3 present', async () => {
      // cutoff = today + 7
      //   certA3 (day-5):  day-5 <= day+7 → appears (past-due)
      //   certA8 (day+3):  day+3 <= day+7 → appears
      //   certA1 (day+15): day+15 > day+7 → absent
      const res = await request(app.getHttpServer())
        .get('/api/v1/employee-certifications/expiring')
        .query({ withinDays: 7 })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const items = res.body.data.expiringCertifications as Array<Record<string, unknown>>;

      expect(items.some(i => i['certificationId'] === certA1Id)).toBe(false);  // day+15 — outside
      expect(items.some(i => i['certificationId'] === certA3Id)).toBe(true);   // past-due — included
      expect(items.some(i => i['certificationId'] === certA8Id)).toBe(true);   // day+3 — inside
    });

    it('LEC-E-20: pageSize=1 returns single item per page; totalPages reflects full matching set', async () => {
      // withinDays=30 matches 4 Tenant A records: certA3(-5), certA8(+3), certA7(+5), certA1(+15)
      // pageSize=1 → totalPages = 4; pages 1 and 2 return different records
      const page1 = await request(app.getHttpServer())
        .get('/api/v1/employee-certifications/expiring')
        .query({ withinDays: 30, page: 1, pageSize: 1 })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(page1.status).toBe(200);
      expect(page1.body.data.expiringCertifications).toHaveLength(1);
      expect(page1.body.data.total).toBeGreaterThanOrEqual(2);
      expect(page1.body.data.totalPages).toBeGreaterThanOrEqual(2);

      const page2 = await request(app.getHttpServer())
        .get('/api/v1/employee-certifications/expiring')
        .query({ withinDays: 30, page: 2, pageSize: 1 })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(page2.status).toBe(200);
      expect(page2.body.data.expiringCertifications).toHaveLength(1);

      // Pages must return distinct records
      const certOnPage1 = (page1.body.data.expiringCertifications as Array<Record<string, unknown>>)[0]!['certificationId'];
      const certOnPage2 = (page2.body.data.expiringCertifications as Array<Record<string, unknown>>)[0]!['certificationId'];
      expect(certOnPage1).not.toBe(certOnPage2);
    });
  });
});
