// Reference: governance/GD-M36-1.md — Decision 10 (naming convention + split rule),
// Decision 11 (endpoint-capability catalog), Decision 12 (reserved capabilities),
// Appendix A (full endpoint-to-capability mapping)
//
// Single, typed source of truth for the M36 capability catalog and legacy-role
// mappings. apps/api/prisma/seed.ts, PermissionsService, and every M36 test file
// import from this module — none of them maintains an independently duplicated
// copy of the catalog data (GD-M36-1 Decision 11's explicit requirement).
//
// This module is read-only data plus two pure helper functions. It performs no
// database access, no side effects, and grants no runtime authorization by
// itself — it is consumed by the seed script (to populate Permission/
// RolePermission) and by PermissionsService (indirectly, via the seeded rows it
// describes), never used as an in-memory authorization shortcut.

// ---------------------------------------------------------------------------
// Platform role names — must match directives/10_role_based_access_rules.md
// and apps/api/prisma/seed.ts's PLATFORM_ROLES exactly.
// ---------------------------------------------------------------------------

export const SYSTEM_ADMINISTRATOR = 'System Administrator';
export const HR_DIRECTOR = 'HR Director';
export const WORKFORCE_PLANNER = 'Workforce Planner';
export const RECRUITER = 'Recruiter';
export const HIRING_MANAGER = 'Hiring Manager';
export const COMPLIANCE_OFFICER = 'Compliance Officer';
export const EXECUTIVE_USER = 'Executive User';

// The 7 unique legacy role-set combinations confirmed in GD-M36-1 Decision 3.
// Every one of the 62 capability definitions below references exactly one of
// these 7 shared arrays — no capability definition types out its own role list.
export const ROLES_SA_HRD = [SYSTEM_ADMINISTRATOR, HR_DIRECTOR] as const;
export const ROLES_SA_HRD_WP = [SYSTEM_ADMINISTRATOR, HR_DIRECTOR, WORKFORCE_PLANNER] as const;
export const ROLES_SA_HRD_WP_CO = [
  SYSTEM_ADMINISTRATOR,
  HR_DIRECTOR,
  WORKFORCE_PLANNER,
  COMPLIANCE_OFFICER,
] as const;
export const ROLES_SA_HRD_WP_HM_CO = [
  SYSTEM_ADMINISTRATOR,
  HR_DIRECTOR,
  WORKFORCE_PLANNER,
  HIRING_MANAGER,
  COMPLIANCE_OFFICER,
] as const;
export const ROLES_SA_HRD_REC = [SYSTEM_ADMINISTRATOR, HR_DIRECTOR, RECRUITER] as const;
export const ROLES_SA_HRD_REC_CO = [
  SYSTEM_ADMINISTRATOR,
  HR_DIRECTOR,
  RECRUITER,
  COMPLIANCE_OFFICER,
] as const;
export const ROLES_SA_HRD_WP_EU = [
  SYSTEM_ADMINISTRATOR,
  HR_DIRECTOR,
  WORKFORCE_PLANNER,
  EXECUTIVE_USER,
] as const;

/** All 7 unique legacy role-set combinations, for tests that enumerate them directly. */
export const UNIQUE_LEGACY_ROLE_SET_COMBINATIONS = [
  ROLES_SA_HRD,
  ROLES_SA_HRD_WP,
  ROLES_SA_HRD_WP_CO,
  ROLES_SA_HRD_WP_HM_CO,
  ROLES_SA_HRD_REC,
  ROLES_SA_HRD_REC_CO,
  ROLES_SA_HRD_WP_EU,
] as const;

/** All 7 platform roles, for parity-suite subset enumeration. */
export const ALL_PLATFORM_ROLES = [
  SYSTEM_ADMINISTRATOR,
  HR_DIRECTOR,
  WORKFORCE_PLANNER,
  RECRUITER,
  HIRING_MANAGER,
  COMPLIANCE_OFFICER,
  EXECUTIVE_USER,
] as const;

// ---------------------------------------------------------------------------
// Capability keys — GD-M36-1 Appendix A, 62 unique capabilities.
// resource:action / resource:subresource:action hierarchical naming
// (GD-M36-1 Decision 10).
// ---------------------------------------------------------------------------

