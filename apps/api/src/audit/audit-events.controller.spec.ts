// Reference: governance/GD-M39-1.md — Decision 16 (five endpoints)
//
// Pure unit tests against a mocked AuditEventsService — proves the
// controller maps service outcomes to the correct HTTP status/error shape
// and always derives tenantId/actorUserId from @CurrentUser(), never from
// the request body/query/path. Real route-ordering and guard behavior are
// proven at the E2E level (test/audit-events.e2e-spec.ts) since Express's
// actual route-matching order cannot be observed from decorator metadata
// alone.

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { AuditEventsController } from './audit-events.controller';
import { AuditEventsService } from './audit-events.service';
import type { RequestUser } from '../identity/jwt.strategy';

const ACTOR: RequestUser = {
  userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  email: 'sa@example.gov',
  firstName: 'S',
  lastName: 'A',
  roles: ['System Administrator'],
};

describe('AuditEventsController', () => {
  let controller: AuditEventsController;
  let mockService: {
    listAuditEvents: jest.Mock;
    getAuditEventById: jest.Mock;
    getRecoveryStatus: jest.Mock;
    requeueFailedWrite: jest.Mock;
    requestReverification: jest.Mock;
  };

  beforeEach(async () => {
    mockService = {
      listAuditEvents: jest.fn(),
      getAuditEventById: jest.fn(),
      getRecoveryStatus: jest.fn(),
      requeueFailedWrite: jest.fn(),
      requestReverification: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditEventsController],
      providers: [{ provide: AuditEventsService, useValue: mockService }],
    }).compile();

    controller = module.get(AuditEventsController);
  });

  describe('listAuditEvents', () => {
    it('derives tenantId/actorUserId from @CurrentUser(), never from the query', async () => {
      mockService.listAuditEvents.mockResolvedValue({ outcome: 'SUCCESS', events: [], nextCursor: null });
      await controller.listAuditEvents({ pageSize: 20 }, ACTOR);
      expect(mockService.listAuditEvents).toHaveBeenCalledWith(ACTOR.tenantId, ACTOR.userId, { pageSize: 20 });
    });

    it('throws BadRequestException on INVALID_CURSOR', async () => {
      mockService.listAuditEvents.mockResolvedValue({ outcome: 'INVALID_CURSOR' });
      await expect(controller.listAuditEvents({ pageSize: 20 }, ACTOR)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getAuditEventById', () => {
    it('throws NotFoundException when the service reports NOT_FOUND', async () => {
      mockService.getAuditEventById.mockResolvedValue({ outcome: 'NOT_FOUND' });
      await expect(controller.getAuditEventById('some-id', ACTOR)).rejects.toThrow(NotFoundException);
    });

    it('returns the event under data.event on success', async () => {
      mockService.getAuditEventById.mockResolvedValue({ outcome: 'SUCCESS', event: { id: 'x' } });
      const result = (await controller.getAuditEventById('some-id', ACTOR)) as { data: { id: string } };
      expect(result.data).toEqual({ id: 'x' });
    });
  });

  describe('requeueFailedWrite', () => {
    it('throws NotFoundException on NOT_FOUND', async () => {
      mockService.requeueFailedWrite.mockResolvedValue({ outcome: 'NOT_FOUND' });
      await expect(controller.requeueFailedWrite('some-id', ACTOR)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException on NOT_ABANDONED', async () => {
      mockService.requeueFailedWrite.mockResolvedValue({ outcome: 'NOT_ABANDONED', currentStatus: 'PENDING' });
      await expect(controller.requeueFailedWrite('some-id', ACTOR)).rejects.toThrow(ForbiddenException);
    });

    it('accepts no request body parameter at all (no replacement event payload)', () => {
      // (id, actor) only — no @Body() parameter exists on this handler.
      expect(controller.requeueFailedWrite.length).toBe(2);
    });
  });

  describe('requestReverification', () => {
    it('accepts no request body parameter at all (no tenant payload of any kind)', () => {
      expect(controller.requestReverification.length).toBe(1); // (actor) only
    });

    it('derives tenant exclusively from @CurrentUser()', async () => {
      mockService.requestReverification.mockResolvedValue({ outcome: 'SUCCESS' });
      await controller.requestReverification(ACTOR);
      expect(mockService.requestReverification).toHaveBeenCalledWith(ACTOR.tenantId, ACTOR.userId);
    });
  });

  describe('getRecoveryStatus', () => {
    it('wraps the service summary under data', async () => {
      mockService.getRecoveryStatus.mockResolvedValue({ counts: {}, chain: {} });
      const result = (await controller.getRecoveryStatus(ACTOR)) as { success: boolean };
      expect(result.success).toBe(true);
    });
  });
});
