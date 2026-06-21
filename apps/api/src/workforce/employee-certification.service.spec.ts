// Reference: directives/15_certification_management_rules.md — CRT-200 through CRT-302
// Reference: governance/GD-M13-3.md — Decisions 1–7 (status enumeration and constraints)
// Reference: governance/GD-M13-4.md — Decision 3 (upsert semantics), Decisions 4–5 (audit events)
// Reference: governance/GD-M13-2.md — Decision 15 (HTTP status), Decision 16 (GET contract)
//
// Pure unit tests — no HTTP server, no database.
// PrismaService and AuditService replaced with jest.fn() mocks.
// Tests verify: EMP-302 enforcement, SEC-003 WHERE clause, INSERT vs UPDATE branching,
// CRT-207 initial status constraint, CRT-204 expirationRequired enforcement (INSERT + UPDATE),
// CRT-206 partial update semantics, GD-M13-4 D4 audit event selection,
// GD-M13-4 D5 audit metadata structure, CRT-301 REVOKED terminal enforcement.

import { Test, type TestingModule } from '@nestjs/testing';

import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import { PrismaService } from '../database/prisma.service';
import { EmployeeCertificationService } from './employee-certification.service';
import type { AssignCertificationParams } from './employee-certification.service';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID    = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const EMPLOYEE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CERT_ID     = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const ISSUE_DATE      = new Date('2026-01-01T00:00:00.000Z');
const EXPIRATION_DATE = new Date('2027-01-01T00:00:00.000Z');
const PAST_DATE       = new Date('2025-06-01T00:00:00.000Z');

const ACTIVE_EMP    = { employmentStatus: 'ACTIVE' };
const SEPARATED_EMP = { employmentStatus: 'SEPARATED' };
const CERT_STUB     = { expirationRequired: false, name: 'AWS Certified' };
const CERT_REQUIRED = { expirationRequired: true,  name: 'AWS Certified' };
const EMP_STUB      = { id: EMPLOYEE_ID };

// Certification row returned from Prisma create/update (includes certification JOIN)
const CERT_ROW = {
  certificationId: CERT_ID,
  status:          'ACTIVE',
  issueDate:       null,
  expirationDate:  null,
  certification: { name: 'AWS Certified', issuer: 'Amazon Web Services' },
};

// Existing record fetched before UPDATE path
const ACTIVE_EXISTING = {
  status:         'ACTIVE',
  issueDate:      ISSUE_DATE,
  expirationDate: EXPIRATION_DATE,
};

const EXPIRED_EXISTING = {
  status:         'EXPIRED',
  issueDate:      ISSUE_DATE,
  expirationDate: PAST_DATE,
};

const REVOKED_EXISTING = {
  status:         'REVOKED',
  issueDate:      ISSUE_DATE,
  expirationDate: null as Date | null,
};

