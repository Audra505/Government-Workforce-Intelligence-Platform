// Governance authority: governance/GD-M38-1.md Decision 13.
//
// TEMPORARY, DORMANT, swappable role-to-authority-category resolver. The
// stable AuthorityCategory enum values (schema.prisma) never change; only
// this mapping's internals may be replaced when a real, permanent
// qualification model (Workforce Decision Owner profile, Independent
// Oversight Reviewer profile) is separately governed and introduced. No
// legacy role name is ever embedded into the decisions/approval schema —
// it lives only here, at the service layer.
//
// Explicit non-goals (do not "fix" these here — out of M38 scope):
//   - System Administrator must NEVER auto-qualify for
//     DEPARTMENT_OR_HIRING_AUTHORITY, HR_AUTHORITY, or
//     INDEPENDENT_OVERSIGHT_REVIEWER. SA is deliberately absent from every
//     dormant role mapping below.
//   - This mapping does not activate CapabilityGuard and is not consulted
//     by any runtime authorization path.
//   - The M36 capability catalog (CAPABILITIES / CAPABILITY_ROLE_MAPPINGS)
//     is read-only here; it is never modified by M38.

import { AuthorityCategory } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import {
  CAPABILITY_ROLE_MAPPINGS,
  HIRING_MANAGER,
  HR_DIRECTOR,
  COMPLIANCE_OFFICER,
} from '../identity/permissions.catalog';

// System-actor sentinel — mirrors AuditService.SYSTEM_USER_ID. No service or
// system identity may occupy a human approval/decision slot (GD-M38-1
// Decision 10/17); this is the only recognized system-actor value in this
// codebase, so it is explicitly rejected wherever a human actor is required.
export const SYSTEM_ACTOR_SENTINEL = '00000000-0000-0000-0000-000000000000';

// Dormant role mapping for the three role-based categories. ACTION_AUTHORITY
// is deliberately excluded — it resolves via the live M36 capability catalog
// below, never via a fixed role name.
const DORMANT_ROLE_MAPPING: Record<
  Exclude<AuthorityCategory, 'ACTION_AUTHORITY'>,
  string
> = {
  DEPARTMENT_OR_HIRING_AUTHORITY: HIRING_MANAGER,
  HR_AUTHORITY: HR_DIRECTOR,
  INDEPENDENT_OVERSIGHT_REVIEWER: COMPLIANCE_OFFICER,
};

export class ServiceActorNotPermittedViolation extends Error {
  constructor(public readonly userId: string) {
    super('SERVICE_ACTOR_NOT_PERMITTED');
  }
}

export class ActorNotFoundViolation extends Error {
  constructor(public readonly userId: string) {
    super('ACTOR_NOT_FOUND');
  }
}

export class ActorNotActiveViolation extends Error {
  constructor(public readonly userId: string) {
    super('ACTOR_NOT_ACTIVE');
  }
}

export class ActorNotQualifiedViolation extends Error {
  constructor(
    public readonly userId: string,
    public readonly category: AuthorityCategory,
  ) {
    super('ACTOR_NOT_QUALIFIED');
  }
}

export class RequiredCapabilityNotFoundViolation extends Error {
  constructor(public readonly requiredCapabilityId: string) {
    super('REQUIRED_CAPABILITY_NOT_FOUND');
  }
}

// Validates that `userId` is a real, active, tenant-owned human actor who
// currently qualifies for `category` (and, for ACTION_AUTHORITY, for the
// exact `requiredCapabilityId`), and returns an immutable text snapshot of
// what qualified them — so the historical meaning of a past decision
// survives later role or profile changes (GD-M38-1 Decision 5/13).
export async function assertHumanActorQualifiesForCategory(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  category: AuthorityCategory,
  requiredCapabilityId: string | null,
): Promise<string> {
  if (!userId || userId === SYSTEM_ACTOR_SENTINEL) {
    throw new ServiceActorNotPermittedViolation(userId);
  }

  const user = await tx.user.findFirst({
    where: { id: userId, tenantId },
    include: { userRoles: { include: { role: true } } },
  });
  if (!user) {
    throw new ActorNotFoundViolation(userId);
  }
  // GD-M38-1 Decision 5 — actors must be active AT DECISION-SUBMISSION TIME.
  // A later deactivation/role change never retroactively invalidates this
  // historical decision (the qualificationSnapshot text this function
  // returns is what preserves that history).
  if (user.status !== 'ACTIVE') {
    throw new ActorNotActiveViolation(userId);
  }

  const roleNames = user.userRoles.map((ur) => ur.role.name);

  if (category === AuthorityCategory.ACTION_AUTHORITY) {
    if (!requiredCapabilityId) {
      throw new ActorNotQualifiedViolation(userId, category);
    }
    const permission = await tx.permission.findUnique({ where: { id: requiredCapabilityId } });
    if (!permission) {
      throw new RequiredCapabilityNotFoundViolation(requiredCapabilityId);
    }
    const capabilityKey = `${permission.resource}:${permission.action}`;
    const mapping = CAPABILITY_ROLE_MAPPINGS.find((m) => m.capability === capabilityKey);
    if (!mapping || !roleNames.some((r) => mapping.roles.includes(r))) {
      throw new ActorNotQualifiedViolation(userId, category);
    }
    return `ACTION_AUTHORITY:capability=${capabilityKey}:roles=${roleNames.sort().join('|')}`;
  }

  // Dormant, temporary role-based categories. System Administrator is never
  // present in DORMANT_ROLE_MAPPING's values, so an SA-only user never
  // qualifies here regardless of any other role they hold.
  const requiredRole = DORMANT_ROLE_MAPPING[category];
  if (!roleNames.includes(requiredRole)) {
    throw new ActorNotQualifiedViolation(userId, category);
  }
  return `${category}:role=${requiredRole}`;
}
