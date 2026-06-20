// Reference: directives/14_skill_management_rules.md — SKL-200 through SKL-211
// Reference: governance/GD-M13-4.md — Decision 3 (upsert semantics), Decision 5 (UPDATED metadata)
// Reference: governance/GD-M13-2.md — Decision 6, 14 (response contract), 15 (HTTP status)
//
// Pure unit tests — no HTTP server, no database.
// PrismaService and AuditService replaced with jest.fn() mocks.
// Tests verify: EMP-302 enforcement, SEC-003 WHERE clause, upsert branch selection,
// partial update semantics, audit event type and metadata, SEC-003 no-enumeration,
// proficiency level validation.

import { Test, type TestingModule } from '@nestjs/testing';

import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import { PrismaService } from '../database/prisma.service';
import { EmployeeSkillService } from './employee-skill.service';
import type { AssignSkillParams } from './employee-skill.service';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID    = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const EMPLOYEE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SKILL_ID    = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const VERIFIED_AT = new Date('2026-06-15T14:32:00.000Z');

const ACTIVE_EMP    = { employmentStatus: 'ACTIVE' };
const SEPARATED_EMP = { employmentStatus: 'SEPARATED' };
const SKILL_STUB    = { id: SKILL_ID };

const ASSIGN_PARAMS: AssignSkillParams = {
  employeeId:      EMPLOYEE_ID,
  skillId:         SKILL_ID,
  proficiencyLevel: 'ADVANCED',
  verifiedAt:      VERIFIED_AT,
};

// Row returned from Prisma create/update (includes skill JOIN)
const ASSIGNMENT_ROW = {
  skillId:         SKILL_ID,
  proficiencyLevel: 'ADVANCED',
  verifiedAt:      VERIFIED_AT,
  skill: { name: 'Python Programming', category: 'Technical' },
};

