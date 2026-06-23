// Reference: spec/01_requirements.md — FR-110, FR-111, FR-112 Employee Management
// Reference: spec/06_api_contracts.md — Employee API contracts + RBAC matrix
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-001 through EMP-AUTH-005
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
//   employees (→ departments FK) deleted before departments
//   departments deleted before tenants
//   audit events (→ users) deleted before users
//   userRoles deleted before users
//
// RBAC-952: Executive User excluded from GET /employees and GET /employees/:id.
//   Executive Users receive HTTP 403. Non-negotiable per EMP-004/EMP-402.
//
// Pre-created employees use direct Prisma inserts (not via API) so each lifecycle
// transition test starts from a known, stable state. This prevents test-ordering
// dependencies within Group 5.

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
const FIXTURE_TENANT_CODE = `E2E-EMP-${SUFFIX}`;
const CROSS_TENANT_CODE   = `E2E-EMP-X-${SUFFIX}`;

const ADMIN_EMAIL     = `e2e-emp-admin-${SUFFIX}@test.gov`;
const HR_EMAIL        = `e2e-emp-hr-${SUFFIX}@test.gov`;
const WP_EMAIL        = `e2e-emp-wp-${SUFFIX}@test.gov`;
const HM_EMAIL        = `e2e-emp-hm-${SUFFIX}@test.gov`;
const CO_EMAIL        = `e2e-emp-co-${SUFFIX}@test.gov`;
const RECRUITER_EMAIL = `e2e-emp-recruiter-${SUFFIX}@test.gov`;
const EXEC_EMAIL      = `e2e-emp-exec-${SUFFIX}@test.gov`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Employee (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  // JWTs
  let adminToken: string;
  let hrToken: string;
  let wpToken: string;
  let hmToken: string;
  let coToken: string;
  let recruiterToken: string;
  let execToken: string;

  // Tenant + user IDs for cleanup
  let fixtureTenantId: string;
  let crossTenantId: string;
  let adminUserId: string;
  let hrUserId: string;
  let wpUserId: string;
  let hmUserId: string;
  let coUserId: string;
  let recruiterUserId: string;
  let execUserId: string;

  // Departments
  let primaryDeptId: string;
  let crossTenantDeptId: string;

  // Pre-created employees for specific scenario coverage
  let pendingEmployeeId: string;     // PENDING_ONBOARDING — list/read/forbidden-transition tests
  let activeEmployeeId: string;      // ACTIVE — list filter tests, read tests
  let separatedEmployeeId: string;   // SEPARATED — EMP-302 + terminal state tests
  let crossTenantEmployeeId: string; // ACTIVE on Tenant B — SEC-003 tests
  let softDeletedEmployeeId: string; // deletedAt set — soft-delete visibility tests
  let updateTargetId: string;        // PENDING_ONBOARDING — PUT test target
  let activateTargetId: string;      // PENDING_ONBOARDING → ACTIVE (Group 5 test 1)
  let leaveTargetId: string;         // ACTIVE → ON_LEAVE (Group 5 test 2)
  let returnTargetId: string;        // ON_LEAVE → ACTIVE (Group 5 test 3)
  let suspendTargetId: string;       // ACTIVE → SUSPENDED (Group 5 test 4)
  let reinstateTargetId: string;     // SUSPENDED → ACTIVE (Group 5 test 5)
  let separateTargetId: string;      // ACTIVE → SEPARATED (Group 5 test 6)

  // API-created employee IDs — captured from POST responses for cleanup
  const apiCreatedEmployeeIds: string[] = [];

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
      data: { name: 'E2E Employee Tenant', code: FIXTURE_TENANT_CODE, status: 'ACTIVE' },
    });
    fixtureTenantId = tenant.id;

    const crossTenant = await prisma.tenant.create({
      data: { name: 'E2E Employee Cross Tenant', code: CROSS_TENANT_CODE, status: 'ACTIVE' },
    });
    crossTenantId = crossTenant.id;

    // ---- Roles (must exist from seed) ----
    const sysAdminRole    = await prisma.role.findUniqueOrThrow({ where: { name: 'System Administrator' } });
    const hrRole          = await prisma.role.findUniqueOrThrow({ where: { name: 'HR Director' } });
    const wpRole          = await prisma.role.findUniqueOrThrow({ where: { name: 'Workforce Planner' } });
    const hmRole          = await prisma.role.findUniqueOrThrow({ where: { name: 'Hiring Manager' } });
    const coRole          = await prisma.role.findUniqueOrThrow({ where: { name: 'Compliance Officer' } });
    const recruiterRole   = await prisma.role.findUniqueOrThrow({ where: { name: 'Recruiter' } });
    const execRole        = await prisma.role.findUniqueOrThrow({ where: { name: 'Executive User' } });

    // ---- Users ----
    const mkUser = async (email: string, roleId: string) => {
      const u = await prisma.user.create({
        data: {
          tenantId: fixtureTenantId, email, passwordHash,
          firstName: 'E2E', lastName: 'Emp', status: 'ACTIVE', failedLoginAttempts: 0,
        },
      });
      await prisma.userRole.create({ data: { userId: u.id, roleId } });
      return u.id;
    };

    adminUserId    = await mkUser(ADMIN_EMAIL,     sysAdminRole.id);
    hrUserId       = await mkUser(HR_EMAIL,        hrRole.id);
    wpUserId       = await mkUser(WP_EMAIL,        wpRole.id);
    hmUserId       = await mkUser(HM_EMAIL,        hmRole.id);
    coUserId       = await mkUser(CO_EMAIL,        coRole.id);
    recruiterUserId = await mkUser(RECRUITER_EMAIL, recruiterRole.id);
    execUserId     = await mkUser(EXEC_EMAIL,      execRole.id);

    // ---- Departments ----
    const primaryDept = await prisma.department.create({
      data: { tenantId: fixtureTenantId, name: 'E2E Emp Dept', code: `E2E-ED-${SUFFIX}`, status: 'ACTIVE' },
    });
    primaryDeptId = primaryDept.id;

    const crossDept = await prisma.department.create({
      data: { tenantId: crossTenantId, name: 'E2E Emp Cross Dept', code: `E2E-ECD-${SUFFIX}`, status: 'ACTIVE' },
    });
    crossTenantDeptId = crossDept.id;

    // ---- Pre-created employees (Prisma-direct — not via API) ----
    // appointmentAuthority required after M15 schema migration (GD-M15-1 D1).
    // Using ADMINISTRATIVE as the designated catch-all for test fixtures (GD-M15-1 D3).
    const mkEmp = async (
      tenantId: string,
      deptId: string,
      empNum: string,
      status: string,
      extra?: Partial<{ deletedAt: Date; terminationDate: Date }>,
    ) => {
      const e = await prisma.employee.create({
        data: {
          tenantId,
          departmentId: deptId,
          employeeNumber: empNum,
          firstName: 'E2E',
          lastName: 'Employee',
          employmentStatus: status,
          appointmentAuthority: 'ADMINISTRATIVE',
          ...extra,
        },
      });
      return e.id;
    };

    pendingEmployeeId   = await mkEmp(fixtureTenantId, primaryDeptId, `EMP-${SUFFIX}-pending`,   'PENDING_ONBOARDING');
    activeEmployeeId    = await mkEmp(fixtureTenantId, primaryDeptId, `EMP-${SUFFIX}-active`,    'ACTIVE');
    separatedEmployeeId = await mkEmp(fixtureTenantId, primaryDeptId, `EMP-${SUFFIX}-separated`, 'SEPARATED', { terminationDate: new Date() });
    crossTenantEmployeeId = await mkEmp(crossTenantId, crossTenantDeptId, `EMP-${SUFFIX}-xten`, 'ACTIVE');
    softDeletedEmployeeId = await mkEmp(fixtureTenantId, primaryDeptId, `EMP-${SUFFIX}-softdel`, 'PENDING_ONBOARDING', { deletedAt: new Date() });
    updateTargetId      = await mkEmp(fixtureTenantId, primaryDeptId, `EMP-${SUFFIX}-uptarget`, 'PENDING_ONBOARDING');
    activateTargetId    = await mkEmp(fixtureTenantId, primaryDeptId, `EMP-${SUFFIX}-activate`, 'PENDING_ONBOARDING');
    leaveTargetId       = await mkEmp(fixtureTenantId, primaryDeptId, `EMP-${SUFFIX}-leave`,    'ACTIVE');
    returnTargetId      = await mkEmp(fixtureTenantId, primaryDeptId, `EMP-${SUFFIX}-return`,   'ON_LEAVE');
    suspendTargetId     = await mkEmp(fixtureTenantId, primaryDeptId, `EMP-${SUFFIX}-suspend`,  'ACTIVE');
    reinstateTargetId   = await mkEmp(fixtureTenantId, primaryDeptId, `EMP-${SUFFIX}-reinstate`, 'SUSPENDED');
    separateTargetId    = await mkEmp(fixtureTenantId, primaryDeptId, `EMP-${SUFFIX}-separate`, 'ACTIVE');

    // ---- Authenticate all fixture users ----
    const login = async (email: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: FIXTURE_PASSWORD });
      return res.body.data.accessToken as string;
    };

    adminToken    = await login(ADMIN_EMAIL);
    hrToken       = await login(HR_EMAIL);
    wpToken       = await login(WP_EMAIL);
    hmToken       = await login(HM_EMAIL);
    coToken       = await login(CO_EMAIL);
    recruiterToken = await login(RECRUITER_EMAIL);
    execToken     = await login(EXEC_EMAIL);
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      const tenantIds = [fixtureTenantId, crossTenantId].filter(Boolean);

      // Employees first — FK constraint to departments
      if (tenantIds.length > 0) {
        await prisma.employee.deleteMany({ where: { tenantId: { in: tenantIds } } }).catch(() => {});
      }

      // Departments
      for (const deptId of [primaryDeptId, crossTenantDeptId].filter(Boolean)) {
        await prisma.department.delete({ where: { id: deptId } }).catch(() => {});
      }

      // Audit events for fixture actors — must precede user deletion
      const actorIds = [adminUserId, hrUserId, wpUserId, hmUserId, coUserId, recruiterUserId, execUserId].filter(Boolean);
      if (actorIds.length > 0) {
        await prisma.auditEvent.deleteMany({ where: { userId: { in: actorIds } } }).catch(() => {});
      }

      // Users + roles
      for (const userId of actorIds) {
        await prisma.userRole.deleteMany({ where: { userId } }).catch(() => {});
        await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      }

      // Tenants
      if (fixtureTenantId) await prisma.tenant.delete({ where: { id: fixtureTenantId } }).catch(() => {});
      if (crossTenantId)   await prisma.tenant.delete({ where: { id: crossTenantId } }).catch(() => {});

      await prisma.$disconnect();
    }
    await app?.close();
  }, 30_000);

  // --------------------------------------------------------------------------
  // Group 1: POST /api/v1/employees
  // --------------------------------------------------------------------------

  describe('POST /api/v1/employees', () => {
    it('SA JWT + valid body → HTTP 201 + { success: true, data: employee }; employmentStatus = PENDING_ONBOARDING (GD-M12-1)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeNumber: `EMP-${SUFFIX}-api-1`,
          firstName: 'Alice',
          lastName: 'Test',
          departmentId: primaryDeptId,
          appointmentAuthority: 'ADMINISTRATIVE',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        employmentStatus: 'PENDING_ONBOARDING',
        employeeNumber: `EMP-${SUFFIX}-api-1`,
        departmentId: primaryDeptId,
        appointmentAuthority: 'ADMINISTRATIVE',
      });
      expect(res.body.data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(res.body.data).toHaveProperty('positionId', null);
      // tenantId must NOT be present in response (SEC-003)
      expect(res.body.data).not.toHaveProperty('tenantId');

      if (res.body.data?.id) apiCreatedEmployeeIds.push(res.body.data.id as string);
    });

    it('HR Director JWT → HTTP 201 (write authorized for HR Director — EMP-AUTH-001)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          employeeNumber: `EMP-${SUFFIX}-api-2`,
          firstName: 'Bob',
          lastName: 'Test',
          departmentId: primaryDeptId,
          appointmentAuthority: 'LATERAL_TRANSFER',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      if (res.body.data?.id) apiCreatedEmployeeIds.push(res.body.data.id as string);
    });

    it('Workforce Planner JWT → HTTP 403 (write restricted to SA and HR Director — EMP-AUTH-001)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${wpToken}`)
        .send({ employeeNumber: `EMP-${SUFFIX}-wp`, firstName: 'X', lastName: 'Y', departmentId: primaryDeptId });

      expect(res.status).toBe(403);
    });

    it('Recruiter JWT → HTTP 403 (Recruiter excluded from all employee endpoints)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${recruiterToken}`)
        .send({ employeeNumber: `EMP-${SUFFIX}-rec`, firstName: 'X', lastName: 'Y', departmentId: primaryDeptId });

      expect(res.status).toBe(403);
    });

    it('Executive User JWT → HTTP 403 (RBAC-952: Executive Users excluded from employee endpoints)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${execToken}`)
        .send({ employeeNumber: `EMP-${SUFFIX}-exec`, firstName: 'X', lastName: 'Y', departmentId: primaryDeptId });

      expect(res.status).toBe(403);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .send({ employeeNumber: `EMP-${SUFFIX}-noauth`, firstName: 'X', lastName: 'Y', departmentId: primaryDeptId });

      expect(res.status).toBe(401);
    });

    it('missing required field (firstName) → HTTP 400 (ValidationPipe rejects)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ employeeNumber: `EMP-${SUFFIX}-bad`, lastName: 'Test', departmentId: primaryDeptId });

      expect(res.status).toBe(400);
    });

    it('non-existent departmentId → HTTP 422 + DEPARTMENT_NOT_FOUND (EMP-202)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeNumber: `EMP-${SUFFIX}-baddept`,
          firstName: 'X',
          lastName: 'Y',
          departmentId: '00000000-0000-4000-8000-000000000099',
          appointmentAuthority: 'ADMINISTRATIVE',
        });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'DEPARTMENT_NOT_FOUND' } });
    });

    it('cross-tenant departmentId → HTTP 422 + DEPARTMENT_NOT_FOUND (SEC-003: same response as absent — no enumeration)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeNumber: `EMP-${SUFFIX}-crossdept`,
          firstName: 'X',
          lastName: 'Y',
          departmentId: crossTenantDeptId,
          appointmentAuthority: 'ADMINISTRATIVE',
        });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'DEPARTMENT_NOT_FOUND' } });
    });

    it('duplicate employeeNumber within tenant → HTTP 409 + EMPLOYEE_NUMBER_CONFLICT (EMP-803)', async () => {
      // pendingEmployee has employeeNumber = EMP-${SUFFIX}-pending
      const res = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeNumber: `EMP-${SUFFIX}-pending`,
          firstName: 'Duplicate',
          lastName: 'Test',
          departmentId: primaryDeptId,
          appointmentAuthority: 'ADMINISTRATIVE',
        });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'EMPLOYEE_NUMBER_CONFLICT' } });
    });

    it('missing appointmentAuthority → HTTP 422 + APPOINTMENT_AUTHORITY_REQUIRED (GD-M15-1 D4)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeNumber: `EMP-${SUFFIX}-noauth`,
          firstName: 'X',
          lastName: 'Y',
          departmentId: primaryDeptId,
        });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPOINTMENT_AUTHORITY_REQUIRED' } });
    });

    it('COMPETITIVE_APPOINTMENT submitted via API → HTTP 422 + COMPETITIVE_APPOINTMENT_SYSTEM_ONLY (GD-PRE-M13-001)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeNumber: `EMP-${SUFFIX}-comp`,
          firstName: 'X',
          lastName: 'Y',
          departmentId: primaryDeptId,
          appointmentAuthority: 'COMPETITIVE_APPOINTMENT',
        });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'COMPETITIVE_APPOINTMENT_SYSTEM_ONLY' } });
    });

    it('invalid appointmentAuthority value → HTTP 422 + INVALID_APPOINTMENT_AUTHORITY (GD-M15-1 D1)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeNumber: `EMP-${SUFFIX}-badauth`,
          firstName: 'X',
          lastName: 'Y',
          departmentId: primaryDeptId,
          appointmentAuthority: 'NOT_A_REAL_AUTHORITY',
        });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INVALID_APPOINTMENT_AUTHORITY' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 2: GET /api/v1/employees
  // --------------------------------------------------------------------------

  describe('GET /api/v1/employees', () => {
    it('SA JWT → HTTP 200 + { success: true, data: { employees, total, page, pageSize, totalPages } }', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({ page: 1, pageSize: 20 });
      expect(Array.isArray(res.body.data.employees)).toBe(true);
      expect(typeof res.body.data.total).toBe('number');
      expect(typeof res.body.data.totalPages).toBe('number');
    });

    it('HR Director JWT → HTTP 200 (EMP-AUTH-002)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees')
        .set('Authorization', `Bearer ${hrToken}`);

      expect(res.status).toBe(200);
    });

    it('Workforce Planner JWT → HTTP 200 (EMP-AUTH-002: read includes Workforce Planner)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees')
        .set('Authorization', `Bearer ${wpToken}`);

      expect(res.status).toBe(200);
    });

    it('Hiring Manager JWT → HTTP 200 (EMP-AUTH-002: read includes Hiring Manager)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees')
        .set('Authorization', `Bearer ${hmToken}`);

      expect(res.status).toBe(200);
    });

    it('Compliance Officer JWT → HTTP 200 (EMP-AUTH-002: read includes Compliance Officer)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees')
        .set('Authorization', `Bearer ${coToken}`);

      expect(res.status).toBe(200);
    });

    it('Executive User JWT → HTTP 403 (RBAC-952: Executive Users forbidden from employee list)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees')
        .set('Authorization', `Bearer ${execToken}`);

      expect(res.status).toBe(403);
    });

    it('Recruiter JWT → HTTP 403 (Recruiter excluded from all employee endpoints)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees')
        .set('Authorization', `Bearer ${recruiterToken}`);

      expect(res.status).toBe(403);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/employees');

      expect(res.status).toBe(401);
    });

    it('employmentStatus=ACTIVE filter → only ACTIVE employees returned (EMP-501)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees?employmentStatus=ACTIVE')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const employees = res.body.data.employees as Array<{ id: string; employmentStatus: string }>;
      expect(employees.every(e => e.employmentStatus === 'ACTIVE')).toBe(true);
      expect(employees.map(e => e.id)).toContain(activeEmployeeId);
    });

    it('departmentId filter → only employees from that department returned', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/employees?departmentId=${primaryDeptId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const employees = res.body.data.employees as Array<{ departmentId: string }>;
      expect(employees.every(e => e.departmentId === primaryDeptId)).toBe(true);
    });

    it('pagination pageSize=1 → employees.length = 1, total >= 1, totalPages >= 1', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees?page=1&pageSize=1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect((res.body.data.employees as unknown[]).length).toBe(1);
      expect(res.body.data.total).toBeGreaterThanOrEqual(1);
      expect(res.body.data.totalPages).toBeGreaterThanOrEqual(1);
      expect(res.body.data.pageSize).toBe(1);
    });

    it('cross-tenant employee excluded from list (SEC-003 tenant isolation)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.employees as Array<{ id: string }>).map(e => e.id);
      expect(ids).not.toContain(crossTenantEmployeeId);
    });
  });

  // --------------------------------------------------------------------------
  // Group 3: GET /api/v1/employees/:id
  // --------------------------------------------------------------------------

  describe('GET /api/v1/employees/:id', () => {
    it('SA JWT + valid id → HTTP 200 + correct data; tenantId absent from response (SEC-003)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/employees/${pendingEmployeeId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(pendingEmployeeId);
      expect(res.body.data.employmentStatus).toBe('PENDING_ONBOARDING');
      expect(res.body.data.departmentName).toBeDefined();
      expect(res.body.data).not.toHaveProperty('tenantId');
    });

    it('Workforce Planner JWT → HTTP 200 (EMP-AUTH-003: read includes Workforce Planner)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/employees/${activeEmployeeId}`)
        .set('Authorization', `Bearer ${wpToken}`);

      expect(res.status).toBe(200);
    });

    it('Hiring Manager JWT → HTTP 200 (EMP-AUTH-003: read includes Hiring Manager)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/employees/${activeEmployeeId}`)
        .set('Authorization', `Bearer ${hmToken}`);

      expect(res.status).toBe(200);
    });

    it('Executive User JWT → HTTP 403 (RBAC-952: Executive Users forbidden from employee detail)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/employees/${activeEmployeeId}`)
        .set('Authorization', `Bearer ${execToken}`);

      expect(res.status).toBe(403);
    });

    it('Recruiter JWT → HTTP 403 (Recruiter excluded from all employee endpoints)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/employees/${activeEmployeeId}`)
        .set('Authorization', `Bearer ${recruiterToken}`);

      expect(res.status).toBe(403);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/employees/${activeEmployeeId}`);

      expect(res.status).toBe(401);
    });

    it('valid UUID not in DB → HTTP 404 (EMP-802)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees/00000000-0000-4000-8000-000000000099')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    });

    it('cross-tenant employee UUID → HTTP 404 (SEC-003: same response as absent — no enumeration)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/employees/${crossTenantEmployeeId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    });

    it('malformed UUID in :id → HTTP 400 (ParseUUIDPipe rejects)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees/not-a-valid-uuid')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // Group 4: PUT /api/v1/employees/:id
  // --------------------------------------------------------------------------

  describe('PUT /api/v1/employees/:id', () => {
    it('SA JWT + update firstName → HTTP 200 + field changed in response (EMP-AUTH-004)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/employees/${updateTargetId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'Janet' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.firstName).toBe('Janet');
      expect(res.body.data.id).toBe(updateTargetId);
    });

    it('HR Director JWT + update email → HTTP 200 (EMP-AUTH-004)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/employees/${updateTargetId}`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ email: 'updated@agency.gov' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('updated@agency.gov');
    });

    it('Workforce Planner JWT → HTTP 403 (write restricted to SA and HR Director — EMP-AUTH-004)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/employees/${updateTargetId}`)
        .set('Authorization', `Bearer ${wpToken}`)
        .send({ firstName: 'Blocked' });

      expect(res.status).toBe(403);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/employees/${updateTargetId}`)
        .send({ firstName: 'Blocked' });

      expect(res.status).toBe(401);
    });

    it('non-existent UUID → HTTP 404 + NOT_FOUND (EMP-802)', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/employees/00000000-0000-4000-8000-000000000099')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'Nobody' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    });

    it('cross-tenant employee UUID → HTTP 404 (SEC-003: same response as absent)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/employees/${crossTenantEmployeeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'CrossTenant' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    });

    it('body includes employeeNumber → HTTP 422 + EMPLOYEE_NUMBER_IMMUTABLE (GD-M12-6/EMP-304)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/employees/${updateTargetId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ employeeNumber: 'NEW-NUM', firstName: 'Janet' });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'EMPLOYEE_NUMBER_IMMUTABLE' } });
    });

    it('body includes appointmentAuthority → HTTP 422 + APPOINTMENT_AUTHORITY_IMMUTABLE (GD-M15-1 D8)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/employees/${updateTargetId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ appointmentAuthority: 'SCHEDULE_A', firstName: 'Janet' });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'APPOINTMENT_AUTHORITY_IMMUTABLE' } });
    });

    it('SEPARATED employee → HTTP 422 + EMPLOYEE_IS_SEPARATED (EMP-302: read-only)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/employees/${separatedEmployeeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'Blocked' });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'EMPLOYEE_IS_SEPARATED' } });
    });

    it('invalid departmentId in body → HTTP 422 + DEPARTMENT_NOT_FOUND (EMP-202)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/employees/${updateTargetId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ departmentId: '00000000-0000-4000-8000-000000000099' });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'DEPARTMENT_NOT_FOUND' } });
    });
  });

  // --------------------------------------------------------------------------
  // Group 5: POST /api/v1/employees/:id/status
  // Each test uses a separate pre-created employee at the correct starting state.
  // Tests are independent — none depends on another passing.
  // --------------------------------------------------------------------------

  describe('POST /api/v1/employees/:id/status', () => {
    it('PENDING_ONBOARDING → ACTIVE: HTTP 200 + employmentStatus = ACTIVE (WORKFORCE_EMPLOYEE_ACTIVATED)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/employees/${activateTargetId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.employmentStatus).toBe('ACTIVE');
      expect(res.body.data.id).toBe(activateTargetId);
    });

    it('ACTIVE → ON_LEAVE: HTTP 200 + employmentStatus = ON_LEAVE (WORKFORCE_EMPLOYEE_LEAVE_STARTED)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/employees/${leaveTargetId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ON_LEAVE' });

      expect(res.status).toBe(200);
      expect(res.body.data.employmentStatus).toBe('ON_LEAVE');
    });

    it('ON_LEAVE → ACTIVE: HTTP 200 + employmentStatus = ACTIVE (WORKFORCE_EMPLOYEE_RETURNED)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/employees/${returnTargetId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' });

      expect(res.status).toBe(200);
      expect(res.body.data.employmentStatus).toBe('ACTIVE');
    });

    it('ACTIVE → SUSPENDED: HTTP 200 + employmentStatus = SUSPENDED (WORKFORCE_EMPLOYEE_SUSPENDED)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/employees/${suspendTargetId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'SUSPENDED' });

      expect(res.status).toBe(200);
      expect(res.body.data.employmentStatus).toBe('SUSPENDED');
    });

    it('SUSPENDED → ACTIVE: HTTP 200 + employmentStatus = ACTIVE (WORKFORCE_EMPLOYEE_REINSTATED)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/employees/${reinstateTargetId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' });

      expect(res.status).toBe(200);
      expect(res.body.data.employmentStatus).toBe('ACTIVE');
    });

    it('ACTIVE → SEPARATED (with separationReason) → HTTP 200 + terminationDate set (WORKFORCE_EMPLOYEE_SEPARATED; EMP-303)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/employees/${separateTargetId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'SEPARATED', separationReason: 'RETIREMENT' });

      expect(res.status).toBe(200);
      expect(res.body.data.employmentStatus).toBe('SEPARATED');
      // EMP-303: terminationDate set automatically by service on ACTIVE → SEPARATED
      expect(res.body.data.terminationDate).not.toBeNull();
    });

    it('forbidden transition PENDING_ONBOARDING → SUSPENDED → HTTP 422 + INVALID_TRANSITION (EMP-801)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/employees/${pendingEmployeeId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'SUSPENDED' });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INVALID_TRANSITION' } });
    });

    it('SEPARATED → ACTIVE (terminal state) → HTTP 422 + INVALID_TRANSITION (GD-M12-1: SEPARATED is terminal)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/employees/${separatedEmployeeId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ success: false, error: { code: 'INVALID_TRANSITION' } });
    });

    it('Workforce Planner JWT → HTTP 403 (status change restricted to SA and HR Director — EMP-AUTH-005)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/employees/${activeEmployeeId}/status`)
        .set('Authorization', `Bearer ${wpToken}`)
        .send({ status: 'ON_LEAVE' });

      expect(res.status).toBe(403);
    });

    it('non-existent employee UUID → HTTP 404 (EMP-802)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/employees/00000000-0000-4000-8000-000000000099/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' });

      expect(res.status).toBe(404);
    });

    it('no Authorization header → HTTP 401', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/employees/${activeEmployeeId}/status`)
        .send({ status: 'ON_LEAVE' });

      expect(res.status).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // Group 6: Audit record verification (EMP-700, EMP-701, EMP-401)
  // Depends on write operations from Groups 1, 4, and 5.
  // --------------------------------------------------------------------------

  describe('Audit record verification (EMP-700)', () => {
    it('WORKFORCE_EMPLOYEE_CREATED written after POST /employees (EMP-700)', async () => {
      expect(apiCreatedEmployeeIds.length).toBeGreaterThan(0);
      const createdId = apiCreatedEmployeeIds[0]!;

      const record = await prisma.auditEvent.findFirst({
        where: { entityId: createdId, action: 'WORKFORCE_EMPLOYEE_CREATED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
      expect(record!.entityType).toBe('EMPLOYEE');
    });

    it('WORKFORCE_EMPLOYEE_UPDATED written after PUT; metadata has updatedFields only — no PII values (EMP-401)', async () => {
      const records = await prisma.auditEvent.findMany({
        where: { entityId: updateTargetId, action: 'WORKFORCE_EMPLOYEE_UPDATED' },
        orderBy: { createdAt: 'asc' },
      });

      expect(records.length).toBeGreaterThan(0);
      const meta = records[0]!.metadata as Record<string, unknown>;
      // EMP-401: metadata contains field names only — not field values
      expect(Array.isArray(meta['updatedFields'])).toBe(true);
      const metaStr = JSON.stringify(meta);
      // Verify PII values (firstName value, email value) are absent from metadata
      expect(metaStr).not.toContain('Janet');
      expect(metaStr).not.toContain('updated@agency.gov');
    });

    it('WORKFORCE_EMPLOYEE_ACTIVATED written after PENDING_ONBOARDING → ACTIVE (EMP-700)', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: activateTargetId, action: 'WORKFORCE_EMPLOYEE_ACTIVATED' },
      });

      expect(record).not.toBeNull();
      expect(record!.tenantId).toBe(fixtureTenantId);
    });

    it('WORKFORCE_EMPLOYEE_SEPARATED written after ACTIVE → SEPARATED; separationReason in metadata (EMP-700/EMP-701)', async () => {
      const record = await prisma.auditEvent.findFirst({
        where: { entityId: separateTargetId, action: 'WORKFORCE_EMPLOYEE_SEPARATED' },
      });

      expect(record).not.toBeNull();
      const meta = record!.metadata as Record<string, unknown>;
      expect(meta['previousStatus']).toBe('ACTIVE');
      expect(meta['newStatus']).toBe('SEPARATED');
      expect(meta['separationReason']).toBe('RETIREMENT');
    });
  });

  // --------------------------------------------------------------------------
  // Group 7: Soft-delete visibility (deletedAt: null filter)
  // --------------------------------------------------------------------------

  describe('Soft-delete visibility', () => {
    it('soft-deleted employee not returned in GET /employees list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data.employees as Array<{ id: string }>).map(e => e.id);
      expect(ids).not.toContain(softDeletedEmployeeId);
    });

    it('soft-deleted employee returns HTTP 404 on GET /employees/:id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/employees/${softDeletedEmployeeId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });
});
