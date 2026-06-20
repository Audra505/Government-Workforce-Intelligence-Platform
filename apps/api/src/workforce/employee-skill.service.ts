// Reference: spec/01_requirements.md — FR-113 Employee Skill Assignment
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
// Reference: directives/14_skill_management_rules.md — SKL-200 through SKL-211
// Reference: governance/GD-M13-1.md — Decision 6 (tenant isolation), Decision 7 (no tenant_id on junction)
// Reference: governance/GD-M13-2.md — Decision 6 (request contract), Decision 14 (GET contract), Decision 15 (HTTP status)
// Reference: governance/GD-M13-4.md — Decision 3 (upsert semantics), Decision 5 (UPDATED metadata)
//
// Transport-agnostic service — no HTTP exceptions, no HttpStatus references.
//
// Tenant isolation (GD-M13-1 D7):
//   workforce.employee_skills has NO tenant_id column. Isolation is enforced via the
//   employee FK chain: employee lookup includes tenantId in WHERE; skill lookup includes
//   tenantId in WHERE. A valid employee + valid skill in the same tenant guarantees
//   the resulting junction record is tenant-scoped.
//
// EMP-302 enforcement (SKL-202):
//   Only SEPARATED employment status is blocked. PENDING_ONBOARDING, ACTIVE,
//   ON_LEAVE, and SUSPENDED employees can all receive skill assignments.
//   Do not add guards for other statuses without a governance decision.
//
// Upsert semantics (SKL-203, GD-M13-4 D3):
//   findFirst → branch to create (ASSIGNED) or update (UPDATED). NOT prisma.upsert().
//   Explicit branching gives: correct audit event selection; access to prior values
//   for UPDATED metadata (GD-M13-4 D5); partial update semantics on UPDATE path.
//
// SKL-211 implementation note:
//   verifiedAt role restriction is enforced at the controller layer, not here.
//   The service receives verifiedAt as Date | undefined; a value of undefined
//   means "not provided" and is respected as such.

import { Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { AuditEventType } from '../audit/enums/audit-event-type.enum';
import { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// Public parameter and result types
// ---------------------------------------------------------------------------

export type AssignSkillParams = {
  employeeId: string;
  skillId: string;
  proficiencyLevel?: string; // undefined = not provided
  verifiedAt?: Date;         // undefined = not provided or silently dropped by controller
};

export type EmployeeSkillRecord = {
  skillId: string;
  skillName: string | null;       // null only if skill catalog entry hard-deleted (rare by design)
  skillCategory: string | null;   // null when category not set on catalog entry
  proficiencyLevel: string | null; // null = proficiency not assessed (SKL-210)
  verifiedAt: Date | null;        // null = self-declared; set = HR-verified (SKL-211)
};

export type AssignSkillResult =
  | { outcome: 'ASSIGNED'; assignment: EmployeeSkillRecord } // INSERT path → HTTP 201
  | { outcome: 'UPDATED';  assignment: EmployeeSkillRecord } // UPDATE path → HTTP 200
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'EMPLOYEE_SEPARATED' }
  | { outcome: 'SKILL_NOT_FOUND' }
  | { outcome: 'INVALID_PROFICIENCY_LEVEL' }
  | { outcome: 'INTERNAL_ERROR' };

export type ListEmployeeSkillsResult =
  | { outcome: 'SUCCESS'; assignments: EmployeeSkillRecord[] }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INTERNAL_ERROR' };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const VALID_PROFICIENCY_LEVELS = new Set([
  'BEGINNER',
  'DEVELOPING',
  'PROFICIENT',
  'ADVANCED',
  'EXPERT',
]);

// Mirrors GD-M13-2 Decision 14 field set. skill is always a non-null object
// because skillId is a NOT NULL FK — the skill catalog row always exists
// (soft-delete preserves the row with deleted_at set).
type EmployeeSkillRow = {
  skillId: string;
  proficiencyLevel: string | null;
  verifiedAt: Date | null;
  skill: {
    name: string;
    category: string | null;
  };
};