// Existing record fetched before UPDATE path
const EXISTING_ROW = {
  proficiencyLevel: 'DEVELOPING',
  verifiedAt:      null as Date | null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmployeeSkillService', () => {
  let service: EmployeeSkillService;
  let mockPrisma: {
    employee:      { findFirst: jest.Mock };
    skill:         { findFirst: jest.Mock };
    employeeSkill: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock; findMany: jest.Mock };
  };
  let mockAudit: { logEvent: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      employee:      { findFirst: jest.fn() },
      skill:         { findFirst: jest.fn() },
      employeeSkill: {
        findFirst: jest.fn(),
        create:    jest.fn(),
        update:    jest.fn(),
        findMany:  jest.fn(),
      },
    };
    mockAudit = { logEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeeSkillService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService,  useValue: mockAudit },
      ],
    }).compile();

    service = module.get<EmployeeSkillService>(EmployeeSkillService);
  });

  afterEach(() => jest.clearAllMocks());

  // --------------------------------------------------------------------------
  // assignSkill — INSERT path (ASSIGNED)
  // --------------------------------------------------------------------------

  describe('assignSkill() — INSERT path', () => {
    beforeEach(() => {
      mockPrisma.employee.findFirst.mockResolvedValue(ACTIVE_EMP);
      mockPrisma.skill.findFirst.mockResolvedValue(SKILL_STUB);
      mockPrisma.employeeSkill.findFirst.mockResolvedValue(null); // no existing record
      mockPrisma.employeeSkill.create.mockResolvedValue(ASSIGNMENT_ROW);
    });

    it('ESS-S-A1: ASSIGNED — full fields stored and returned', async () => {
      const result = await service.assignSkill(ASSIGN_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('ASSIGNED');
      if (result.outcome !== 'ASSIGNED') return;
      expect(result.assignment.skillId).toBe(SKILL_ID);
      expect(result.assignment.skillName).toBe('Python Programming');
      expect(result.assignment.skillCategory).toBe('Technical');
      expect(result.assignment.proficiencyLevel).toBe('ADVANCED');
      expect(result.assignment.verifiedAt).toEqual(VERIFIED_AT);
    });

    it('ESS-S-A2: ASSIGNED — proficiencyLevel omitted; create called with null', async () => {
      const params = { ...ASSIGN_PARAMS, proficiencyLevel: undefined };
      await service.assignSkill(params, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.employeeSkill.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ proficiencyLevel: null }),
        }),
      );
    });

    it('ESS-S-A3: ASSIGNED — verifiedAt omitted; create called with null', async () => {
      const params = { ...ASSIGN_PARAMS, verifiedAt: undefined };
      await service.assignSkill(params, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.employeeSkill.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ verifiedAt: null }),
        }),
      );
    });

    it('ESS-S-A16: ASSIGNED — emits WORKFORCE_EMPLOYEE_SKILL_ASSIGNED', async () => {
      await service.assignSkill(ASSIGN_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.WORKFORCE_EMPLOYEE_SKILL_ASSIGNED,
          result: 'SUCCESS',
          entityType: 'EMPLOYEE_SKILL',
          entityId: EMPLOYEE_ID,
          metadata: expect.objectContaining({
            employeeId: EMPLOYEE_ID,
            skillId:    SKILL_ID,
          }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // assignSkill — UPDATE path (UPDATED)
  // --------------------------------------------------------------------------

  describe('assignSkill() — UPDATE path', () => {
    const UPDATED_ROW = {
      ...ASSIGNMENT_ROW,
      proficiencyLevel: 'EXPERT',
    };

    beforeEach(() => {
      mockPrisma.employee.findFirst.mockResolvedValue(ACTIVE_EMP);
      mockPrisma.skill.findFirst.mockResolvedValue(SKILL_STUB);
      mockPrisma.employeeSkill.findFirst.mockResolvedValue(EXISTING_ROW);
      mockPrisma.employeeSkill.update.mockResolvedValue(UPDATED_ROW);
    });

    it('ESS-S-A4: UPDATED — outcome is UPDATED when record exists', async () => {
      const result = await service.assignSkill(
        { ...ASSIGN_PARAMS, proficiencyLevel: 'EXPERT' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('UPDATED');
    });

    it('ESS-S-A5: UPDATED — verifiedAt updated when provided', async () => {
      const newDate = new Date('2026-06-20T00:00:00.000Z');
      await service.assignSkill(
        { ...ASSIGN_PARAMS, verifiedAt: newDate },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockPrisma.employeeSkill.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ verifiedAt: newDate }),
        }),
      );
    });

    it('ESS-S-A6: UPDATED — partial update: omitted verifiedAt NOT included in update data', async () => {
      await service.assignSkill(
        { employeeId: EMPLOYEE_ID, skillId: SKILL_ID, proficiencyLevel: 'EXPERT' },
        TENANT_ID,
        ACTOR_ID,
      );

      const callArg = mockPrisma.employeeSkill.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(callArg.data).not.toHaveProperty('verifiedAt');
    });

    it('ESS-S-A17: UPDATED — emits WORKFORCE_EMPLOYEE_SKILL_UPDATED', async () => {
      await service.assignSkill(ASSIGN_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.WORKFORCE_EMPLOYEE_SKILL_UPDATED,
          result: 'SUCCESS',
          entityType: 'EMPLOYEE_SKILL',
          entityId: EMPLOYEE_ID,
        }),
      );
    });

    it('ESS-S-A18: UPDATED — audit metadata contains prior and new proficiency and verifiedAt fields', async () => {
      await service.assignSkill(
        { ...ASSIGN_PARAMS, proficiencyLevel: 'EXPERT', verifiedAt: VERIFIED_AT },
        TENANT_ID,
        ACTOR_ID,
      );

      const callMeta = (mockAudit.logEvent.mock.calls[0][0] as { metadata: Record<string, unknown> }).metadata;
      expect(callMeta).toMatchObject({
        prior_proficiency_level: 'DEVELOPING',
        new_proficiency_level:   'EXPERT',
        prior_verified_at:       null,
        new_verified_at:         VERIFIED_AT.toISOString(),
      });
    });
  });

  // --------------------------------------------------------------------------
  // assignSkill — error outcomes
  // --------------------------------------------------------------------------

  describe('assignSkill() — error outcomes', () => {
    it('ESS-S-A7: NOT_FOUND — absent employee returns NOT_FOUND; no skill lookup', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      const result = await service.assignSkill(ASSIGN_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('NOT_FOUND');
      expect(mockPrisma.skill.findFirst).not.toHaveBeenCalled();
    });

    it('ESS-S-A8: NOT_FOUND — cross-tenant employee returns identical NOT_FOUND (SEC-003 no-enumeration)', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      const result = await service.assignSkill(ASSIGN_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('ESS-S-A9: EMPLOYEE_SEPARATED — SEPARATED employee blocked; no skill lookup; no write', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(SEPARATED_EMP);

      const result = await service.assignSkill(ASSIGN_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('EMPLOYEE_SEPARATED');
      expect(mockPrisma.skill.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.employeeSkill.create).not.toHaveBeenCalled();
    });

    it('ESS-S-A10: INVALID_PROFICIENCY_LEVEL — invalid value rejected before DB write', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(ACTIVE_EMP);

      const result = await service.assignSkill(
        { ...ASSIGN_PARAMS, proficiencyLevel: 'MASTER' },
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('INVALID_PROFICIENCY_LEVEL');
      expect(mockPrisma.skill.findFirst).not.toHaveBeenCalled();
    });

    it('ESS-S-A11: SKILL_NOT_FOUND — absent skill returns SKILL_NOT_FOUND', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(ACTIVE_EMP);
      mockPrisma.skill.findFirst.mockResolvedValue(null);

      const result = await service.assignSkill(ASSIGN_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SKILL_NOT_FOUND');
    });

    it('ESS-S-A12: SKILL_NOT_FOUND — cross-tenant skill returns identical SKILL_NOT_FOUND (SEC-003)', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(ACTIVE_EMP);
      mockPrisma.skill.findFirst.mockResolvedValue(null);

      const result = await service.assignSkill(ASSIGN_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SKILL_NOT_FOUND');
    });

    it('ESS-S-A13: SKILL_NOT_FOUND — soft-deleted skill returns SKILL_NOT_FOUND (deletedAt null in WHERE)', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(ACTIVE_EMP);
      mockPrisma.skill.findFirst.mockResolvedValue(null); // findFirst returns null due to deletedAt: null filter

      const result = await service.assignSkill(ASSIGN_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SKILL_NOT_FOUND');
      expect(mockPrisma.skill.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
      );
    });

    it('ESS-S-A14: INTERNAL_ERROR — DB failure on employee lookup', async () => {
      mockPrisma.employee.findFirst.mockRejectedValue(new Error('DB down'));

      const result = await service.assignSkill(ASSIGN_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('ESS-S-A15: INTERNAL_ERROR — DB failure on create', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(ACTIVE_EMP);
      mockPrisma.skill.findFirst.mockResolvedValue(SKILL_STUB);
      mockPrisma.employeeSkill.findFirst.mockResolvedValue(null);
      mockPrisma.employeeSkill.create.mockRejectedValue(new Error('DB down'));

      const result = await service.assignSkill(ASSIGN_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // assignSkill — no audit on error outcomes
  // --------------------------------------------------------------------------

  describe('assignSkill() — audit suppression on error', () => {
    it('ESS-S-A19: no audit event emitted on NOT_FOUND', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      await service.assignSkill(ASSIGN_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockAudit.logEvent).not.toHaveBeenCalled();
    });

    it('ESS-S-A20: no audit event emitted on EMPLOYEE_SEPARATED', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(SEPARATED_EMP);

      await service.assignSkill(ASSIGN_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockAudit.logEvent).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // assignSkill — SEC-003 WHERE clause assertions
  // --------------------------------------------------------------------------

  describe('assignSkill() — SEC-003 WHERE clause', () => {
    beforeEach(() => {
      mockPrisma.employee.findFirst.mockResolvedValue(ACTIVE_EMP);
      mockPrisma.skill.findFirst.mockResolvedValue(SKILL_STUB);
      mockPrisma.employeeSkill.findFirst.mockResolvedValue(null);
      mockPrisma.employeeSkill.create.mockResolvedValue(ASSIGNMENT_ROW);
    });

    it('ESS-S-A21: employee WHERE includes tenantId and deletedAt null (SEC-003)', async () => {
      await service.assignSkill(ASSIGN_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_ID, deletedAt: null }),
        }),
      );
    });

    it('ESS-S-A22: skill WHERE includes tenantId and deletedAt null (SEC-003)', async () => {
      await service.assignSkill(ASSIGN_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.skill.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_ID, deletedAt: null }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // listEmployeeSkills
  // --------------------------------------------------------------------------

  describe('listEmployeeSkills()', () => {
    const SKILL_LIST_ROWS = [
      {
        skillId:         SKILL_ID,
        proficiencyLevel: 'ADVANCED',
        verifiedAt:      VERIFIED_AT,
        skill: { name: 'Python Programming', category: 'Technical' },
      },
      {
        skillId:         'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        proficiencyLevel: null,
        verifiedAt:      null,
        skill: { name: 'Project Management', category: null },
      },
    ];

    it('ESS-S-L1: SUCCESS — returns assignments with correct shape', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({ id: EMPLOYEE_ID });
      mockPrisma.employeeSkill.findMany.mockResolvedValue(SKILL_LIST_ROWS);

      const result = await service.listEmployeeSkills(EMPLOYEE_ID, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome !== 'SUCCESS') return;
      expect(result.assignments).toHaveLength(2);
      expect(result.assignments[0]!.skillName).toBe('Python Programming');
      expect(result.assignments[1]!.skillCategory).toBeNull();
    });

    it('ESS-S-L2: SUCCESS — empty list when no assignments', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({ id: EMPLOYEE_ID });
      mockPrisma.employeeSkill.findMany.mockResolvedValue([]);

      const result = await service.listEmployeeSkills(EMPLOYEE_ID, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome !== 'SUCCESS') return;
      expect(result.assignments).toHaveLength(0);
    });

    it('ESS-S-L3: SUCCESS — skillName and skillCategory from skill JOIN', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({ id: EMPLOYEE_ID });
      mockPrisma.employeeSkill.findMany.mockResolvedValue([SKILL_LIST_ROWS[0]]);

      const result = await service.listEmployeeSkills(EMPLOYEE_ID, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome !== 'SUCCESS') return;
      expect(result.assignments[0]!.skillName).toBe('Python Programming');
      expect(result.assignments[0]!.skillCategory).toBe('Technical');
    });

    it('ESS-S-L4: SUCCESS — null proficiencyLevel when not assessed', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({ id: EMPLOYEE_ID });
      mockPrisma.employeeSkill.findMany.mockResolvedValue([SKILL_LIST_ROWS[1]]);

      const result = await service.listEmployeeSkills(EMPLOYEE_ID, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome !== 'SUCCESS') return;
      expect(result.assignments[0]!.proficiencyLevel).toBeNull();
    });

    it('ESS-S-L5: NOT_FOUND — absent employee', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      const result = await service.listEmployeeSkills(EMPLOYEE_ID, TENANT_ID);

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('ESS-S-L6: NOT_FOUND — cross-tenant employee returns identical NOT_FOUND (SEC-003)', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      const result = await service.listEmployeeSkills(EMPLOYEE_ID, TENANT_ID);

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('ESS-S-L7: INTERNAL_ERROR — DB failure on findMany', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({ id: EMPLOYEE_ID });
      mockPrisma.employeeSkill.findMany.mockRejectedValue(new Error('DB down'));

      const result = await service.listEmployeeSkills(EMPLOYEE_ID, TENANT_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('ESS-S-L8: SEC-003 — employee WHERE includes tenantId and deletedAt null', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({ id: EMPLOYEE_ID });
      mockPrisma.employeeSkill.findMany.mockResolvedValue([]);

      await service.listEmployeeSkills(EMPLOYEE_ID, TENANT_ID);

      expect(mockPrisma.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_ID, deletedAt: null }),
        }),
      );
    });
  });
});
