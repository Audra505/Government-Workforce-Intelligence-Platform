// Reference: spec/01_requirements.md — FR-050 Agency Management
// Reference: directives/12_organization_management_rules.md — AGY-001, AGY-002, AGY-003, ORG-006
//
// Pure unit tests — no database.
// PrismaService replaced with jest.fn() mocks.
// AgencyService has no write operations in Phase 1 (AGY-001): AuditService is not injected.
// ORG-006: getAgency() reads from Tenant (Tenant IS Agency) using tenantId as PK.

import { Test, type TestingModule } from '@nestjs/testing';

import { AgencyService } from './agency.service';
import { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const TENANT_ROW = {
  name: 'Department of Labor',
  code: 'DOL',
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgencyService', () => {
  let service: AgencyService;

  const mockPrisma = {
    tenant: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgencyService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AgencyService>(AgencyService);
  });

  describe('getAgency()', () => {
    it('tenant exists → outcome SUCCESS with AgencyRecord (name, code, status, createdAt)', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(TENANT_ROW);

      const result = await service.getAgency(TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.agency).toMatchObject({
          name: 'Department of Labor',
          code: 'DOL',
          status: 'ACTIVE',
        });
        expect(result.agency.createdAt).toBeInstanceOf(Date);
      }
    });

    it('findUnique returns null → outcome NOT_FOUND', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      const result = await service.getAgency(TENANT_ID);

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.tenant.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await service.getAgency(TENANT_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('AgencyRecord does not contain id field (AGY-003: no internal identifiers)', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(TENANT_ROW);

      const result = await service.getAgency(TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.agency).not.toHaveProperty('id');
      }
    });

    it('findUnique called with { where: { id: tenantId } } (ORG-006: Tenant IS Agency)', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(TENANT_ROW);

      await service.getAgency(TENANT_ID);

      expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: TENANT_ID } }),
      );
    });
  });
});
