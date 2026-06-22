// Reference: spec/01_requirements.md — FR-153 Certification Expiration Tracking
// Reference: governance/GD-M14-1.md — Decisions 3–5 (namespace; endpoint; RBAC)
// Reference: directives/15_certification_management_rules.md — CRT-400 (expiration tracking)
//
// Pure unit tests — no HTTP server, no database.
// EmployeeCertificationService replaced with jest.fn() mocks.
// JwtAuthGuard and RolesGuard overridden to always pass.
// Controller methods called directly with mock RequestUser actor.
// Verifies: HTTP exception types, response envelope shape, date serialization, error codes.
// RBAC and JWT are infrastructure concerns tested in integration / e2e specs.

import { InternalServerErrorException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import { EmployeeCertificationsController } from './employee-certifications.controller';
import { EmployeeCertificationService } from './employee-certification.service';
import type { ExpiringCertificationRecord } from './employee-certification.service';
import type { RequestUser } from '../identity/jwt.strategy';
import type { ListExpiringCertificationsQueryDto } from './dto/list-expiring-certifications-query.dto';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID    = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const EMPLOYEE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CERT_ID     = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const ISSUE_DATE      = new Date('2025-03-15T00:00:00.000Z');
const EXPIRATION_DATE = new Date('2026-07-10T00:00:00.000Z');

const mockActor: RequestUser = {
  userId:   ACTOR_ID,
  tenantId: TENANT_ID,
  email:    'admin@dev.gov',
  roles:    ['System Administrator'],
};

const expiringRecord: ExpiringCertificationRecord = {
  employeeId:        EMPLOYEE_ID,
  employeeNumber:    'EMP-001',
  firstName:         'Jane',
  lastName:          'Doe',
  certificationId:   CERT_ID,
  certificationName: 'AWS Certified Solutions Architect',
  issuer:            'Amazon Web Services',
  status:            'ACTIVE',
  issueDate:         ISSUE_DATE,
  expirationDate:    EXPIRATION_DATE,
};

const nullIssueDateRecord: ExpiringCertificationRecord = {
  ...expiringRecord,
  issueDate: null,
};

const defaultQuery: ListExpiringCertificationsQueryDto = {
  withinDays: 30,
  page:       1,
  pageSize:   20,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmployeeCertificationsController', () => {
  let controller: EmployeeCertificationsController;
  let mockService: { listExpiringCertifications: jest.Mock };

  beforeEach(async () => {
    mockService = { listExpiringCertifications: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmployeeCertificationsController],
      providers: [
        { provide: EmployeeCertificationService, useValue: mockService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<EmployeeCertificationsController>(EmployeeCertificationsController);
  });

  afterEach(() => jest.clearAllMocks());

  // --------------------------------------------------------------------------
  // listExpiringCertifications()
  // --------------------------------------------------------------------------

  describe('listExpiringCertifications()', () => {
    it('LEC-C-1: SUCCESS — returns { success: true, data: ... }', async () => {
      mockService.listExpiringCertifications.mockResolvedValue({
        outcome: 'SUCCESS', items: [expiringRecord], total: 1, page: 1, pageSize: 20,
      });

      const result = await controller.listExpiringCertifications(defaultQuery, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toBeDefined();
    });

    it('LEC-C-2: SUCCESS — data.expiringCertifications array is present and populated', async () => {
      mockService.listExpiringCertifications.mockResolvedValue({
        outcome: 'SUCCESS', items: [expiringRecord], total: 1, page: 1, pageSize: 20,
      });

      const result = await controller.listExpiringCertifications(defaultQuery, mockActor) as Record<string, unknown>;
      const data   = result['data'] as Record<string, unknown>;

      expect(Array.isArray(data['expiringCertifications'])).toBe(true);
      expect((data['expiringCertifications'] as unknown[]).length).toBe(1);
    });

    it('LEC-C-3: SUCCESS — empty service items returns empty expiringCertifications array', async () => {
      mockService.listExpiringCertifications.mockResolvedValue({
        outcome: 'SUCCESS', items: [], total: 0, page: 1, pageSize: 20,
      });

      const result = await controller.listExpiringCertifications(defaultQuery, mockActor) as Record<string, unknown>;
      const data   = result['data'] as Record<string, unknown>;

      expect(data['expiringCertifications']).toEqual([]);
    });

    it('LEC-C-4: SUCCESS — issueDate serialized as YYYY-MM-DD string', async () => {
      mockService.listExpiringCertifications.mockResolvedValue({
        outcome: 'SUCCESS', items: [expiringRecord], total: 1, page: 1, pageSize: 20,
      });

      const result = await controller.listExpiringCertifications(defaultQuery, mockActor) as Record<string, unknown>;
      const items  = (result['data'] as Record<string, unknown>)['expiringCertifications'] as Record<string, unknown>[];

      expect(items[0]!['issueDate']).toBe('2025-03-15');
    });

    it('LEC-C-5: SUCCESS — null issueDate serializes to null', async () => {
      mockService.listExpiringCertifications.mockResolvedValue({
        outcome: 'SUCCESS', items: [nullIssueDateRecord], total: 1, page: 1, pageSize: 20,
      });

      const result = await controller.listExpiringCertifications(defaultQuery, mockActor) as Record<string, unknown>;
      const items  = (result['data'] as Record<string, unknown>)['expiringCertifications'] as Record<string, unknown>[];

      expect(items[0]!['issueDate']).toBeNull();
    });

    it('LEC-C-6: SUCCESS — expirationDate serialized as YYYY-MM-DD string (non-null)', async () => {
      mockService.listExpiringCertifications.mockResolvedValue({
        outcome: 'SUCCESS', items: [expiringRecord], total: 1, page: 1, pageSize: 20,
      });

      const result = await controller.listExpiringCertifications(defaultQuery, mockActor) as Record<string, unknown>;
      const items  = (result['data'] as Record<string, unknown>)['expiringCertifications'] as Record<string, unknown>[];

      expect(items[0]!['expirationDate']).toBe('2026-07-10');
    });

    it('LEC-C-7: SUCCESS — totalPages computed as Math.ceil(total / pageSize)', async () => {
      mockService.listExpiringCertifications.mockResolvedValue({
        outcome: 'SUCCESS', items: [], total: 45, page: 1, pageSize: 20,
      });

      const result = await controller.listExpiringCertifications(defaultQuery, mockActor) as Record<string, unknown>;
      const data   = result['data'] as Record<string, unknown>;

      expect(data['totalPages']).toBe(3); // Math.ceil(45 / 20) = 3
    });

    it('LEC-C-8: SUCCESS — actor.tenantId passed to service (not from query params)', async () => {
      mockService.listExpiringCertifications.mockResolvedValue({
        outcome: 'SUCCESS', items: [], total: 0, page: 1, pageSize: 20,
      });

      await controller.listExpiringCertifications(defaultQuery, mockActor);

      expect(mockService.listExpiringCertifications).toHaveBeenCalledWith(
        TENANT_ID,
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('LEC-C-9: SUCCESS — withinDays, page, and pageSize passed from query to service', async () => {
      const customQuery: ListExpiringCertificationsQueryDto = { withinDays: 60, page: 2, pageSize: 10 };
      mockService.listExpiringCertifications.mockResolvedValue({
        outcome: 'SUCCESS', items: [], total: 0, page: 2, pageSize: 10,
      });

      await controller.listExpiringCertifications(customQuery, mockActor);

      expect(mockService.listExpiringCertifications).toHaveBeenCalledWith(
        TENANT_ID,
        60,
        2,
        10,
      );
    });

    it('LEC-C-10: INTERNAL_ERROR — throws InternalServerErrorException', async () => {
      mockService.listExpiringCertifications.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(
        controller.listExpiringCertifications(defaultQuery, mockActor),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('LEC-C-11: INTERNAL_ERROR — error envelope is { success: false, error: { code: INTERNAL_ERROR, ... } }', async () => {
      mockService.listExpiringCertifications.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      let thrown: InternalServerErrorException | undefined;
      try {
        await controller.listExpiringCertifications(defaultQuery, mockActor);
      } catch (err) {
        thrown = err as InternalServerErrorException;
      }

      expect(thrown).toBeInstanceOf(InternalServerErrorException);
      const body = thrown!.getResponse() as Record<string, unknown>;
      expect(body['success']).toBe(false);
      expect((body['error'] as Record<string, unknown>)['code']).toBe('INTERNAL_ERROR');
    });
  });
});
