// Reference: governance/GD-M18-1.md — Decision 18 (OfferService unit tests required)
// Reference: governance/GD-M18-1.md — Decision 7 (lifecycle), 9 (no hire-to-employee), 10 (active offer), 14 (error codes), 17 (audit/PII)
//
// Pure unit tests — no database.
// PrismaService and AuditService replaced with jest.fn() mocks.
// Verifies all discriminated-union outcomes for each OfferService method.
// SEC-003 tenant isolation: tenantId always present in where clauses; cross-tenant = NOT_FOUND.
// Active offer: deleted_at IS NULL AND status NOT IN ('DECLINED', 'WITHDRAWN') — ACCEPTED blocks re-offer.
// P2002 race condition: partial unique index violation on concurrent creates → ACTIVE_OFFER_EXISTS.
// Terminal states: ACCEPTED, DECLINED, WITHDRAWN block all further transitions (GD-M18-1 D7).
// Hire-to-employee guard: recordOfferResponse must NOT call application.update or employee.create (GD-M18-1 D3, D9).
// PII safety: notes text and offerDate value must not appear in audit metadata (GD-M18-1 D17).

import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

import { OfferService } from './offer.service';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import type { CreateOfferParams, UpdateOfferParams } from './offer.service';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TENANT_ID      = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_TENANT   = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const ACTOR_ID       = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const APPLICATION_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OFFER_ID       = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const CREATED_AT = new Date('2026-07-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-07-01T01:00:00.000Z');

