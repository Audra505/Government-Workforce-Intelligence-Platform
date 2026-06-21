// Reference: spec/01_requirements.md — FR-113, FR-150 Skills Management
// Reference: directives/14_skill_management_rules.md — SKL-001 through SKL-400
// Reference: governance/GD-M13-2.md — API design decisions
// Reference: governance/GD-M13-4.md — audit event requirements
//
// Pure unit tests — no database, no HTTP server.
// PrismaService and AuditService replaced with jest.fn() mocks.
// Verifies all discriminated-union outcomes for each SkillService method.
//
// SEC-003 tenant isolation (GD-M13-1 Decision 3):
//   tenantId and deletedAt: null must be present in all read WHERE clauses.
// SKL-003: P2002 → SKILL_NAME_CONFLICT.
// GD-M13-4 Decision 4: audit emitted after write on SUCCESS only — not on failure paths.

import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { SkillService } from './skill.service';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import type { CreateSkillParams } from './skill.service';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID  = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SKILL_ID  = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-01-02T00:00:00.000Z');

const SKILL_ROW = {
  id:          SKILL_ID,
  tenantId:    TENANT_ID,
  name:        'Python Programming',
  category:    'Programming Languages' as string | null,
  description: null as string | null,
  createdAt:   CREATED_AT,
  updatedAt:   UPDATED_AT,
};

