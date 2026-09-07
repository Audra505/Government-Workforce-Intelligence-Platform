// Reference: governance/GD-M39-1.md — Decision 4 (API/viewer boundary),
// Decision 16 (five protected endpoints, exact authorization + route order)
//
// AuditEventsController is the sole HTTP transport layer for the M39
// audit-read/recovery/integrity surface — the first HTTP surface any
// milestone since M36 has been authorized to add. tenantId is never
// accepted from the request — always derived from the validated JWT
// (SEC-003), exactly like every other controller in this codebase.
//
// Authorization: class-level @RequireRoles(SA, CO) covers the three read
// endpoints (audit:read); both mutation endpoints override to SA only
// (audit:recover). RolesGuard remains the sole runtime authorization
// authority; CapabilityGuard remains unregistered — @RequireCapability on
// every handler below is metadata-only, exactly as on the 73 pre-existing
// endpoints (GD-M36-1).
//
// Route order is binding (Decision 16): static routes (recovery-status,
// recovery/:id/requeue, integrity/reverify) are declared before the bare
// :id detail route, so the detail route's dynamic segment can never
// capture a static sibling path.
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import { RequireRoles } from '../identity/decorators/require-roles.decorator';
import { RequireCapability } from '../identity/decorators/require-capability.decorator';
import { CAPABILITIES } from '../identity/permissions.catalog';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { RequestUser } from '../identity/jwt.strategy';
import { AuditEventsService } from './audit-events.service';
import { ListAuditEventsQueryDto } from './dto/list-audit-events-query.dto';

@ApiTags('audit-events')
@Controller({ path: 'audit-events', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles('System Administrator', 'Compliance Officer')
@ApiBearerAuth()
export class AuditEventsController {
  constructor(private readonly auditEventsService: AuditEventsService) {}

  @Get()
  @RequireCapability(CAPABILITIES.AUDIT_READ)
  @ApiOperation({ summary: 'List audit events within the authenticated tenant' })
  @ApiResponse({ status: 200, description: 'Cursor-paginated audit event list' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters or cursor' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async listAuditEvents(
    @Query() query: ListAuditEventsQueryDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.auditEventsService.listAuditEvents(actor.tenantId, actor.userId, query);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: { events: result.events, nextCursor: result.nextCursor } };

      case 'INVALID_CURSOR':
        throw new BadRequestException({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'invalid cursor' },
        });
    }
  }

  @Get('recovery-status')
  @RequireCapability(CAPABILITIES.AUDIT_READ)
  @ApiOperation({ summary: 'Sanitized recovery and chain-health summary for the authenticated tenant' })
  @ApiResponse({ status: 200, description: 'Recovery and chain-health summary' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getRecoveryStatus(@CurrentUser() actor: RequestUser): Promise<object> {
    const summary = await this.auditEventsService.getRecoveryStatus(actor.tenantId, actor.userId);
    return { success: true, data: summary };
  }

  @Post('recovery/:id/requeue')
  @HttpCode(200)
  @RequireRoles('System Administrator')
  @RequireCapability(CAPABILITIES.AUDIT_RECOVER)
  @ApiOperation({ summary: 'Requeue an ABANDONED failed audit write for another recovery attempt' })
  @ApiParam({ name: 'id', description: 'AuditWriteFailure UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Requeued successfully' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Failure not found in this tenant' })
  @ApiResponse({ status: 422, description: 'Failure is not in ABANDONED status' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async requeueFailedWrite(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.auditEventsService.requeueFailedWrite(actor.tenantId, id, actor.userId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: { failureId: result.failureId } };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'audit write failure not found' },
        });

      case 'NOT_ABANDONED':
        throw new ForbiddenException({
          success: false,
          error: {
            code: 'NOT_ABANDONED',
            message: `only an ABANDONED failure may be requeued (current status: ${result.currentStatus})`,
          },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  @Post('integrity/reverify')
  @HttpCode(200)
  @RequireRoles('System Administrator')
  @RequireCapability(CAPABILITIES.AUDIT_RECOVER)
  @ApiOperation({ summary: 'Request an out-of-cycle chain-integrity re-verification for the authenticated tenant' })
  @ApiResponse({ status: 200, description: 'Re-verification scheduled' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async requestReverification(@CurrentUser() actor: RequestUser): Promise<object> {
    const result = await this.auditEventsService.requestReverification(actor.tenantId, actor.userId);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: { scheduled: true } };

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        });
    }
  }

  @Get(':id')
  @RequireCapability(CAPABILITIES.AUDIT_READ)
  @ApiOperation({ summary: 'Get an audit event by id within the authenticated tenant' })
  @ApiParam({ name: 'id', description: 'AuditEvent UUID v4', type: 'string' })
  @ApiResponse({ status: 200, description: 'Audit event found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Audit event not found in this tenant' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getAuditEventById(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: RequestUser,
  ): Promise<object> {
    const result = await this.auditEventsService.getAuditEventById(actor.tenantId, actor.userId, id);

    switch (result.outcome) {
      case 'SUCCESS':
        return { success: true, data: result.event };

      case 'NOT_FOUND':
        throw new NotFoundException({
          success: false,
          error: { code: 'NOT_FOUND', message: 'audit event not found' },
        });
    }
  }
}