function makeOfferRow(overrides: Record<string, unknown> = {}) {
  return {
    id: OFFER_ID,
    tenantId: TENANT_ID,
    applicationId: APPLICATION_ID,
    status: 'DRAFT',
    offerDate: null as Date | null,
    acceptedAt: null as Date | null,
    declinedAt: null as Date | null,
    notes: null as string | null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

const APPLICATION_ROW_OFFER = { id: APPLICATION_ID, status: 'OFFER' };

const CREATE_PARAMS: CreateOfferParams = { applicationId: APPLICATION_ID };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OfferService', () => {
  let service: OfferService;

  const mockPrisma = {
    application: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    offer: {
      create:    jest.fn(),
      findFirst: jest.fn(),
      findMany:  jest.fn(),
      count:     jest.fn(),
      update:    jest.fn(),
    },
    employee: {
      create: jest.fn(),
    },
  };
  const mockAuditService = { logEvent: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OfferService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<OfferService>(OfferService);
  });

  // ---------------------------------------------------------------------------
  // createOffer
  // ---------------------------------------------------------------------------

  describe('createOffer()', () => {
    function setupHappyPath() {
      mockPrisma.application.findFirst.mockResolvedValue(APPLICATION_ROW_OFFER);
      mockPrisma.offer.findFirst.mockResolvedValue(null);
      mockPrisma.offer.create.mockResolvedValue(makeOfferRow());
      mockAuditService.logEvent.mockResolvedValue(undefined);
    }

    it('success — creates offer in DRAFT; audit emitted', async () => {
      setupHappyPath();

      const result = await service.createOffer(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.offer.status).toBe('DRAFT');
        expect(result.offer.applicationId).toBe(APPLICATION_ID);
      }
      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.RECRUITING_OFFER_CREATED }),
      );
    });

    it('create data always sets status: "DRAFT" — never from caller (GD-M18-1 D7)', async () => {
      setupHappyPath();

      await service.createOffer(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.offer.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'DRAFT' }) }),
      );
    });

    it('create data includes tenantId from JWT context — never from params (SEC-003)', async () => {
      setupHappyPath();

      await service.createOffer(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.offer.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tenantId: TENANT_ID }) }),
      );
    });

    it('application not found (absent or cross-tenant) → APPLICATION_NOT_FOUND; no write', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(null);

      const result = await service.createOffer(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('APPLICATION_NOT_FOUND');
      expect(mockPrisma.offer.create).not.toHaveBeenCalled();
    });

    it('application cross-tenant → APPLICATION_NOT_FOUND (SEC-003)', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(null);

      const result = await service.createOffer(CREATE_PARAMS, OTHER_TENANT, ACTOR_ID);

      expect(result.outcome).toBe('APPLICATION_NOT_FOUND');
    });

    it('application.status = APPLIED → APPLICATION_NOT_AT_OFFER_STATUS; no write', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ ...APPLICATION_ROW_OFFER, status: 'APPLIED' });

      const result = await service.createOffer(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('APPLICATION_NOT_AT_OFFER_STATUS');
      expect(mockPrisma.offer.create).not.toHaveBeenCalled();
    });

    it('application.status = REJECTED → APPLICATION_NOT_AT_OFFER_STATUS', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ ...APPLICATION_ROW_OFFER, status: 'REJECTED' });

      const result = await service.createOffer(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('APPLICATION_NOT_AT_OFFER_STATUS');
    });

    it('application.status = HIRED → APPLICATION_NOT_AT_OFFER_STATUS', async () => {
      mockPrisma.application.findFirst.mockResolvedValue({ ...APPLICATION_ROW_OFFER, status: 'HIRED' });

      const result = await service.createOffer(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('APPLICATION_NOT_AT_OFFER_STATUS');
    });

    it('active offer exists (DRAFT) → ACTIVE_OFFER_EXISTS; no create', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(APPLICATION_ROW_OFFER);
      mockPrisma.offer.findFirst.mockResolvedValue({ id: OFFER_ID });

      const result = await service.createOffer(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('ACTIVE_OFFER_EXISTS');
      expect(mockPrisma.offer.create).not.toHaveBeenCalled();
    });

    it('active offer exists (ACCEPTED) → ACTIVE_OFFER_EXISTS — ACCEPTED blocks re-offer (GD-M18-1 D10)', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(APPLICATION_ROW_OFFER);
      mockPrisma.offer.findFirst.mockResolvedValue({ id: OFFER_ID });

      const result = await service.createOffer(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('ACTIVE_OFFER_EXISTS');
    });

    it('P2002 on offer.create → ACTIVE_OFFER_EXISTS (race condition on partial unique index)', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(APPLICATION_ROW_OFFER);
      mockPrisma.offer.findFirst.mockResolvedValue(null);
      const p2002 = new PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      });
      mockPrisma.offer.create.mockRejectedValue(p2002);

      const result = await service.createOffer(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('ACTIVE_OFFER_EXISTS');
    });

    it('DB error on application check → INTERNAL_ERROR', async () => {
      mockPrisma.application.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await service.createOffer(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });

    it('non-P2002 DB error on offer.create → INTERNAL_ERROR', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(APPLICATION_ROW_OFFER);
      mockPrisma.offer.findFirst.mockResolvedValue(null);
      mockPrisma.offer.create.mockRejectedValue(new Error('connection lost'));

      const result = await service.createOffer(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // listOffers
  // ---------------------------------------------------------------------------

  describe('listOffers()', () => {
    it('success with pagination defaults — returns offers, total, page, pageSize', async () => {
      mockPrisma.offer.findMany.mockResolvedValue([makeOfferRow()]);
      mockPrisma.offer.count.mockResolvedValue(1);

      const result = await service.listOffers({}, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.offers).toHaveLength(1);
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(20);
        expect(result.total).toBe(1);
      }
    });

    it('list always filtered by tenantId and deletedAt IS NULL (SEC-003)', async () => {
      mockPrisma.offer.findMany.mockResolvedValue([]);
      mockPrisma.offer.count.mockResolvedValue(0);

      await service.listOffers({}, TENANT_ID);

      expect(mockPrisma.offer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_ID, deletedAt: null }),
        }),
      );
    });

    it('applicationId filter applied when provided', async () => {
      mockPrisma.offer.findMany.mockResolvedValue([]);
      mockPrisma.offer.count.mockResolvedValue(0);

      await service.listOffers({ applicationId: APPLICATION_ID }, TENANT_ID);

      expect(mockPrisma.offer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ applicationId: APPLICATION_ID }),
        }),
      );
    });

    it('status filter applied when provided', async () => {
      mockPrisma.offer.findMany.mockResolvedValue([]);
      mockPrisma.offer.count.mockResolvedValue(0);

      await service.listOffers({ status: 'SENT' }, TENANT_ID);

      expect(mockPrisma.offer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'SENT' }),
        }),
      );
    });

    it('DB error → INTERNAL_ERROR', async () => {
      mockPrisma.offer.findMany.mockRejectedValue(new Error('DB error'));

      const result = await service.listOffers({}, TENANT_ID);

      expect(result.outcome).toBe('INTERNAL_ERROR');
    });
  });

  // ---------------------------------------------------------------------------
  // getOfferById
  // ---------------------------------------------------------------------------

  describe('getOfferById()', () => {
    it('success — returns offer record', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow());

      const result = await service.getOfferById(OFFER_ID, TENANT_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.offer.id).toBe(OFFER_ID);
      }
    });

    it('offer not found → OFFER_NOT_FOUND', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(null);

      const result = await service.getOfferById(OFFER_ID, TENANT_ID);

      expect(result.outcome).toBe('OFFER_NOT_FOUND');
    });

    it('soft-deleted offer (findFirst null via deletedAt filter) → OFFER_NOT_FOUND', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(null);

      const result = await service.getOfferById(OFFER_ID, TENANT_ID);

      expect(result.outcome).toBe('OFFER_NOT_FOUND');
    });

    it('cross-tenant offer (findFirst null via tenantId filter) → OFFER_NOT_FOUND (SEC-003)', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(null);

      const result = await service.getOfferById(OFFER_ID, OTHER_TENANT);

      expect(result.outcome).toBe('OFFER_NOT_FOUND');
    });

    it('query includes tenantId and deletedAt IS NULL (SEC-003)', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow());

      await service.getOfferById(OFFER_ID, TENANT_ID);

      expect(mockPrisma.offer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: OFFER_ID, tenantId: TENANT_ID, deletedAt: null }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // updateOffer
  // ---------------------------------------------------------------------------

  describe('updateOffer()', () => {
    const UPDATE_PARAMS_DATE: UpdateOfferParams = { offerDate: '2026-08-15T00:00:00.000Z' };
    const UPDATE_PARAMS_NOTES: UpdateOfferParams = { notes: 'Updated terms.' };

    function setupHappyPath(existingOverrides: Record<string, unknown> = {}) {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow(existingOverrides));
      mockPrisma.offer.update.mockResolvedValue(makeOfferRow(existingOverrides));
      mockAuditService.logEvent.mockResolvedValue(undefined);
    }

    it('success — DRAFT; offerDate updated', async () => {
      setupHappyPath();

      const result = await service.updateOffer(OFFER_ID, UPDATE_PARAMS_DATE, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      expect(mockPrisma.offer.update).toHaveBeenCalled();
    });

    it('success — DRAFT; notes updated', async () => {
      setupHappyPath();

      const result = await service.updateOffer(OFFER_ID, UPDATE_PARAMS_NOTES, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('no-op (empty params) → SUCCESS; no DB write; no audit event', async () => {
      setupHappyPath();

      const result = await service.updateOffer(OFFER_ID, {}, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      expect(mockPrisma.offer.update).not.toHaveBeenCalled();
      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('offer not found → OFFER_NOT_FOUND', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(null);

      const result = await service.updateOffer(OFFER_ID, UPDATE_PARAMS_DATE, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_NOT_FOUND');
    });

    it('ACCEPTED → OFFER_IN_TERMINAL_STATE; no write', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'ACCEPTED' }));

      const result = await service.updateOffer(OFFER_ID, UPDATE_PARAMS_DATE, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_IN_TERMINAL_STATE');
      expect(mockPrisma.offer.update).not.toHaveBeenCalled();
    });

    it('DECLINED → OFFER_IN_TERMINAL_STATE', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'DECLINED' }));

      const result = await service.updateOffer(OFFER_ID, UPDATE_PARAMS_DATE, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_IN_TERMINAL_STATE');
    });

    it('WITHDRAWN → OFFER_IN_TERMINAL_STATE', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'WITHDRAWN' }));

      const result = await service.updateOffer(OFFER_ID, UPDATE_PARAMS_DATE, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_IN_TERMINAL_STATE');
    });

    it('PENDING_APPROVAL (non-terminal non-DRAFT) → OFFER_NOT_IN_DRAFT; no write', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'PENDING_APPROVAL' }));

      const result = await service.updateOffer(OFFER_ID, UPDATE_PARAMS_DATE, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_NOT_IN_DRAFT');
      expect(mockPrisma.offer.update).not.toHaveBeenCalled();
    });

    it('APPROVED → OFFER_NOT_IN_DRAFT', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'APPROVED' }));

      const result = await service.updateOffer(OFFER_ID, UPDATE_PARAMS_DATE, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_NOT_IN_DRAFT');
    });

    it('SENT → OFFER_NOT_IN_DRAFT', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'SENT' }));

      const result = await service.updateOffer(OFFER_ID, UPDATE_PARAMS_DATE, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_NOT_IN_DRAFT');
    });

    it('audit emitted with field names only — no field values in metadata (PII safety)', async () => {
      setupHappyPath();

      await service.updateOffer(OFFER_ID, UPDATE_PARAMS_NOTES, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditEventType.RECRUITING_OFFER_UPDATED,
          metadata: expect.objectContaining({ fieldsChanged: expect.arrayContaining(['notes']) }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // submitOffer
  // ---------------------------------------------------------------------------

  describe('submitOffer()', () => {
    it('success — DRAFT → PENDING_APPROVAL; audit emitted', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'DRAFT' }));
      mockPrisma.offer.update.mockResolvedValue(makeOfferRow({ status: 'PENDING_APPROVAL' }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.submitOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.offer.status).toBe('PENDING_APPROVAL');
      }
      expect(mockPrisma.offer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'PENDING_APPROVAL' } }),
      );
    });

    it('offer not found → OFFER_NOT_FOUND', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(null);

      const result = await service.submitOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_NOT_FOUND');
    });

    it('ACCEPTED → OFFER_IN_TERMINAL_STATE; no write', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'ACCEPTED' }));

      const result = await service.submitOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_IN_TERMINAL_STATE');
      expect(mockPrisma.offer.update).not.toHaveBeenCalled();
    });

    it('PENDING_APPROVAL → OFFER_NOT_IN_DRAFT (already submitted); no write', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'PENDING_APPROVAL' }));

      const result = await service.submitOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_NOT_IN_DRAFT');
      expect(mockPrisma.offer.update).not.toHaveBeenCalled();
    });

    it('APPROVED → OFFER_NOT_IN_DRAFT', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'APPROVED' }));

      const result = await service.submitOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_NOT_IN_DRAFT');
    });
  });

  // ---------------------------------------------------------------------------
  // approveOffer
  // ---------------------------------------------------------------------------

  describe('approveOffer()', () => {
    it('success — PENDING_APPROVAL → APPROVED; audit emitted', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'PENDING_APPROVAL' }));
      mockPrisma.offer.update.mockResolvedValue(makeOfferRow({ status: 'APPROVED' }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.approveOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.offer.status).toBe('APPROVED');
      }
      expect(mockPrisma.offer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'APPROVED' } }),
      );
    });

    it('offer not found → OFFER_NOT_FOUND', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(null);

      const result = await service.approveOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_NOT_FOUND');
    });

    it('ACCEPTED → OFFER_IN_TERMINAL_STATE; no write', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'ACCEPTED' }));

      const result = await service.approveOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_IN_TERMINAL_STATE');
      expect(mockPrisma.offer.update).not.toHaveBeenCalled();
    });

    it('DRAFT → OFFER_NOT_PENDING_APPROVAL; no write', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'DRAFT' }));

      const result = await service.approveOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_NOT_PENDING_APPROVAL');
      expect(mockPrisma.offer.update).not.toHaveBeenCalled();
    });

    it('APPROVED (already approved) → OFFER_NOT_PENDING_APPROVAL', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'APPROVED' }));

      const result = await service.approveOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_NOT_PENDING_APPROVAL');
    });
  });

  // ---------------------------------------------------------------------------
  // sendOffer
  // ---------------------------------------------------------------------------

  describe('sendOffer()', () => {
    it('success — APPROVED → SENT; audit emitted', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'APPROVED' }));
      mockPrisma.offer.update.mockResolvedValue(makeOfferRow({ status: 'SENT' }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.sendOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.offer.status).toBe('SENT');
      }
      expect(mockPrisma.offer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'SENT' } }),
      );
    });

    it('offer not found → OFFER_NOT_FOUND', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(null);

      const result = await service.sendOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_NOT_FOUND');
    });

    it('ACCEPTED → OFFER_IN_TERMINAL_STATE; no write', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'ACCEPTED' }));

      const result = await service.sendOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_IN_TERMINAL_STATE');
      expect(mockPrisma.offer.update).not.toHaveBeenCalled();
    });

    it('DRAFT → OFFER_NOT_APPROVED; no write', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'DRAFT' }));

      const result = await service.sendOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_NOT_APPROVED');
      expect(mockPrisma.offer.update).not.toHaveBeenCalled();
    });

    it('PENDING_APPROVAL → OFFER_NOT_APPROVED', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'PENDING_APPROVAL' }));

      const result = await service.sendOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_NOT_APPROVED');
    });
  });

  // ---------------------------------------------------------------------------
  // recordOfferResponse
  // ---------------------------------------------------------------------------

  describe('recordOfferResponse()', () => {
    function setupSentOffer() {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'SENT' }));
      mockAuditService.logEvent.mockResolvedValue(undefined);
    }

    it('success — ACCEPTED: sets status=ACCEPTED and acceptedAt; audit emitted', async () => {
      setupSentOffer();
      const acceptedRow = makeOfferRow({ status: 'ACCEPTED', acceptedAt: new Date() });
      mockPrisma.offer.update.mockResolvedValue(acceptedRow);

      const result = await service.recordOfferResponse(OFFER_ID, { response: 'ACCEPTED' }, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.offer.status).toBe('ACCEPTED');
        expect(result.offer.acceptedAt).not.toBeNull();
      }
      expect(mockPrisma.offer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ACCEPTED', acceptedAt: expect.any(Date) }) }),
      );
    });

    it('success — DECLINED: sets status=DECLINED and declinedAt; audit emitted', async () => {
      setupSentOffer();
      const declinedRow = makeOfferRow({ status: 'DECLINED', declinedAt: new Date() });
      mockPrisma.offer.update.mockResolvedValue(declinedRow);

      const result = await service.recordOfferResponse(OFFER_ID, { response: 'DECLINED' }, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.offer.status).toBe('DECLINED');
        expect(result.offer.declinedAt).not.toBeNull();
      }
      expect(mockPrisma.offer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'DECLINED', declinedAt: expect.any(Date) }) }),
      );
    });

    it('ACCEPTED must NOT call application.update — hire-to-employee excluded (GD-M18-1 D9)', async () => {
      setupSentOffer();
      mockPrisma.offer.update.mockResolvedValue(makeOfferRow({ status: 'ACCEPTED', acceptedAt: new Date() }));

      await service.recordOfferResponse(OFFER_ID, { response: 'ACCEPTED' }, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.application.update).not.toHaveBeenCalled();
    });

    it('ACCEPTED must NOT call employee.create — hire-to-employee excluded (GD-M18-1 D3)', async () => {
      setupSentOffer();
      mockPrisma.offer.update.mockResolvedValue(makeOfferRow({ status: 'ACCEPTED', acceptedAt: new Date() }));

      await service.recordOfferResponse(OFFER_ID, { response: 'ACCEPTED' }, TENANT_ID, ACTOR_ID);

      expect(mockPrisma.employee.create).not.toHaveBeenCalled();
    });

    it('offer not found → OFFER_NOT_FOUND', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(null);

      const result = await service.recordOfferResponse(OFFER_ID, { response: 'ACCEPTED' }, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_NOT_FOUND');
    });

    it('already ACCEPTED → OFFER_IN_TERMINAL_STATE; no write', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'ACCEPTED' }));

      const result = await service.recordOfferResponse(OFFER_ID, { response: 'DECLINED' }, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_IN_TERMINAL_STATE');
      expect(mockPrisma.offer.update).not.toHaveBeenCalled();
    });

    it('already DECLINED → OFFER_IN_TERMINAL_STATE; no write', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'DECLINED' }));

      const result = await service.recordOfferResponse(OFFER_ID, { response: 'ACCEPTED' }, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_IN_TERMINAL_STATE');
    });

    it('DRAFT (not yet sent) → OFFER_NOT_SENT; no write', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'DRAFT' }));

      const result = await service.recordOfferResponse(OFFER_ID, { response: 'ACCEPTED' }, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_NOT_SENT');
      expect(mockPrisma.offer.update).not.toHaveBeenCalled();
    });

    it('PENDING_APPROVAL → OFFER_NOT_SENT', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'PENDING_APPROVAL' }));

      const result = await service.recordOfferResponse(OFFER_ID, { response: 'ACCEPTED' }, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_NOT_SENT');
    });
  });

  // ---------------------------------------------------------------------------
  // withdrawOffer
  // ---------------------------------------------------------------------------

  describe('withdrawOffer()', () => {
    it('success — DRAFT → WITHDRAWN; audit emitted', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'DRAFT' }));
      mockPrisma.offer.update.mockResolvedValue(makeOfferRow({ status: 'WITHDRAWN' }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.withdrawOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
      if (result.outcome === 'SUCCESS') {
        expect(result.offer.status).toBe('WITHDRAWN');
      }
      expect(mockPrisma.offer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'WITHDRAWN' } }),
      );
    });

    it('success — SENT (any non-terminal) → WITHDRAWN', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'SENT' }));
      mockPrisma.offer.update.mockResolvedValue(makeOfferRow({ status: 'WITHDRAWN' }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      const result = await service.withdrawOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('SUCCESS');
    });

    it('offer not found → OFFER_NOT_FOUND', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(null);

      const result = await service.withdrawOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_NOT_FOUND');
    });

    it('ACCEPTED → OFFER_IN_TERMINAL_STATE; no write', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'ACCEPTED' }));

      const result = await service.withdrawOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_IN_TERMINAL_STATE');
      expect(mockPrisma.offer.update).not.toHaveBeenCalled();
    });

    it('already WITHDRAWN → OFFER_IN_TERMINAL_STATE; no write', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'WITHDRAWN' }));

      const result = await service.withdrawOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(result.outcome).toBe('OFFER_IN_TERMINAL_STATE');
      expect(mockPrisma.offer.update).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Audit events (GD-M18-1 D17 — event types and metadata)
  // ---------------------------------------------------------------------------

  describe('Audit events', () => {
    it('RECRUITING_OFFER_CREATED emitted on createOffer', async () => {
      mockPrisma.application.findFirst.mockResolvedValue(APPLICATION_ROW_OFFER);
      mockPrisma.offer.findFirst.mockResolvedValue(null);
      mockPrisma.offer.create.mockResolvedValue(makeOfferRow());
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createOffer(CREATE_PARAMS, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.RECRUITING_OFFER_CREATED }),
      );
    });

    it('RECRUITING_OFFER_UPDATED emitted on updateOffer', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow());
      mockPrisma.offer.update.mockResolvedValue(makeOfferRow());
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateOffer(OFFER_ID, { notes: 'Changed.' }, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.RECRUITING_OFFER_UPDATED }),
      );
    });

    it('RECRUITING_OFFER_SUBMITTED emitted on submitOffer', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'DRAFT' }));
      mockPrisma.offer.update.mockResolvedValue(makeOfferRow({ status: 'PENDING_APPROVAL' }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.submitOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.RECRUITING_OFFER_SUBMITTED }),
      );
    });

    it('RECRUITING_OFFER_APPROVED emitted on approveOffer', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'PENDING_APPROVAL' }));
      mockPrisma.offer.update.mockResolvedValue(makeOfferRow({ status: 'APPROVED' }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.approveOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.RECRUITING_OFFER_APPROVED }),
      );
    });

    it('RECRUITING_OFFER_SENT emitted on sendOffer', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'APPROVED' }));
      mockPrisma.offer.update.mockResolvedValue(makeOfferRow({ status: 'SENT' }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.sendOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.RECRUITING_OFFER_SENT }),
      );
    });

    it('RECRUITING_OFFER_ACCEPTED emitted on recordOfferResponse(ACCEPTED)', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'SENT' }));
      mockPrisma.offer.update.mockResolvedValue(makeOfferRow({ status: 'ACCEPTED', acceptedAt: new Date() }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.recordOfferResponse(OFFER_ID, { response: 'ACCEPTED' }, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.RECRUITING_OFFER_ACCEPTED }),
      );
    });

    it('RECRUITING_OFFER_DECLINED emitted on recordOfferResponse(DECLINED)', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'SENT' }));
      mockPrisma.offer.update.mockResolvedValue(makeOfferRow({ status: 'DECLINED', declinedAt: new Date() }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.recordOfferResponse(OFFER_ID, { response: 'DECLINED' }, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.RECRUITING_OFFER_DECLINED }),
      );
    });

    it('RECRUITING_OFFER_WITHDRAWN emitted on withdrawOffer', async () => {
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow({ status: 'DRAFT' }));
      mockPrisma.offer.update.mockResolvedValue(makeOfferRow({ status: 'WITHDRAWN' }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.withdrawOffer(OFFER_ID, TENANT_ID, ACTOR_ID);

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditEventType.RECRUITING_OFFER_WITHDRAWN }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // PII safety (GD-M18-1 D17)
  // ---------------------------------------------------------------------------

  describe('PII safety', () => {
    it('audit metadata for createOffer does not contain notes text (PII)', async () => {
      const notesText = 'Confidential offer terms with salary details.';
      mockPrisma.application.findFirst.mockResolvedValue(APPLICATION_ROW_OFFER);
      mockPrisma.offer.findFirst.mockResolvedValue(null);
      mockPrisma.offer.create.mockResolvedValue(makeOfferRow({ notes: notesText }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createOffer({ applicationId: APPLICATION_ID, notes: notesText }, TENANT_ID, ACTOR_ID);

      const call = mockAuditService.logEvent.mock.calls[0][0];
      expect(JSON.stringify(call.metadata)).not.toContain(notesText);
      expect(call.metadata).not.toHaveProperty('notes');
    });

    it('audit metadata for createOffer does not contain offerDate value (PII)', async () => {
      const offerDateStr = '2026-08-01T00:00:00.000Z';
      mockPrisma.application.findFirst.mockResolvedValue(APPLICATION_ROW_OFFER);
      mockPrisma.offer.findFirst.mockResolvedValue(null);
      mockPrisma.offer.create.mockResolvedValue(makeOfferRow({ offerDate: new Date(offerDateStr) }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.createOffer({ applicationId: APPLICATION_ID, offerDate: offerDateStr }, TENANT_ID, ACTOR_ID);

      const call = mockAuditService.logEvent.mock.calls[0][0];
      expect(call.metadata).not.toHaveProperty('offerDate');
    });

    it('audit metadata for updateOffer contains fieldsChanged array but not field values', async () => {
      const notesText = 'Revised terms with updated PTO policy.';
      mockPrisma.offer.findFirst.mockResolvedValue(makeOfferRow());
      mockPrisma.offer.update.mockResolvedValue(makeOfferRow({ notes: notesText }));
      mockAuditService.logEvent.mockResolvedValue(undefined);

      await service.updateOffer(OFFER_ID, { notes: notesText }, TENANT_ID, ACTOR_ID);

      const call = mockAuditService.logEvent.mock.calls[0][0];
      expect(JSON.stringify(call.metadata)).not.toContain(notesText);
      expect(call.metadata).toHaveProperty('fieldsChanged');
      expect(call.metadata).not.toHaveProperty('notes');
    });
  });
});
