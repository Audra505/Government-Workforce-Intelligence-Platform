// Reference: spec/01_requirements.md — FR-113, FR-150 Skills Management
// Reference: directives/14_skill_management_rules.md — SKL-100 through SKL-103
// Reference: governance/GD-M13-2.md — API design decisions (Decision 12 RBAC)
//
// Pure unit tests — no HTTP server, no database.
// SkillService replaced with jest.fn() mocks.
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
import { SkillController } from './skill.controller';
import { SkillService } from './skill.service';
import type { SkillRecord } from './skill.service';
import type { RequestUser } from '../identity/jwt.strategy';
import type { CreateSkillDto } from './dto/create-skill.dto';
import type { UpdateSkillDto } from './dto/update-skill.dto';
import type { ListSkillsQueryDto } from './dto/list-skills-query.dto';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID  = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SKILL_ID  = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-01-02T00:00:00.000Z');

const mockActor: RequestUser = {
  userId:   ACTOR_ID,
  tenantId: TENANT_ID,
  email:    'admin@dev.gov',
  roles:    ['System Administrator'],
};

const skillRecord: SkillRecord = {
  id:          SKILL_ID,
  tenantId:    TENANT_ID,
  name:        'Python Programming',
  category:    'Programming Languages',
  description: null,
  createdAt:   CREATED_AT,
  updatedAt:   UPDATED_AT,
};

const createDto: CreateSkillDto = {
  name:     'Python Programming',
  category: 'Programming Languages',
};

const updateDto: UpdateSkillDto = { name: 'Python 3 Programming' };