const CREATE_PARAMS: CreateSkillParams = {
  name:     'Python Programming',
  category: 'Programming Languages',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SkillService', () => {
  let service: SkillService;

  const mockPrisma = {
    skill: {
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
        SkillService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService,  useValue: mockAudit },
      ],
    }).compile();
    service = module.get(SkillService);
  });

  // --------------------------------------------------------------------------
  // createSkill
  // --------------------------------------------------------------------------

  describe('createSkill', () => {
    it('SKL-S-C1: SUCCESS — returns skill record on happy path', async () => {
      mockPrisma.skill.create.mockResolvedValueOnce(SKILL_ROW);
      const result = await service.createSkill(CREATE_PARAMS, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.skill.id).toBe(SKILL_ID);
        expect(result.skill.name).toBe('Python Programming');
        expect(result.skill.tenantId).toBe(TENANT_ID);
      }
    });

    it('SKL-S-C2: SKILL_NAME_CONFLICT — returns conflict on P2002', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0' },
      );
      mockPrisma.skill.create.mockRejectedValueOnce(p2002);
      const result = await service.createSkill(CREATE_PARAMS, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('SKILL_NAME_CONFLICT');
    });

    it('SKL-S-C3: INTERNAL_ERROR — returns error on unexpected DB failure', async () => {
      mockPrisma.skill.create.mockRejectedValueOnce(new Error('DB error'));
      const result = await service.createSkill(CREATE_PARAMS, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('SKL-S-C4: audit — emits WORKFORCE_SKILL_CREATED after successful create', async () => {
      mockPrisma.skill.create.mockResolvedValueOnce(SKILL_ROW);
      await service.createSkill(CREATE_PARAMS, TENANT_ID, ACTOR_ID);
      expect(mockAudit.logEvent).toHaveBeenCalledTimes(1);
      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action:     AuditEventType.WORKFORCE_SKILL_CREATED,
          tenantId:   TENANT_ID,
          userId:     ACTOR_ID,
          entityType: 'SKILL',
          entityId:   SKILL_ID,
        }),
      );
    });

    it('SKL-S-C5: audit — no event emitted on SKILL_NAME_CONFLICT', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0' },
      );
      mockPrisma.skill.create.mockRejectedValueOnce(p2002);
      await service.createSkill(CREATE_PARAMS, TENANT_ID, ACTOR_ID);
      expect(mockAudit.logEvent).not.toHaveBeenCalled();
    });

    it('SKL-S-C6: audit — no event emitted on INTERNAL_ERROR', async () => {
      mockPrisma.skill.create.mockRejectedValueOnce(new Error('DB error'));
      await service.createSkill(CREATE_PARAMS, TENANT_ID, ACTOR_ID);
      expect(mockAudit.logEvent).not.toHaveBeenCalled();
    });

    it('SKL-S-C7: SEC-003 — tenantId from context written to skill record', async () => {
      mockPrisma.skill.create.mockResolvedValueOnce(SKILL_ROW);
      await service.createSkill(CREATE_PARAMS, TENANT_ID, ACTOR_ID);
      expect(mockPrisma.skill.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: TENANT_ID }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // listSkills
  // --------------------------------------------------------------------------

  describe('listSkills', () => {
    it('SKL-S-L1: SUCCESS — returns paginated skill list', async () => {
      mockPrisma.skill.findMany.mockResolvedValueOnce([SKILL_ROW]);
      mockPrisma.skill.count.mockResolvedValueOnce(1);
      const result = await service.listSkills(TENANT_ID, { page: 1, pageSize: 20 });
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.skills).toHaveLength(1);
        expect(result.total).toBe(1);
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(20);
      }
    });

    it('SKL-S-L2: SUCCESS — returns empty list when no skills exist', async () => {
      mockPrisma.skill.findMany.mockResolvedValueOnce([]);
      mockPrisma.skill.count.mockResolvedValueOnce(0);
      const result = await service.listSkills(TENANT_ID, {});
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.skills).toHaveLength(0);
        expect(result.total).toBe(0);
      }
    });

    it('SKL-S-L3: SEC-003 — tenantId present in findMany WHERE', async () => {
      mockPrisma.skill.findMany.mockResolvedValueOnce([]);
      mockPrisma.skill.count.mockResolvedValueOnce(0);
      await service.listSkills(TENANT_ID, {});
      expect(mockPrisma.skill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_ID }),
        }),
      );
    });

    it('SKL-S-L4: SEC-003 — deletedAt: null present in findMany WHERE', async () => {
      mockPrisma.skill.findMany.mockResolvedValueOnce([]);
      mockPrisma.skill.count.mockResolvedValueOnce(0);
      await service.listSkills(TENANT_ID, {});
      expect(mockPrisma.skill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
        }),
      );
    });

    it('SKL-S-L5: category filter — applied to findMany WHERE when provided', async () => {
      mockPrisma.skill.findMany.mockResolvedValueOnce([]);
      mockPrisma.skill.count.mockResolvedValueOnce(0);
      await service.listSkills(TENANT_ID, { category: 'Programming Languages' });
      expect(mockPrisma.skill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: 'Programming Languages' }),
        }),
      );
    });

    it('SKL-S-L6: pagination — count receives same WHERE clause as findMany', async () => {
      mockPrisma.skill.findMany.mockResolvedValueOnce([]);
      mockPrisma.skill.count.mockResolvedValueOnce(0);
      await service.listSkills(TENANT_ID, { category: 'Programming Languages' });
      const findManyWhere = (mockPrisma.skill.findMany.mock.calls[0]![0] as { where: unknown }).where;
      const countWhere    = (mockPrisma.skill.count.mock.calls[0]![0] as { where: unknown }).where;
      expect(countWhere).toEqual(findManyWhere);
    });

    it('SKL-S-L7: INTERNAL_ERROR — returns error on DB failure', async () => {
      mockPrisma.skill.findMany.mockRejectedValueOnce(new Error('DB error'));
      mockPrisma.skill.count.mockRejectedValueOnce(new Error('DB error'));
      const result = await service.listSkills(TENANT_ID, {});
      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('SKL-S-L8: defaults — page=1 and pageSize=20 used when params omitted', async () => {
      mockPrisma.skill.findMany.mockResolvedValueOnce([]);
      mockPrisma.skill.count.mockResolvedValueOnce(0);
      const result = await service.listSkills(TENANT_ID, {});
      if (result.outcome === 'SUCCESS') {
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(20);
      }
    });
  });

  // --------------------------------------------------------------------------
  // getSkillById
  // --------------------------------------------------------------------------

  describe('getSkillById', () => {
    it('SKL-S-G1: SUCCESS — returns skill when found', async () => {
      mockPrisma.skill.findFirst.mockResolvedValueOnce(SKILL_ROW);
      const result = await service.getSkillById(SKILL_ID, TENANT_ID);
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.skill.id).toBe(SKILL_ID);
      }
    });

    it('SKL-S-G2: NOT_FOUND — returns not found when skill is absent', async () => {
      mockPrisma.skill.findFirst.mockResolvedValueOnce(null);
      const result = await service.getSkillById(SKILL_ID, TENANT_ID);
      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('SKL-S-G3: NOT_FOUND — cross-tenant record returns same as absent (SEC-003, no enumeration)', async () => {
      // tenantId filter excludes cross-tenant record; findFirst returns null
      mockPrisma.skill.findFirst.mockResolvedValueOnce(null);
      const result = await service.getSkillById(SKILL_ID, 'other-tenant-id');
      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('SKL-S-G4: NOT_FOUND — soft-deleted skill excluded by deletedAt: null filter', async () => {
      // deletedAt filter excludes soft-deleted record; findFirst returns null
      mockPrisma.skill.findFirst.mockResolvedValueOnce(null);
      const result = await service.getSkillById(SKILL_ID, TENANT_ID);
      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('SKL-S-G5: SEC-003 — WHERE includes id, tenantId, and deletedAt: null', async () => {
      mockPrisma.skill.findFirst.mockResolvedValueOnce(SKILL_ROW);
      await service.getSkillById(SKILL_ID, TENANT_ID);
      expect(mockPrisma.skill.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id:        SKILL_ID,
            tenantId:  TENANT_ID,
            deletedAt: null,
          }),
        }),
      );
    });

    it('SKL-S-G6: INTERNAL_ERROR — returns error on DB failure', async () => {
      mockPrisma.skill.findFirst.mockRejectedValueOnce(new Error('DB error'));
      const result = await service.getSkillById(SKILL_ID, TENANT_ID);
      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // updateSkill
  // --------------------------------------------------------------------------

  describe('updateSkill', () => {
    it('SKL-S-U1: SUCCESS — updates name field', async () => {
      const updatedRow = { ...SKILL_ROW, name: 'Python 3 Programming' };
      mockPrisma.skill.findFirst.mockResolvedValueOnce(SKILL_ROW);
      mockPrisma.skill.update.mockResolvedValueOnce(updatedRow);
      const result = await service.updateSkill(SKILL_ID, { name: 'Python 3 Programming' }, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.skill.name).toBe('Python 3 Programming');
      }
    });

    it('SKL-S-U2: SUCCESS — updates category field', async () => {
      const updatedRow = { ...SKILL_ROW, category: 'Software Development' };
      mockPrisma.skill.findFirst.mockResolvedValueOnce(SKILL_ROW);
      mockPrisma.skill.update.mockResolvedValueOnce(updatedRow);
      const result = await service.updateSkill(SKILL_ID, { category: 'Software Development' }, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.skill.category).toBe('Software Development');
      }
    });

    it('SKL-S-U3: NOT_FOUND — returns not found when skill absent', async () => {
      mockPrisma.skill.findFirst.mockResolvedValueOnce(null);
      const result = await service.updateSkill(SKILL_ID, { name: 'New Name' }, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('SKL-S-U4: NOT_FOUND — does not attempt prisma.skill.update when not found', async () => {
      mockPrisma.skill.findFirst.mockResolvedValueOnce(null);
      await service.updateSkill(SKILL_ID, { name: 'New Name' }, TENANT_ID, ACTOR_ID);
      expect(mockPrisma.skill.update).not.toHaveBeenCalled();
    });

    it('SKL-S-U5: SKILL_NAME_CONFLICT — returns conflict on P2002 during update', async () => {
      mockPrisma.skill.findFirst.mockResolvedValueOnce(SKILL_ROW);
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0' },
      );
      mockPrisma.skill.update.mockRejectedValueOnce(p2002);
      const result = await service.updateSkill(SKILL_ID, { name: 'Existing Name' }, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('SKILL_NAME_CONFLICT');
    });

    it('SKL-S-U6: INTERNAL_ERROR — returns error on unexpected update failure', async () => {
      mockPrisma.skill.findFirst.mockResolvedValueOnce(SKILL_ROW);
      mockPrisma.skill.update.mockRejectedValueOnce(new Error('DB error'));
      const result = await service.updateSkill(SKILL_ID, { name: 'New Name' }, TENANT_ID, ACTOR_ID);
      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('SKL-S-U7: audit — emits WORKFORCE_SKILL_UPDATED after successful update', async () => {
      mockPrisma.skill.findFirst.mockResolvedValueOnce(SKILL_ROW);
      mockPrisma.skill.update.mockResolvedValueOnce(SKILL_ROW);
      await service.updateSkill(SKILL_ID, { name: 'Python 3 Programming' }, TENANT_ID, ACTOR_ID);
      expect(mockAudit.logEvent).toHaveBeenCalledTimes(1);
      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action:     AuditEventType.WORKFORCE_SKILL_UPDATED,
          tenantId:   TENANT_ID,
          userId:     ACTOR_ID,
          entityType: 'SKILL',
          entityId:   SKILL_ID,
        }),
      );
    });

    it('SKL-S-U8: audit — no event emitted on NOT_FOUND', async () => {
      mockPrisma.skill.findFirst.mockResolvedValueOnce(null);
      await service.updateSkill(SKILL_ID, { name: 'New Name' }, TENANT_ID, ACTOR_ID);
      expect(mockAudit.logEvent).not.toHaveBeenCalled();
    });

    it('SKL-S-U9: audit — no event emitted on SKILL_NAME_CONFLICT', async () => {
      mockPrisma.skill.findFirst.mockResolvedValueOnce(SKILL_ROW);
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0' },
      );
      mockPrisma.skill.update.mockRejectedValueOnce(p2002);
      await service.updateSkill(SKILL_ID, { name: 'Existing Name' }, TENANT_ID, ACTOR_ID);
      expect(mockAudit.logEvent).not.toHaveBeenCalled();
    });

    it('SKL-S-U10: SEC-003 — findFirst WHERE includes id, tenantId, deletedAt: null', async () => {
      mockPrisma.skill.findFirst.mockResolvedValueOnce(SKILL_ROW);
      mockPrisma.skill.update.mockResolvedValueOnce(SKILL_ROW);
      await service.updateSkill(SKILL_ID, { name: 'New Name' }, TENANT_ID, ACTOR_ID);
      expect(mockPrisma.skill.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id:        SKILL_ID,
            tenantId:  TENANT_ID,
            deletedAt: null,
          }),
        }),
      );
    });
  });
});
