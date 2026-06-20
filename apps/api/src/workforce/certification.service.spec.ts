// Reference: spec/01_requirements.md — FR-114, FR-151 Certifications Management
// Reference: directives/15_certification_management_rules.md — CRT-001 through CRT-103
// Reference: governance/GD-M13-2.md — API design decisions (Decision 9)
// Reference: governance/GD-M13-4.md — audit event requirements (Decision 4)
//
// Pure unit tests — no database, no HTTP server.
// PrismaService and AuditService replaced with jest.fn() mocks.
// Verifies all discriminated-union outcomes for each CertificationService method.
//
// SEC-003 tenant isolation (GD-M13-1 Decision 3, CRT-002):
//   tenantId and deletedAt: null must be present in all read WHERE clauses.
// CRT-003: P2002 → CERTIFICATION_NAME_CONFLICT.
// GD-M13-4 Decision 4: audit emitted after write on SUCCESS only — not on failure paths.

import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { CertificationService } from './certification.service';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import type { CreateCertificationParams } from './certification.service';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID  = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CERT_ID   = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-01-02T00:00:00.000Z');

const CERT_ROW = {
  id:                 CERT_ID,
  tenantId:           TENANT_ID,
  name:               'Project Management Professional (PMP)',
  issuer:             'Project Management Institute' as string | null,
  expirationRequired: true,
  createdAt:          CREATED_AT,
  updatedAt:          UPDATED_AT,
};

