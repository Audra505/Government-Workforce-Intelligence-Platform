// OfferController unit tests
// Reference: governance/GD-M18-1.md — D7 (lifecycle), D13 (RBAC/DTOs), D14 (error codes), D16 (tenant isolation)
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
//
// Pattern: mirrors apps/api/src/recruiting/interview.controller.spec.ts
// Guards overridden with { canActivate: () => true } — RBAC enforcement tested separately
// by confirming @RequireRoles metadata via Reflect.getMetadata on each method.
// tenantId comes from actor.tenantId (JWT), never from body/params — SEC-003 verified
// by asserting the exact call signature passed to the mock service.
//
// HTTP code verification uses Reflect.getMetadata('__httpCode__', handler) — NestJS's
// @HttpCode decorator sets this key on the handler function (descriptor.value).
// createOffer must return 201 (POST default).
// Action endpoints (submit, approve, send, record-response, withdraw) must return 200, not 201.
//
// RBAC rules verified via metadata:
//   approveOffer and sendOffer must NOT include 'Recruiter' (GD-M18-1 D16).
//   listOffers and getOfferById must include 'Compliance Officer' (read-only role).
//   No endpoint may include 'Hiring Manager' for M18B offers.
//
// ACTIVE_OFFER_EXISTS maps to ConflictException (409) — unique to offer domain.
// No /applications/:id/hire, no /applications/:id/offer, no employee creation.

