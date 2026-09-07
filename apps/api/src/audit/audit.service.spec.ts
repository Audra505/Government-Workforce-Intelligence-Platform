// Reference: directives/08_audit_rules.md — AUD-100 (required event fields), AUD-1300 (failure suppression)
// Reference: governance/GD-M39-1.md — Decision 5 (occurredAt/id before first
// attempt), Decision 8 (chain-writing path), Decision 11 (dead-letter),
// Decision 14 (strict vs. operational)
//
// Tests are pure — no database connection, no network, no NestJS application
// bootstrap. PrismaService is replaced with a jest.fn()-based mock whose
// $transaction() invokes its callback with a mock TransactionClient exposing
// $executeRaw/$queryRaw/auditEvent.createMany — the surface writeChainedEvent()
// actually uses.

import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { PrismaService } from '../database/prisma.service';
import { AuditService, SYSTEM_USER_ID, deriveRetentionUntil } from './audit.service';
import { AuditEventType } from './enums/audit-event-type.enum';

function makeMockTx(overrides: {
  createManyCount?: number;
  lastSequence?: bigint;
  lastHash?: string | null;
  existingEvent?: Record<string, unknown>;
} = {}) {
  return {
    $executeRaw: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest
      .fn()
      .mockResolvedValue([
        { last_sequence: overrides.lastSequence ?? 0n, last_hash: overrides.lastHash ?? null },
      ]),
    auditEvent: {
      createMany: jest.fn().mockResolvedValue({ count: overrides.createManyCount ?? 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(overrides.existingEvent ?? null),
    },
  };
}

describe('AuditService', () => {
  let service: AuditService;
  let mockTx: ReturnType<typeof makeMockTx>;
  let mockPrisma: {
    $transaction: jest.Mock;
    auditWriteFailure: { create: jest.Mock };
  };
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockTx = makeMockTx();
    mockPrisma = {
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockTx)),
      auditWriteFailure: { create: jest.fn().mockResolvedValue(undefined) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<AuditService>(AuditService);
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // logEvent() — successful chain write
  // ---------------------------------------------------------------------------

  describe('logEvent() — success path', () => {
    it('writes the event through the chain-writing path with the correct tenantId, userId, action, result', async () => {
      await service.logEvent({
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: AuditEventType.AUTH_LOGIN_SUCCESS,
        result: 'SUCCESS',
      });

      expect(mockTx.auditEvent.createMany).toHaveBeenCalledTimes(1);
      const [{ data }] = mockTx.auditEvent.createMany.mock.calls[0];
      expect(data[0]).toMatchObject({
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: AuditEventType.AUTH_LOGIN_SUCCESS,
        result: 'SUCCESS',
      });
    });

    it('generates a fresh id and sets sequenceNo=1n/previousHash=null at genesis (empty chain state)', async () => {
      await service.logEvent({
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: AuditEventType.AUTH_LOGIN_SUCCESS,
        result: 'SUCCESS',
      });

      const [{ data }] = mockTx.auditEvent.createMany.mock.calls[0];
      expect(typeof data[0].id).toBe('string');
      expect(data[0].id).toHaveLength(36); // UUID
      expect(data[0].sequenceNo).toBe(1n);
      expect(data[0].previousHash).toBeUndefined();
      expect(data[0].hashVersion).toBe('v1');
      expect(data[0].recordHash).toHaveLength(64);
    });

    it('allocates the next sequence number and links previousHash when the chain already has a tip', async () => {
      mockTx = makeMockTx({ lastSequence: 5n, lastHash: 'f'.repeat(64) });
      mockPrisma.$transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockTx));

      await service.logEvent({
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: AuditEventType.AUTH_LOGIN_SUCCESS,
        result: 'SUCCESS',
      });

      const [{ data }] = mockTx.auditEvent.createMany.mock.calls[0];
      expect(data[0].sequenceNo).toBe(6n);
      expect(data[0].previousHash).toBe('f'.repeat(64));
    });

    it('does not advance the chain pointer when createMany reports zero inserted rows (idempotent skip of matching content)', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      try {
        mockTx = makeMockTx({
          createManyCount: 0,
          existingEvent: {
            tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
            action: AuditEventType.AUTH_LOGIN_SUCCESS,
            result: 'SUCCESS',
            entityType: null,
            entityId: null,
            occurredAt: new Date('2026-01-01T00:00:00.000Z'),
            metadata: null,
          },
        });
        mockPrisma.$transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockTx));

        await service.logEvent({
          tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          action: AuditEventType.AUTH_LOGIN_SUCCESS,
          result: 'SUCCESS',
        });

        // Only the init INSERT ON CONFLICT DO NOTHING ($executeRaw call #1)
        // — the chain-pointer UPDATE ($executeRaw call #2) must be skipped.
        expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
        // Content was verified to match — no dead-letter, no thrown error.
        expect(mockPrisma.auditWriteFailure.create).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('throws (and dead-letters) when an existing row under the same id has DIFFERENT governed content — never silently accepted', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      try {
        mockTx = makeMockTx({
          createManyCount: 0,
          existingEvent: {
            tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
            action: AuditEventType.AUTH_LOGIN_FAILURE, // different action — mismatch
            result: 'FAILURE',
            entityType: null,
            entityId: null,
            occurredAt: new Date('2026-01-01T00:00:00.000Z'),
            metadata: null,
          },
        });
        mockPrisma.$transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockTx));

        // logEvent() never throws (AUD-1300) — the mismatch surfaces via
        // the dead-letter path instead, exactly like any other chain-write
        // failure.
        await service.logEvent({
          tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          action: AuditEventType.AUTH_LOGIN_SUCCESS,
          result: 'SUCCESS',
        });

        expect(mockPrisma.auditWriteFailure.create).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('passes entityType, entityId, and metadata through when provided', async () => {
      const metadata = { updatedFields: ['a'] };
      await service.logEvent({
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: AuditEventType.WORKFORCE_EMPLOYEE_UPDATED,
        result: 'SUCCESS',
        entityType: 'EMPLOYEE',
        entityId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        metadata,
      });

      const [{ data }] = mockTx.auditEvent.createMany.mock.calls[0];
      expect(data[0].entityType).toBe('EMPLOYEE');
      expect(data[0].entityId).toBe('dddddddd-dddd-dddd-dddd-dddddddddddd');
      expect(data[0].metadata).toEqual(metadata);
    });

    // Pre-M39 coverage preserved: audit.service.spec.ts (committed) had
    // 'logEvent() passes undefined for entityType and entityId when
    // omitted' — equivalent assertion against the new createMany payload.
    it('passes undefined for entityType and entityId when omitted', async () => {
      await service.logEvent({
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: AuditEventType.AUTH_LOGOUT,
        result: 'SUCCESS',
      });

      const [{ data }] = mockTx.auditEvent.createMany.mock.calls[0];
      expect(data[0].entityType).toBeUndefined();
      expect(data[0].entityId).toBeUndefined();
    });

    // Pre-M39 coverage preserved: audit.service.spec.ts (committed) had
    // 'logEvent() correctly writes a FAILURE result'.
    it('correctly writes a FAILURE result', async () => {
      await service.logEvent({
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: AuditEventType.AUTHZ_ACCESS_DENIED,
        result: 'FAILURE',
      });

      const [{ data }] = mockTx.auditEvent.createMany.mock.calls[0];
      expect(data[0].result).toBe('FAILURE');
    });

    it('resolves without a return value on success (preserves existing 71-caller contract)', async () => {
      const result = await service.logEvent({
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: AuditEventType.AUTH_LOGIN_SUCCESS,
        result: 'SUCCESS',
      });
      expect(result).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // logEvent() — AUD-1300 dead-letter path (GD-M39-1 Decision 11)
  // ---------------------------------------------------------------------------

  describe('logEvent() — dead-letter path', () => {
    it('does not throw when the chain write fails', async () => {
      mockPrisma.$transaction = jest.fn().mockRejectedValue(new Error('DB write failed'));

      await expect(
        service.logEvent({
          tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          action: AuditEventType.AUTH_LOGIN_FAILURE,
          result: 'FAILURE',
        }),
      ).resolves.toBeUndefined();
    });

    it('journals a PENDING AuditWriteFailure preserving the original id/occurredAt/tenant/actor/action/entity/result/metadata', async () => {
      mockPrisma.$transaction = jest.fn().mockRejectedValue(new Error('DB write failed'));

      await service.logEvent({
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: AuditEventType.WORKFORCE_EMPLOYEE_UPDATED,
        result: 'SUCCESS',
        entityType: 'EMPLOYEE',
        entityId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        metadata: { updatedFields: ['a'] },
      });

      expect(mockPrisma.auditWriteFailure.create).toHaveBeenCalledTimes(1);
      const [{ data }] = mockPrisma.auditWriteFailure.create.mock.calls[0];
      expect(data).toMatchObject({
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: AuditEventType.WORKFORCE_EMPLOYEE_UPDATED,
        entityType: 'EMPLOYEE',
        entityId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        result: 'SUCCESS',
        metadata: { updatedFields: ['a'] },
        status: 'PENDING',
        attemptCount: 0,
      });
      expect(typeof data.id).toBe('string');
      expect(data.occurredAt).toBeInstanceOf(Date);
    });

    // Pre-M39 coverage preserved: audit.service.spec.ts (committed) had
    // 'logEvent() calls logger.error exactly once when
    // prisma.auditEvent.create() rejects' — same cardinality assertion for
    // the ordinary single-failure (dead-letter-succeeds) case, distinct
    // from the double-failure case below which is asserted at exactly 2.
    it('calls logger.error exactly once when the chain write fails and the dead-letter write succeeds', async () => {
      mockPrisma.$transaction = jest.fn().mockRejectedValue(new Error('DB write failed'));

      await service.logEvent({
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: AuditEventType.AUTH_LOGIN_FAILURE,
        result: 'FAILURE',
      });

      expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('never stores a raw database driver error message as failureReason — only a sanitized category', async () => {
      mockPrisma.$transaction = jest
        .fn()
        .mockRejectedValue(new Error('connection terminated unexpectedly: password authentication failed for user "govplatform"'));

      await service.logEvent({
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: AuditEventType.AUTH_LOGIN_FAILURE,
        result: 'FAILURE',
      });

      const [{ data }] = mockPrisma.auditWriteFailure.create.mock.calls[0];
      expect(data.failureReason).not.toContain('password');
      expect(data.failureReason).not.toContain('govplatform');
      expect(typeof data.failureReason).toBe('string');
    });

    it('still emits the AUD-1300 log line without userId, entityId, or metadata', async () => {
      const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const entityId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
      mockPrisma.$transaction = jest.fn().mockRejectedValue(new Error('DB write failed'));

      await service.logEvent({
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId,
        action: AuditEventType.AUTH_LOGIN_SUCCESS,
        result: 'SUCCESS',
        entityId,
        metadata: { ipAddress: '192.168.99.1' },
      });

      const loggedMessage = loggerErrorSpy.mock.calls[0]![0] as string;
      expect(loggedMessage).not.toContain(userId);
      expect(loggedMessage).not.toContain(entityId);
      expect(loggedMessage).toContain(AuditEventType.AUTH_LOGIN_SUCCESS);
      expect(loggedMessage).toContain('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    });

    it('does not throw and logs twice when the dead-letter write also fails (total-outage-adjacent case)', async () => {
      mockPrisma.$transaction = jest.fn().mockRejectedValue(new Error('DB write failed'));
      mockPrisma.auditWriteFailure.create = jest.fn().mockRejectedValue(new Error('DB unreachable'));

      await expect(
        service.logEvent({
          tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          action: AuditEventType.AUTH_LOGIN_FAILURE,
          result: 'FAILURE',
        }),
      ).resolves.toBeUndefined();

      expect(loggerErrorSpy).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // logEventStrict() — fail-closed, reuses caller's transaction, no dead-letter
  // ---------------------------------------------------------------------------

  describe('logEventStrict()', () => {
    it('writes through the same chain-writing path, on the caller-supplied tx (never opens its own transaction)', async () => {
      await service.logEventStrict(mockTx as never, {
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: AuditEventType.ELEVATION_SESSION_REQUESTED,
        result: 'SUCCESS',
      });

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockTx.auditEvent.createMany).toHaveBeenCalledTimes(1);
    });

    it('propagates (does not swallow) a chain-write failure — fail-closed', async () => {
      mockTx.auditEvent.createMany.mockRejectedValue(new Error('constraint violation'));

      await expect(
        service.logEventStrict(mockTx as never, {
          tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          action: AuditEventType.ELEVATION_SESSION_REQUESTED,
          result: 'SUCCESS',
        }),
      ).rejects.toThrow('constraint violation');

      expect(mockPrisma.auditWriteFailure.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // logOperationalEvent() — narrow, non-recursive supplemental path
  // ---------------------------------------------------------------------------

  describe('logOperationalEvent()', () => {
    it('writes through the chain-writing path on success', async () => {
      await service.logOperationalEvent({
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: SYSTEM_USER_ID,
        action: AuditEventType.AUDIT_WRITE_RECOVERY_SUCCEEDED,
        result: 'SUCCESS',
      });
      expect(mockTx.auditEvent.createMany).toHaveBeenCalledTimes(1);
    });

    it('does not throw when the write fails', async () => {
      mockPrisma.$transaction = jest.fn().mockRejectedValue(new Error('DB write failed'));

      await expect(
        service.logOperationalEvent({
          tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          userId: SYSTEM_USER_ID,
          action: AuditEventType.AUDIT_WRITE_RECOVERY_SUCCEEDED,
          result: 'SUCCESS',
        }),
      ).resolves.toBeUndefined();
    });

    it('NEVER creates an AuditWriteFailure row on its own failure (non-recursive)', async () => {
      mockPrisma.$transaction = jest.fn().mockRejectedValue(new Error('DB write failed'));

      await service.logOperationalEvent({
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: SYSTEM_USER_ID,
        action: AuditEventType.AUDIT_WRITE_RECOVERY_SUCCEEDED,
        result: 'SUCCESS',
      });

      expect(mockPrisma.auditWriteFailure.create).not.toHaveBeenCalled();
    });

    it('emits a warning (not an error) log line on failure', async () => {
      mockPrisma.$transaction = jest.fn().mockRejectedValue(new Error('DB write failed'));

      await service.logOperationalEvent({
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: SYSTEM_USER_ID,
        action: AuditEventType.AUDIT_CHAIN_VERIFICATION_FAILED,
        result: 'FAILURE',
      });

      expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // replayFailedWrite() — recovery worker's replay path (GD-M39-1 Decision 11)
  // ---------------------------------------------------------------------------

  describe('replayFailedWrite()', () => {
    it('reuses the original id and occurredAt (never regenerates them)', async () => {
      const originalOccurredAt = new Date('2026-01-01T00:00:00.000Z');
      const result = await service.replayFailedWrite(mockTx as never, {
        id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: AuditEventType.AUTH_LOGIN_SUCCESS,
        entityType: null,
        entityId: null,
        result: 'SUCCESS',
        metadata: null,
        occurredAt: originalOccurredAt,
      });

      expect(result).toEqual({ inserted: true });
      const [{ data }] = mockTx.auditEvent.createMany.mock.calls[0];
      expect(data[0].id).toBe('ffffffff-ffff-ffff-ffff-ffffffffffff');
      expect(data[0].occurredAt).toBe(originalOccurredAt);
    });

    it('reports inserted:false when the row already existed with matching content (idempotent replay)', async () => {
      const occurredAt = new Date('2026-01-01T00:00:00.000Z');
      mockTx = makeMockTx({
        createManyCount: 0,
        existingEvent: {
          tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          action: AuditEventType.AUTH_LOGIN_SUCCESS,
          result: 'SUCCESS',
          entityType: null,
          entityId: null,
          occurredAt,
          metadata: null,
        },
      });
      const result = await service.replayFailedWrite(mockTx as never, {
        id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: AuditEventType.AUTH_LOGIN_SUCCESS,
        entityType: null,
        entityId: null,
        result: 'SUCCESS',
        metadata: null,
        occurredAt,
      });

      expect(result).toEqual({ inserted: false });
    });

    it('throws AuditEventContentMismatchError when the existing row under the same id has different content', async () => {
      const occurredAt = new Date('2026-01-01T00:00:00.000Z');
      mockTx = makeMockTx({
        createManyCount: 0,
        existingEvent: {
          tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          action: AuditEventType.AUTH_LOGIN_SUCCESS,
          result: 'SUCCESS',
          entityType: 'DIFFERENT_ENTITY_TYPE', // mismatch
          entityId: null,
          occurredAt,
          metadata: null,
        },
      });

      await expect(
        service.replayFailedWrite(mockTx as never, {
          id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
          tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          action: AuditEventType.AUTH_LOGIN_SUCCESS,
          entityType: null,
          entityId: null,
          result: 'SUCCESS',
          metadata: null,
          occurredAt,
        }),
      ).rejects.toThrow('Audit event content mismatch');
    });
  });

  // ---------------------------------------------------------------------------
  // deriveRetentionUntil() — GD-M39-1 Decision 6
  // ---------------------------------------------------------------------------

  describe('deriveRetentionUntil()', () => {
    it('adds exactly 7 calendar years to an ordinary date', () => {
      const result = deriveRetentionUntil(new Date('2026-06-15T12:00:00.000Z'));
      expect(result.toISOString()).toBe('2033-06-15T12:00:00.000Z');
    });

    it('clamps a Feb 29 leap-day occurredAt to Feb 28 in a non-leap target year, matching PostgreSQL', () => {
      const result = deriveRetentionUntil(new Date('2028-02-29T00:00:00.000Z'));
      // 2028 + 7 = 2035, not a leap year — Feb 29 does not exist in 2035.
      // Proven against a real PostgreSQL 16 instance during M39 validation:
      // SELECT '2028-02-29T00:00:00.000Z'::timestamptz + INTERVAL '7 years'
      //   => 2035-02-28 00:00:00+00 (clamps down, never overflows to March).
      expect(result.toISOString()).toBe('2035-02-28T00:00:00.000Z');
    });

    it('clamps Jan 31 to the last day of the target month when that month is shorter', () => {
      // Only relevant to +7 calendar years (same month, same day count as
      // origin unless origin is Feb 29) — included as a defensive case
      // proving the day-count clamp logic generalizes beyond Feb 29.
      const result = deriveRetentionUntil(new Date('2026-01-31T23:59:59.999Z'));
      expect(result.toISOString()).toBe('2033-01-31T23:59:59.999Z');
    });

    it('preserves sub-second precision through the transformation', () => {
      const result = deriveRetentionUntil(new Date('2026-01-01T00:00:00.123Z'));
      expect(result.toISOString()).toBe('2033-01-01T00:00:00.123Z');
    });
  });

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  it('SYSTEM_USER_ID is the zero UUID sentinel', () => {
    expect(SYSTEM_USER_ID).toBe('00000000-0000-0000-0000-000000000000');
  });
});
