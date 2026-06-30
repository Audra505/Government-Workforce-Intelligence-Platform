// Reference: spec/01_requirements.md — FR-315 through FR-324 Offer Management
// Reference: spec/06_api_contracts.md — Offer API contracts
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: governance/GD-M18-1.md — Decisions 3, 7, 9, 10, 13, 14, 16
// Reference: governance/GD-PRE-PHASE3-002.md — Decision 1 (tenant isolation)
// Reference: governance/GD-PRE-PHASE3-003.md — RBAC authority
//
// OfferController is the sole HTTP transport layer for the offer management domain.
// It maps OfferService result types → HTTP status codes + response envelopes.
// tenantId is never accepted from the request — always derived from the validated JWT (SEC-003).
//
// Authorization (GD-PRE-PHASE3-003; GD-M18-1 D16):
//   POST  /offers                     — System Administrator, HR Director, Recruiter
//   GET   /offers                     — System Administrator, HR Director, Recruiter, Compliance Officer
//   GET   /offers/:id                 — System Administrator, HR Director, Recruiter, Compliance Officer
//   PUT   /offers/:id                 — System Administrator, HR Director, Recruiter
//   POST  /offers/:id/submit          — System Administrator, HR Director, Recruiter
//   POST  /offers/:id/approve         — System Administrator, HR Director (Recruiter excluded — GD-M18-1 D16)
//   POST  /offers/:id/send            — System Administrator, HR Director (Recruiter excluded — GD-M18-1 D16)
//   POST  /offers/:id/record-response — System Administrator, HR Director, Recruiter
//   POST  /offers/:id/withdraw        — System Administrator, HR Director, Recruiter
//
// Compliance Officer: read-only (list + detail only).
// Hiring Manager: denied for all M18B offer endpoints (GD-M18-1 D16).
// Workforce Planner, Executive User: denied all M18B offer endpoints.
// No hire, employee creation, or vacancy status changes in M18B (GD-M18-1 D3, D9).

import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import { RequireRoles } from '../identity/decorators/require-roles.decorator';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { RequestUser } from '../identity/jwt.strategy';
import { OfferService, OfferRecord } from './offer.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { RecordOfferResponseDto } from './dto/record-offer-response.dto';
import { ListOffersQueryDto } from './dto/list-offers-query.dto';

