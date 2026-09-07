// Reference: governance/GD-M39-1.md — Decision 8 (verification requirements),
// Decision 13 (chain-verification worker), Decision 14 (supplemental
// notification, deduplicated on transition into BROKEN)

import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from './audit.service';
import { AuditChainVerificationService } from './audit-chain-verification.service';
import { hashAuditEvent, HASH_VERSION_V1 } from './audit-hash.util';

const TENANT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function makeChainedRow(overrides: Record<string, unknown> = {}) {
  const base = {
    id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    tenant_id: TENANT_ID,
    sequence_no: 1n,
    user_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    action: 'AUTH_LOGIN_SUCCESS',
    entity_type: null,
    entity_id: null,
    result: 'SUCCESS',
    metadata: null,
    occurred_at: new Date('2026-01-01T00:00:00.000Z'),
    created_at: new Date('2026-01-01T00:00:00.100Z'),
    retention_until: new Date('2033-01-01T00:00:00.000Z'),
    previous_hash: null,
    hash_version: HASH_VERSION_V1,
    ...overrides,
  };
  const record_hash = hashAuditEvent({
    hashVersion: base.hash_version,
    tenantId: base.tenant_id,
    sequenceNo: base.sequence_no as bigint,
    eventId: base.id,
    userId: base.user_id,
    action: base.action,
    entityType: base.entity_type as string | null,
    entityId: base.entity_id as string | null,
    result: base.result,
    metadata: base.metadata,
    occurredAt: base.occurred_at,
    createdAt: base.created_at,
    retentionUntil: base.retention_until,
    previousHash: base.previous_hash as string | null,
  });
  return { ...base, record_hash: (overrides.record_hash as string | undefined) ?? record_hash };
}

