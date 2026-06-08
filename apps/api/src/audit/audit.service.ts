import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { CreateAuditEventDto } from './dto/create-audit-event.dto';

// Sentinel UUID for system-initiated audit events that have no human actor.
// Used by scheduled jobs, background processing, and startup-time events.
// No corresponding row in identity.users is required — audit_events.user_id
// carries no FK constraint (intentional design: cascading deletes must never
// corrupt the audit trail).
// Import this constant; do not redefine it elsewhere.
export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

// Sentinel UUID for audit events where the tenant context cannot be determined.
// Used exclusively for pre-authentication failures (e.g. EMAIL_NOT_FOUND) where
// no tenant is known and no DB round-trip can safely resolve one.
// Distinct semantic meaning from SYSTEM_USER_ID despite sharing the same value:
//   SYSTEM_USER_ID  → actor is the system (not a human)
//   SYSTEM_TENANT_ID → tenant is indeterminate (pre-authentication context)
// audit_events.tenant_id carries no FK constraint — zero UUID is safe.
// Import this constant; do not redefine it elsewhere.
export const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async logEvent(dto: CreateAuditEventDto): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          tenantId: dto.tenantId,
          userId: dto.userId,
          entityType: dto.entityType,
          entityId: dto.entityId,
          action: dto.action,
          result: dto.result,
          metadata: dto.metadata as object | undefined,
        },
      });
    } catch (error) {
      // AUD-1300: audit subsystem failure must not block primary operations.
      // Log the failure for operator visibility; do not rethrow.
      // Never log metadata, userId, or entityId — may contain PII.
      this.logger.error(
        `Audit write failed: action=${dto.action} tenantId=${dto.tenantId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