@ApiTags('recruiting')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class OfferController {
  constructor(private readonly offerService: OfferService) {}

  // --------------------------------------------------------------------------
  // POST /api/v1/offers
  // --------------------------------------------------------------------------

  @Post('offers')
  @HttpCode(201)
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter')
  @ApiOperation({ summary: 'Create a new offer in DRAFT status for an application at OFFER stage (GD-M18-1 D7)' })
  @ApiResponse({ status: 201, description: 'Offer created — status = DRAFT' })
  @ApiResponse({ status: 400, description: 'Validation error — missing or invalid fields' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — Compliance Officer, Hiring Manager, Workforce Planner, Executive User forbidden' })
  @ApiResponse({ status: 404, description: 'Application not found in this tenant' })
  @ApiResponse({ status: 409, description: 'An active offer already exists for this application (GD-M18-1 D10)' })
  @ApiResponse({ status: 422, description: 'Application is not in OFFER status (GD-M18-1 D7)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async createOffer(
    @Body() dto: CreateOfferDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.offerService.createOffer(
      {
        applicationId: dto.applicationId,
        offerDate:     dto.offerDate,
        notes:         dto.notes,
      },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toOfferShape(result.offer) };

      case 'APPLICATION_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'APPLICATION_NOT_FOUND', message: 'application not found' },
        });

      case 'APPLICATION_NOT_AT_OFFER_STATUS':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'APPLICATION_NOT_AT_OFFER_STATUS',
            message: 'application must be in OFFER status to create an offer (GD-M18-1 D7)',
          },
        });

      case 'ACTIVE_OFFER_EXISTS':
        throw new ConflictException({
          success: false,
          error: {
            code: 'ACTIVE_OFFER_EXISTS',
            message: 'an active offer already exists for this application (GD-M18-1 D10)',
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/offers
  // --------------------------------------------------------------------------

  @Get('offers')
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter', 'Compliance Officer')
  @ApiOperation({ summary: 'List offers within the authenticated tenant (GD-M18-1 D16) — paginated with optional filters' })
  @ApiResponse({ status: 200, description: 'Paginated offer list' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — Hiring Manager, Workforce Planner, Executive User forbidden' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async listOffers(
    @Query() query: ListOffersQueryDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.offerService.listOffers(
      {
        page:          query.page,
        pageSize:      query.pageSize,
        applicationId: query.applicationId,
        status:        query.status,
      },
      actor.tenantId,
    );

    switch (result.outcome) {
      case 'SUCCESS': {
        const totalPages = Math.ceil(result.total / result.pageSize);
        return {
          success: true,
          data: {
            offers:     result.offers.map(toOfferShape),
            total:      result.total,
            page:       result.page,
            pageSize:   result.pageSize,
            totalPages,
          },
        };
      }

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/offers/:id
  // --------------------------------------------------------------------------

  @Get('offers/:id')
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter', 'Compliance Officer')
  @ApiOperation({ summary: 'Get an offer by ID — cross-tenant and soft-deleted offers return 404 (SEC-003)' })
  @ApiParam({ name: 'id', description: 'Offer UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Offer found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Offer not found — absent, deleted, and cross-tenant return identical response (SEC-003)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getOfferById(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.offerService.getOfferById(id, actor.tenantId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toOfferShape(result.offer) };

      case 'OFFER_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'OFFER_NOT_FOUND', message: 'offer not found' },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // PUT /api/v1/offers/:id
  // --------------------------------------------------------------------------

  @Put('offers/:id')
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter')
  @ApiOperation({ summary: 'Update offer fields — only permitted in DRAFT status; status not editable here (GD-M18-1 D7, D13)' })
  @ApiParam({ name: 'id', description: 'Offer UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Offer updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — Compliance Officer, Hiring Manager, Workforce Planner, Executive User forbidden' })
  @ApiResponse({ status: 404, description: 'Offer not found' })
  @ApiResponse({ status: 422, description: 'Offer is not in DRAFT status or is in a terminal state (GD-M18-1 D7)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async updateOffer(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateOfferDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.offerService.updateOffer(
      id,
      {
        offerDate: dto.offerDate,
        notes:     dto.notes,
      },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toOfferShape(result.offer) };

      case 'OFFER_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'OFFER_NOT_FOUND', message: 'offer not found' },
        });

      case 'OFFER_IN_TERMINAL_STATE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'OFFER_IN_TERMINAL_STATE',
            message: 'offer is in a terminal state and cannot be modified (GD-M18-1 D7)',
          },
        });

      case 'OFFER_NOT_IN_DRAFT':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'OFFER_NOT_IN_DRAFT',
            message: 'only DRAFT offers may be updated (GD-M18-1 D7)',
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/offers/:id/submit
  // --------------------------------------------------------------------------

  @Post('offers/:id/submit')
  @HttpCode(200)
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter')
  @ApiOperation({ summary: 'Submit a DRAFT offer for approval — transitions status to PENDING_APPROVAL (GD-M18-1 D7)' })
  @ApiParam({ name: 'id', description: 'Offer UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Offer submitted — status = PENDING_APPROVAL' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Offer not found' })
  @ApiResponse({ status: 422, description: 'Offer is not in DRAFT status or is terminal (GD-M18-1 D7)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async submitOffer(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.offerService.submitOffer(id, actor.tenantId, actor.userId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toOfferShape(result.offer) };

      case 'OFFER_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'OFFER_NOT_FOUND', message: 'offer not found' },
        });

      case 'OFFER_IN_TERMINAL_STATE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'OFFER_IN_TERMINAL_STATE',
            message: 'offer is in a terminal state and cannot be submitted (GD-M18-1 D7)',
          },
        });

      case 'OFFER_NOT_IN_DRAFT':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'OFFER_NOT_IN_DRAFT',
            message: 'offer must be in DRAFT status to submit (GD-M18-1 D7)',
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/offers/:id/approve
  // Recruiter excluded — approval authority is restricted to HR Director and System Administrator.
  // --------------------------------------------------------------------------

  @Post('offers/:id/approve')
  @HttpCode(200)
  @RequireRoles('System Administrator', 'HR Director')
  @ApiOperation({ summary: 'Approve a PENDING_APPROVAL offer — transitions status to APPROVED (GD-M18-1 D7); Recruiter excluded' })
  @ApiParam({ name: 'id', description: 'Offer UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Offer approved — status = APPROVED' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — Recruiter, Compliance Officer, Hiring Manager, Workforce Planner, Executive User forbidden' })
  @ApiResponse({ status: 404, description: 'Offer not found' })
  @ApiResponse({ status: 422, description: 'Offer is not in PENDING_APPROVAL status or is terminal (GD-M18-1 D7)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async approveOffer(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.offerService.approveOffer(id, actor.tenantId, actor.userId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toOfferShape(result.offer) };

      case 'OFFER_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'OFFER_NOT_FOUND', message: 'offer not found' },
        });

      case 'OFFER_IN_TERMINAL_STATE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'OFFER_IN_TERMINAL_STATE',
            message: 'offer is in a terminal state and cannot be approved (GD-M18-1 D7)',
          },
        });

      case 'OFFER_NOT_PENDING_APPROVAL':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'OFFER_NOT_PENDING_APPROVAL',
            message: 'offer must be in PENDING_APPROVAL status to approve (GD-M18-1 D7)',
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/offers/:id/send
  // Recruiter excluded — sending authority is restricted to HR Director and System Administrator.
  // --------------------------------------------------------------------------

  @Post('offers/:id/send')
  @HttpCode(200)
  @RequireRoles('System Administrator', 'HR Director')
  @ApiOperation({ summary: 'Send an APPROVED offer to the candidate — transitions status to SENT (GD-M18-1 D7); Recruiter excluded' })
  @ApiParam({ name: 'id', description: 'Offer UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Offer sent — status = SENT' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role — Recruiter, Compliance Officer, Hiring Manager, Workforce Planner, Executive User forbidden' })
  @ApiResponse({ status: 404, description: 'Offer not found' })
  @ApiResponse({ status: 422, description: 'Offer is not in APPROVED status or is terminal (GD-M18-1 D7)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async sendOffer(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.offerService.sendOffer(id, actor.tenantId, actor.userId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toOfferShape(result.offer) };

      case 'OFFER_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'OFFER_NOT_FOUND', message: 'offer not found' },
        });

      case 'OFFER_IN_TERMINAL_STATE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'OFFER_IN_TERMINAL_STATE',
            message: 'offer is in a terminal state and cannot be sent (GD-M18-1 D7)',
          },
        });

      case 'OFFER_NOT_APPROVED':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'OFFER_NOT_APPROVED',
            message: 'offer must be in APPROVED status to send (GD-M18-1 D7)',
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/offers/:id/record-response
  // --------------------------------------------------------------------------

  @Post('offers/:id/record-response')
  @HttpCode(200)
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter')
  @ApiOperation({ summary: 'Record candidate response (ACCEPTED or DECLINED) for a SENT offer (GD-M18-1 D7); does not create employee record (D3, D9)' })
  @ApiParam({ name: 'id', description: 'Offer UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Response recorded — status = ACCEPTED or DECLINED' })
  @ApiResponse({ status: 400, description: 'Validation error — response missing or invalid' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Offer not found' })
  @ApiResponse({ status: 422, description: 'Offer is not in SENT status or is terminal (GD-M18-1 D7)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async recordOfferResponse(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: RecordOfferResponseDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.offerService.recordOfferResponse(
      id,
      { response: dto.response as 'ACCEPTED' | 'DECLINED' },
      actor.tenantId,
      actor.userId,
    );

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toOfferShape(result.offer) };

      case 'OFFER_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'OFFER_NOT_FOUND', message: 'offer not found' },
        });

      case 'OFFER_IN_TERMINAL_STATE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'OFFER_IN_TERMINAL_STATE',
            message: 'offer is in a terminal state and cannot receive a response (GD-M18-1 D7)',
          },
        });

      case 'OFFER_NOT_SENT':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'OFFER_NOT_SENT',
            message: 'offer must be in SENT status to record a candidate response (GD-M18-1 D7)',
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/offers/:id/withdraw
  // --------------------------------------------------------------------------

  @Post('offers/:id/withdraw')
  @HttpCode(200)
  @RequireRoles('System Administrator', 'HR Director', 'Recruiter')
  @ApiOperation({ summary: 'Withdraw any non-terminal offer — transitions status to WITHDRAWN (terminal) (GD-M18-1 D7)' })
  @ApiParam({ name: 'id', description: 'Offer UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Offer withdrawn — status = WITHDRAWN' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Offer not found' })
  @ApiResponse({ status: 422, description: 'Offer is already in a terminal state (GD-M18-1 D7)' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async withdrawOffer(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.offerService.withdrawOffer(id, actor.tenantId, actor.userId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: toOfferShape(result.offer) };

      case 'OFFER_NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'OFFER_NOT_FOUND', message: 'offer not found' },
        });

      case 'OFFER_IN_TERMINAL_STATE':
        throw new UnprocessableEntityException({
          success: false,
          error: {
            code: 'OFFER_IN_TERMINAL_STATE',
            message: 'offer is already in a terminal state (GD-M18-1 D7)',
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }
}

// ---------------------------------------------------------------------------
// toOfferShape — maps OfferRecord (service layer) to HTTP response shape.
// tenantId excluded per SEC-003 — clients must not derive tenantId from responses.
// deletedAt excluded — soft-deleted offers are invisible (NOT_FOUND); no caller sees deletedAt.
// Date fields serialized as ISO 8601 strings or null.
// ---------------------------------------------------------------------------
function toOfferShape(record: OfferRecord): object {
  return {
    id:            record.id,
    applicationId: record.applicationId,
    status:        record.status,
    offerDate:     record.offerDate  ? record.offerDate.toISOString()  : null,
    acceptedAt:    record.acceptedAt ? record.acceptedAt.toISOString() : null,
    declinedAt:    record.declinedAt ? record.declinedAt.toISOString() : null,
    notes:         record.notes,
    createdAt:     record.createdAt.toISOString(),
    updatedAt:     record.updatedAt.toISOString(),
  };
}