describe('AuditChainVerificationService.verifyTenantChain()', () => {
  let service: AuditChainVerificationService;
  let mockPrisma: {
    $queryRaw: jest.Mock;
    auditChainState: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    mockPrisma = {
      $queryRaw: jest.fn(),
      auditChainState: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditChainVerificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: { logOperationalEvent: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => ({}) } },
        { provide: SchedulerRegistry, useValue: { addInterval: jest.fn() } },
      ],
    }).compile();

    service = module.get(AuditChainVerificationService);
  });

  it('returns OK with rowsChecked:0 for a tenant with no chained rows', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    const result = await service.verifyTenantChain(TENANT_ID);
    expect(result).toEqual({ outcome: 'OK', rowsChecked: 0 });
  });

  it('returns OK for a single valid genesis row matching chain state', async () => {
    const row = makeChainedRow();
    mockPrisma.$queryRaw.mockResolvedValue([row]);
    mockPrisma.auditChainState.findUnique.mockResolvedValue({
      lastSequence: 1n,
      lastHash: row.record_hash,
    });

    const result = await service.verifyTenantChain(TENANT_ID);
    expect(result.outcome).toBe('OK');
  });

  it('detects a hash mismatch (tampered row)', async () => {
    const row = makeChainedRow({ record_hash: 'f'.repeat(64) });
    mockPrisma.$queryRaw.mockResolvedValue([row]);
    mockPrisma.auditChainState.findUnique.mockResolvedValue({
      lastSequence: 1n,
      lastHash: 'f'.repeat(64),
    });

    const result = await service.verifyTenantChain(TENANT_ID);
    expect(result.outcome).toBe('BROKEN');
    if (result.outcome === 'BROKEN') {
      expect(result.reasons.some((r) => r.startsWith('HASH_MISMATCH'))).toBe(true);
    }
  });

  it('detects a sequence gap', async () => {
    const row1 = makeChainedRow({ id: 'a', sequence_no: 1n, previous_hash: null });
    const row3 = makeChainedRow({
      id: 'c',
      sequence_no: 3n,
      previous_hash: row1.record_hash,
    });
    mockPrisma.$queryRaw.mockResolvedValue([row1, row3]);
    mockPrisma.auditChainState.findUnique.mockResolvedValue({
      lastSequence: 3n,
      lastHash: row3.record_hash,
    });

    const result = await service.verifyTenantChain(TENANT_ID);
    expect(result.outcome).toBe('BROKEN');
    if (result.outcome === 'BROKEN') {
      expect(result.reasons.some((r) => r.startsWith('SEQUENCE_GAP'))).toBe(true);
    }
  });

  it('detects a duplicate sequence number', async () => {
    const row1 = makeChainedRow({ id: 'a', sequence_no: 1n, previous_hash: null });
    const row1Dup = makeChainedRow({ id: 'b', sequence_no: 1n, previous_hash: null });
    mockPrisma.$queryRaw.mockResolvedValue([row1, row1Dup]);
    mockPrisma.auditChainState.findUnique.mockResolvedValue({
      lastSequence: 1n,
      lastHash: row1Dup.record_hash,
    });

    const result = await service.verifyTenantChain(TENANT_ID);
    expect(result.outcome).toBe('BROKEN');
    if (result.outcome === 'BROKEN') {
      expect(result.reasons.some((r) => r.startsWith('DUPLICATE_SEQUENCE'))).toBe(true);
    }
  });

  it('detects incorrect genesis placement (no previousHash-null row)', async () => {
    const row = makeChainedRow({ sequence_no: 1n, previous_hash: 'a'.repeat(64) });
    mockPrisma.$queryRaw.mockResolvedValue([row]);
    mockPrisma.auditChainState.findUnique.mockResolvedValue({
      lastSequence: 1n,
      lastHash: row.record_hash,
    });

    const result = await service.verifyTenantChain(TENANT_ID);
    expect(result.outcome).toBe('BROKEN');
    if (result.outcome === 'BROKEN') {
      expect(result.reasons).toContain('INVALID_GENESIS');
    }
  });

  it('detects a final-row-versus-chain-state mismatch', async () => {
    const row = makeChainedRow();
    mockPrisma.$queryRaw.mockResolvedValue([row]);
    mockPrisma.auditChainState.findUnique.mockResolvedValue({
      lastSequence: 2n, // does not match the actual last row's sequenceNo (1n)
      lastHash: row.record_hash,
    });

    const result = await service.verifyTenantChain(TENANT_ID);
    expect(result.outcome).toBe('BROKEN');
    if (result.outcome === 'BROKEN') {
      expect(result.reasons).toContain('CHAIN_STATE_MISMATCH');
    }
  });

  it('never issues an UPDATE/DELETE against audit_events (only $queryRaw SELECT calls)', async () => {
    const row = makeChainedRow({ record_hash: 'f'.repeat(64) }); // force a break
    mockPrisma.$queryRaw.mockResolvedValue([row]);
    mockPrisma.auditChainState.findUnique.mockResolvedValue({
      lastSequence: 1n,
      lastHash: 'f'.repeat(64),
    });

    await service.verifyTenantChain(TENANT_ID);

    // verifyTenantChain only ever calls $queryRaw (read) — never $executeRaw
    // or any Prisma write method. This mock has no $executeRaw/update method
    // at all, so a call to either would throw (undefined is not a function),
    // which this test's absence of a thrown error already proves.
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe('AuditChainVerificationService — BROKEN persistence and deduplication', () => {
  let service: AuditChainVerificationService;
  let mockPrisma: {
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
    auditChainState: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  };
  let mockAuditService: { logOperationalEvent: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(mockPrisma)),
      $queryRaw: jest.fn().mockResolvedValue([{ tenant_id: TENANT_ID }]),
      auditChainState: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue(undefined),
      },
    };
    mockAuditService = { logOperationalEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditChainVerificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
        {
          provide: ConfigService,
          useValue: { get: () => ({ intervalMs: 3600000, batchSize: 10, claimTimeoutMs: 300000 }) },
        },
        { provide: SchedulerRegistry, useValue: { addInterval: jest.fn() } },
      ],
    }).compile();

    service = module.get(AuditChainVerificationService);
  });

  it('emits AUDIT_CHAIN_VERIFICATION_FAILED on the transition into BROKEN, but not on a subsequent already-BROKEN cycle', async () => {
    jest.spyOn(service, 'verifyTenantChain').mockResolvedValue({
      outcome: 'BROKEN',
      reasons: ['HASH_MISMATCH:x'],
      rowsChecked: 1,
    });

    // First cycle: prior state has no lastVerificationResult (never verified).
    mockPrisma.auditChainState.findUnique.mockResolvedValueOnce({ lastVerificationResult: null });
    await service.runVerificationCycle();
    expect(mockAuditService.logOperationalEvent).toHaveBeenCalledTimes(1);

    // Second cycle: prior state is already BROKEN — must not re-emit.
    mockPrisma.auditChainState.findUnique.mockResolvedValueOnce({
      lastVerificationResult: 'BROKEN',
    });
    await service.runVerificationCycle();
    expect(mockAuditService.logOperationalEvent).toHaveBeenCalledTimes(1);
  });

  it('BROKEN state is never auto-cleared even if a later scan reports OK', async () => {
    jest
      .spyOn(service, 'verifyTenantChain')
      .mockResolvedValue({ outcome: 'OK', rowsChecked: 3 });

    mockPrisma.auditChainState.findUnique.mockResolvedValueOnce({
      lastVerificationResult: 'BROKEN',
    });

    await service.runVerificationCycle();

    const updateCall = mockPrisma.auditChainState.update.mock.calls[0];
    expect(updateCall[0].data.lastVerificationResult).toBe('BROKEN');
  });
});
