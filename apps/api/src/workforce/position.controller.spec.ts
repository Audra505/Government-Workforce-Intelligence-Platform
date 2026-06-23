// Reference: spec/01_requirements.md — FR-100 Position Management
// Reference: spec/06_api_contracts.md — Position API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/02_position_management_rules.md — POS-AUTH-001 through POS-AUTH-005
//
// Pure unit tests — no HTTP server, no database.
// PositionService replaced with jest.fn() mocks.
// JwtAuthGuard and RolesGuard overridden to always pass.
// Controller methods called directly with mock RequestUser actor.
// Verifies: HTTP exception types, response envelope shapes, date serialization, error codes.

import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import { PositionController } from './position.controller';
import { PositionService } from './position.service';
import type { PositionRecord, PositionDetailRecord } from './position.service';
import type { RequestUser } from '../identity/jwt.strategy';
import type { CreatePositionDto } from './dto/create-position.dto';
import type { UpdatePositionDto } from './dto/update-position.dto';
import type { ListPositionsQueryDto } from './dto/list-positions-query.dto';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR_ID    = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DEPT_ID     = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const POSITION_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const CREATED_AT  = new Date('2026-06-10T12:00:00.000Z');

const mockActor: RequestUser = {
  userId: ACTOR_ID,
  tenantId: TENANT_ID,
  email: 'admin@dev.gov',
  roles: ['System Administrator'],
};

const positionRecord: PositionRecord = {
  id: POSITION_ID,
  departmentId: DEPT_ID,
  title: 'HR Specialist',
  classification: null,
  salaryBand: null,
  status: 'DRAFT',
  createdAt: CREATED_AT,
};

const HIRE_DATE = new Date('2024-03-15T00:00:00.000Z');

const positionDetailRecord: PositionDetailRecord = {
  ...positionRecord,
  occupant: null,
};

const positionDetailRecordWithOccupant: PositionDetailRecord = {
  ...positionRecord,
  occupant: {
    id: 'emp-aaa',
    firstName: 'Jane',
    lastName: 'Doe',
    employeeNumber: 'EMP-001',
    employmentStatus: 'ACTIVE',
    hireDate: HIRE_DATE,
  },
};