const CREATE_PARAMS: CreateCertificationParams = {
  name:               'Project Management Professional (PMP)',
  expirationRequired: true,
  issuer:             'Project Management Institute',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CertificationService', () => {
  let service: CertificationService;

  const mockPrisma = {
    certification: {
      create:    jest.fn(),
      findMany:  jest.fn(),
      count:     jest.fn(),
      findFirst: jest.fn(),
      update:    jest.fn(),
    },
  };

  const mockAudit = {
    logEvent: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService,  useValue: mockAudit },
      ],
    }).compile();
    service = module.get(CertificationService);
  });

  // --------------------------------------------------------------------------
  // createCertification
  // --------------------------------------------------------------------------

  describe('createCertification', () => {
    it('CRT-S-C1: SUCCESS — returns certification record on happy path', async () => {
      mockPrisma.certification.create.mockResolvedValueOnce(CERT_ROW);
      const result = await service.createCertification(CREATE_PARAMS, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.certification.id).toBe(CERT_ID);
        expect(result.certification.name).toBe('Project Management Professional (PMP)');
        expect(result.certification.expirationRequired).toBe(true);
        expect(result.certification.tenantId).toBe(TENANT_ID);
      }
    });

    it('CRT-S-C2: CERTIFICATION_NAME_CONFLICT — returns conflict on P2002', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0' },
      );
      mockPrisma.certification.create.mockRejectedValueOnce(p2002);
      const result = await service.createCertification(CREATE_PARAMS, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('CERTIFICATION_NAME_CONFLICT');
    });

    it('CRT-S-C3: INTERNAL_ERROR — returns error on unexpected DB failure', async () => {
      mockPrisma.certification.create.mockRejectedValueOnce(new Error('DB error'));
      const result = await service.createCertification(CREATE_PARAMS, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('CRT-S-C4: audit — emits WORKFORCE_CERTIFICATION_CREATED after successful create', async () => {
      mockPrisma.certification.create.mockResolvedValueOnce(CERT_ROW);
      await service.createCertification(CREATE_PARAMS, TENANT_ID, ACTOR_ID);
      expect(mockAudit.logEvent).toHaveBeenCalledTimes(1);
      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action:     AuditEventType.WORKFORCE_CERTIFICATION_CREATED,
          tenantId:   TENANT_ID,
          userId:     ACTOR_ID,
          entityType: 'CERTIFICATION',
          entityId:   CERT_ID,
        }),
      );
    });

    it('CRT-S-C5: audit — no event emitted on CERTIFICATION_NAME_CONFLICT', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0' },
      );
      mockPrisma.certification.create.mockRejectedValueOnce(p2002);
      await service.createCertification(CREATE_PARAMS, TENANT_ID, ACTOR_ID);
      expect(mockAudit.logEvent).not.toHaveBeenCalled();
    });

    it('CRT-S-C6: audit — no event emitted on INTERNAL_ERROR', async () => {
      mockPrisma.certification.create.mockRejectedValueOnce(new Error('DB error'));
      await service.createCertification(CREATE_PARAMS, TENANT_ID, ACTOR_ID);
      expect(mockAudit.logEvent).not.toHaveBeenCalled();
    });

    it('CRT-S-C7: SEC-003 — tenantId from context written to certification record', async () => {
      mockPrisma.certification.create.mockResolvedValueOnce(CERT_ROW);
      await service.createCertification(CREATE_PARAMS, TENANT_ID, ACTOR_ID);
      expect(mockPrisma.certification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: TENANT_ID }),
        }),
      );
    });

    it('CRT-S-C8: expirationRequired — written to DB from params', async () => {
      mockPrisma.certification.create.mockResolvedValueOnce(CERT_ROW);
      await service.createCertification(CREATE_PARAMS, TENANT_ID, ACTOR_ID);
      expect(mockPrisma.certification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ expirationRequired: true }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // listCertifications
  // --------------------------------------------------------------------------

  describe('listCertifications', () => {
    it('CRT-S-L1: SUCCESS — returns paginated certification list', async () => {
      mockPrisma.certification.findMany.mockResolvedValueOnce([CERT_ROW]);
      mockPrisma.certification.count.mockResolvedValueOnce(1);
      const result = await service.listCertifications(TENANT_ID, { page: 1, pageSize: 20 });
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.certifications).toHaveLength(1);
        expect(result.total).toBe(1);
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(20);
      }
    });

    it('CRT-S-L2: SUCCESS — returns empty list when no certifications exist', async () => {
      mockPrisma.certification.findMany.mockResolvedValueOnce([]);
      mockPrisma.certification.count.mockResolvedValueOnce(0);
      const result = await service.listCertifications(TENANT_ID, {});
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.certifications).toHaveLength(0);
        expect(result.total).toBe(0);
      }
    });

    it('CRT-S-L3: SEC-003 — tenantId present in findMany WHERE', async () => {
      mockPrisma.certification.findMany.mockResolvedValueOnce([]);
      mockPrisma.certification.count.mockResolvedValueOnce(0);
      await service.listCertifications(TENANT_ID, {});
      expect(mockPrisma.certification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_ID }),
        }),
      );
    });

    it('CRT-S-L4: SEC-003 — deletedAt: null present in findMany WHERE', async () => {
      mockPrisma.certification.findMany.mockResolvedValueOnce([]);
      mockPrisma.certification.count.mockResolvedValueOnce(0);
      await service.listCertifications(TENANT_ID, {});
      expect(mockPrisma.certification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
        }),
      );
    });

    it('CRT-S-L5: pagination — count receives same WHERE clause as findMany', async () => {
      mockPrisma.certification.findMany.mockResolvedValueOnce([]);
      mockPrisma.certification.count.mockResolvedValueOnce(0);
      await service.listCertifications(TENANT_ID, {});
      const findManyWhere = (mockPrisma.certification.findMany.mock.calls[0]![0] as { where: unknown }).where;
      const countWhere    = (mockPrisma.certification.count.mock.calls[0]![0] as { where: unknown }).where;
      expect(countWhere).toEqual(findManyWhere);
    });

    it('CRT-S-L6: INTERNAL_ERROR — returns error on DB failure', async () => {
      mockPrisma.certification.findMany.mockRejectedValueOnce(new Error('DB error'));
      mockPrisma.certification.count.mockRejectedValueOnce(new Error('DB error'));
      const result = await service.listCertifications(TENANT_ID, {});
      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('CRT-S-L7: defaults — page=1 and pageSize=20 used when params omitted', async () => {
      mockPrisma.certification.findMany.mockResolvedValueOnce([]);
      mockPrisma.certification.count.mockResolvedValueOnce(0);
      const result = await service.listCertifications(TENANT_ID, {});
      if (result.outcome === 'SUCCESS') {
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(20);
      }
    });
  });

  // --------------------------------------------------------------------------
  // getCertificationById
  // --------------------------------------------------------------------------

  describe('getCertificationById', () => {
    it('CRT-S-G1: SUCCESS — returns certification when found', async () => {
      mockPrisma.certification.findFirst.mockResolvedValueOnce(CERT_ROW);
      const result = await service.getCertificationById(CERT_ID, TENANT_ID);
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.certification.id).toBe(CERT_ID);
        expect(result.certification.expirationRequired).toBe(true);
      }
    });

    it('CRT-S-G2: NOT_FOUND — returns not found when certification is absent', async () => {
      mockPrisma.certification.findFirst.mockResolvedValueOnce(null);
      const result = await service.getCertificationById(CERT_ID, TENANT_ID);
      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('CRT-S-G3: NOT_FOUND — cross-tenant record returns same as absent (SEC-003, no enumeration)', async () => {
      mockPrisma.certification.findFirst.mockResolvedValueOnce(null);
      const result = await service.getCertificationById(CERT_ID, 'other-tenant-id');
      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('CRT-S-G4: NOT_FOUND — soft-deleted certification excluded by deletedAt: null filter', async () => {
      mockPrisma.certification.findFirst.mockResolvedValueOnce(null);
      const result = await service.getCertificationById(CERT_ID, TENANT_ID);
      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('CRT-S-G5: SEC-003 — WHERE includes id, tenantId, and deletedAt: null', async () => {
      mockPrisma.certification.findFirst.mockResolvedValueOnce(CERT_ROW);
      await service.getCertificationById(CERT_ID, TENANT_ID);
      expect(mockPrisma.certification.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id:        CERT_ID,
            tenantId:  TENANT_ID,
            deletedAt: null,
          }),
        }),
      );
    });

    it('CRT-S-G6: INTERNAL_ERROR — returns error on DB failure', async () => {
      mockPrisma.certification.findFirst.mockRejectedValueOnce(new Error('DB error'));
      const result = await service.getCertificationById(CERT_ID, TENANT_ID);
      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // updateCertification
  // --------------------------------------------------------------------------

  describe('updateCertification', () => {
    it('CRT-S-U1: SUCCESS — updates name field', async () => {
      const updatedRow = { ...CERT_ROW, name: 'PMP — Project Management Professional' };
      mockPrisma.certification.findFirst.mockResolvedValueOnce(CERT_ROW);
      mockPrisma.certification.update.mockResolvedValueOnce(updatedRow);
      const result = await service.updateCertification(CERT_ID, { name: 'PMP — Project Management Professional' }, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.certification.name).toBe('PMP — Project Management Professional');
      }
    });

    it('CRT-S-U2: SUCCESS — toggles expirationRequired', async () => {
      const updatedRow = { ...CERT_ROW, expirationRequired: false };
      mockPrisma.certification.findFirst.mockResolvedValueOnce(CERT_ROW);
      mockPrisma.certification.update.mockResolvedValueOnce(updatedRow);
      const result = await service.updateCertification(CERT_ID, { expirationRequired: false }, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.certification.expirationRequired).toBe(false);
      }
    });

    it('CRT-S-U3: SUCCESS — updates issuer field', async () => {
      const updatedRow = { ...CERT_ROW, issuer: 'PMI Global' };
      mockPrisma.certification.findFirst.mockResolvedValueOnce(CERT_ROW);
      mockPrisma.certification.update.mockResolvedValueOnce(updatedRow);
      const result = await service.updateCertification(CERT_ID, { issuer: 'PMI Global' }, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.certification.issuer).toBe('PMI Global');
      }
    });

    it('CRT-S-U4: NOT_FOUND — returns not found when certification absent', async () => {
      mockPrisma.certification.findFirst.mockResolvedValueOnce(null);
      const result = await service.updateCertification(CERT_ID, { name: 'New Name' }, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('CRT-S-U5: NOT_FOUND — does not attempt prisma.certification.update when not found', async () => {
      mockPrisma.certification.findFirst.mockResolvedValueOnce(null);
      await service.updateCertification(CERT_ID, { name: 'New Name' }, TENANT_ID, ACTOR_ID);
      expect(mockPrisma.certification.update).not.toHaveBeenCalled();
    });

    it('CRT-S-U6: CERTIFICATION_NAME_CONFLICT — returns conflict on P2002 during update', async () => {
      mockPrisma.certification.findFirst.mockResolvedValueOnce(CERT_ROW);
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0' },
      );
      mockPrisma.certification.update.mockRejectedValueOnce(p2002);
      const result = await service.updateCertification(CERT_ID, { name: 'Existing Name' }, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('CERTIFICATION_NAME_CONFLICT');
    });

    it('CRT-S-U7: INTERNAL_ERROR — returns error on unexpected update failure', async () => {
      mockPrisma.certification.findFirst.mockResolvedValueOnce(CERT_ROW);
      mockPrisma.certification.update.mockRejectedValueOnce(new Error('DB error'));
      const result = await service.updateCertification(CERT_ID, { name: 'New Name' }, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('CRT-S-U8: audit — emits WORKFORCE_CERTIFICATION_UPDATED after successful update', async () => {
      mockPrisma.certification.findFirst.mockResolvedValueOnce(CERT_ROW);
      mockPrisma.certification.update.mockResolvedValueOnce(CERT_ROW);
      await service.updateCertification(CERT_ID, { name: 'New Name' }, TENANT_ID, ACTOR_ID);
      expect(mockAudit.logEvent).toHaveBeenCalledTimes(1);
      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action:     AuditEventType.WORKFORCE_CERTIFICATION_UPDATED,
          tenantId:   TENANT_ID,
          userId:     ACTOR_ID,
          entityType: 'CERTIFICATION',
          entityId:   CERT_ID,
        }),
      );
    });

    it('CRT-S-U9: audit — no event emitted on NOT_FOUND', async () => {
      mockPrisma.certification.findFirst.mockResolvedValueOnce(null);
      await service.updateCertification(CERT_ID, { name: 'New Name' }, TENANT_ID, ACTOR_ID);
      expect(mockAudit.logEvent).not.toHaveBeenCalled();
    });

    it('CRT-S-U10: audit — no event emitted on CERTIFICATION_NAME_CONFLICT', async () => {
      mockPrisma.certification.findFirst.mockResolvedValueOnce(CERT_ROW);
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0' },
      );
      mockPrisma.certification.update.mockRejectedValueOnce(p2002);
      await service.updateCertification(CERT_ID, { name: 'Existing Name' }, TENANT_ID, ACTOR_ID);
      expect(mockAudit.logEvent).not.toHaveBeenCalled();
    });

    it('CRT-S-U11: SEC-003 — findFirst WHERE includes id, tenantId, deletedAt: null', async () => {
      mockPrisma.certification.findFirst.mockResolvedValueOnce(CERT_ROW);
      mockPrisma.certification.update.mockResolvedValueOnce(CERT_ROW);
      await service.updateCertification(CERT_ID, { name: 'New Name' }, TENANT_ID, ACTOR_ID);
      expect(mockPrisma.certification.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id:        CERT_ID,
            tenantId:  TENANT_ID,
            deletedAt: null,
          }),
        }),
      );
    });
  });
});
