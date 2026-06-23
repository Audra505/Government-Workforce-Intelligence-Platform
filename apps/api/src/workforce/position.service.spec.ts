// Reference: spec/01_requirements.md — FR-100 Position Management
// Reference: directives/02_position_management_rules.md — POS-001 through POS-602
// Reference: directives/08_audit_rules.md — AUD-400
//
// Pure unit tests — no database.
// PrismaService and AuditService replaced with jest.fn() mocks.
// Verifies all discriminated-union outcomes for each PositionService method.
// SEC-003 tenant isolation: tenantId and deletedAt: null always present in where clauses.

import { Test, type TestingModule } from '@nestjs/testing';

import { PositionService } from './position.service';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import type { CreatePositionDto } from './dto/create-position.dto';
import type { UpdatePositionDto } from './dto/update-position.dto';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID    = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DEPT_ID     = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const POSITION_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const POSITION_ROW = {
  id: POSITION_ID,
  departmentId: DEPT_ID,
  title: 'HR Specialist',
  classification: null as string | null,
  salaryBand: null as string | null,
  status: 'DRAFT',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PositionService', () => {
  let service: PositionService;

  const mockPrisma = {
    department: {
      findFirst: jest.fn(),
    },
    position: {
      create:    jest.fn(),
      findMany:  jest.fn(),
      count:     jest.fn(),
      findFirst: jest.fn(),
      update:    jest.fn(),
    },
    vacancy: {
      findFirst: jest.fn(),
    },
    employee: {
      findFirst: jest.fn(),
    },
  };
  const mockAuditService = { logEvent: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<PositionService>(PositionService);
  });

  // ---------------------------------------------------------------------------
  // createPosition
  // ---------------------------------------------------------------------------

  describe('createPosition()', () => {
    it('valid input → outcome SUCCESS with PositionRecord', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.position.create.mockResolvedValue(POSITION_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.createPosition(
        { title: 'HR Specialist', departmentId: DEPT_ID } as CreatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.position).toMatchObject({ id: POSITION_ID, title: 'HR Specialist', status: 'DRAFT' });
      }
    });

    it('create data always sets status: "DRAFT" (POS-001)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.position.create.mockResolvedValue(POSITION_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createPosition(
        { title: 'HR Specialist', departmentId: DEPT_ID } as CreatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockPrisma.position.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DRAFT' }),
        }),
      );
    });

    it('classification not provided → create data contains classification: null', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.position.create.mockResolvedValue(POSITION_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createPosition(
        { title: 'HR Specialist', departmentId: DEPT_ID } as CreatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockPrisma.position.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ classification: null }),
        }),
      );
    });

    it('department findFirst returns null → outcome DEPARTMENT_NOT_FOUND', async () => {
      mockPrisma.department.findFirst.mockResolvedValue(null);

      const result = await service.createPosition(
        { title: 'HR Specialist', departmentId: DEPT_ID } as CreatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('DEPARTMENT_NOT_FOUND');
    });

    it('department validation applies tenantId filter (SEC-003 / Decision 4)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.position.create.mockResolvedValue(POSITION_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createPosition(
        { title: 'HR Specialist', departmentId: DEPT_ID } as CreatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockPrisma.department.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: DEPT_ID, tenantId: TENANT_ID, deletedAt: null }),
        }),
      );
    });

    it('department Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.department.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await service.createPosition(
        { title: 'HR Specialist', departmentId: DEPT_ID } as CreatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('position create Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.position.create.mockRejectedValue(new Error('DB error'));

      const result = await service.createPosition(
        { title: 'HR Specialist', departmentId: DEPT_ID } as CreatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('WORKFORCE_POSITION_CREATED audit event emitted after successful create (AUD-400)', async () => {
      mockPrisma.department.findFirst.mockResolvedValue({ id: DEPT_ID });
      mockPrisma.position.create.mockResolvedValue(POSITION_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createPosition(
        { title: 'HR Specialist', departmentId: DEPT_ID } as CreatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.WORKFORCE_POSITION_CREATED,
          tenantId: TENANT_ID,
          userId: ACTOR_ID,
          entityType: 'POSITION',
          entityId: POSITION_ID,
        }),
      );
    });

    it('audit event NOT emitted when DEPARTMENT_NOT_FOUND', async () => {
      mockPrisma.department.findFirst.mockResolvedValue(null);

      await service.createPosition(
        { title: 'HR Specialist', departmentId: DEPT_ID } as CreatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // listPositions
  // ---------------------------------------------------------------------------

  describe('listPositions()', () => {
    it('returns SUCCESS with positions array and correct pagination metadata', async () => {
      mockPrisma.position.findMany.mockResolvedValue([POSITION_ROW]);
      mockPrisma.position.count.mockResolvedValue(1);

      const result = await service.listPositions(TENANT_ID, { page: 1, pageSize: 20 });

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.positions).toHaveLength(1);
        expect(result.total).toBe(1);
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(20);
      }
    });

    it('skip = (page - 1) * pageSize', async () => {
      mockPrisma.position.findMany.mockResolvedValue([]);
      mockPrisma.position.count.mockResolvedValue(0);

      await service.listPositions(TENANT_ID, { page: 3, pageSize: 10 });

      expect(mockPrisma.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('status filter included in where clause when provided', async () => {
      mockPrisma.position.findMany.mockResolvedValue([]);
      mockPrisma.position.count.mockResolvedValue(0);

      await service.listPositions(TENANT_ID, { status: 'ACTIVE' });

      expect(mockPrisma.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
    });

    it('departmentId filter included in where clause when provided', async () => {
      mockPrisma.position.findMany.mockResolvedValue([]);
      mockPrisma.position.count.mockResolvedValue(0);

      await service.listPositions(TENANT_ID, { departmentId: DEPT_ID });

      expect(mockPrisma.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ departmentId: DEPT_ID }),
        }),
      );
    });

    it('search generates OR filter across title and classification (no description — POS spec)', async () => {
      mockPrisma.position.findMany.mockResolvedValue([]);
      mockPrisma.position.count.mockResolvedValue(0);

      await service.listPositions(TENANT_ID, { search: 'HR' });

      expect(mockPrisma.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ title: expect.objectContaining({ contains: 'HR' }) }),
              expect.objectContaining({ classification: expect.objectContaining({ contains: 'HR' }) }),
            ]),
          }),
        }),
      );
    });

    it('where clause always includes tenantId and deletedAt: null (SEC-003)', async () => {
      mockPrisma.position.findMany.mockResolvedValue([]);
      mockPrisma.position.count.mockResolvedValue(0);

      await service.listPositions(TENANT_ID, {});

      expect(mockPrisma.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_ID, deletedAt: null }),
        }),
      );
    });

    it('Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.position.findMany.mockRejectedValue(new Error('DB error'));

      const result = await service.listPositions(TENANT_ID, {});

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // getPositionById
  // ---------------------------------------------------------------------------

  describe('getPositionById()', () => {
    it('position found → outcome SUCCESS with PositionRecord', async () => {
      mockPrisma.position.findFirst.mockResolvedValue(POSITION_ROW);

      const result = await service.getPositionById(POSITION_ID, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.position.id).toBe(POSITION_ID);
      }
    });

    it('findFirst returns null (absent or cross-tenant) → outcome NOT_FOUND', async () => {
      mockPrisma.position.findFirst.mockResolvedValue(null);

      const result = await service.getPositionById(POSITION_ID, TENANT_ID);

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.position.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await service.getPositionById(POSITION_ID, TENANT_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('findFirst where clause includes id, tenantId, and deletedAt: null (SEC-003)', async () => {
      mockPrisma.position.findFirst.mockResolvedValue(POSITION_ROW);
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      await service.getPositionById(POSITION_ID, TENANT_ID);

      expect(mockPrisma.position.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: POSITION_ID, tenantId: TENANT_ID, deletedAt: null }),
        }),
      );
    });

    // GD-M15-1 D7 occupant tests

    it('GD-M15-1-D7: position with no occupant → result.position.occupant is null', async () => {
      mockPrisma.position.findFirst.mockResolvedValue(POSITION_ROW);
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      const result = await service.getPositionById(POSITION_ID, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.position.occupant).toBeNull();
      }
    });

    it('GD-M15-1-D7: position with ACTIVE occupant → result.position.occupant populated', async () => {
      const occupantRow = {
        id: 'emp-aaa',
        firstName: 'Jane',
        lastName: 'Doe',
        employeeNumber: 'EMP-001',
        employmentStatus: 'ACTIVE',
        hireDate: new Date('2024-03-15'),
      };
      mockPrisma.position.findFirst.mockResolvedValue(POSITION_ROW);
      mockPrisma.employee.findFirst.mockResolvedValue(occupantRow);

      const result = await service.getPositionById(POSITION_ID, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.position.occupant).toMatchObject({
          id: 'emp-aaa',
          firstName: 'Jane',
          lastName: 'Doe',
          employeeNumber: 'EMP-001',
          employmentStatus: 'ACTIVE',
          hireDate: new Date('2024-03-15'),
        });
      }
    });

    it('GD-M15-1-D7: occupant query uses positionId, tenantId, deletedAt: null, and non-SEPARATED statuses (SEC-003)', async () => {
      mockPrisma.position.findFirst.mockResolvedValue(POSITION_ROW);
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      await service.getPositionById(POSITION_ID, TENANT_ID);

      expect(mockPrisma.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            positionId: POSITION_ID,
            tenantId: TENANT_ID,
            deletedAt: null,
            employmentStatus: { in: ['PENDING_ONBOARDING', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED'] },
          }),
        }),
      );
    });

    it('GD-M15-1-D7: employee.findFirst NOT called when position is NOT_FOUND (early return)', async () => {
      mockPrisma.position.findFirst.mockResolvedValue(null);

      await service.getPositionById(POSITION_ID, TENANT_ID);

      expect(mockPrisma.employee.findFirst).not.toHaveBeenCalled();
    });

    it('GD-M15-1-D7: employee.findFirst throwing → outcome INTERNAL_ERROR', async () => {
      mockPrisma.position.findFirst.mockResolvedValue(POSITION_ROW);
      mockPrisma.employee.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await service.getPositionById(POSITION_ID, TENANT_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // updatePosition
  // ---------------------------------------------------------------------------

  describe('updatePosition()', () => {
    it('position found and updated → outcome SUCCESS with updated PositionRecord', async () => {
      const updatedRow = { ...POSITION_ROW, title: 'Senior HR Specialist' };
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'DRAFT' });
      mockPrisma.position.update.mockResolvedValue(updatedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.updatePosition(
        POSITION_ID,
        { title: 'Senior HR Specialist' } as UpdatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.position.title).toBe('Senior HR Specialist');
      }
    });

    it('findFirst returns null → outcome NOT_FOUND', async () => {
      mockPrisma.position.findFirst.mockResolvedValue(null);

      const result = await service.updatePosition(
        POSITION_ID,
        { title: 'X' } as UpdatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('existing.status === "CLOSED" → outcome POSITION_CLOSED (POS-202)', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'CLOSED' });

      const result = await service.updatePosition(
        POSITION_ID,
        { title: 'X' } as UpdatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('POSITION_CLOSED');
    });

    it('dto.status === "ACTIVE" → emits WORKFORCE_POSITION_ACTIVATED (AUD-400)', async () => {
      const activatedRow = { ...POSITION_ROW, status: 'ACTIVE' };
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'DRAFT' });
      mockPrisma.position.update.mockResolvedValue(activatedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updatePosition(
        POSITION_ID,
        { status: 'ACTIVE' } as UpdatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.WORKFORCE_POSITION_ACTIVATED }),
      );
    });

    it('dto.status === "FROZEN" → emits WORKFORCE_POSITION_FROZEN (AUD-400)', async () => {
      const frozenRow = { ...POSITION_ROW, status: 'FROZEN' };
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'ACTIVE' });
      mockPrisma.position.update.mockResolvedValue(frozenRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updatePosition(
        POSITION_ID,
        { status: 'FROZEN' } as UpdatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.WORKFORCE_POSITION_FROZEN }),
      );
    });

    it('dto.status not a state transition → emits WORKFORCE_POSITION_UPDATED (AUD-400)', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'DRAFT' });
      mockPrisma.position.update.mockResolvedValue(POSITION_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updatePosition(
        POSITION_ID,
        { title: 'New Title' } as UpdatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.WORKFORCE_POSITION_UPDATED }),
      );
    });

    it('only supplied dto fields included in update data', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'DRAFT' });
      mockPrisma.position.update.mockResolvedValue(POSITION_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updatePosition(
        POSITION_ID,
        { title: 'Title Only' } as UpdatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      const callData = (mockPrisma.position.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
      expect(callData).toHaveProperty('title', 'Title Only');
      expect(callData).not.toHaveProperty('classification');
      expect(callData).not.toHaveProperty('salaryBand');
      expect(callData).not.toHaveProperty('status');
    });

    it('departmentId never included in update data (POS-201)', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'DRAFT' });
      mockPrisma.position.update.mockResolvedValue(POSITION_ROW);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updatePosition(
        POSITION_ID,
        { title: 'No Dept Change' } as UpdatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      const callData = (mockPrisma.position.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
      expect(callData).not.toHaveProperty('departmentId');
    });

    it('Prisma update throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'DRAFT' });
      mockPrisma.position.update.mockRejectedValue(new Error('DB error'));

      const result = await service.updatePosition(
        POSITION_ID,
        { title: 'X' } as UpdatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('audit event NOT emitted when outcome is NOT_FOUND', async () => {
      mockPrisma.position.findFirst.mockResolvedValue(null);

      await service.updatePosition(
        POSITION_ID,
        { title: 'X' } as UpdatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('audit event NOT emitted when outcome is POSITION_CLOSED', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'CLOSED' });

      await service.updatePosition(
        POSITION_ID,
        { title: 'X' } as UpdatePositionDto,
        TENANT_ID,
        ACTOR_ID,
      );

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // closePosition
  // ---------------------------------------------------------------------------

  describe('closePosition()', () => {
    it('valid position → outcome SUCCESS with status CLOSED (POS-501)', async () => {
      const closedRow = { ...POSITION_ROW, status: 'CLOSED' };
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'DRAFT' });
      mockPrisma.vacancy.findFirst.mockResolvedValue(null);
      mockPrisma.position.update.mockResolvedValue(closedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.closePosition(POSITION_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.position.status).toBe('CLOSED');
      }
    });

    it('findFirst returns null → outcome NOT_FOUND', async () => {
      mockPrisma.position.findFirst.mockResolvedValue(null);

      const result = await service.closePosition(POSITION_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('existing.status === "CLOSED" → outcome ALREADY_CLOSED', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'CLOSED' });

      const result = await service.closePosition(POSITION_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('ALREADY_CLOSED');
    });

    it('WORKFORCE_POSITION_CLOSED audit event emitted after successful close (AUD-400 / POS-501)', async () => {
      const closedRow = { ...POSITION_ROW, status: 'CLOSED' };
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'DRAFT' });
      mockPrisma.vacancy.findFirst.mockResolvedValue(null);
      mockPrisma.position.update.mockResolvedValue(closedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.closePosition(POSITION_ID, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.WORKFORCE_POSITION_CLOSED,
          tenantId: TENANT_ID,
          userId: ACTOR_ID,
          entityType: 'POSITION',
          entityId: POSITION_ID,
        }),
      );
    });

    it('Prisma throws → outcome INTERNAL_ERROR', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'DRAFT' });
      mockPrisma.position.update.mockRejectedValue(new Error('DB error'));

      const result = await service.closePosition(POSITION_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('audit event NOT emitted when outcome is ALREADY_CLOSED', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'CLOSED' });

      await service.closePosition(POSITION_ID, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    // POS-500 gate tests (M11 Step 8 — Governance Decision 8-6 broad interpretation)

    it('non-CLOSED vacancy exists → outcome HAS_ACTIVE_VACANCIES (POS-500)', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'ACTIVE' });
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: 'vac-id-stub' });

      const result = await service.closePosition(POSITION_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('HAS_ACTIVE_VACANCIES');
    });

    it('DRAFT vacancy present → outcome HAS_ACTIVE_VACANCIES (Governance Decision 8-6 — POS-300 integrity)', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'ACTIVE' });
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: 'vac-id-stub' });

      const result = await service.closePosition(POSITION_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('HAS_ACTIVE_VACANCIES');
    });

    it('vacancy.findFirst returns null and no incumbent → closure proceeds to SUCCESS', async () => {
      const closedRow = { ...POSITION_ROW, status: 'CLOSED' };
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'ACTIVE' });
      mockPrisma.vacancy.findFirst.mockResolvedValue(null);
      mockPrisma.employee.findFirst.mockResolvedValue(null);
      mockPrisma.position.update.mockResolvedValue(closedRow);
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.closePosition(POSITION_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('vacancy check not performed when position is NOT_FOUND (early return before POS-500 guard)', async () => {
      mockPrisma.position.findFirst.mockResolvedValue(null);

      await service.closePosition(POSITION_ID, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.vacancy.findFirst).not.toHaveBeenCalled();
    });

    it('vacancy check where clause includes positionId, tenantId, deletedAt: null, status: { not: CLOSED } (POS-500 / SEC-003)', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'ACTIVE' });
      mockPrisma.vacancy.findFirst.mockResolvedValue(null);
      mockPrisma.employee.findFirst.mockResolvedValue(null);
      mockPrisma.position.update.mockResolvedValue({ ...POSITION_ROW, status: 'CLOSED' });
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.closePosition(POSITION_ID, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.vacancy.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            positionId: POSITION_ID,
            tenantId: TENANT_ID,
            deletedAt: null,
            status: { not: 'CLOSED' },
          }),
        }),
      );
    });

    it('audit event NOT emitted when outcome is HAS_ACTIVE_VACANCIES (AUD-400)', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'ACTIVE' });
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: 'vac-id-stub' });

      await service.closePosition(POSITION_ID, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('position.update NOT called when outcome is HAS_ACTIVE_VACANCIES (no write on blocked closure)', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'ACTIVE' });
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: 'vac-id-stub' });

      await service.closePosition(POSITION_ID, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.position.update).not.toHaveBeenCalled();
    });

    // POS-500 gate 2: No Active Incumbent (GD-M15-1 D5)

    it('GD-M15-1-D5: active incumbent present → outcome HAS_ACTIVE_INCUMBENT', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'ACTIVE' });
      mockPrisma.vacancy.findFirst.mockResolvedValue(null);
      mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-stub' });

      const result = await service.closePosition(POSITION_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('HAS_ACTIVE_INCUMBENT');
    });

    it('GD-M15-1-D5: incumbent check uses positionId, tenantId, deletedAt: null, non-SEPARATED statuses (SEC-003)', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'ACTIVE' });
      mockPrisma.vacancy.findFirst.mockResolvedValue(null);
      mockPrisma.employee.findFirst.mockResolvedValue(null);
      mockPrisma.position.update.mockResolvedValue({ ...POSITION_ROW, status: 'CLOSED' });
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.closePosition(POSITION_ID, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            positionId: POSITION_ID,
            tenantId: TENANT_ID,
            deletedAt: null,
            employmentStatus: { in: ['PENDING_ONBOARDING', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED'] },
          }),
        }),
      );
    });

    it('GD-M15-1-D5: audit event NOT emitted when outcome is HAS_ACTIVE_INCUMBENT', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'ACTIVE' });
      mockPrisma.vacancy.findFirst.mockResolvedValue(null);
      mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-stub' });

      await service.closePosition(POSITION_ID, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('GD-M15-1-D5: position.update NOT called when blocked by active incumbent', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'ACTIVE' });
      mockPrisma.vacancy.findFirst.mockResolvedValue(null);
      mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-stub' });

      await service.closePosition(POSITION_ID, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.position.update).not.toHaveBeenCalled();
    });

    it('GD-M15-1-D5: employee.findFirst NOT called when vacancy guard already blocked', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: POSITION_ID, status: 'ACTIVE' });
      mockPrisma.vacancy.findFirst.mockResolvedValue({ id: 'vac-stub' });

      await service.closePosition(POSITION_ID, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.employee.findFirst).not.toHaveBeenCalled();
    });
  });
});