import { Test, type TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import { ROLES_KEY } from '../identity/decorators/require-roles.decorator';
import type { RequestUser } from '../identity/jwt.strategy';
import { OfferController } from './offer.controller';
import { OfferService, type OfferRecord } from './offer.service';
import type { CreateOfferDto } from './dto/create-offer.dto';
import type { UpdateOfferDto } from './dto/update-offer.dto';
import type { RecordOfferResponseDto } from './dto/record-offer-response.dto';
import type { ListOffersQueryDto } from './dto/list-offers-query.dto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const HTTP_CODE_METADATA = '__httpCode__';

const OFFER_ID       = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_ID      = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTOR_ID       = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const APPLICATION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const NOW = new Date('2026-07-01T00:00:00.000Z');
const OFFER_DATE = new Date('2026-08-01T00:00:00.000Z');

const offerRecord: OfferRecord = {
  id:            OFFER_ID,
  tenantId:      TENANT_ID,
  applicationId: APPLICATION_ID,
  status:        'DRAFT',
  offerDate:     null,
  acceptedAt:    null,
  declinedAt:    null,
  notes:         null,
  createdAt:     NOW,
  updatedAt:     NOW,
};

const createDto: CreateOfferDto = {
  applicationId: APPLICATION_ID,
};

const updateDto: UpdateOfferDto = {
  notes: 'Updated terms.',
};

const recordResponseDto: RecordOfferResponseDto = {
  response: 'ACCEPTED',
};

const listQuery: ListOffersQueryDto = {
  page:     1,
  pageSize: 20,
};

const mockActor: RequestUser = {
  userId:    ACTOR_ID,
  tenantId:  TENANT_ID,
  email:     'actor@tenant.gov',
  firstName: '',
  lastName:  '',
  roles:     ['System Administrator'],
};

const complianceActor: RequestUser = {
  ...mockActor,
  roles: ['Compliance Officer'],
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe('OfferController', () => {
  let controller: OfferController;
  let mockService: {
    createOffer:          jest.Mock;
    listOffers:           jest.Mock;
    getOfferById:         jest.Mock;
    updateOffer:          jest.Mock;
    submitOffer:          jest.Mock;
    approveOffer:         jest.Mock;
    sendOffer:            jest.Mock;
    recordOfferResponse:  jest.Mock;
    withdrawOffer:        jest.Mock;
  };

  beforeEach(async () => {
    mockService = {
      createOffer:         jest.fn(),
      listOffers:          jest.fn(),
      getOfferById:        jest.fn(),
      updateOffer:         jest.fn(),
      submitOffer:         jest.fn(),
      approveOffer:        jest.fn(),
      sendOffer:           jest.fn(),
      recordOfferResponse: jest.fn(),
      withdrawOffer:       jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OfferController],
      providers: [
        { provide: OfferService, useValue: mockService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<OfferController>(OfferController);
  });

  afterEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------------------
  // createOffer
  // ---------------------------------------------------------------------------

  describe('createOffer()', () => {
    it('SUCCESS: returns { success: true, data: offer shape }', async () => {
      mockService.createOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      const result = await controller.createOffer(createDto, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({
        id:            OFFER_ID,
        applicationId: APPLICATION_ID,
        status:        'DRAFT',
      });
    });

    it('SUCCESS: response data does not include tenantId (SEC-003)', async () => {
      mockService.createOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      const result = await controller.createOffer(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: response data does not include deletedAt', async () => {
      mockService.createOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      const result = await controller.createOffer(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: createdAt and updatedAt are ISO 8601 strings', async () => {
      mockService.createOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      const result = await controller.createOffer(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(typeof result['data']['createdAt']).toBe('string');
      expect(typeof result['data']['updatedAt']).toBe('string');
      expect(result['data']['createdAt']).toBe(NOW.toISOString());
    });

    it('SUCCESS: offerDate is null when not set on record', async () => {
      mockService.createOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      const result = await controller.createOffer(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']['offerDate']).toBeNull();
    });

    it('SUCCESS: offerDate serialized as ISO 8601 string when set', async () => {
      const recordWithDate = { ...offerRecord, offerDate: OFFER_DATE };
      mockService.createOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: recordWithDate });

      const result = await controller.createOffer(createDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']['offerDate']).toBe(OFFER_DATE.toISOString());
    });

    it('SUCCESS: actor.tenantId and actor.userId forwarded to service — not from DTO (SEC-003)', async () => {
      mockService.createOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      await controller.createOffer(createDto, mockActor);

      expect(mockService.createOffer).toHaveBeenCalledWith(
        expect.objectContaining({ applicationId: APPLICATION_ID }),
        TENANT_ID,
        ACTOR_ID,
      );
    });

    it('APPLICATION_NOT_FOUND: throws NotFoundException', async () => {
      mockService.createOffer.mockResolvedValue({ outcome: 'APPLICATION_NOT_FOUND' });

      await expect(controller.createOffer(createDto, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('APPLICATION_NOT_FOUND: error body code = APPLICATION_NOT_FOUND', async () => {
      mockService.createOffer.mockResolvedValue({ outcome: 'APPLICATION_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.createOffer(createDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('APPLICATION_NOT_FOUND');
      expect(body['success']).toBe(false);
    });

    it('APPLICATION_NOT_AT_OFFER_STATUS: throws UnprocessableEntityException', async () => {
      mockService.createOffer.mockResolvedValue({ outcome: 'APPLICATION_NOT_AT_OFFER_STATUS' });

      await expect(controller.createOffer(createDto, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('APPLICATION_NOT_AT_OFFER_STATUS: error body code = APPLICATION_NOT_AT_OFFER_STATUS', async () => {
      mockService.createOffer.mockResolvedValue({ outcome: 'APPLICATION_NOT_AT_OFFER_STATUS' });

      let thrown: unknown;
      try { await controller.createOffer(createDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('APPLICATION_NOT_AT_OFFER_STATUS');
      expect(body['success']).toBe(false);
    });

    it('ACTIVE_OFFER_EXISTS: throws ConflictException (409)', async () => {
      mockService.createOffer.mockResolvedValue({ outcome: 'ACTIVE_OFFER_EXISTS' });

      await expect(controller.createOffer(createDto, mockActor)).rejects.toThrow(ConflictException);
    });

    it('ACTIVE_OFFER_EXISTS: error body code = ACTIVE_OFFER_EXISTS', async () => {
      mockService.createOffer.mockResolvedValue({ outcome: 'ACTIVE_OFFER_EXISTS' });

      let thrown: unknown;
      try { await controller.createOffer(createDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as ConflictException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('ACTIVE_OFFER_EXISTS');
      expect(body['success']).toBe(false);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.createOffer.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.createOffer(createDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // listOffers
  // ---------------------------------------------------------------------------

  describe('listOffers()', () => {
    it('SUCCESS: returns { success: true, data: paginated envelope }', async () => {
      mockService.listOffers.mockResolvedValue({
        outcome:  'SUCCESS',
        offers:   [offerRecord],
        total:    1,
        page:     1,
        pageSize: 20,
      });

      const result = await controller.listOffers(listQuery, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      const data = result['data'] as Record<string, unknown>;
      expect(data['offers']).toHaveLength(1);
      expect(data['total']).toBe(1);
      expect(data['page']).toBe(1);
      expect(data['pageSize']).toBe(20);
    });

    it('SUCCESS: totalPages computed as Math.ceil(total / pageSize)', async () => {
      mockService.listOffers.mockResolvedValue({
        outcome: 'SUCCESS', offers: [], total: 41, page: 1, pageSize: 20,
      });

      const result = await controller.listOffers(listQuery, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']['totalPages']).toBe(3);
    });

    it('SUCCESS: offer records in list do not include tenantId (SEC-003)', async () => {
      mockService.listOffers.mockResolvedValue({
        outcome: 'SUCCESS', offers: [offerRecord], total: 1, page: 1, pageSize: 20,
      });

      const result = await controller.listOffers(listQuery, mockActor) as Record<string, Record<string, unknown[]>>;
      const offers = result['data']['offers'] as Record<string, unknown>[];

      expect(offers[0]).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: offer records in list do not include deletedAt', async () => {
      mockService.listOffers.mockResolvedValue({
        outcome: 'SUCCESS', offers: [offerRecord], total: 1, page: 1, pageSize: 20,
      });

      const result = await controller.listOffers(listQuery, mockActor) as Record<string, Record<string, unknown[]>>;
      const offers = result['data']['offers'] as Record<string, unknown>[];

      expect(offers[0]).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: actor.tenantId forwarded to service — not from query (SEC-003)', async () => {
      mockService.listOffers.mockResolvedValue({
        outcome: 'SUCCESS', offers: [], total: 0, page: 1, pageSize: 20,
      });

      await controller.listOffers(listQuery, mockActor);

      expect(mockService.listOffers).toHaveBeenCalledWith(expect.any(Object), TENANT_ID);
    });

    it('SUCCESS: Compliance Officer actor passes through list (read authorization via @RequireRoles)', async () => {
      mockService.listOffers.mockResolvedValue({
        outcome: 'SUCCESS', offers: [], total: 0, page: 1, pageSize: 20,
      });

      const result = await controller.listOffers(listQuery, complianceActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.listOffers.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.listOffers(listQuery, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // getOfferById
  // ---------------------------------------------------------------------------

  describe('getOfferById()', () => {
    it('SUCCESS: returns { success: true, data: offer shape }', async () => {
      mockService.getOfferById.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      const result = await controller.getOfferById(OFFER_ID, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: OFFER_ID, status: 'DRAFT' });
    });

    it('SUCCESS: response data does not include tenantId (SEC-003)', async () => {
      mockService.getOfferById.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      const result = await controller.getOfferById(OFFER_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
    });

    it('SUCCESS: response data does not include deletedAt', async () => {
      mockService.getOfferById.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      const result = await controller.getOfferById(OFFER_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: id and actor.tenantId forwarded to service (SEC-003)', async () => {
      mockService.getOfferById.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      await controller.getOfferById(OFFER_ID, mockActor);

      expect(mockService.getOfferById).toHaveBeenCalledWith(OFFER_ID, TENANT_ID);
    });

    it('SUCCESS: Compliance Officer actor passes through detail (read authorization via @RequireRoles)', async () => {
      mockService.getOfferById.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      const result = await controller.getOfferById(OFFER_ID, complianceActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
    });

    it('OFFER_NOT_FOUND: throws NotFoundException', async () => {
      mockService.getOfferById.mockResolvedValue({ outcome: 'OFFER_NOT_FOUND' });

      await expect(controller.getOfferById(OFFER_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('OFFER_NOT_FOUND: error body code = OFFER_NOT_FOUND', async () => {
      mockService.getOfferById.mockResolvedValue({ outcome: 'OFFER_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.getOfferById(OFFER_ID, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('OFFER_NOT_FOUND');
      expect(body['success']).toBe(false);
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.getOfferById.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.getOfferById(OFFER_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // updateOffer
  // ---------------------------------------------------------------------------

  describe('updateOffer()', () => {
    it('SUCCESS: returns { success: true, data: offer shape }', async () => {
      const updatedRecord = { ...offerRecord, notes: 'Updated terms.' };
      mockService.updateOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: updatedRecord });

      const result = await controller.updateOffer(OFFER_ID, updateDto, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: OFFER_ID });
    });

    it('SUCCESS: response data does not include tenantId or deletedAt', async () => {
      mockService.updateOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      const result = await controller.updateOffer(OFFER_ID, updateDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: id, params, actor.tenantId, actor.userId forwarded to service (SEC-003)', async () => {
      mockService.updateOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      await controller.updateOffer(OFFER_ID, updateDto, mockActor);

      expect(mockService.updateOffer).toHaveBeenCalledWith(
        OFFER_ID,
        expect.objectContaining({ notes: 'Updated terms.' }),
        TENANT_ID,
        ACTOR_ID,
      );
    });

    it('OFFER_NOT_FOUND: throws NotFoundException', async () => {
      mockService.updateOffer.mockResolvedValue({ outcome: 'OFFER_NOT_FOUND' });

      await expect(controller.updateOffer(OFFER_ID, updateDto, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('OFFER_NOT_FOUND: error body code = OFFER_NOT_FOUND', async () => {
      mockService.updateOffer.mockResolvedValue({ outcome: 'OFFER_NOT_FOUND' });

      let thrown: unknown;
      try { await controller.updateOffer(OFFER_ID, updateDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as NotFoundException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('OFFER_NOT_FOUND');
    });

    it('OFFER_IN_TERMINAL_STATE: throws UnprocessableEntityException', async () => {
      mockService.updateOffer.mockResolvedValue({ outcome: 'OFFER_IN_TERMINAL_STATE' });

      await expect(controller.updateOffer(OFFER_ID, updateDto, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('OFFER_IN_TERMINAL_STATE: error body code = OFFER_IN_TERMINAL_STATE', async () => {
      mockService.updateOffer.mockResolvedValue({ outcome: 'OFFER_IN_TERMINAL_STATE' });

      let thrown: unknown;
      try { await controller.updateOffer(OFFER_ID, updateDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('OFFER_IN_TERMINAL_STATE');
    });

    it('OFFER_NOT_IN_DRAFT: throws UnprocessableEntityException', async () => {
      mockService.updateOffer.mockResolvedValue({ outcome: 'OFFER_NOT_IN_DRAFT' });

      await expect(controller.updateOffer(OFFER_ID, updateDto, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('OFFER_NOT_IN_DRAFT: error body code = OFFER_NOT_IN_DRAFT', async () => {
      mockService.updateOffer.mockResolvedValue({ outcome: 'OFFER_NOT_IN_DRAFT' });

      let thrown: unknown;
      try { await controller.updateOffer(OFFER_ID, updateDto, mockActor); } catch (e) { thrown = e; }

      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('OFFER_NOT_IN_DRAFT');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.updateOffer.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.updateOffer(OFFER_ID, updateDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // submitOffer
  // ---------------------------------------------------------------------------

  describe('submitOffer()', () => {
    it('SUCCESS: returns offer shape with status PENDING_APPROVAL', async () => {
      const submittedRecord = { ...offerRecord, status: 'PENDING_APPROVAL' };
      mockService.submitOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: submittedRecord });

      const result = await controller.submitOffer(OFFER_ID, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: OFFER_ID, status: 'PENDING_APPROVAL' });
    });

    it('SUCCESS: response data does not include tenantId or deletedAt', async () => {
      mockService.submitOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      const result = await controller.submitOffer(OFFER_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: id, actor.tenantId, actor.userId forwarded to service (SEC-003)', async () => {
      mockService.submitOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      await controller.submitOffer(OFFER_ID, mockActor);

      expect(mockService.submitOffer).toHaveBeenCalledWith(OFFER_ID, TENANT_ID, ACTOR_ID);
    });

    it('OFFER_NOT_FOUND: throws NotFoundException', async () => {
      mockService.submitOffer.mockResolvedValue({ outcome: 'OFFER_NOT_FOUND' });

      await expect(controller.submitOffer(OFFER_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('OFFER_IN_TERMINAL_STATE: throws UnprocessableEntityException with code', async () => {
      mockService.submitOffer.mockResolvedValue({ outcome: 'OFFER_IN_TERMINAL_STATE' });

      let thrown: unknown;
      try { await controller.submitOffer(OFFER_ID, mockActor); } catch (e) { thrown = e; }

      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('OFFER_IN_TERMINAL_STATE');
    });

    it('OFFER_NOT_IN_DRAFT: throws UnprocessableEntityException with code', async () => {
      mockService.submitOffer.mockResolvedValue({ outcome: 'OFFER_NOT_IN_DRAFT' });

      let thrown: unknown;
      try { await controller.submitOffer(OFFER_ID, mockActor); } catch (e) { thrown = e; }

      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('OFFER_NOT_IN_DRAFT');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.submitOffer.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.submitOffer(OFFER_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // approveOffer
  // ---------------------------------------------------------------------------

  describe('approveOffer()', () => {
    it('SUCCESS: returns offer shape with status APPROVED', async () => {
      const approvedRecord = { ...offerRecord, status: 'APPROVED' };
      mockService.approveOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: approvedRecord });

      const result = await controller.approveOffer(OFFER_ID, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: OFFER_ID, status: 'APPROVED' });
    });

    it('SUCCESS: response data does not include tenantId or deletedAt', async () => {
      mockService.approveOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      const result = await controller.approveOffer(OFFER_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: id, actor.tenantId, actor.userId forwarded to service (SEC-003)', async () => {
      mockService.approveOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      await controller.approveOffer(OFFER_ID, mockActor);

      expect(mockService.approveOffer).toHaveBeenCalledWith(OFFER_ID, TENANT_ID, ACTOR_ID);
    });

    it('OFFER_NOT_FOUND: throws NotFoundException', async () => {
      mockService.approveOffer.mockResolvedValue({ outcome: 'OFFER_NOT_FOUND' });

      await expect(controller.approveOffer(OFFER_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('OFFER_IN_TERMINAL_STATE: throws UnprocessableEntityException', async () => {
      mockService.approveOffer.mockResolvedValue({ outcome: 'OFFER_IN_TERMINAL_STATE' });

      await expect(controller.approveOffer(OFFER_ID, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('OFFER_NOT_PENDING_APPROVAL: throws UnprocessableEntityException with code', async () => {
      mockService.approveOffer.mockResolvedValue({ outcome: 'OFFER_NOT_PENDING_APPROVAL' });

      let thrown: unknown;
      try { await controller.approveOffer(OFFER_ID, mockActor); } catch (e) { thrown = e; }

      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('OFFER_NOT_PENDING_APPROVAL');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.approveOffer.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.approveOffer(OFFER_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // sendOffer
  // ---------------------------------------------------------------------------

  describe('sendOffer()', () => {
    it('SUCCESS: returns offer shape with status SENT', async () => {
      const sentRecord = { ...offerRecord, status: 'SENT' };
      mockService.sendOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: sentRecord });

      const result = await controller.sendOffer(OFFER_ID, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: OFFER_ID, status: 'SENT' });
    });

    it('SUCCESS: response data does not include tenantId or deletedAt', async () => {
      mockService.sendOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      const result = await controller.sendOffer(OFFER_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: id, actor.tenantId, actor.userId forwarded to service (SEC-003)', async () => {
      mockService.sendOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      await controller.sendOffer(OFFER_ID, mockActor);

      expect(mockService.sendOffer).toHaveBeenCalledWith(OFFER_ID, TENANT_ID, ACTOR_ID);
    });

    it('OFFER_NOT_FOUND: throws NotFoundException', async () => {
      mockService.sendOffer.mockResolvedValue({ outcome: 'OFFER_NOT_FOUND' });

      await expect(controller.sendOffer(OFFER_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('OFFER_IN_TERMINAL_STATE: throws UnprocessableEntityException', async () => {
      mockService.sendOffer.mockResolvedValue({ outcome: 'OFFER_IN_TERMINAL_STATE' });

      await expect(controller.sendOffer(OFFER_ID, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('OFFER_NOT_APPROVED: throws UnprocessableEntityException with code', async () => {
      mockService.sendOffer.mockResolvedValue({ outcome: 'OFFER_NOT_APPROVED' });

      let thrown: unknown;
      try { await controller.sendOffer(OFFER_ID, mockActor); } catch (e) { thrown = e; }

      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('OFFER_NOT_APPROVED');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.sendOffer.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.sendOffer(OFFER_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // recordOfferResponse
  // ---------------------------------------------------------------------------

  describe('recordOfferResponse()', () => {
    it('SUCCESS ACCEPTED: returns offer shape with status ACCEPTED', async () => {
      const acceptedAt = new Date('2026-08-15T14:30:00.000Z');
      const acceptedRecord = { ...offerRecord, status: 'ACCEPTED', acceptedAt };
      mockService.recordOfferResponse.mockResolvedValue({ outcome: 'SUCCESS', offer: acceptedRecord });

      const result = await controller.recordOfferResponse(OFFER_ID, recordResponseDto, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: OFFER_ID, status: 'ACCEPTED' });
      const data = result['data'] as Record<string, unknown>;
      expect(data['acceptedAt']).toBe(acceptedAt.toISOString());
    });

    it('SUCCESS: response data does not include tenantId or deletedAt', async () => {
      mockService.recordOfferResponse.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      const result = await controller.recordOfferResponse(OFFER_ID, recordResponseDto, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: id, response, actor.tenantId, actor.userId forwarded to service', async () => {
      mockService.recordOfferResponse.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      await controller.recordOfferResponse(OFFER_ID, recordResponseDto, mockActor);

      expect(mockService.recordOfferResponse).toHaveBeenCalledWith(
        OFFER_ID,
        { response: 'ACCEPTED' },
        TENANT_ID,
        ACTOR_ID,
      );
    });

    it('OFFER_NOT_FOUND: throws NotFoundException', async () => {
      mockService.recordOfferResponse.mockResolvedValue({ outcome: 'OFFER_NOT_FOUND' });

      await expect(controller.recordOfferResponse(OFFER_ID, recordResponseDto, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('OFFER_IN_TERMINAL_STATE: throws UnprocessableEntityException', async () => {
      mockService.recordOfferResponse.mockResolvedValue({ outcome: 'OFFER_IN_TERMINAL_STATE' });

      await expect(controller.recordOfferResponse(OFFER_ID, recordResponseDto, mockActor)).rejects.toThrow(UnprocessableEntityException);
    });

    it('OFFER_NOT_SENT: throws UnprocessableEntityException with code', async () => {
      mockService.recordOfferResponse.mockResolvedValue({ outcome: 'OFFER_NOT_SENT' });

      let thrown: unknown;
      try { await controller.recordOfferResponse(OFFER_ID, recordResponseDto, mockActor); } catch (e) { thrown = e; }

      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('OFFER_NOT_SENT');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.recordOfferResponse.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.recordOfferResponse(OFFER_ID, recordResponseDto, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // withdrawOffer
  // ---------------------------------------------------------------------------

  describe('withdrawOffer()', () => {
    it('SUCCESS: returns offer shape with status WITHDRAWN', async () => {
      const withdrawnRecord = { ...offerRecord, status: 'WITHDRAWN' };
      mockService.withdrawOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: withdrawnRecord });

      const result = await controller.withdrawOffer(OFFER_ID, mockActor) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(result['data']).toMatchObject({ id: OFFER_ID, status: 'WITHDRAWN' });
    });

    it('SUCCESS: response data does not include tenantId or deletedAt', async () => {
      mockService.withdrawOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      const result = await controller.withdrawOffer(OFFER_ID, mockActor) as Record<string, Record<string, unknown>>;

      expect(result['data']).not.toHaveProperty('tenantId');
      expect(result['data']).not.toHaveProperty('deletedAt');
    });

    it('SUCCESS: id, actor.tenantId, actor.userId forwarded to service (SEC-003)', async () => {
      mockService.withdrawOffer.mockResolvedValue({ outcome: 'SUCCESS', offer: offerRecord });

      await controller.withdrawOffer(OFFER_ID, mockActor);

      expect(mockService.withdrawOffer).toHaveBeenCalledWith(OFFER_ID, TENANT_ID, ACTOR_ID);
    });

    it('OFFER_NOT_FOUND: throws NotFoundException', async () => {
      mockService.withdrawOffer.mockResolvedValue({ outcome: 'OFFER_NOT_FOUND' });

      await expect(controller.withdrawOffer(OFFER_ID, mockActor)).rejects.toThrow(NotFoundException);
    });

    it('OFFER_IN_TERMINAL_STATE: throws UnprocessableEntityException with code', async () => {
      mockService.withdrawOffer.mockResolvedValue({ outcome: 'OFFER_IN_TERMINAL_STATE' });

      let thrown: unknown;
      try { await controller.withdrawOffer(OFFER_ID, mockActor); } catch (e) { thrown = e; }

      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      const body = (thrown as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
      expect(body['error']['code']).toBe('OFFER_IN_TERMINAL_STATE');
    });

    it('INTERNAL_ERROR: throws InternalServerErrorException', async () => {
      mockService.withdrawOffer.mockResolvedValue({ outcome: 'INTERNAL_ERROR' });

      await expect(controller.withdrawOffer(OFFER_ID, mockActor)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ---------------------------------------------------------------------------
  // RBAC metadata (GD-M18-1 D16)
  // Verified by reading @RequireRoles decorator metadata from each handler.
  // NestJS SetMetadata places roles on descriptor.value (the handler function itself).
  // ---------------------------------------------------------------------------

  describe('RBAC metadata', () => {
    it('createOffer requires System Administrator, HR Director, Recruiter', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.createOffer);
      expect(roles).toContain('System Administrator');
      expect(roles).toContain('HR Director');
      expect(roles).toContain('Recruiter');
    });

    it('createOffer does not include Compliance Officer — write endpoint', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.createOffer);
      expect(roles).not.toContain('Compliance Officer');
    });

    it('createOffer does not include Hiring Manager (GD-M18-1 D16)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.createOffer);
      expect(roles).not.toContain('Hiring Manager');
    });

    it('listOffers includes Compliance Officer — read endpoint', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.listOffers);
      expect(roles).toContain('Compliance Officer');
    });

    it('listOffers does not include Hiring Manager', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.listOffers);
      expect(roles).not.toContain('Hiring Manager');
    });

    it('getOfferById includes Compliance Officer — read endpoint', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.getOfferById);
      expect(roles).toContain('Compliance Officer');
    });

    it('getOfferById does not include Hiring Manager', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.getOfferById);
      expect(roles).not.toContain('Hiring Manager');
    });

    it('updateOffer does not include Compliance Officer — write endpoint', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.updateOffer);
      expect(roles).not.toContain('Compliance Officer');
    });

    it('updateOffer does not include Hiring Manager', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.updateOffer);
      expect(roles).not.toContain('Hiring Manager');
    });

    it('submitOffer includes Recruiter — Recruiter may submit (GD-M18-1 D16)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.submitOffer);
      expect(roles).toContain('Recruiter');
    });

    it('submitOffer does not include Hiring Manager', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.submitOffer);
      expect(roles).not.toContain('Hiring Manager');
    });

    it('approveOffer does NOT include Recruiter — approval authority restricted (GD-M18-1 D16)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.approveOffer);
      expect(roles).not.toContain('Recruiter');
    });

    it('approveOffer requires System Administrator and HR Director', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.approveOffer);
      expect(roles).toContain('System Administrator');
      expect(roles).toContain('HR Director');
    });

    it('approveOffer does not include Hiring Manager', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.approveOffer);
      expect(roles).not.toContain('Hiring Manager');
    });

    it('sendOffer does NOT include Recruiter — send authority restricted (GD-M18-1 D16)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.sendOffer);
      expect(roles).not.toContain('Recruiter');
    });

    it('sendOffer requires System Administrator and HR Director', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.sendOffer);
      expect(roles).toContain('System Administrator');
      expect(roles).toContain('HR Director');
    });

    it('sendOffer does not include Hiring Manager', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.sendOffer);
      expect(roles).not.toContain('Hiring Manager');
    });

    it('recordOfferResponse includes Recruiter — Recruiter may record candidate response', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.recordOfferResponse);
      expect(roles).toContain('Recruiter');
    });

    it('recordOfferResponse does not include Hiring Manager', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.recordOfferResponse);
      expect(roles).not.toContain('Hiring Manager');
    });

    it('withdrawOffer includes Recruiter — Recruiter may withdraw', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.withdrawOffer);
      expect(roles).toContain('Recruiter');
    });

    it('withdrawOffer does not include Hiring Manager', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, controller.withdrawOffer);
      expect(roles).not.toContain('Hiring Manager');
    });
  });

  // ---------------------------------------------------------------------------
  // HTTP code metadata
  // Verifies that action endpoints override the NestJS POST default of 201 to 200.
  // ---------------------------------------------------------------------------

  describe('HTTP code metadata', () => {
    it('createOffer uses 201', () => {
      const code = Reflect.getMetadata(HTTP_CODE_METADATA, controller.createOffer);
      expect(code).toBe(201);
    });

    it('submitOffer uses 200 — not the NestJS POST default of 201', () => {
      const code = Reflect.getMetadata(HTTP_CODE_METADATA, controller.submitOffer);
      expect(code).toBe(200);
    });

    it('approveOffer uses 200 — not the NestJS POST default of 201', () => {
      const code = Reflect.getMetadata(HTTP_CODE_METADATA, controller.approveOffer);
      expect(code).toBe(200);
    });

    it('sendOffer uses 200 — not the NestJS POST default of 201', () => {
      const code = Reflect.getMetadata(HTTP_CODE_METADATA, controller.sendOffer);
      expect(code).toBe(200);
    });

    it('recordOfferResponse uses 200 — not the NestJS POST default of 201', () => {
      const code = Reflect.getMetadata(HTTP_CODE_METADATA, controller.recordOfferResponse);
      expect(code).toBe(200);
    });

    it('withdrawOffer uses 200 — not the NestJS POST default of 201', () => {
      const code = Reflect.getMetadata(HTTP_CODE_METADATA, controller.withdrawOffer);
      expect(code).toBe(200);
    });
  });
});
