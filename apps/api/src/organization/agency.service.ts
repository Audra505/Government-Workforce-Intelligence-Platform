// Reference: spec/01_requirements.md — FR-050 Agency Management
// Reference: spec/06_api_contracts.md — GET /api/v1/agencies/current
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/12_organization_management_rules.md — AGY-001, AGY-002, AGY-003, ORG-006
//
// AgencyService is transport-agnostic: no HTTP exceptions thrown, no HTTP responses returned.
// HTTP status mapping is the sole responsibility of OrganizationController.
//
// ORG-006: The Tenant model IS the agency. No separate agencies table exists.
// GET /api/v1/agencies/current reads from Tenant using tenantId from the JWT (AGY-002).
//
// Agency data is read-only in Phase 1 (AGY-001). No write operations are implemented.
// Reads are not audited — AUD-350 covers create, update, and deactivation only.
//
// AGY-003: id is excluded from the returned record — internal identifiers are not exposed.

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';

// Shared intermediate agency shape — name, code, status, createdAt per AGY-003.
// id excluded: internal identifier must not be exposed via the agency endpoint.
export type AgencyRecord = {
  name: string;
  code: string;
  status: string;
  createdAt: Date;
};

export type GetAgencyResult =
  | { outcome: 'SUCCESS'; agency: AgencyRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

// Shared Prisma select — matches AgencyRecord fields exactly.
const AGENCY_READ_SELECT = {
  name: true,
  code: true,
  status: true,
  createdAt: true,
} as const;

@Injectable()
export class AgencyService {
  private readonly logger = new Logger(AgencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getAgency(tenantId: string): Promise<GetAgencyResult> {
    // tenantId is the primary key of the Tenant row (ORG-006: Tenant IS Agency).
    // findUnique is correct: id is the PK, no separate WHERE tenantId clause needed.
    // NOT_FOUND is a defensive outcome — a valid JWT always carries a valid tenantId,
    // but the service must not assume runtime invariants it cannot verify at the DB layer.
    let row: AgencyRecord | null;
    try {
      row = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: AGENCY_READ_SELECT,
      });
    } catch (err) {
      this.logger.error(
        'getAgency failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (!row) return { outcome: 'NOT_FOUND' };
    return { outcome: 'SUCCESS', agency: row };
  }
}