const createDto: CreatePositionDto = { title: 'HR Specialist', departmentId: DEPT_ID };
const updateDto: UpdatePositionDto = { title: 'Senior HR Specialist' };
const listQuery: ListPositionsQueryDto = { page: 1, pageSize: 20 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PositionController', () => {
  let controller: PositionController;
  let mockService: {
    createPosition:  jest.Mock;
    listPositions:   jest.Mock;
    getPositionById: jest.Mock;
    updatePosition:  jest.Mock;
    closePosition:   jest.Mock;
  };

  beforeEach(async () => {
    mockService = {
      createPosition:  jest.fn(),
      listPositions:   jest.fn(),
      getPositionById: jest.fn(),
      updatePosition:  jest.fn(),
      closePosition:   jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PositionController],
      providers: [
        { provide: PositionService, useValue: mockService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PositionController>(PositionController);
  });

  afterEach(() => jest.clearAllMocks());

  // --------------------------------------------------------------------------
  // createPosition()
  // --------------------------------------------------------------------------

  describe('createPosition()', () => {
    it('SUCCESS: returns { success: true, data: position shape }', async () => {
      mockService.createPosition.mockResolvedValue({ outcome: 'SUCCESS', position: positionRecord });

      const result = await controller.createPosition(createDto, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: POSITION_ID, title: 'HR Specialist', status: 'DRAFT' });
    });

    it('SUCCESS: createdAt serialized as ISO 8601 string', async () => {
      mockService.createPosition.mockResolvedValue({ outcome: 'SUCCESS', position: positionRecord });

      const result = await controller.createPosition(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']!['createdAt']).toBe(CREATED_AT.toISOString());
    });

    it('DEPARTMENT_NOT_FOUND: throws NotFoundException', async () => {
      mockService.createPosition.mockResolvedValue({ outcome: 'DEPARTMENT_NOT_FOUND' });

      await expect(controller.createPosition(createDto, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.createPosition.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.createPosition(createDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });

    it('actor.tenantId + actor.userId passed to service — not from request body (SEC-003)', async () => {
      mockService.createPosition.mockResolvedValue({ outcome: 'SUCCESS', position: positionRecord });

      await controller.createPosition(createDto, mockActor);

      expect(mockService.createPosition).toHaveBeenCalledWith(createDto, TENANT_ID, ACTOR_ID);
    });
  });

  // --------------------------------------------------------------------------
  // listPositions()
  // --------------------------------------------------------------------------

  describe('listPositions()', () => {
    it('SUCCESS: returns { success: true, data: { positions, total, page, pageSize, totalPages } }', async () => {
      mockService.listPositions.mockResolvedValue({
        outcome: 'SUCCESS',
        positions: [positionRecord],
        total: 1,
        page: 1,
        pageSize: 20,
      });

      const result = await controller.listPositions(listQuery, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ total: 1, page: 1, pageSize: 20 });
      expect((result['data']!['positions'] as unknown[]).length).toBe(1);
    });

    it('SUCCESS: totalPages = Math.ceil(total / pageSize)', async () => {
      mockService.listPositions.mockResolvedValue({
        outcome: 'SUCCESS',
        positions: [],
        total: 25,
        page: 1,
        pageSize: 10,
      });

      const result = await controller.listPositions(listQuery, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']!['totalPages']).toBe(3);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.listPositions.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.listPositions(listQuery, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // getPositionById()
  // --------------------------------------------------------------------------

  describe('getPositionById()', () => {
    it('SUCCESS: returns { success: true, data: position shape }', async () => {
      mockService.getPositionById.mockResolvedValue({ outcome: 'SUCCESS', position: positionDetailRecord });

      const result = await controller.getPositionById(POSITION_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']!['id']).toBe(POSITION_ID);
    });

    it('NOT_FOUND: throws NotFoundException', async () => {
      mockService.getPositionById.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(controller.getPositionById(POSITION_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.getPositionById.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.getPositionById(POSITION_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });

    it('actor.tenantId from JWT passed to service — not from route param (SEC-003)', async () => {
      mockService.getPositionById.mockResolvedValue({ outcome: 'SUCCESS', position: positionDetailRecord });

      await controller.getPositionById(POSITION_ID, mockActor);

      expect(mockService.getPositionById).toHaveBeenCalledWith(POSITION_ID, TENANT_ID);
    });

    // GD-M15-1 D7 occupant response tests

    it('GD-M15-1-D7: vacant position → response.data.occupant is null', async () => {
      mockService.getPositionById.mockResolvedValue({ outcome: 'SUCCESS', position: positionDetailRecord });

      const result = await controller.getPositionById(POSITION_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']!['occupant']).toBeNull();
    });

    it('GD-M15-1-D7: occupied position → response.data.occupant contains occupant fields', async () => {
      mockService.getPositionById.mockResolvedValue({ outcome: 'SUCCESS', position: positionDetailRecordWithOccupant });

      const result = await controller.getPositionById(POSITION_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']!['occupant']).toMatchObject({
        id: 'emp-aaa',
        firstName: 'Jane',
        lastName: 'Doe',
        employeeNumber: 'EMP-001',
        employmentStatus: 'ACTIVE',
      });
    });

    it('GD-M15-1-D7: occupant.hireDate serialized as YYYY-MM-DD string', async () => {
      mockService.getPositionById.mockResolvedValue({ outcome: 'SUCCESS', position: positionDetailRecordWithOccupant });

      const result = await controller.getPositionById(POSITION_ID, mockActor) as Record<string, Record<string, unknown>>;

      const occupant = result['data']!['occupant'] as Record<string, unknown>;
      expect(occupant!['hireDate']).toBe('2024-03-15');
    });
  });

  // --------------------------------------------------------------------------
  // updatePosition()
  // --------------------------------------------------------------------------

  describe('updatePosition()', () => {
    it('SUCCESS: returns { success: true, data: updated position shape }', async () => {
      const updated = { ...positionRecord, title: 'Senior HR Specialist' };
      mockService.updatePosition.mockResolvedValue({ outcome: 'SUCCESS', position: updated });

      const result = await controller.updatePosition(POSITION_ID, updateDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']!['id']).toBe(POSITION_ID);
    });

    it('NOT_FOUND: throws NotFoundException', async () => {
      mockService.updatePosition.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(controller.updatePosition(POSITION_ID, updateDto, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('POSITION_CLOSED: throws ConflictException (POS-202)', async () => {
      mockService.updatePosition.mockResolvedValue({ outcome: 'POSITION_CLOSED' });

      await expect(controller.updatePosition(POSITION_ID, updateDto, mockActor)).rejects.toThrow(ConflictException);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.updatePosition.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.updatePosition(POSITION_ID, updateDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // closePosition()
  // --------------------------------------------------------------------------

  describe('closePosition()', () => {
    it('SUCCESS: returns { success: true, data: { status: "CLOSED" } }', async () => {
      const closed = { ...positionRecord, status: 'CLOSED' };
      mockService.closePosition.mockResolvedValue({ outcome: 'SUCCESS', position: closed });

      const result = await controller.closePosition(POSITION_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['success']).toBe(true);
      expect(result['data']!['status']).toBe('CLOSED');
    });

    it('NOT_FOUND: throws NotFoundException', async () => {
      mockService.closePosition.mockResolvedValue({ outcome: 'NOT_FOUND' });

      await expect(controller.closePosition(POSITION_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('ALREADY_CLOSED: throws ConflictException', async () => {
      mockService.closePosition.mockResolvedValue({ outcome: 'ALREADY_CLOSED' });

      await expect(controller.closePosition(POSITION_ID, mockActor)).rejects.toThrow(ConflictException);
    });

    it('HAS_ACTIVE_VACANCIES: throws ConflictException with code HAS_ACTIVE_VACANCIES (POS-500)', async () => {
      mockService.closePosition.mockResolvedValue({ outcome: 'HAS_ACTIVE_VACANCIES' });

      await expect(controller.closePosition(POSITION_ID, mockActor)).rejects.toThrow(ConflictException);
    });

    it('HAS_ACTIVE_INCUMBENT: throws ConflictException with code HAS_ACTIVE_INCUMBENT (GD-M15-1 D5)', async () => {
      mockService.closePosition.mockResolvedValue({ outcome: 'HAS_ACTIVE_INCUMBENT' });

      await expect(controller.closePosition(POSITION_ID, mockActor)).rejects.toThrow(ConflictException);
    });

    it('HAS_ACTIVE_INCUMBENT: error code in response body is HAS_ACTIVE_INCUMBENT', async () => {
      mockService.closePosition.mockResolvedValue({ outcome: 'HAS_ACTIVE_INCUMBENT' });

      let caught: ConflictException | null = null;
      try {
        await controller.closePosition(POSITION_ID, mockActor);
      } catch (e) {
        caught = e as ConflictException;
      }

      expect(caught).not.toBeNull();
      const response = caught!.getResponse() as Record<string, unknown>;
      const error = response['error'] as Record<string, unknown>;
      expect(error!['code']).toBe('HAS_ACTIVE_INCUMBENT');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.closePosition.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.closePosition(POSITION_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });
});