const BASE_PARAMS: AssignCertificationParams = {
  employeeId:      EMPLOYEE_ID,
  certificationId: CERT_ID,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmployeeCertificationService', () => {
  let service: EmployeeCertificationService;
  let mockPrisma: {
    employee:               { findFirst: jest.Mock };
    certification:          { findFirst: jest.Mock };
    employeeCertification:  {
      findFirst: jest.Mock;
      create:    jest.Mock;
      update:    jest.Mock;
      findMany:  jest.Mock;
    };
  };
  let mockAudit: { logEvent: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      employee:              { findFirst: jest.fn() },
      certification:         { findFirst: jest.fn() },
      employeeCertification: {
        findFirst: jest.fn(),
        create:    jest.fn(),
        update:    jest.fn(),
        findMany:  jest.fn(),
      },
    };
    mockAudit = { logEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeeCertificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService,  useValue: mockAudit },
      ],
    }).compile();

    service = module.get<EmployeeCertificationService>(EmployeeCertificationService);
  });

  afterEach(() => jest.clearAllMocks());

  // --------------------------------------------------------------------------
  // assignCertification — guard checks (Steps A–D)
  // --------------------------------------------------------------------------

  describe('assignCertification() — guard checks', () => {
    it('ECS-S-A1: NOT_FOUND when employee does not exist', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      const result = await service.assignCertification(BASE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('ECS-S-A2: NOT_FOUND for cross-tenant employee (tenantId in WHERE)', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      await service.assignCertification(BASE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: EMPLOYEE_ID, tenantId: TENANT_ID }),
        }),
      );
    });

    it('ECS-S-A3: EMPLOYEE_SEPARATED when employee has SEPARATED status', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(SEPARATED_EMP);

      const result = await service.assignCertification(BASE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('EMPLOYEE_SEPARATED');
    });

    it('ECS-S-A4: CERTIFICATION_NOT_FOUND when certification does not exist', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(ACTIVE_EMP);
      mockPrisma.certification.findFirst.mockResolvedValue(null);

      const result = await service.assignCertification(BASE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('CERTIFICATION_NOT_FOUND');
    });

    it('ECS-S-A5: CERTIFICATION_NOT_FOUND for cross-tenant certification (tenantId in WHERE)', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(ACTIVE_EMP);
      mockPrisma.certification.findFirst.mockResolvedValue(null);

      await service.assignCertification(BASE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.certification.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: CERT_ID, tenantId: TENANT_ID }),
        }),
      );
    });

    it('ECS-S-A6: CERTIFICATION_NOT_FOUND for soft-deleted certification (deletedAt: null in WHERE)', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(ACTIVE_EMP);
      mockPrisma.certification.findFirst.mockResolvedValue(null);

      await service.assignCertification(BASE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.certification.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // assignCertification — INSERT path: CRT-207 initial status constraint
  // --------------------------------------------------------------------------

  describe('assignCertification() — INSERT path: CRT-207 initial status', () => {
    beforeEach(() => {
      mockPrisma.employee.findFirst.mockResolvedValue(ACTIVE_EMP);
      mockPrisma.certification.findFirst.mockResolvedValue(CERT_STUB);
      mockPrisma.employeeCertification.findFirst.mockResolvedValue(null);
    });

    it('ECS-S-A7: INVALID_STATUS_TRANSITION when status=EXPIRED on INSERT (CRT-207)', async () => {
      const result = await service.assignCertification(
        { ...BASE_PARAMS, status: 'EXPIRED' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('INVALID_STATUS_TRANSITION');
    });

    it('ECS-S-A8: INVALID_STATUS_TRANSITION when status=REVOKED on INSERT (CRT-207)', async () => {
      const result = await service.assignCertification(
        { ...BASE_PARAMS, status: 'REVOKED' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  // --------------------------------------------------------------------------
  // assignCertification — INSERT path: expirationRequired and date validation
  // --------------------------------------------------------------------------

  describe('assignCertification() — INSERT path: date validation', () => {
    beforeEach(() => {
      mockPrisma.employee.findFirst.mockResolvedValue(ACTIVE_EMP);
      mockPrisma.employeeCertification.findFirst.mockResolvedValue(null);
    });

    it('ECS-S-A9: EXPIRATION_DATE_REQUIRED on INSERT when expirationRequired=true and expirationDate absent (CRT-204)', async () => {
      mockPrisma.certification.findFirst.mockResolvedValue(CERT_REQUIRED);

      const result = await service.assignCertification(
        { ...BASE_PARAMS, issueDate: ISSUE_DATE }, // expirationDate absent
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('EXPIRATION_DATE_REQUIRED');
    });

    it('ECS-S-A12: INVALID_DATE_RANGE when expirationDate precedes issueDate (CRT-204)', async () => {
      mockPrisma.certification.findFirst.mockResolvedValue(CERT_STUB);

      const result = await service.assignCertification(
        { ...BASE_PARAMS, issueDate: EXPIRATION_DATE, expirationDate: PAST_DATE },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('INVALID_DATE_RANGE');
    });
  });

  // --------------------------------------------------------------------------
  // assignCertification — INSERT path: successful assignment
  // --------------------------------------------------------------------------

  describe('assignCertification() — INSERT path: successful ASSIGNED', () => {
    beforeEach(() => {
      mockPrisma.employee.findFirst.mockResolvedValue(ACTIVE_EMP);
      mockPrisma.certification.findFirst.mockResolvedValue(CERT_STUB);
      mockPrisma.employeeCertification.findFirst.mockResolvedValue(null);
      mockPrisma.employeeCertification.create.mockResolvedValue(CERT_ROW);
    });

    it('ECS-S-A13: ASSIGNED with status omitted → stored as ACTIVE; CERT_ASSIGNED audit emitted', async () => {
      const result = await service.assignCertification(BASE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('ASSIGNED');
      expect(mockPrisma.employeeCertification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.WORKFORCE_EMPLOYEE_CERT_ASSIGNED,
        }),
      );
    });

    it('ECS-S-A14: ASSIGNED with explicit status=ACTIVE → accepted; CERT_ASSIGNED emitted', async () => {
      const result = await service.assignCertification(
        { ...BASE_PARAMS, status: 'ACTIVE' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('ASSIGNED');
      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.WORKFORCE_EMPLOYEE_CERT_ASSIGNED,
        }),
      );
    });

    it('ECS-S-A15: ASSIGNED with issueDate and expirationDate → create called with both dates', async () => {
      const result = await service.assignCertification(
        { ...BASE_PARAMS, issueDate: ISSUE_DATE, expirationDate: EXPIRATION_DATE },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('ASSIGNED');
      expect(mockPrisma.employeeCertification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            issueDate:      ISSUE_DATE,
            expirationDate: EXPIRATION_DATE,
          }),
        }),
      );
    });

    it('ECS-S-A13b: ASSIGNED — record shape includes certificationName and issuer', async () => {
      const result = await service.assignCertification(BASE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('ASSIGNED');
      if (result.outcome !== 'ASSIGNED') return;
      expect(result.assignment.certificationId).toBe(CERT_ID);
      expect(result.assignment.certificationName).toBe('AWS Certified');
      expect(result.assignment.issuer).toBe('Amazon Web Services');
      expect(result.assignment.status).toBe('ACTIVE');
    });
  });

  // --------------------------------------------------------------------------
  // assignCertification — UPDATE path: terminal and date guards
  // --------------------------------------------------------------------------

  describe('assignCertification() — UPDATE path: guards', () => {
    beforeEach(() => {
      mockPrisma.employee.findFirst.mockResolvedValue(ACTIVE_EMP);
      mockPrisma.certification.findFirst.mockResolvedValue(CERT_STUB);
    });

    it('ECS-S-A16: CERTIFICATION_REVOKED when existing record is REVOKED (CRT-301)', async () => {
      mockPrisma.employeeCertification.findFirst.mockResolvedValue(REVOKED_EXISTING);

      const result = await service.assignCertification(
        { ...BASE_PARAMS, status: 'ACTIVE' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('CERTIFICATION_REVOKED');
    });

    it('ECS-S-A10: EXPIRATION_DATE_REQUIRED on UPDATE when expirationRequired=true and effective expirationDate is null (CRT-204)', async () => {
      mockPrisma.certification.findFirst.mockResolvedValue(CERT_REQUIRED);
      mockPrisma.employeeCertification.findFirst.mockResolvedValue({
        status: 'ACTIVE', issueDate: null, expirationDate: null, // existing has no expirationDate
      });

      const result = await service.assignCertification(
        { ...BASE_PARAMS, status: 'EXPIRED' }, // no expirationDate in request
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('EXPIRATION_DATE_REQUIRED');
    });

    it('ECS-S-A11: no EXPIRATION_DATE_REQUIRED on UPDATE when existing.expirationDate is non-null and request omits it (CRT-204)', async () => {
      mockPrisma.certification.findFirst.mockResolvedValue(CERT_REQUIRED);
      mockPrisma.employeeCertification.findFirst.mockResolvedValue(ACTIVE_EXISTING);
      mockPrisma.employeeCertification.update.mockResolvedValue({
        ...CERT_ROW,
        status: 'EXPIRED',
        expirationDate: EXPIRATION_DATE,
      });

      const result = await service.assignCertification(
        { ...BASE_PARAMS, status: 'EXPIRED' }, // omit expirationDate — existing has one
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('UPDATED');
    });
  });

  // --------------------------------------------------------------------------
  // assignCertification — UPDATE path: audit event selection
  // --------------------------------------------------------------------------

  describe('assignCertification() — UPDATE path: audit event selection', () => {
    beforeEach(() => {
      mockPrisma.employee.findFirst.mockResolvedValue(ACTIVE_EMP);
      mockPrisma.certification.findFirst.mockResolvedValue(CERT_STUB);
      mockPrisma.employeeCertification.update.mockResolvedValue(CERT_ROW);
    });

    it('ECS-S-A17: ACTIVE→EXPIRED → UPDATED; CERT_UPDATED emitted', async () => {
      mockPrisma.employeeCertification.findFirst.mockResolvedValue(ACTIVE_EXISTING);

      const result = await service.assignCertification(
        { ...BASE_PARAMS, status: 'EXPIRED' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('UPDATED');
      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.WORKFORCE_EMPLOYEE_CERT_UPDATED,
        }),
      );
    });

    it('ECS-S-A18: ACTIVE→REVOKED → UPDATED; CERT_REVOKED emitted', async () => {
      mockPrisma.employeeCertification.findFirst.mockResolvedValue(ACTIVE_EXISTING);

      const result = await service.assignCertification(
        { ...BASE_PARAMS, status: 'REVOKED' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('UPDATED');
      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.WORKFORCE_EMPLOYEE_CERT_REVOKED,
        }),
      );
    });

    it('ECS-S-A19: CERT_REVOKED metadata contains certification_name, prior_status, revocation_timestamp (GD-M13-4 D5)', async () => {
      mockPrisma.employeeCertification.findFirst.mockResolvedValue(ACTIVE_EXISTING);

      await service.assignCertification(
        { ...BASE_PARAMS, status: 'REVOKED' },
        TENANT_ID,
        ACTOR_ID,
      );

      const call = mockAudit.logEvent.mock.calls[0][0] as { metadata: Record<string, unknown> };
      expect(call.metadata['certification_name']).toBe('AWS Certified');
      expect(call.metadata['prior_status']).toBe('ACTIVE');
      expect(typeof call.metadata['revocation_timestamp']).toBe('string');
    });

    it('ECS-S-A20: EXPIRED→ACTIVE renewal → UPDATED; CERT_RENEWED emitted', async () => {
      mockPrisma.employeeCertification.findFirst.mockResolvedValue(EXPIRED_EXISTING);

      const result = await service.assignCertification(
        { ...BASE_PARAMS, status: 'ACTIVE', expirationDate: EXPIRATION_DATE },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('UPDATED');
      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.WORKFORCE_EMPLOYEE_CERT_RENEWED,
        }),
      );
    });

    it('ECS-S-A21: CERT_RENEWED metadata contains prior_expiration_date and new_expiration_date (GD-M13-4 D5)', async () => {
      mockPrisma.employeeCertification.findFirst.mockResolvedValue(EXPIRED_EXISTING);

      await service.assignCertification(
        { ...BASE_PARAMS, status: 'ACTIVE', expirationDate: EXPIRATION_DATE },
        TENANT_ID,
        ACTOR_ID,
      );

      const call = mockAudit.logEvent.mock.calls[0][0] as { metadata: Record<string, unknown> };
      expect(call.metadata).toHaveProperty('prior_expiration_date');
      expect(call.metadata).toHaveProperty('new_expiration_date');
    });

    it('ECS-S-A22: EXPIRED→REVOKED → UPDATED; CERT_REVOKED emitted', async () => {
      mockPrisma.employeeCertification.findFirst.mockResolvedValue(EXPIRED_EXISTING);

      const result = await service.assignCertification(
        { ...BASE_PARAMS, status: 'REVOKED' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('UPDATED');
      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.WORKFORCE_EMPLOYEE_CERT_REVOKED,
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // assignCertification — UPDATE path: CRT-206 partial update semantics
  // --------------------------------------------------------------------------

  describe('assignCertification() — UPDATE path: CRT-206 partial update', () => {
    beforeEach(() => {
      mockPrisma.employee.findFirst.mockResolvedValue(ACTIVE_EMP);
      mockPrisma.certification.findFirst.mockResolvedValue(CERT_STUB);
      mockPrisma.employeeCertification.findFirst.mockResolvedValue(ACTIVE_EXISTING);
      mockPrisma.employeeCertification.update.mockResolvedValue(CERT_ROW);
    });

    it('ECS-S-A23: status-only update → update called with only { status } (issueDate/expirationDate not in updateData)', async () => {
      await service.assignCertification(
        { ...BASE_PARAMS, status: 'EXPIRED' },
        TENANT_ID,
        ACTOR_ID,
      );

      const updateCall = mockPrisma.employeeCertification.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(updateCall.data).toEqual({ status: 'EXPIRED' });
      expect(updateCall.data).not.toHaveProperty('issueDate');
      expect(updateCall.data).not.toHaveProperty('expirationDate');
    });

    it('ECS-S-A24: no-op update (no fields changed) → UPDATED; CERT_UPDATED emitted; updated_fields=[]', async () => {
      const result = await service.assignCertification(
        BASE_PARAMS, // no status, no issueDate, no expirationDate
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('UPDATED');
      const call = mockAudit.logEvent.mock.calls[0][0] as { action: AuditEventType; metadata: Record<string, unknown> };
      expect(call.action).toBe(AuditEventType.WORKFORCE_EMPLOYEE_CERT_UPDATED);
      expect(call.metadata['updated_fields']).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // assignCertification — INTERNAL_ERROR paths
  // --------------------------------------------------------------------------

  describe('assignCertification() — INTERNAL_ERROR paths', () => {
    it('ECS-S-A25: INTERNAL_ERROR when employee lookup throws', async () => {
      mockPrisma.employee.findFirst.mockRejectedValue(new Error('db error'));

      const result = await service.assignCertification(BASE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('ECS-S-A26: INTERNAL_ERROR when INSERT throws', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(ACTIVE_EMP);
      mockPrisma.certification.findFirst.mockResolvedValue(CERT_STUB);
      mockPrisma.employeeCertification.findFirst.mockResolvedValue(null);
      mockPrisma.employeeCertification.create.mockRejectedValue(new Error('db error'));

      const result = await service.assignCertification(BASE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // listEmployeeCertifications
  // --------------------------------------------------------------------------

  describe('listEmployeeCertifications()', () => {
    it('ECS-S-L1: NOT_FOUND when employee does not exist', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      const result = await service.listEmployeeCertifications(EMPLOYEE_ID, TENANT_ID);

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('ECS-S-L2: NOT_FOUND for cross-tenant employee (tenantId in WHERE)', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      await service.listEmployeeCertifications(EMPLOYEE_ID, TENANT_ID);

      expect(mockPrisma.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: EMPLOYEE_ID, tenantId: TENANT_ID }),
        }),
      );
    });

    it('ECS-S-L3: SUCCESS with empty certifications array when employee has no assignments', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(EMP_STUB);
      mockPrisma.employeeCertification.findMany.mockResolvedValue([]);

      const result = await service.listEmployeeCertifications(EMPLOYEE_ID, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome !== 'SUCCESS') return;
      expect(result.certifications).toEqual([]);
    });

    it('ECS-S-L4: SUCCESS returns all certification assignments', async () => {
      const secondRow = {
        ...CERT_ROW,
        status: 'EXPIRED',
        expirationDate: PAST_DATE,
      };
      mockPrisma.employee.findFirst.mockResolvedValue(EMP_STUB);
      mockPrisma.employeeCertification.findMany.mockResolvedValue([CERT_ROW, secondRow]);

      const result = await service.listEmployeeCertifications(EMPLOYEE_ID, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome !== 'SUCCESS') return;
      expect(result.certifications).toHaveLength(2);
    });

    it('ECS-S-L5: SUCCESS — record with null issueDate and null expirationDate returns nulls', async () => {
      const nullDateRow = { ...CERT_ROW, issueDate: null, expirationDate: null };
      mockPrisma.employee.findFirst.mockResolvedValue(EMP_STUB);
      mockPrisma.employeeCertification.findMany.mockResolvedValue([nullDateRow]);

      const result = await service.listEmployeeCertifications(EMPLOYEE_ID, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome !== 'SUCCESS') return;
      expect(result.certifications[0]!.issueDate).toBeNull();
      expect(result.certifications[0]!.expirationDate).toBeNull();
    });

    it('ECS-S-L6: SUCCESS — certification with null issuer returns null issuer in record', async () => {
      const noIssuerRow = {
        ...CERT_ROW,
        certification: { name: 'AWS Certified', issuer: null },
      };
      mockPrisma.employee.findFirst.mockResolvedValue(EMP_STUB);
      mockPrisma.employeeCertification.findMany.mockResolvedValue([noIssuerRow]);

      const result = await service.listEmployeeCertifications(EMPLOYEE_ID, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome !== 'SUCCESS') return;
      expect(result.certifications[0]!.issuer).toBeNull();
    });

    it('ECS-S-L7: INTERNAL_ERROR when employee lookup throws', async () => {
      mockPrisma.employee.findFirst.mockRejectedValue(new Error('db error'));

      const result = await service.listEmployeeCertifications(EMPLOYEE_ID, TENANT_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('ECS-S-L8: INTERNAL_ERROR when findMany throws', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(EMP_STUB);
      mockPrisma.employeeCertification.findMany.mockRejectedValue(new Error('db error'));

      const result = await service.listEmployeeCertifications(EMPLOYEE_ID, TENANT_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });
});