// Prisma select for all employeeSkill queries. Nested skill select per GD-M13-2 D14.
// skill select has NO deletedAt filter — D14 requires preserving refs to soft-deleted skills.
const EMPLOYEE_SKILL_SELECT = {
  skillId: true,
  proficiencyLevel: true,
  verifiedAt: true,
  skill: {
    select: {
      name: true,
      category: true,
    },
  },
} as const;

function toEmployeeSkillRecord(row: EmployeeSkillRow): EmployeeSkillRecord {
  return {
    skillId:         row.skillId,
    skillName:       row.skill.name,
    skillCategory:   row.skill.category,
    proficiencyLevel: row.proficiencyLevel,
    verifiedAt:      row.verifiedAt,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class EmployeeSkillService {
  private readonly logger = new Logger(EmployeeSkillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // assignSkill — upsert an employee skill assignment
  // -------------------------------------------------------------------------

  async assignSkill(
    params: AssignSkillParams,
    tenantId: string,
    actorId: string,
  ): Promise<AssignSkillResult> {
    // Step A — Employee lookup (SEC-003 + EMP-302 source)
    let employee: { employmentStatus: string } | null;
    try {
      employee = await this.prisma.employee.findFirst({
        where: { id: params.employeeId, tenantId, deletedAt: null },
        select: { employmentStatus: true },
      });
    } catch (err) {
      this.logger.error('assignSkill: employee lookup failed', err);
      return { outcome: 'INTERNAL_ERROR' };
    }
    if (!employee) return { outcome: 'NOT_FOUND' };

    // Step B — EMP-302: only SEPARATED is blocked (SKL-202)
    if (employee.employmentStatus === 'SEPARATED') {
      return { outcome: 'EMPLOYEE_SEPARATED' };
    }

    // Step C — Proficiency level validation (SKL-210), before skill DB lookup
    if (
      params.proficiencyLevel !== undefined &&
      !VALID_PROFICIENCY_LEVELS.has(params.proficiencyLevel)
    ) {
      return { outcome: 'INVALID_PROFICIENCY_LEVEL' };
    }

    // Step D — Skill lookup (SEC-003 + tenant scope; excludes soft-deleted)
    let skill: { id: string } | null;
    try {
      skill = await this.prisma.skill.findFirst({
        where: { id: params.skillId, tenantId, deletedAt: null },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error('assignSkill: skill lookup failed', err);
      return { outcome: 'INTERNAL_ERROR' };
    }
    if (!skill) return { outcome: 'SKILL_NOT_FOUND' };

    // Step E — Existing record check (determines INSERT vs UPDATE branch)
    let existing: { proficiencyLevel: string | null; verifiedAt: Date | null } | null;
    try {
      existing = await this.prisma.employeeSkill.findFirst({
        where: { employeeId: params.employeeId, skillId: params.skillId },
        select: { proficiencyLevel: true, verifiedAt: true },
      });
    } catch (err) {
      this.logger.error('assignSkill: existing record check failed', err);
      return { outcome: 'INTERNAL_ERROR' };
    }

    if (existing === null) {
      return this.insertSkillAssignment(params, tenantId, actorId);
    }
    return this.updateSkillAssignment(params, existing, tenantId, actorId);
  }

  private async insertSkillAssignment(
    params: AssignSkillParams,
    tenantId: string,
    actorId: string,
  ): Promise<AssignSkillResult> {
    let row: EmployeeSkillRow;
    try {
      row = await this.prisma.employeeSkill.create({
        data: {
          employeeId:      params.employeeId,
          skillId:         params.skillId,
          proficiencyLevel: params.proficiencyLevel ?? null,
          verifiedAt:      params.verifiedAt ?? null,
        },
        select: EMPLOYEE_SKILL_SELECT,
      }) as EmployeeSkillRow;
    } catch (err) {
      this.logger.error('assignSkill: INSERT failed', err);
      return { outcome: 'INTERNAL_ERROR' };
    }

    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: AuditEventType.WORKFORCE_EMPLOYEE_SKILL_ASSIGNED,
      result: 'SUCCESS',
      entityType: 'EMPLOYEE_SKILL',
      entityId: params.employeeId,
      metadata: {
        employeeId:      params.employeeId,
        skillId:         params.skillId,
        proficiencyLevel: params.proficiencyLevel ?? null,
        verifiedAt:      params.verifiedAt?.toISOString() ?? null,
      },
    });

    return { outcome: 'ASSIGNED', assignment: toEmployeeSkillRecord(row) };
  }

  private async updateSkillAssignment(
    params: AssignSkillParams,
    existing: { proficiencyLevel: string | null; verifiedAt: Date | null },
    tenantId: string,
    actorId: string,
  ): Promise<AssignSkillResult> {
    // Partial update semantics (SKL-203): only fields explicitly provided are written.
    const updateData: { proficiencyLevel?: string | null; verifiedAt?: Date | null } = {};
    if (params.proficiencyLevel !== undefined) updateData.proficiencyLevel = params.proficiencyLevel;
    if (params.verifiedAt !== undefined)       updateData.verifiedAt = params.verifiedAt;

    let row: EmployeeSkillRow;
    try {
      row = await this.prisma.employeeSkill.update({
        where: { employeeId_skillId: { employeeId: params.employeeId, skillId: params.skillId } },
        data: updateData,
        select: EMPLOYEE_SKILL_SELECT,
      }) as EmployeeSkillRow;
    } catch (err) {
      this.logger.error('assignSkill: UPDATE failed', err);
      return { outcome: 'INTERNAL_ERROR' };
    }

    // GD-M13-4 D5: UPDATED metadata must include prior and new values for each field.
    const newProficiencyLevel = params.proficiencyLevel !== undefined
      ? params.proficiencyLevel
      : existing.proficiencyLevel;
    const newVerifiedAt = params.verifiedAt !== undefined
      ? params.verifiedAt
      : existing.verifiedAt;

    await this.auditService.logEvent({
      tenantId,
      userId: actorId,
      action: AuditEventType.WORKFORCE_EMPLOYEE_SKILL_UPDATED,
      result: 'SUCCESS',
      entityType: 'EMPLOYEE_SKILL',
      entityId: params.employeeId,
      metadata: {
        employeeId:             params.employeeId,
        skillId:                params.skillId,
        prior_proficiency_level: existing.proficiencyLevel,
        new_proficiency_level:   newProficiencyLevel,
        prior_verified_at:       existing.verifiedAt?.toISOString() ?? null,
        new_verified_at:         newVerifiedAt?.toISOString() ?? null,
        updated_fields:          Object.keys(updateData),
      },
    });

    return { outcome: 'UPDATED', assignment: toEmployeeSkillRecord(row) };
  }

  // -------------------------------------------------------------------------
  // listEmployeeSkills — return all skill assignments for an employee
  // -------------------------------------------------------------------------

  async listEmployeeSkills(
    employeeId: string,
    tenantId: string,
  ): Promise<ListEmployeeSkillsResult> {
    // Step A — Employee existence check (SEC-003): empty array and NOT_FOUND are
    // indistinguishable from findMany alone; this guard ensures correct NOT_FOUND.
    let employeeExists: { id: string } | null;
    try {
      employeeExists = await this.prisma.employee.findFirst({
        where: { id: employeeId, tenantId, deletedAt: null },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error('listEmployeeSkills: employee lookup failed', err);
      return { outcome: 'INTERNAL_ERROR' };
    }
    if (!employeeExists) return { outcome: 'NOT_FOUND' };

    // Step B — Fetch all assignments with skill JOIN (GD-M13-2 D14)
    let rows: EmployeeSkillRow[];
    try {
      rows = (await this.prisma.employeeSkill.findMany({
        where:  { employeeId },
        select: EMPLOYEE_SKILL_SELECT,
      })) as EmployeeSkillRow[];
    } catch (err) {
      this.logger.error('listEmployeeSkills: findMany failed', err);
      return { outcome: 'INTERNAL_ERROR' };
    }

    return { outcome: 'SUCCESS', assignments: rows.map(toEmployeeSkillRecord) };
  }
}