export const CAPABILITIES = {
  DEPARTMENTS_CREATE: 'departments:create',
  DEPARTMENTS_READ: 'departments:read',
  DEPARTMENTS_UPDATE: 'departments:update',

  POSITIONS_CREATE: 'positions:create',
  POSITIONS_READ: 'positions:read',
  POSITIONS_UPDATE: 'positions:update',
  POSITIONS_CLOSE: 'positions:close',

  VACANCIES_CREATE: 'vacancies:create',
  VACANCIES_READ: 'vacancies:read',
  VACANCIES_UPDATE: 'vacancies:update',
  VACANCIES_CLOSE: 'vacancies:close',

  SKILLS_CREATE: 'skills:create',
  SKILLS_READ: 'skills:read',
  SKILLS_UPDATE: 'skills:update',

  CERTIFICATIONS_CREATE: 'certifications:create',
  CERTIFICATIONS_READ: 'certifications:read',
  CERTIFICATIONS_UPDATE: 'certifications:update',

  EMPLOYEE_CERTIFICATIONS_EXPIRING_READ: 'employee-certifications:expiring:read',

  EMPLOYEES_CREATE: 'employees:create',
  EMPLOYEES_READ: 'employees:read',
  EMPLOYEES_UPDATE: 'employees:update',
  EMPLOYEES_STATUS_TRANSITION: 'employees:status:transition',
  EMPLOYEES_ASSIGN_POSITION: 'employees:assign-position',
  EMPLOYEES_SKILLS_ASSIGN: 'employees:skills:assign',
  EMPLOYEES_SKILLS_READ: 'employees:skills:read',
  EMPLOYEES_CERTIFICATIONS_ASSIGN: 'employees:certifications:assign',
  EMPLOYEES_CERTIFICATIONS_READ: 'employees:certifications:read',

  CANDIDATES_CREATE: 'candidates:create',
  CANDIDATES_READ: 'candidates:read',
  CANDIDATES_UPDATE: 'candidates:update',
  CANDIDATES_ARCHIVE: 'candidates:archive',

  APPLICATIONS_CREATE: 'applications:create',
  APPLICATIONS_READ: 'applications:read',
  APPLICATIONS_UPDATE: 'applications:update',
  APPLICATIONS_ADVANCE: 'applications:advance',
  APPLICATIONS_REJECT: 'applications:reject',
  APPLICATIONS_WITHDRAW: 'applications:withdraw',

  INTERVIEWS_CREATE: 'interviews:create',
  INTERVIEWS_READ: 'interviews:read',
  INTERVIEWS_UPDATE: 'interviews:update',
  INTERVIEWS_COMPLETE: 'interviews:complete',
  INTERVIEWS_FEEDBACK: 'interviews:feedback',
  INTERVIEWS_CANCEL: 'interviews:cancel',
  INTERVIEWS_NO_SHOW: 'interviews:no-show',

  OFFERS_CREATE: 'offers:create',
  OFFERS_READ: 'offers:read',
  OFFERS_UPDATE: 'offers:update',
  OFFERS_SUBMIT: 'offers:submit',
  OFFERS_APPROVE: 'offers:approve',
  OFFERS_ISSUE: 'offers:issue',
  OFFERS_RECORD_RESPONSE: 'offers:record-response',
  OFFERS_WITHDRAW: 'offers:withdraw',

  // Current mapping unchanged (SA, HRD) — GD-M19-1 / directives/10 RBAC-701
  // conflict acknowledged, resolution deferred to M40. See RESERVED_CAPABILITIES
  // below for the capabilities this endpoint's payload-conditional semantics do
  // NOT yet support (there are none reserved for hire specifically today).
  HIRE_AUTHORIZE: 'hire:authorize',

  INTELLIGENCE_VACANCY_RISK_READ: 'intelligence:vacancy-risk:read',
  INTELLIGENCE_WORKFORCE_READINESS_READ: 'intelligence:workforce-readiness:read',
  INTELLIGENCE_ATTRITION_RISK_READ: 'intelligence:attrition-risk:read',
  INTELLIGENCE_DEPARTMENT_GAP_READ: 'intelligence:department-gap:read',
  INTELLIGENCE_EXECUTIVE_METRICS_READ: 'intelligence:executive-metrics:read',

  USERS_CREATE: 'users:create',
  USERS_READ: 'users:read',
  USERS_UPDATE: 'users:update',

  ROLES_ASSIGNABLE_READ: 'roles:assignable:read',
} as const;

export type CapabilityKey = keyof typeof CAPABILITIES;
export type Capability = (typeof CAPABILITIES)[CapabilityKey];

// ---------------------------------------------------------------------------
// Reserved conditional/service-level capabilities — GD-M36-1 Decision 12.
// Documented for future governance; explicitly NOT seeded, NOT attached to any
// @RequireCapability metadata, and NOT parity-tested by M36.
// ---------------------------------------------------------------------------

export const RESERVED_CAPABILITIES = [
  'employees:terminate',
  'users:deactivate',
  'users:assign-role',
  'offers:rescind',
] as const;

