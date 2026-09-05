// Reference: governance/GD-M37-1.md — M37 Elevation Sessions Foundation
// (Decisions 4-17, 20 exercised directly by this suite)
//
// Pure unit tests — no database, no HTTP. PrismaService and AuditService are
// replaced with jest.fn() mocks, following users.service.spec.ts's own
// $transaction-mocking pattern exactly: mockPrisma.$transaction invokes the
// callback with a mockTx object whose delegates are independently stubbed.
/* eslint-disable */

import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, ElevationSessionStatus, ElevationCapabilityDecision } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import { CAPABILITIES } from './permissions.catalog';
import {
  ELEVATION_SESSION_ALLOWED_CAPABILITIES,
  isElevationSessionAllowedCapability,
} from './elevation-session-allowlist';
import {
  ElevationSessionService,
  isElevationLifecycleCapabilityValidAt,
  type ElevationSessionRecord,
} from './elevation-session.service';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_TENANT_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const REQUESTER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const GRANTEE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const APPROVER_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const SESSION_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const PERMISSION_ID_1 = '11111111-1111-1111-1111-111111111111';
const PERMISSION_ID_2 = '22222222-2222-2222-2222-222222222222';
const NOW = new Date('2026-09-05T12:00:00.000Z');

function makeCapabilityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cap-1',
    elevationSessionId: SESSION_ID,
    permissionId: PERMISSION_ID_1,
    decision: ElevationCapabilityDecision.PENDING,
    permission: { id: PERMISSION_ID_1, resource: 'users', action: 'create' },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    tenantId: TENANT_ID,
    requestedByUserId: REQUESTER_ID,
    granteeUserId: GRANTEE_ID,
    approvedByUserId: null,
    revokedByUserId: null,
    status: ElevationSessionStatus.REQUESTED,
    purpose: 'Investigate a support ticket',
    requestedAt: NOW,
    decidedAt: null,
    activatedAt: null,
    expiresAt: null,
    revokedAt: null,
    revokedReason: null,
    denialReason: null,
    correlationId: null,
    stepUpAuthMethod: null,
    stepUpVerifiedAt: null,
    idempotencyKey: 'idem-key-1',
    capabilities: [makeCapabilityRow()],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('ElevationSessionService', () => {
  let service: ElevationSessionService;
  let mockPrisma: {
    elevationSession: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let mockTx: {
    user: { findFirst: jest.Mock };
    permission: { findMany: jest.Mock };
    elevationSession: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findFirstOrThrow: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    elevationSessionCapability: { update: jest.Mock; count: jest.Mock };
  };
  let mockAuditService: { logEvent: jest.Mock; logEventStrict: jest.Mock };

  beforeEach(async () => {
    mockTx = {
      // Default: any actor lookup succeeds (belongs to the tenant). Tests for
      // ACTOR_NOT_FOUND / APPROVER_NOT_FOUND / REVOKER_NOT_FOUND override this
      // per-case with mockResolvedValueOnce(null) or a rejecting mock.
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'some-actor-id' }),
      },
      permission: {
        findMany: jest.fn().mockResolvedValue([{ id: PERMISSION_ID_1, resource: 'users', action: 'create' }]),
      },
      elevationSession: {
        create: jest.fn().mockResolvedValue(makeSessionRow()),
        findFirst: jest.fn().mockResolvedValue(makeSessionRow()),
        findFirstOrThrow: jest.fn().mockResolvedValue(makeSessionRow()),
        update: jest.fn().mockResolvedValue(makeSessionRow()),
        count: jest.fn().mockResolvedValue(0),
      },
      elevationSessionCapability: {
        update: jest.fn().mockResolvedValue(undefined),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    mockPrisma = {
      elevationSession: { findFirst: jest.fn() },
      $transaction: jest.fn().mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
    };

    mockAuditService = {
      logEvent: jest.fn().mockResolvedValue(undefined),
      logEventStrict: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ElevationSessionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<ElevationSessionService>(ElevationSessionService);
  });

  afterEach(() => jest.clearAllMocks());

  // --------------------------------------------------------------------------
  // requestElevation()
  // --------------------------------------------------------------------------

  describe('requestElevation()', () => {
    const baseInput = {
      tenantId: TENANT_ID,
      requestedByUserId: REQUESTER_ID,
      granteeUserId: GRANTEE_ID,
      purpose: 'Investigate a support ticket',
      capabilities: [CAPABILITIES.USERS_CREATE],
      idempotencyKey: 'idem-key-1',
    };

    it('SUCCESS: returns { outcome: "SUCCESS", session }', async () => {
      const result = await service.requestElevation(baseInput);
      expect(result.outcome).toBe('SUCCESS');
    });

    it('SUCCESS: self-request is permitted (granteeUserId === requestedByUserId)', async () => {
      mockTx.elevationSession.create.mockResolvedValue(
        makeSessionRow({ granteeUserId: REQUESTER_ID }),
      );
      const result = await service.requestElevation({ ...baseInput, granteeUserId: REQUESTER_ID });
      expect(result.outcome).toBe('SUCCESS');
    });

    it('SUCCESS: ELEVATION_SESSION_REQUESTED audit event emitted via logEventStrict inside the transaction', async () => {
      await service.requestElevation(baseInput);
      expect(mockAuditService.logEventStrict).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          action: AuditEventType.ELEVATION_SESSION_REQUESTED,
          tenantId: TENANT_ID,
          entityType: 'ELEVATION_SESSION',
        }),
      );
    });

    it('SUCCESS: logEvent() (non-strict) is never called by this service', async () => {
      await service.requestElevation(baseInput);
      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('INVALID_PURPOSE: empty purpose returns INVALID_PURPOSE and never opens a transaction', async () => {
      const result = await service.requestElevation({ ...baseInput, purpose: '   ' });
      expect(result.outcome).toBe('INVALID_PURPOSE');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('INVALID_IDEMPOTENCY_KEY: empty idempotencyKey returns INVALID_IDEMPOTENCY_KEY', async () => {
      const result = await service.requestElevation({ ...baseInput, idempotencyKey: '' });
      expect(result.outcome).toBe('INVALID_IDEMPOTENCY_KEY');
    });

    it('NO_CAPABILITIES_REQUESTED: empty capabilities array returns NO_CAPABILITIES_REQUESTED', async () => {
      const result = await service.requestElevation({ ...baseInput, capabilities: [] });
      expect(result.outcome).toBe('NO_CAPABILITIES_REQUESTED');
    });

    it('CAPABILITY_NOT_ALLOWLISTED: a real but non-allowlisted M36 capability is rejected', async () => {
      const result = await service.requestElevation({
        ...baseInput,
        capabilities: [CAPABILITIES.EMPLOYEES_READ],
      });
      expect(result.outcome).toBe('CAPABILITY_NOT_ALLOWLISTED');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('CAPABILITY_NOT_ALLOWLISTED: a reserved capability is rejected', async () => {
      const result = await service.requestElevation({
        ...baseInput,
        capabilities: ['users:deactivate'],
      });
      expect(result.outcome).toBe('CAPABILITY_NOT_ALLOWLISTED');
    });

    it('CAPABILITY_NOT_FOUND: allowlisted capability with no matching Permission row', async () => {
      mockTx.permission.findMany.mockResolvedValue([]); // catalog row missing/unseeded
      const result = await service.requestElevation(baseInput);
      expect(result.outcome).toBe('CAPABILITY_NOT_FOUND');
    });

    it('ACTOR_NOT_FOUND: requestedByUserId does not exist in this tenant', async () => {
      mockTx.user.findFirst.mockResolvedValueOnce(null); // requester lookup fails
      const result = await service.requestElevation(baseInput);
      expect(result.outcome).toBe('ACTOR_NOT_FOUND');
      expect((result as { outcome: 'ACTOR_NOT_FOUND'; actorRole: string }).actorRole).toBe('REQUESTER');
    });

    it('ACTOR_NOT_FOUND: granteeUserId does not exist in this tenant (requester check passes first)', async () => {
      mockTx.user.findFirst
        .mockResolvedValueOnce({ id: REQUESTER_ID }) // requester check passes
        .mockResolvedValueOnce(null); // grantee check fails
      const result = await service.requestElevation(baseInput);
      expect(result.outcome).toBe('ACTOR_NOT_FOUND');
      expect((result as { outcome: 'ACTOR_NOT_FOUND'; actorRole: string }).actorRole).toBe('GRANTEE');
    });

    it('ACTOR_NOT_FOUND: no transaction-committing write occurs when the requester is not found', async () => {
      mockTx.user.findFirst.mockResolvedValueOnce(null);
      await service.requestElevation(baseInput);
      expect(mockTx.elevationSession.create).not.toHaveBeenCalled();
    });

    it('DUPLICATE_IDEMPOTENCY_KEY: P2002 on the tenant+idempotencyKey index maps to DUPLICATE_IDEMPOTENCY_KEY', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError('unique constraint', {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: { target: ['tenantId', 'idempotencyKey'] },
      });
      mockTx.elevationSession.create.mockRejectedValue(p2002);
      const result = await service.requestElevation(baseInput);
      expect(result.outcome).toBe('DUPLICATE_IDEMPOTENCY_KEY');
    });

    it('GRANTEE_HAS_NON_TERMINAL_SESSION: P2002 on the partial grantee index maps to GRANTEE_HAS_NON_TERMINAL_SESSION', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError('unique constraint', {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: { target: 'idx_elevation_sessions_tenant_grantee_non_terminal' },
      });
      mockTx.elevationSession.create.mockRejectedValue(p2002);
      const result = await service.requestElevation(baseInput);
      expect(result.outcome).toBe('GRANTEE_HAS_NON_TERMINAL_SESSION');
    });

    it('INTERNAL_ERROR: a non-P2002 transaction error returns INTERNAL_ERROR', async () => {
      mockTx.elevationSession.create.mockRejectedValue(new Error('connection lost'));
      const result = await service.requestElevation(baseInput);
      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('duplicate capability keys in the input are deduplicated before validation', async () => {
      const result = await service.requestElevation({
        ...baseInput,
        capabilities: [CAPABILITIES.USERS_CREATE, CAPABILITIES.USERS_CREATE],
      });
      expect(result.outcome).toBe('SUCCESS');
      const createCall = mockTx.elevationSession.create.mock.calls[0]![0] as {
        data: { capabilities: { create: unknown[] } };
      };
      expect(createCall.data.capabilities.create).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // decideElevationCapabilities()
  // --------------------------------------------------------------------------

  describe('decideElevationCapabilities()', () => {
    const baseInput = {
      sessionId: SESSION_ID,
      tenantId: TENANT_ID,
      approverUserId: APPROVER_ID,
      decisions: [{ permissionId: PERMISSION_ID_1, decision: 'GRANTED' as const }],
    };

    it('SUCCESS_PENDING: one of several items decided, session remains REQUESTED', async () => {
      mockTx.elevationSession.findFirst.mockResolvedValue(
        makeSessionRow({ capabilities: [makeCapabilityRow(), makeCapabilityRow({ id: 'cap-2', permissionId: PERMISSION_ID_2 })] }),
      );
      mockTx.elevationSessionCapability.count.mockResolvedValue(1); // one still PENDING

      const result = await service.decideElevationCapabilities(baseInput);
      expect(result.outcome).toBe('SUCCESS_PENDING');
    });

    it('SUCCESS_APPROVED: last item decided GRANTED, zero remaining PENDING, >=1 GRANTED', async () => {
      mockTx.elevationSessionCapability.count
        .mockResolvedValueOnce(0) // remainingPending
        .mockResolvedValueOnce(1); // grantedCount
      mockTx.elevationSession.update.mockResolvedValue(
        makeSessionRow({ status: ElevationSessionStatus.APPROVED, approvedByUserId: APPROVER_ID }),
      );

      const result = await service.decideElevationCapabilities(baseInput);
      expect(result.outcome).toBe('SUCCESS_APPROVED');
    });

    it('SUCCESS_DENIED: last item decided DENIED, zero remaining PENDING, zero GRANTED', async () => {
      mockTx.elevationSessionCapability.count
        .mockResolvedValueOnce(0) // remainingPending
        .mockResolvedValueOnce(0); // grantedCount
      mockTx.elevationSession.update.mockResolvedValue(
        makeSessionRow({ status: ElevationSessionStatus.DENIED, denialReason: 'Not warranted' }),
      );

      const result = await service.decideElevationCapabilities({
        ...baseInput,
        decisions: [{ permissionId: PERMISSION_ID_1, decision: 'DENIED' }],
        denialReason: 'Not warranted',
      });
      expect(result.outcome).toBe('SUCCESS_DENIED');
    });

    it('SUCCESS_APPROVED: ELEVATION_SESSION_APPROVED audit event emitted', async () => {
      mockTx.elevationSessionCapability.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      mockTx.elevationSession.update.mockResolvedValue(makeSessionRow({ status: ElevationSessionStatus.APPROVED }));

      await service.decideElevationCapabilities(baseInput);

      expect(mockAuditService.logEventStrict).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: AuditEventType.ELEVATION_SESSION_APPROVED }),
      );
    });

    it('NOT_FOUND: session absent or wrong tenant', async () => {
      mockTx.elevationSession.findFirst.mockResolvedValue(null);
      const result = await service.decideElevationCapabilities(baseInput);
      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('INVALID_LIFECYCLE_STATE: session is not REQUESTED', async () => {
      mockTx.elevationSession.findFirst.mockResolvedValue(makeSessionRow({ status: ElevationSessionStatus.APPROVED }));
      const result = await service.decideElevationCapabilities(baseInput);
      expect(result.outcome).toBe('INVALID_LIFECYCLE_STATE');
    });

    it('APPROVER_NOT_FOUND: approverUserId does not exist in this tenant', async () => {
      mockTx.user.findFirst.mockResolvedValueOnce(null);
      const result = await service.decideElevationCapabilities(baseInput);
      expect(result.outcome).toBe('APPROVER_NOT_FOUND');
    });

    it('APPROVER_NOT_FOUND: no capability item update occurs when the approver is not found', async () => {
      mockTx.user.findFirst.mockResolvedValueOnce(null);
      await service.decideElevationCapabilities(baseInput);
      expect(mockTx.elevationSessionCapability.update).not.toHaveBeenCalled();
    });

    it('APPROVER_SEPARATION_VIOLATION: approver === requester', async () => {
      const result = await service.decideElevationCapabilities({ ...baseInput, approverUserId: REQUESTER_ID });
      expect(result.outcome).toBe('APPROVER_SEPARATION_VIOLATION');
    });

    it('APPROVER_SEPARATION_VIOLATION: approver === grantee', async () => {
      const result = await service.decideElevationCapabilities({ ...baseInput, approverUserId: GRANTEE_ID });
      expect(result.outcome).toBe('APPROVER_SEPARATION_VIOLATION');
    });

    it('APPROVER_SEPARATION_VIOLATION: applies even when requester === grantee (self-request)', async () => {
      mockTx.elevationSession.findFirst.mockResolvedValue(
        makeSessionRow({ requestedByUserId: REQUESTER_ID, granteeUserId: REQUESTER_ID }),
      );
      const result = await service.decideElevationCapabilities({ ...baseInput, approverUserId: REQUESTER_ID });
      expect(result.outcome).toBe('APPROVER_SEPARATION_VIOLATION');
    });

    it('CAPABILITY_ITEM_NOT_PENDING: unknown permissionId', async () => {
      const result = await service.decideElevationCapabilities({
        ...baseInput,
        decisions: [{ permissionId: 'not-a-real-permission', decision: 'GRANTED' }],
      });
      expect(result.outcome).toBe('CAPABILITY_ITEM_NOT_PENDING');
    });

    it('CAPABILITY_ITEM_NOT_PENDING: item already decided (immutability — no re-deciding)', async () => {
      mockTx.elevationSession.findFirst.mockResolvedValue(
        makeSessionRow({ capabilities: [makeCapabilityRow({ decision: ElevationCapabilityDecision.GRANTED })] }),
      );
      const result = await service.decideElevationCapabilities(baseInput);
      expect(result.outcome).toBe('CAPABILITY_ITEM_NOT_PENDING');
    });

    it('INTERNAL_ERROR: unexpected error returns INTERNAL_ERROR', async () => {
      mockTx.elevationSession.findFirst.mockRejectedValue(new Error('DB error'));
      const result = await service.decideElevationCapabilities(baseInput);
      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // cancelElevationSession()
  // --------------------------------------------------------------------------

  describe('cancelElevationSession()', () => {
    const baseInput = { sessionId: SESSION_ID, tenantId: TENANT_ID, requestedByUserId: REQUESTER_ID };

    it('SUCCESS: requester cancels before any item decided', async () => {
      mockTx.elevationSession.update.mockResolvedValue(makeSessionRow({ status: ElevationSessionStatus.CANCELLED }));
      const result = await service.cancelElevationSession(baseInput);
      expect(result.outcome).toBe('SUCCESS');
    });

    it('NOT_FOUND: session absent or wrong tenant', async () => {
      mockTx.elevationSession.findFirst.mockResolvedValue(null);
      const result = await service.cancelElevationSession(baseInput);
      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('INVALID_LIFECYCLE_STATE: session is not REQUESTED', async () => {
      mockTx.elevationSession.findFirst.mockResolvedValue(makeSessionRow({ status: ElevationSessionStatus.ACTIVE }));
      const result = await service.cancelElevationSession(baseInput);
      expect(result.outcome).toBe('INVALID_LIFECYCLE_STATE');
    });

    it('REQUESTER_MISMATCH: caller is not the original requester', async () => {
      const result = await service.cancelElevationSession({ ...baseInput, requestedByUserId: GRANTEE_ID });
      expect(result.outcome).toBe('REQUESTER_MISMATCH');
    });

    it('CAPABILITY_ALREADY_DECIDED: cannot cancel once any item has a decision', async () => {
      mockTx.elevationSession.findFirst.mockResolvedValue(
        makeSessionRow({ capabilities: [makeCapabilityRow({ decision: ElevationCapabilityDecision.GRANTED })] }),
      );
      const result = await service.cancelElevationSession(baseInput);
      expect(result.outcome).toBe('CAPABILITY_ALREADY_DECIDED');
    });

    it('SUCCESS: ELEVATION_SESSION_CANCELLED audit event emitted, no revokedByUserId/revokedReason set', async () => {
      mockTx.elevationSession.update.mockResolvedValue(makeSessionRow({ status: ElevationSessionStatus.CANCELLED }));
      await service.cancelElevationSession(baseInput);

      expect(mockAuditService.logEventStrict).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: AuditEventType.ELEVATION_SESSION_CANCELLED }),
      );
      const updateCall = mockTx.elevationSession.update.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(updateCall.data['revokedByUserId']).toBeUndefined();
      expect(updateCall.data['revokedReason']).toBeUndefined();
    });

    it('INTERNAL_ERROR: unexpected error returns INTERNAL_ERROR', async () => {
      mockTx.elevationSession.findFirst.mockRejectedValue(new Error('DB error'));
      const result = await service.cancelElevationSession(baseInput);
      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // markElevationSessionLifecycleActive()
  // --------------------------------------------------------------------------

  describe('markElevationSessionLifecycleActive()', () => {
    // The service validates expiresAt against the real wall-clock Date.now()
    // (GD-M37-1 Decision 8/11 — expiration is never scheduler-dependent), so
    // these fixtures must be relative to actual execution time, not the
    // fictional NOW constant used elsewhere in this suite for row fixtures.
    const future = new Date(Date.now() + 15 * 60 * 1000);
    const past = new Date(Date.now() - 1000);
    const baseInput = { sessionId: SESSION_ID, tenantId: TENANT_ID, expiresAt: future };

    beforeEach(() => {
      mockTx.elevationSession.findFirst.mockResolvedValue(makeSessionRow({ status: ElevationSessionStatus.APPROVED }));
    });

    it('SUCCESS: APPROVED -> ACTIVE with activatedAt and expiresAt set', async () => {
      mockTx.elevationSession.update.mockResolvedValue(
        makeSessionRow({ status: ElevationSessionStatus.ACTIVE, activatedAt: NOW, expiresAt: future }),
      );
      const result = await service.markElevationSessionLifecycleActive(baseInput);
      expect(result.outcome).toBe('SUCCESS');
    });

    it('SUCCESS: ELEVATION_SESSION_ACTIVATED audit event emitted', async () => {
      mockTx.elevationSession.update.mockResolvedValue(makeSessionRow({ status: ElevationSessionStatus.ACTIVE }));
      await service.markElevationSessionLifecycleActive(baseInput);
      expect(mockAuditService.logEventStrict).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: AuditEventType.ELEVATION_SESSION_ACTIVATED }),
      );
    });

    it('NOT_FOUND: session absent or wrong tenant', async () => {
      mockTx.elevationSession.findFirst.mockResolvedValue(null);
      const result = await service.markElevationSessionLifecycleActive(baseInput);
      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('INVALID_LIFECYCLE_STATE: session is not APPROVED', async () => {
      mockTx.elevationSession.findFirst.mockResolvedValue(makeSessionRow({ status: ElevationSessionStatus.REQUESTED }));
      const result = await service.markElevationSessionLifecycleActive(baseInput);
      expect(result.outcome).toBe('INVALID_LIFECYCLE_STATE');
    });

    it('INVALID_EXPIRATION: expiresAt in the past is rejected before any transaction opens', async () => {
      const result = await service.markElevationSessionLifecycleActive({ ...baseInput, expiresAt: past });
      expect(result.outcome).toBe('INVALID_EXPIRATION');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('ACTIVATION_FAILED: a conflicting non-terminal session for the same grantee is detected at activation time', async () => {
      mockTx.elevationSession.count.mockResolvedValue(1); // conflicting non-terminal session found
      mockTx.elevationSession.update.mockResolvedValue(makeSessionRow({ status: ElevationSessionStatus.ACTIVATION_FAILED }));

      const result = await service.markElevationSessionLifecycleActive(baseInput);
      expect(result.outcome).toBe('ACTIVATION_FAILED');
      expect(mockAuditService.logEventStrict).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: AuditEventType.ELEVATION_SESSION_ACTIVATION_FAILED }),
      );
    });

    it('ACTIVATION_FAILED: P2002 race on the update itself is caught and mapped', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError('unique constraint', {
        code: 'P2002',
        clientVersion: '5.0.0',
      });
      mockTx.elevationSession.update
        .mockRejectedValueOnce(p2002)
        .mockResolvedValueOnce(makeSessionRow({ status: ElevationSessionStatus.ACTIVATION_FAILED }));

      const result = await service.markElevationSessionLifecycleActive(baseInput);
      expect(result.outcome).toBe('ACTIVATION_FAILED');
    });

    it('INTERNAL_ERROR: unexpected error returns INTERNAL_ERROR', async () => {
      mockTx.elevationSession.findFirst.mockRejectedValue(new Error('DB error'));
      const result = await service.markElevationSessionLifecycleActive(baseInput);
      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // revokeElevationSession()
  // --------------------------------------------------------------------------

  describe('revokeElevationSession()', () => {
    const baseInput = {
      sessionId: SESSION_ID,
      tenantId: TENANT_ID,
      revokedByUserId: GRANTEE_ID,
      revokedReason: 'No longer needed',
    };

    beforeEach(() => {
      mockTx.elevationSession.findFirst.mockResolvedValue(makeSessionRow({ status: ElevationSessionStatus.ACTIVE }));
    });

    it('SUCCESS: grantee self-revokes an ACTIVE session', async () => {
      mockTx.elevationSession.update.mockResolvedValue(
        makeSessionRow({ status: ElevationSessionStatus.REVOKED, revokedByUserId: GRANTEE_ID }),
      );
      const result = await service.revokeElevationSession(baseInput);
      expect(result.outcome).toBe('SUCCESS');
    });

    it('SUCCESS: requester-initiated revocation is permitted even though requester !== grantee', async () => {
      mockTx.elevationSession.update.mockResolvedValue(makeSessionRow({ status: ElevationSessionStatus.REVOKED }));
      const result = await service.revokeElevationSession({ ...baseInput, revokedByUserId: REQUESTER_ID });
      expect(result.outcome).toBe('SUCCESS');
    });

    it('SUCCESS: an independent actor (neither requester nor grantee) may revoke', async () => {
      mockTx.elevationSession.update.mockResolvedValue(makeSessionRow({ status: ElevationSessionStatus.REVOKED }));
      const result = await service.revokeElevationSession({ ...baseInput, revokedByUserId: APPROVER_ID });
      expect(result.outcome).toBe('SUCCESS');
    });

    it('NOT_FOUND: session absent or wrong tenant', async () => {
      mockTx.elevationSession.findFirst.mockResolvedValue(null);
      const result = await service.revokeElevationSession(baseInput);
      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('INVALID_LIFECYCLE_STATE: session is not ACTIVE', async () => {
      mockTx.elevationSession.findFirst.mockResolvedValue(makeSessionRow({ status: ElevationSessionStatus.APPROVED }));
      const result = await service.revokeElevationSession(baseInput);
      expect(result.outcome).toBe('INVALID_LIFECYCLE_STATE');
    });

    it('INVALID_REVOCATION_REASON: empty reason is rejected before any transaction opens', async () => {
      const result = await service.revokeElevationSession({ ...baseInput, revokedReason: '   ' });
      expect(result.outcome).toBe('INVALID_REVOCATION_REASON');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('REVOKER_NOT_FOUND: revokedByUserId does not exist in this tenant', async () => {
      mockTx.user.findFirst.mockResolvedValueOnce(null);
      const result = await service.revokeElevationSession(baseInput);
      expect(result.outcome).toBe('REVOKER_NOT_FOUND');
    });

    it('REVOKER_NOT_FOUND: no state mutation occurs when the revoker is not found', async () => {
      mockTx.user.findFirst.mockResolvedValueOnce(null);
      await service.revokeElevationSession(baseInput);
      expect(mockTx.elevationSession.update).not.toHaveBeenCalled();
    });

    it('SUCCESS: ELEVATION_SESSION_REVOKED audit event emitted', async () => {
      mockTx.elevationSession.update.mockResolvedValue(makeSessionRow({ status: ElevationSessionStatus.REVOKED }));
      await service.revokeElevationSession(baseInput);
      expect(mockAuditService.logEventStrict).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: AuditEventType.ELEVATION_SESSION_REVOKED }),
      );
    });

    it('INTERNAL_ERROR: unexpected error returns INTERNAL_ERROR', async () => {
      mockTx.elevationSession.findFirst.mockRejectedValue(new Error('DB error'));
      const result = await service.revokeElevationSession(baseInput);
      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // reconcileExpiredElevationSession() — reporting-only (GD-M37-1 Decision 11)
  // --------------------------------------------------------------------------

  describe('reconcileExpiredElevationSession()', () => {
    const past = new Date(NOW.getTime() - 1000);
    const future = new Date(NOW.getTime() + 1000);
    const baseInput = { sessionId: SESSION_ID, tenantId: TENANT_ID, now: NOW };

    it('SUCCESS: ACTIVE session past expiresAt transitions to EXPIRED', async () => {
      mockTx.elevationSession.findFirst.mockResolvedValue(
        makeSessionRow({ status: ElevationSessionStatus.ACTIVE, expiresAt: past }),
      );
      mockTx.elevationSession.update.mockResolvedValue(makeSessionRow({ status: ElevationSessionStatus.EXPIRED }));

      const result = await service.reconcileExpiredElevationSession(baseInput);
      expect(result.outcome).toBe('SUCCESS');
      expect(mockAuditService.logEventStrict).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ action: AuditEventType.ELEVATION_SESSION_EXPIRED }),
      );
    });

    it('NOT_FOUND: session absent or wrong tenant', async () => {
      mockTx.elevationSession.findFirst.mockResolvedValue(null);
      const result = await service.reconcileExpiredElevationSession(baseInput);
      expect(result.outcome).toBe('NOT_FOUND');
    });

    it('INVALID_LIFECYCLE_STATE: session is not ACTIVE', async () => {
      mockTx.elevationSession.findFirst.mockResolvedValue(makeSessionRow({ status: ElevationSessionStatus.EXPIRED }));
      const result = await service.reconcileExpiredElevationSession(baseInput);
      expect(result.outcome).toBe('INVALID_LIFECYCLE_STATE');
    });

    it('NOT_YET_EXPIRED: ACTIVE session whose expiresAt has not yet passed', async () => {
      mockTx.elevationSession.findFirst.mockResolvedValue(
        makeSessionRow({ status: ElevationSessionStatus.ACTIVE, expiresAt: future }),
      );
      const result = await service.reconcileExpiredElevationSession(baseInput);
      expect(result.outcome).toBe('NOT_YET_EXPIRED');
    });

    it('INTERNAL_ERROR: unexpected error returns INTERNAL_ERROR', async () => {
      mockTx.elevationSession.findFirst.mockRejectedValue(new Error('DB error'));
      const result = await service.reconcileExpiredElevationSession(baseInput);
      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // getElevationSessionById()
  // --------------------------------------------------------------------------

  describe('getElevationSessionById()', () => {
    it('returns the record when found within the given tenant', async () => {
      mockPrisma.elevationSession.findFirst.mockResolvedValue(makeSessionRow());
      const result = await service.getElevationSessionById(SESSION_ID, TENANT_ID);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(SESSION_ID);
    });

    it('returns null when absent', async () => {
      mockPrisma.elevationSession.findFirst.mockResolvedValue(null);
      const result = await service.getElevationSessionById(SESSION_ID, TENANT_ID);
      expect(result).toBeNull();
    });

    it('tenantId is included in the Prisma findFirst where clause (SEC-003) — cross-tenant lookup returns null, not another tenant\'s session', async () => {
      mockPrisma.elevationSession.findFirst.mockResolvedValue(null);
      const result = await service.getElevationSessionById(SESSION_ID, OTHER_TENANT_ID);
      expect(result).toBeNull();
      const whereArg = mockPrisma.elevationSession.findFirst.mock.calls[0]![0].where as Record<string, unknown>;
      expect(whereArg['tenantId']).toBe(OTHER_TENANT_ID);
    });
  });
});

// ---------------------------------------------------------------------------
// isElevationLifecycleCapabilityValidAt() — pure validity predicate
// (GD-M37-1 Decision 11's full validity rule)
// ---------------------------------------------------------------------------

describe('isElevationLifecycleCapabilityValidAt()', () => {
  const activatedAt = new Date('2026-09-05T10:00:00.000Z');
  const expiresAt = new Date('2026-09-05T10:30:00.000Z');

  function baseCheck(overrides: Partial<Parameters<typeof isElevationLifecycleCapabilityValidAt>[0]> = {}) {
    return {
      session: {
        status: ElevationSessionStatus.ACTIVE,
        tenantId: TENANT_ID,
        activatedAt,
        expiresAt,
        revokedAt: null,
      },
      capabilityDecision: ElevationCapabilityDecision.GRANTED,
      requestingTenantId: TENANT_ID,
      now: new Date('2026-09-05T10:15:00.000Z'),
      ...overrides,
    };
  }

  it('true: all conditions satisfied — ACTIVE, matching tenant, within window, not revoked, GRANTED', () => {
    expect(isElevationLifecycleCapabilityValidAt(baseCheck())).toBe(true);
  });

  it('false: session status is not ACTIVE', () => {
    expect(
      isElevationLifecycleCapabilityValidAt(
        baseCheck({ session: { ...baseCheck().session, status: ElevationSessionStatus.REVOKED } }),
      ),
    ).toBe(false);
  });

  it('false: tenantId does not match the requesting tenant', () => {
    expect(isElevationLifecycleCapabilityValidAt(baseCheck({ requestingTenantId: OTHER_TENANT_ID }))).toBe(false);
  });

  it('false: now is before activatedAt', () => {
    expect(isElevationLifecycleCapabilityValidAt(baseCheck({ now: new Date('2026-09-05T09:59:00.000Z') }))).toBe(false);
  });

  it('false: now is at or after expiresAt (boundary: exactly expiresAt is NOT valid)', () => {
    expect(isElevationLifecycleCapabilityValidAt(baseCheck({ now: expiresAt }))).toBe(false);
  });

  it('false: now is after expiresAt', () => {
    expect(isElevationLifecycleCapabilityValidAt(baseCheck({ now: new Date('2026-09-05T11:00:00.000Z') }))).toBe(false);
  });

  it('false: revokedAt is set', () => {
    expect(
      isElevationLifecycleCapabilityValidAt(
        baseCheck({ session: { ...baseCheck().session, revokedAt: new Date('2026-09-05T10:10:00.000Z') } }),
      ),
    ).toBe(false);
  });

  it('false: the specific capability item decision is PENDING, not GRANTED', () => {
    expect(
      isElevationLifecycleCapabilityValidAt(baseCheck({ capabilityDecision: ElevationCapabilityDecision.PENDING })),
    ).toBe(false);
  });

  it('false: the specific capability item decision is DENIED', () => {
    expect(
      isElevationLifecycleCapabilityValidAt(baseCheck({ capabilityDecision: ElevationCapabilityDecision.DENIED })),
    ).toBe(false);
  });

  it('false: activatedAt is null (never activated)', () => {
    expect(
      isElevationLifecycleCapabilityValidAt(baseCheck({ session: { ...baseCheck().session, activatedAt: null } })),
    ).toBe(false);
  });

  it('false: expiresAt is null (never set)', () => {
    expect(
      isElevationLifecycleCapabilityValidAt(baseCheck({ session: { ...baseCheck().session, expiresAt: null } })),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Elevation session capability allowlist (GD-M37-1 Decision 10 / Appendix A)
// ---------------------------------------------------------------------------

describe('ELEVATION_SESSION_ALLOWED_CAPABILITIES (GD-M37-1 Appendix A)', () => {
  it('contains exactly the 4 governance-approved capabilities, verbatim from permissions.catalog.ts', () => {
    expect(new Set(ELEVATION_SESSION_ALLOWED_CAPABILITIES)).toEqual(
      new Set([
        CAPABILITIES.USERS_CREATE,
        CAPABILITIES.USERS_READ,
        CAPABILITIES.USERS_UPDATE,
        CAPABILITIES.ROLES_ASSIGNABLE_READ,
      ]),
    );
    expect(ELEVATION_SESSION_ALLOWED_CAPABILITIES).toHaveLength(4);
  });

  it('isElevationSessionAllowedCapability() returns true for each of the 4 allowlisted capabilities', () => {
    for (const capability of ELEVATION_SESSION_ALLOWED_CAPABILITIES) {
      expect(isElevationSessionAllowedCapability(capability)).toBe(true);
    }
  });

  it('isElevationSessionAllowedCapability() returns false for a real but non-allowlisted M36 capability', () => {
    expect(isElevationSessionAllowedCapability(CAPABILITIES.EMPLOYEES_READ)).toBe(false);
    expect(isElevationSessionAllowedCapability(CAPABILITIES.CANDIDATES_READ)).toBe(false);
  });

  it('isElevationSessionAllowedCapability() returns false for a reserved (unseeded) capability', () => {
    expect(isElevationSessionAllowedCapability('employees:terminate')).toBe(false);
    expect(isElevationSessionAllowedCapability('users:deactivate')).toBe(false);
    expect(isElevationSessionAllowedCapability('users:assign-role')).toBe(false);
    expect(isElevationSessionAllowedCapability('offers:rescind')).toBe(false);
  });

  it('isElevationSessionAllowedCapability() returns false for an unrecognized string', () => {
    expect(isElevationSessionAllowedCapability('not:a-real-capability')).toBe(false);
  });
});