const listQuery: ListSkillsQueryDto = { page: 1, pageSize: 20 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SkillController', () => {
  let controller: SkillController;
  let mockService: {
    createSkill:  jest.Mock;
    listSkills:   jest.Mock;
    getSkillById: jest.Mock;
    updateSkill:  jest.Mock;
  };

  beforeEach(async () => {
    mockService = {
      createSkill:  jest.fn(),
      listSkills:   jest.fn(),
      getSkillById: jest.fn(),
      updateSkill:  jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SkillController],
      providers: [
        { provide: SkillService, useValue: mockService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<SkillController>(SkillController);
  });

  afterEach(() => jest.clearAllMocks());

  // --------------------------------------------------------------------------
  // createSkill()
  // --------------------------------------------------------------------------

  describe('createSkill()', () => {
    it('SUCCESS: returns { success: true, data: skill shape }', async () => {
      mockService.createSkill.mockResolvedValue({ outcome: 'SUCCESS', skill: skillRecord });
      const result = await controller.createSkill(createDto, mockActor) as Record<string, unknown>;
      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: SKILL_ID, name: 'Python Programming' });
    });

    it('SUCCESS: createdAt and updatedAt serialized as ISO 8601 strings', async () => {
      mockService.createSkill.mockResolvedValue({ outcome: 'SUCCESS', skill: skillRecord });
      const result = await controller.createSkill(createDto, mockActor) as Record<string, Record<string, unknown>>;
      expect(result['data']!['createdAt']).toBe(CREATED_AT.toISOString());
      expect(result['data']!['updatedAt']).toBe(UPDATED_AT.toISOString());
    });

    it('SUCCESS: tenantId absent from response (SEC-003)', async () => {
      mockService.createSkill.mockResolvedValue({ outcome: 'SUCCESS', skill: skillRecord });
      const result = await controller.createSkill(createDto, mockActor) as Record<string, Record<string, unknown>>;
      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: actor.tenantId and actor.userId forwarded to service — not from DTO (SEC-003)', async () => {
      mockService.createSkill.mockResolvedValue({ outcome: 'SUCCESS', skill: skillRecord });
      await controller.createSkill(createDto, mockActor);
      expect(mockService.createSkill).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Python Programming' }),
        TENANT_ID,
        ACTOR_ID,
      );
    });

    it('SKILL_NAME_CONFLICT: throws ConflictException with code SKILL_NAME_CONFLICT', async () => {
      mockService.createSkill.mockResolvedValue({ outcome: 'SKILL_NAME_CONFLICT' });
      let thrown: unknown;
      try { await controller.createSkill(createDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(ConflictException);
      const body = (thrown as ConflictException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']!['code']).toBe('SKILL_NAME_CONFLICT');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException with code INTERNAL_ERROR', async () => {
      mockService.createSkill.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });
      let thrown: unknown;
      try { await controller.createSkill(createDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(InternalServerErrorException);
      const body = (thrown as InternalServerErrorException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']!['code']).toBe('INTERNAL_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // listSkills()
  // --------------------------------------------------------------------------

  describe('listSkills()', () => {
    it('SUCCESS: returns { success: true, data: paginated shape }', async () => {
      mockService.listSkills.mockResolvedValue({
        outcome: 'SUCCESS',
        skills: [skillRecord],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      const result = await controller.listSkills(listQuery, mockActor) as Record<string, unknown>;
      expect(result['success']).toBe(true);
      const data = result['data'] as Record<string, unknown>;
      expect(data['total']).toBe(1);
      expect(data['page']).toBe(1);
      expect(data['pageSize']).toBe(20);
      expect(Array.isArray(data['skills'])).toBe(true);
      expect((data['skills'] as unknown[]).length).toBe(1);
    });

    it('SUCCESS: totalPages calculated correctly', async () => {
      mockService.listSkills.mockResolvedValue({
        outcome: 'SUCCESS',
        skills: [],
        total: 45,
        page: 1,
        pageSize: 20,
      });
      const result = await controller.listSkills(listQuery, mockActor) as Record<string, Record<string, unknown>>;
      expect(result['data']!['totalPages']).toBe(3);
    });

    it('SUCCESS: actor.tenantId forwarded to service', async () => {
      mockService.listSkills.mockResolvedValue({
        outcome: 'SUCCESS',
        skills: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
      await controller.listSkills(listQuery, mockActor);
      expect(mockService.listSkills).toHaveBeenCalledWith(
        TENANT_ID,
        expect.anything(),
      );
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.listSkills.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });
      let thrown: unknown;
      try { await controller.listSkills(listQuery, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(InternalServerErrorException);
      const body = (thrown as InternalServerErrorException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']!['code']).toBe('INTERNAL_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // getSkillById()
  // --------------------------------------------------------------------------

  describe('getSkillById()', () => {
    it('SUCCESS: returns { success: true, data: skill }', async () => {
      mockService.getSkillById.mockResolvedValue({ outcome: 'SUCCESS', skill: skillRecord });
      const result = await controller.getSkillById(SKILL_ID, mockActor) as Record<string, unknown>;
      expect(result['success']).toBe(true);
      expect((result['data'] as Record<string, unknown>)['id']).toBe(SKILL_ID);
    });

    it('SUCCESS: tenantId absent from response (SEC-003)', async () => {
      mockService.getSkillById.mockResolvedValue({ outcome: 'SUCCESS', skill: skillRecord });
      const result = await controller.getSkillById(SKILL_ID, mockActor) as Record<string, Record<string, unknown>>;
      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: actor.tenantId forwarded to service', async () => {
      mockService.getSkillById.mockResolvedValue({ outcome: 'SUCCESS', skill: skillRecord });
      await controller.getSkillById(SKILL_ID, mockActor);
      expect(mockService.getSkillById).toHaveBeenCalledWith(SKILL_ID, TENANT_ID);
    });

    it('NOT_FOUND: throws NotFoundException with code NOT_FOUND', async () => {
      mockService.getSkillById.mockResolvedValue({ outcome: 'NOT_FOUND' });
      let thrown: unknown;
      try { await controller.getSkillById(SKILL_ID, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(NotFoundException);
      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']!['code']).toBe('NOT_FOUND');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.getSkillById.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });
      let thrown: unknown;
      try { await controller.getSkillById(SKILL_ID, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // updateSkill()
  // --------------------------------------------------------------------------

  describe('updateSkill()', () => {
    it('SUCCESS: returns { success: true, data: updated skill }', async () => {
      const updated = { ...skillRecord, name: 'Python 3 Programming' };
      mockService.updateSkill.mockResolvedValue({ outcome: 'SUCCESS', skill: updated });
      const result = await controller.updateSkill(SKILL_ID, updateDto, mockActor) as Record<string, unknown>;
      expect(result['success']).toBe(true);
      expect((result['data'] as Record<string, unknown>)['name']).toBe('Python 3 Programming');
    });

    it('SUCCESS: actor.tenantId and actor.userId forwarded to service', async () => {
      mockService.updateSkill.mockResolvedValue({ outcome: 'SUCCESS', skill: skillRecord });
      await controller.updateSkill(SKILL_ID, updateDto, mockActor);
      expect(mockService.updateSkill).toHaveBeenCalledWith(
        SKILL_ID,
        expect.anything(),
        TENANT_ID,
        ACTOR_ID,
      );
    });

    it('NOT_FOUND: throws NotFoundException with code NOT_FOUND', async () => {
      mockService.updateSkill.mockResolvedValue({ outcome: 'NOT_FOUND' });
      let thrown: unknown;
      try { await controller.updateSkill(SKILL_ID, updateDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(NotFoundException);
      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']!['code']).toBe('NOT_FOUND');
    });

    it('SKILL_NAME_CONFLICT: throws ConflictException with code SKILL_NAME_CONFLICT', async () => {
      mockService.updateSkill.mockResolvedValue({ outcome: 'SKILL_NAME_CONFLICT' });
      let thrown: unknown;
      try { await controller.updateSkill(SKILL_ID, updateDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(ConflictException);
      const body = (thrown as ConflictException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']!['code']).toBe('SKILL_NAME_CONFLICT');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.updateSkill.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });
      let thrown: unknown;
      try { await controller.updateSkill(SKILL_ID, updateDto, mockActor); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(InternalServerErrorException);
    });
  });
});
