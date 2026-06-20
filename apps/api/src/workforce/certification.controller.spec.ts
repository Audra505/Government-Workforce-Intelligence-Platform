// Reference: spec/01_requirements.md — FR-114, FR-151 Certifications Management
// Reference: directives/15_certification_management_rules.md — CRT-100 through CRT-103
// Reference: governance/GD-M13-2.md — API design decisions (Decision 12 RBAC)
//
// Pure unit tests — no HTTP server, no database.
// CertificationService replaced with jest.fn() mocks.
// JwtAuthGuard and RolesGuard overridden to always pass.
// Controller methods called directly with mock RequestUser actor.
// Verifies: HTTP exception types, response envelope shapes, date serialization, error codes.
// RBAC and JWT are infrastructure concerns tested in integration / e2e specs.

import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import { CertificationController } from './certification.controller';
import { CertificationService } from './certification.service';
import type { CertificationRecord } from './certification.service';
import type { RequestUser } from '../identity/jwt.strategy';
import type { CreateCertificationDto } from './dto/create-certification.dto';
import type { UpdateCertificationDto } from './dto/update-certification.dto';
import type { ListCertificationsQueryDto } from './dto/list-certifications-query.dto';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID  = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CERT_ID   = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-01-02T00:00:00.000Z');

const mockActor: RequestUser = {
  userId:   ACTOR_ID,
  tenantId: TENANT_ID,
  email:    'admin@dev.gov',
  roles:    ['System Administrator'],
};

const certRecord: CertificationRecord = {
  id:                 CERT_ID,
  tenantId:           TENANT_ID,
  name:               'Project Management Professional (PMP)',
  issuer:             'Project Management Institute',
  expirationRequired: true,
  createdAt:          CREATED_AT,
  updatedAt:          UPDATED_AT,
};

const createDto: CreateCertificationDto = {
  name:               'Project Management Professional (PMP)',
  expirationRequired: true,
  issuer:             'Project Management Institute',
};

const updateDto: UpdateCertificationDto = { name: 'PMP — Project Management Professional' };