// ---------------------------------------------------------------------------
// Capability -> legacy role-set mapping — GD-M36-1 Appendix A, 62 entries.
// This is the single source of truth apps/api/prisma/seed.ts upserts from, and
// the single source of truth every M36 test compares real controller metadata
// against. No endpoint list is duplicated here — the 73 endpoint-to-capability
// associations live only as the real @RequireCapability(...) arguments on the
// 15 controller files; this table supplies only "which roles does this
// capability grant," matching each capability's Appendix A role set exactly.
// ---------------------------------------------------------------------------

export interface CapabilityRoleMapping {
  readonly capability: Capability;
  readonly roles: readonly string[];
}

export const CAPABILITY_ROLE_MAPPINGS: readonly CapabilityRoleMapping[] = [
  { capability: CAPABILITIES.DEPARTMENTS_CREATE, roles: ROLES_SA_HRD },
  { capability: CAPABILITIES.DEPARTMENTS_READ, roles: ROLES_SA_HRD_WP },
  { capability: CAPABILITIES.DEPARTMENTS_UPDATE, roles: ROLES_SA_HRD },

  { capability: CAPABILITIES.POSITIONS_CREATE, roles: ROLES_SA_HRD },
  { capability: CAPABILITIES.POSITIONS_READ, roles: ROLES_SA_HRD_WP },
  { capability: CAPABILITIES.POSITIONS_UPDATE, roles: ROLES_SA_HRD },
  { capability: CAPABILITIES.POSITIONS_CLOSE, roles: ROLES_SA_HRD },

  { capability: CAPABILITIES.VACANCIES_CREATE, roles: ROLES_SA_HRD },
  { capability: CAPABILITIES.VACANCIES_READ, roles: ROLES_SA_HRD_WP },
  { capability: CAPABILITIES.VACANCIES_UPDATE, roles: ROLES_SA_HRD },
  { capability: CAPABILITIES.VACANCIES_CLOSE, roles: ROLES_SA_HRD },

  { capability: CAPABILITIES.SKILLS_CREATE, roles: ROLES_SA_HRD },
  { capability: CAPABILITIES.SKILLS_READ, roles: ROLES_SA_HRD_WP_CO },
  { capability: CAPABILITIES.SKILLS_UPDATE, roles: ROLES_SA_HRD },

  { capability: CAPABILITIES.CERTIFICATIONS_CREATE, roles: ROLES_SA_HRD },
  { capability: CAPABILITIES.CERTIFICATIONS_READ, roles: ROLES_SA_HRD_WP_CO },
  { capability: CAPABILITIES.CERTIFICATIONS_UPDATE, roles: ROLES_SA_HRD },

  { capability: CAPABILITIES.EMPLOYEE_CERTIFICATIONS_EXPIRING_READ, roles: ROLES_SA_HRD_WP_CO },

  { capability: CAPABILITIES.EMPLOYEES_CREATE, roles: ROLES_SA_HRD },
  { capability: CAPABILITIES.EMPLOYEES_READ, roles: ROLES_SA_HRD_WP_HM_CO },
  { capability: CAPABILITIES.EMPLOYEES_UPDATE, roles: ROLES_SA_HRD },
  { capability: CAPABILITIES.EMPLOYEES_STATUS_TRANSITION, roles: ROLES_SA_HRD },
  { capability: CAPABILITIES.EMPLOYEES_ASSIGN_POSITION, roles: ROLES_SA_HRD },
  { capability: CAPABILITIES.EMPLOYEES_SKILLS_ASSIGN, roles: ROLES_SA_HRD },
  { capability: CAPABILITIES.EMPLOYEES_SKILLS_READ, roles: ROLES_SA_HRD_WP_CO },
  { capability: CAPABILITIES.EMPLOYEES_CERTIFICATIONS_ASSIGN, roles: ROLES_SA_HRD },
  { capability: CAPABILITIES.EMPLOYEES_CERTIFICATIONS_READ, roles: ROLES_SA_HRD_WP_CO },

  { capability: CAPABILITIES.CANDIDATES_CREATE, roles: ROLES_SA_HRD_REC },
  { capability: CAPABILITIES.CANDIDATES_READ, roles: ROLES_SA_HRD_REC_CO },
  { capability: CAPABILITIES.CANDIDATES_UPDATE, roles: ROLES_SA_HRD_REC },
  { capability: CAPABILITIES.CANDIDATES_ARCHIVE, roles: ROLES_SA_HRD_REC },

  { capability: CAPABILITIES.APPLICATIONS_CREATE, roles: ROLES_SA_HRD_REC },
  { capability: CAPABILITIES.APPLICATIONS_READ, roles: ROLES_SA_HRD_REC_CO },
  { capability: CAPABILITIES.APPLICATIONS_UPDATE, roles: ROLES_SA_HRD_REC },
  { capability: CAPABILITIES.APPLICATIONS_ADVANCE, roles: ROLES_SA_HRD_REC },
  { capability: CAPABILITIES.APPLICATIONS_REJECT, roles: ROLES_SA_HRD_REC },
  { capability: CAPABILITIES.APPLICATIONS_WITHDRAW, roles: ROLES_SA_HRD_REC },

  { capability: CAPABILITIES.INTERVIEWS_CREATE, roles: ROLES_SA_HRD_REC },
  { capability: CAPABILITIES.INTERVIEWS_READ, roles: ROLES_SA_HRD_REC_CO },
  { capability: CAPABILITIES.INTERVIEWS_UPDATE, roles: ROLES_SA_HRD_REC },
  { capability: CAPABILITIES.INTERVIEWS_COMPLETE, roles: ROLES_SA_HRD_REC },
  { capability: CAPABILITIES.INTERVIEWS_FEEDBACK, roles: ROLES_SA_HRD_REC },
  { capability: CAPABILITIES.INTERVIEWS_CANCEL, roles: ROLES_SA_HRD_REC },
  { capability: CAPABILITIES.INTERVIEWS_NO_SHOW, roles: ROLES_SA_HRD_REC },

  { capability: CAPABILITIES.OFFERS_CREATE, roles: ROLES_SA_HRD_REC },
  { capability: CAPABILITIES.OFFERS_READ, roles: ROLES_SA_HRD_REC_CO },
  { capability: CAPABILITIES.OFFERS_UPDATE, roles: ROLES_SA_HRD_REC },
  { capability: CAPABILITIES.OFFERS_SUBMIT, roles: ROLES_SA_HRD_REC },
  { capability: CAPABILITIES.OFFERS_APPROVE, roles: ROLES_SA_HRD },
  { capability: CAPABILITIES.OFFERS_ISSUE, roles: ROLES_SA_HRD },
  { capability: CAPABILITIES.OFFERS_RECORD_RESPONSE, roles: ROLES_SA_HRD_REC },
  { capability: CAPABILITIES.OFFERS_WITHDRAW, roles: ROLES_SA_HRD_REC },

  { capability: CAPABILITIES.HIRE_AUTHORIZE, roles: ROLES_SA_HRD },

  { capability: CAPABILITIES.INTELLIGENCE_VACANCY_RISK_READ, roles: ROLES_SA_HRD_WP },
  { capability: CAPABILITIES.INTELLIGENCE_WORKFORCE_READINESS_READ, roles: ROLES_SA_HRD_WP_EU },
  { capability: CAPABILITIES.INTELLIGENCE_ATTRITION_RISK_READ, roles: ROLES_SA_HRD_WP_EU },
  { capability: CAPABILITIES.INTELLIGENCE_DEPARTMENT_GAP_READ, roles: ROLES_SA_HRD_WP },
  { capability: CAPABILITIES.INTELLIGENCE_EXECUTIVE_METRICS_READ, roles: ROLES_SA_HRD_WP_EU },

  { capability: CAPABILITIES.USERS_CREATE, roles: ROLES_SA_HRD },
  { capability: CAPABILITIES.USERS_READ, roles: ROLES_SA_HRD },
  { capability: CAPABILITIES.USERS_UPDATE, roles: ROLES_SA_HRD },

  { capability: CAPABILITIES.ROLES_ASSIGNABLE_READ, roles: ROLES_SA_HRD },
];

// ---------------------------------------------------------------------------
// Split rule — GD-M36-1 Decision 10's binding resource/action mapping.
// The final colon-delimited segment is `action`; everything preceding the
// final colon is `resource`. Deterministic and injective given the catalog's
// pairwise-distinct capability keys, so (resource, action) tuples remain
// pairwise distinct under Permission's existing @@unique([resource, action]).
// ---------------------------------------------------------------------------

export interface SplitCapability {
  readonly resource: string;
  readonly action: string;
}

export function splitCapability(capability: string): SplitCapability {
  const lastColonIndex = capability.lastIndexOf(':');

  if (lastColonIndex <= 0 || lastColonIndex === capability.length - 1) {
    throw new Error(`Malformed capability key (expected "resource:action"): "${capability}"`);
  }

  return {
    resource: capability.slice(0, lastColonIndex),
    action: capability.slice(lastColonIndex + 1),
  };
}

/** Inverse of splitCapability — reconstructs the full capability key. */
export function joinCapability(resource: string, action: string): Capability {
  return `${resource}:${action}` as Capability;
}