const listQuery: ListCertificationsQueryDto = { page: 1, pageSize: 20 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CertificationController', () => {
  let controller: CertificationController;
  let mockService: {
    createCertification:  jest.Mock;
    listCertifications:   jest.Mock;
    getCertificationById: jest.Mock;
    updateCertification:  jest.Mock;
  };

  beforeEach(async () => {
    mockService = {
      createCertification:  jest.fn(),
      listCertifications:   jest.fn(),
      getCertificationById: jest.fn(),
      updateCertification:  jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CertificationController],
      providers: [
        { provide: CertificationService, useValue: mockService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CertificationController>(CertificationController);
  });

  afterEach(() => jest.clearAllMocks());

  // --------------------------------------------------------------------------
  // createCertification()
  // --------------------------------------------------------------------------

  describe('createCertification()', () => {
    it('SUCCESS: returns { success: true, data: certification shape }', async () => {
      mockService.createCertification.mockResolvedValue({ outcome: 'SUCCESS', certification: certRecord });
      const result = await controller.createCertification(createDto, mockActor) as Record<string, unknown>;
      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({
        id:                 CERT_ID,
        name:               'Project Management Professional (PMP)',
        expirationRequired: true,
      });
    });

    it('SUCCESS: createdAt and updatedAt serialized as ISO 8601 strings', async () => {
      mockService.createCertification.mockResolvedValue({ outcome: 'SUCCESS', certification: certRecord });
      const result = await controller.createCertification(createDto, mockActor) as Record<string, Record<string, unknown>>;
      expect(result['data']!['createdAt']).toBe(CREATED_AT.toISOString());
      expect(result['data']!['updatedAt']).toBe(UPDATED_AT.toISOString());
    });

    it('SUCCESS: tenantId absent from response (SEC-003)', async () => {
      mockService.createCertification.mockResolvedValue({ outcome: 'SUCCESS', certification: certRecord });
      const result = await controller.createCertification(createDto, mockActor) as Record<string, Record<string, unknown>>;
      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: actor.tenantId and actor.userId forwarded to service — not from DTO (SEC-003)', async () => {
      mockService.createCertification.mockResolvedValue({ outcome: 'SUCCESS', certification: certRecord });
      await controller.createCertification(createDto, mockActor);
      expect(mockService.createCertification).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Project Management Professional (PMP)', expirationRequired: true }),
        TENANT_ID,
        ACTOR_ID,
      );
    });

    it('CERTIFICATION_NAME_CONFLICT: throws ConflictException with code CERTIFICATION_NAME_CONFLICT', async () => {
      mockService.createCertification.mockResolvedValue({ outcome: 'CERTIFICATION_NAME_CONFLICT' });
      let thrown: unknown;
      try { await controller.createCertification(createDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(ConflictException);
      const body = (thrown as ConflictException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']!['code']).toBe('CERTIFICATION_NAME_CONFLICT');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException with code INTERNAL_ERROR', async () => {
      mockService.createCertification.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });
      let thrown: unknown;
      try { await controller.createCertification(createDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(InternalServerErrorException);
      const body = (thrown as InternalServerErrorException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']!['code']).toBe('INTERNAL_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // listCertifications()
  // --------------------------------------------------------------------------

  describe('listCertifications()', () => {
    it('SUCCESS: returns { success: true, data: paginated shape }', async () => {
      mockService.listCertifications.mockResolvedValue({
        outcome: 'SUCCESS',
        certifications: [certRecord],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      const result = await controller.listCertifications(listQuery, mockActor) as Record<string, unknown>;
      expect(result['success']).toBe(true);
      const data = result['data'] as Record<string, unknown>;
      expect(data['total']).toBe(1);
      expect(data['page']).toBe(1);
      expect(data['pageSize']).toBe(20);
      expect((data['certifications'] as unknown[]).length).toBe(1);
    });

    it('SUCCESS: totalPages calculated correctly', async () => {
      mockService.listCertifications.mockResolvedValue({
        outcome: 'SUCCESS',
        certifications: [],
        total: 45,
        page: 1,
        pageSize: 20,
      });
      const result = await controller.listCertifications(listQuery, mockActor) as Record<string, Record<string, unknown>>;
      expect(result['data']!['totalPages']).toBe(3);
    });

    it('SUCCESS: actor.tenantId forwarded to service', async () => {
      mockService.listCertifications.mockResolvedValue({
        outcome: 'SUCCESS',
        certifications: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
      await controller.listCertifications(listQuery, mockActor);
      expect(mockService.listCertifications).toHaveBeenCalledWith(TENANT_ID, expect.anything());
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.listCertifications.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });
      let thrown: unknown;
      try { await controller.listCertifications(listQuery, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // getCertificationById()
  // --------------------------------------------------------------------------

  describe('getCertificationById()', () => {
    it('SUCCESS: returns { success: true, data: certification }', async () => {
      mockService.getCertificationById.mockResolvedValue({ outcome: 'SUCCESS', certification: certRecord });
      const result = await controller.getCertificationById(CERT_ID, mockActor) as Record<string, unknown>;
      expect(result['success']).toBe(true);
      const data = result['data'] as Record<string, unknown>;
      expect(data['id']).toBe(CERT_ID);
      expect(data['expirationRequired']).toBe(true);
    });

    it('SUCCESS: tenantId absent from response (SEC-003)', async () => {
      mockService.getCertificationById.mockResolvedValue({ outcome: 'SUCCESS', certification: certRecord });
      const result = await controller.getCertificationById(CERT_ID, mockActor) as Record<string, Record<string, unknown>>;
      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: actor.tenantId forwarded to service', async () => {
      mockService.getCertificationById.mockResolvedValue({ outcome: 'SUCCESS', certification: certRecord });
      await controller.getCertificationById(CERT_ID, mockActor);
      expect(mockService.getCertificationById).toHaveBeenCalledWith(CERT_ID, TENANT_ID);
    });

    it('NOT_FOUND: throws NotFoundException with code NOT_FOUND', async () => {
      mockService.getCertificationById.mockResolvedValue({ outcome: 'NOT_FOUND' });
      let thrown: unknown;
      try { await controller.getCertificationById(CERT_ID, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(NotFoundException);
      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']!['code']).toBe('NOT_FOUND');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.getCertificationById.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });
      let thrown: unknown;
      try { await controller.getCertificationById(CERT_ID, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // updateCertification()
  // --------------------------------------------------------------------------

  describe('updateCertification()', () => {
    it('SUCCESS: returns { success: true, data: updated certification }', async () => {
      const updated = { ...certRecord, name: 'PMP — Project Management Professional' };
      mockService.updateCertification.mockResolvedValue({ outcome: 'SUCCESS', certification: updated });
      const result = await controller.updateCertification(CERT_ID, updateDto, mockActor) as Record<string, unknown>;
      expect(result['success']).toBe(true);
      expect((result['data'] as Record<string, unknown>)['name']).toBe('PMP — Project Management Professional');
    });

    it('SUCCESS: actor.tenantId and actor.userId forwarded to service', async () => {
      mockService.updateCertification.mockResolvedValue({ outcome: 'SUCCESS', certification: certRecord });
      await controller.updateCertification(CERT_ID, updateDto, mockActor);
      expect(mockService.updateCertification).toHaveBeenCalledWith(
        CERT_ID,
        expect.anything(),
        TENANT_ID,
        ACTOR_ID,
      );
    });

    it('NOT_FOUND: throws NotFoundException with code NOT_FOUND', async () => {
      mockService.updateCertification.mockResolvedValue({ outcome: 'NOT_FOUND' });
      let thrown: unknown;
      try { await controller.updateCertification(CERT_ID, updateDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(NotFoundException);
      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']!['code']).toBe('NOT_FOUND');
    });

    it('CERTIFICATION_NAME_CONFLICT: throws ConflictException with code CERTIFICATION_NAME_CONFLICT', async () => {
      mockService.updateCertification.mockResolvedValue({ outcome: 'CERTIFICATION_NAME_CONFLICT' });
      let thrown: unknown;
      try { await controller.updateCertification(CERT_ID, updateDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(ConflictException);
      const body = (thrown as ConflictException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']!['code']).toBe('CERTIFICATION_NAME_CONFLICT');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.updateCertification.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });
      let thrown: unknown;
      try { await controller.updateCertification(CERT_ID, updateDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(InternalServerErrorException);
    });
  });
});
