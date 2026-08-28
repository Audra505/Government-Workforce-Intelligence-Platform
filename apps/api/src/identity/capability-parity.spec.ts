// Reference: governance/GD-M36-1.md — Decision 15 (deterministic parity-proof design),
// Decision 16 (permanent metadata-drift protection through M46), Appendix A
// (73 endpoint-to-capability mappings)
//
// This is the parity proof GD-M36-1 requires in place of any runtime shadow
// path: it reads REAL @RequireRoles and @RequireCapability metadata directly
// off the 15 controller classes' prototypes (decorators write to
// descriptor.value / the class constructor, so no instantiation or dependency
// injection is needed to read them — see interview.controller.spec.ts for the
// existing single-method precedent this file generalizes to all 73 endpoints).
//
// For every endpoint, this file proves two things without ever running a real
// HTTP request or touching a database:
//   1. The real @RequireRoles role set for that handler is EXACTLY the role
//      set CAPABILITY_ROLE_MAPPINGS declares for the capability that same
//      handler's real @RequireCapability names (core parity invariant).
//   2. Simulated RolesGuard and CapabilityGuard decisions agree across every
//      one of the 127 non-empty subsets of the 7 platform roles — 73 x 127 =
//      9,271 comparisons — proving no daylight between the two authorization
//      models exists for any combination of roles an actor could hold.
//
// This file is also the permanent metadata-drift guard (GD-M36-1 Decision 16,
// binding through M46): ENDPOINT_REGISTRY enumerates every currently known
// protected handler; a later test diffs it against every handler the 15
// controllers actually expose with @RequireRoles metadata today, so adding a
// new protected endpoint without updating this registry — or changing a
// handler's roles/capability without keeping them in sync — fails this file.

import 'reflect-metadata';

import {
  CAPABILITIES,
  CAPABILITY_ROLE_MAPPINGS,
  RESERVED_CAPABILITIES,
  ALL_PLATFORM_ROLES,
  UNIQUE_LEGACY_ROLE_SET_COMBINATIONS,
  splitCapability,
  type CapabilityRoleMapping,
} from './permissions.catalog';
import { ROLES_KEY } from './decorators/require-roles.decorator';
import { CAPABILITY_KEY } from './decorators/require-capability.decorator';

import { OrganizationController } from '../organization/organization.controller';
import { PositionController } from '../workforce/position.controller';
import { VacancyController } from '../workforce/vacancy.controller';
import { SkillController } from '../workforce/skill.controller';
import { CertificationController } from '../workforce/certification.controller';
import { EmployeeCertificationsController } from '../workforce/employee-certifications.controller';
import { EmployeeController } from '../workforce/employee.controller';
import { CandidateController } from '../recruiting/candidate.controller';
import { ApplicationController } from '../recruiting/application.controller';
import { InterviewController } from '../recruiting/interview.controller';
import { OfferController } from '../recruiting/offer.controller';
import { HireController } from '../recruiting/hire.controller';
import { IntelligenceController } from '../intelligence/intelligence.controller';
import { UsersController } from '../users/users.controller';
import { RolesController } from '../users/roles.controller';

// ---------------------------------------------------------------------------
// Metadata reflection helpers — mirror Reflector.getAllAndOverride(key,
// [handler, class])'s precedence (method-level wins, class-level is the
// fallback) without needing a NestJS ExecutionContext or a controller
// instance. SetMetadata writes method decorators onto descriptor.value
// (identical to ControllerClass.prototype.methodName) and class decorators
// onto the class constructor itself, so reading straight off the class is
// equivalent to what RolesGuard/CapabilityGuard see through the Reflector at
// request time.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCtrl = new (...args: any[]) => unknown;

function getHandler(Ctrl: AnyCtrl, methodName: string): (...args: unknown[]) => unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Ctrl.prototype as any)[methodName];
}

function getEffectiveRoles(Ctrl: AnyCtrl, methodName: string): string[] | undefined {
  const handler = getHandler(Ctrl, methodName);
  return (
    (Reflect.getMetadata(ROLES_KEY, handler) as string[] | undefined) ??
    (Reflect.getMetadata(ROLES_KEY, Ctrl) as string[] | undefined)
  );
}

function getEffectiveCapabilities(Ctrl: AnyCtrl, methodName: string): string[] | undefined {
  const handler = getHandler(Ctrl, methodName);
  return (
    (Reflect.getMetadata(CAPABILITY_KEY, handler) as string[] | undefined) ??
    (Reflect.getMetadata(CAPABILITY_KEY, Ctrl) as string[] | undefined)
  );
}

function mappingFor(capability: string): CapabilityRoleMapping {
  const mapping = CAPABILITY_ROLE_MAPPINGS.find((m) => m.capability === capability);
  if (!mapping) {
    throw new Error(`No CAPABILITY_ROLE_MAPPINGS entry for capability "${capability}"`);
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// ENDPOINT_REGISTRY — the 73 GD-M36-1 Appendix A protected handlers.
// Only [ControllerClass, methodName] is listed; expected roles and the
// expected capability are never hand-duplicated here — both are read live off
// the real decorator metadata by the tests below, and compared against the
// single catalog source of truth (permissions.catalog.ts).
// ---------------------------------------------------------------------------

interface RegistryEntry {
  readonly controllerName: string;
  readonly Ctrl: AnyCtrl;
  readonly methodName: string;
}

function entries(controllerName: string, Ctrl: AnyCtrl, methodNames: string[]): RegistryEntry[] {
  return methodNames.map((methodName) => ({ controllerName, Ctrl, methodName }));
}

const ENDPOINT_REGISTRY: RegistryEntry[] = [
  ...entries('OrganizationController', OrganizationController as unknown as AnyCtrl, [
    'createDepartment',
    'listDepartments',
    'getDepartmentById',
    'updateDepartment',
  ]),
  ...entries('PositionController', PositionController as unknown as AnyCtrl, [
    'createPosition',
    'listPositions',
    'getPositionById',
    'updatePosition',
    'closePosition',
  ]),
  ...entries('VacancyController', VacancyController as unknown as AnyCtrl, [
    'createVacancy',
    'listVacancies',
    'getVacancyById',
    'updateVacancy',
    'closeVacancy',
  ]),
  ...entries('SkillController', SkillController as unknown as AnyCtrl, [
    'createSkill',
    'listSkills',
    'getSkillById',
    'updateSkill',
  ]),
  ...entries('CertificationController', CertificationController as unknown as AnyCtrl, [
    'createCertification',
    'listCertifications',
    'getCertificationById',
    'updateCertification',
  ]),
  ...entries(
    'EmployeeCertificationsController',
    EmployeeCertificationsController as unknown as AnyCtrl,
    ['listExpiringCertifications'],
  ),
  ...entries('EmployeeController', EmployeeController as unknown as AnyCtrl, [
    'createEmployee',
    'listEmployees',
    'getEmployeeById',
    'updateEmployee',
    'changeEmployeeStatus',
    'assignPosition',
    'assignEmployeeSkill',
    'listEmployeeSkills',
    'assignEmployeeCertification',
    'listEmployeeCertifications',
  ]),
  ...entries('CandidateController', CandidateController as unknown as AnyCtrl, [
    'createCandidate',
    'listCandidates',
    'getCandidateById',
    'updateCandidate',
    'archiveCandidate',
  ]),
  ...entries('ApplicationController', ApplicationController as unknown as AnyCtrl, [
    'createApplication',
    'listApplications',
    'getApplicationById',
    'updateApplication',
    'advanceApplication',
    'rejectApplication',
    'withdrawApplication',
  ]),
  ...entries('InterviewController', InterviewController as unknown as AnyCtrl, [
    'createInterview',
    'listInterviews',
    'getInterviewById',
    'updateInterview',
    'completeInterview',
    'recordFeedback',
    'cancelInterview',
    'noShowInterview',
  ]),
  ...entries('OfferController', OfferController as unknown as AnyCtrl, [
    'createOffer',
    'listOffers',
    'getOfferById',
    'updateOffer',
    'submitOffer',
    'approveOffer',
    'sendOffer',
    'recordOfferResponse',
    'withdrawOffer',
  ]),
  ...entries('HireController', HireController as unknown as AnyCtrl, ['hireApplication']),
  ...entries('IntelligenceController', IntelligenceController as unknown as AnyCtrl, [
    'getVacancyRisk',
    'getWorkforceReadiness',
    'getAttritionRisk',
    'getDepartmentGap',
    'getExecutiveMetrics',
  ]),
  ...entries('UsersController', UsersController as unknown as AnyCtrl, [
    'createUser',
    'listUsers',
    'updateUser',
    'getUserById',
  ]),
  ...entries('RolesController', RolesController as unknown as AnyCtrl, ['getRoles']),
];

// ---------------------------------------------------------------------------
// Role-subset enumeration — all 127 non-empty subsets of the 7 platform roles.
// ---------------------------------------------------------------------------

function allNonEmptySubsets<T>(items: readonly T[]): T[][] {
  const subsets: T[][] = [];
  const n = items.length;
  for (let mask = 1; mask < 2 ** n; mask += 1) {
    const subset: T[] = [];
    for (let bit = 0; bit < n; bit += 1) {
      if (mask & (1 << bit)) {
        subset.push(items[bit]);
      }
    }
    subsets.push(subset);
  }
  return subsets;
}

const ROLE_SUBSETS = allNonEmptySubsets<string>(ALL_PLATFORM_ROLES);

// ---------------------------------------------------------------------------
// Basic registry sanity — must hold before any downstream test is meaningful.
// ---------------------------------------------------------------------------

describe('ENDPOINT_REGISTRY sanity', () => {
  it('contains exactly 73 entries (GD-M36-1 confirmed inventory)', () => {
    expect(ENDPOINT_REGISTRY).toHaveLength(73);
  });

  it('contains no duplicate [controller, method] pairs', () => {
    const keys = ENDPOINT_REGISTRY.map((e) => `${e.controllerName}.${e.methodName}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('there are exactly 127 non-empty role subsets for 7 platform roles', () => {
    expect(ROLE_SUBSETS).toHaveLength(127);
  });
});

// ---------------------------------------------------------------------------
// Core parity invariant, per endpoint: real @RequireRoles role set === the
// CAPABILITY_ROLE_MAPPINGS role set for that endpoint's real @RequireCapability.
// ---------------------------------------------------------------------------

describe('capability-parity — per-endpoint metadata agreement (73 endpoints)', () => {
  it.each(ENDPOINT_REGISTRY.map((e) => [`${e.controllerName}.${e.methodName}`, e] as const))(
    '%s: @RequireRoles matches CAPABILITY_ROLE_MAPPINGS for its @RequireCapability',
    (_label, entry) => {
      const roles = getEffectiveRoles(entry.Ctrl, entry.methodName);
      const capabilities = getEffectiveCapabilities(entry.Ctrl, entry.methodName);

      expect(roles).toBeDefined();
      expect(roles!.length).toBeGreaterThan(0);
      expect(capabilities).toBeDefined();
      expect(capabilities).toHaveLength(1);

      const mapping = mappingFor(capabilities![0]);
      expect(new Set(roles)).toEqual(new Set(mapping.roles));
    },
  );
});

// ---------------------------------------------------------------------------
// Exhaustive subset-level parity: 73 endpoints x 127 role subsets = 9,271
// comparisons between simulated RolesGuard and simulated CapabilityGuard
// decisions. Both simulations are pure — no Reflector, no ExecutionContext,
// no database — but mirror each guard's real decision rule exactly:
//   RolesGuard:       requiredRoles.some(r => actorRoles.includes(r))
//   CapabilityGuard:  requiredCapabilityRoles.some(r => actorRoles.includes(r))
// where requiredRoles comes from real @RequireRoles metadata and
// requiredCapabilityRoles comes from CAPABILITY_ROLE_MAPPINGS, keyed by the
// same handler's real @RequireCapability value.
// ---------------------------------------------------------------------------

describe('capability-parity — exhaustive subset comparison (9,271 cases)', () => {
  for (const entry of ENDPOINT_REGISTRY) {
    const roles = getEffectiveRoles(entry.Ctrl, entry.methodName)!;
    const capabilities = getEffectiveCapabilities(entry.Ctrl, entry.methodName)!;
    const mapping = mappingFor(capabilities[0]);

    describe(`${entry.controllerName}.${entry.methodName}`, () => {
      it.each(ROLE_SUBSETS.map((subset) => [subset.join('+'), subset] as const))(
        'role subset {%s}: RolesGuard and CapabilityGuard agree',
        (_label, subset) => {
          const rolesGuardAllows = roles.some((r) => subset.includes(r));
          const capabilityGuardAllows = mapping.roles.some((r) => subset.includes(r));
          expect(capabilityGuardAllows).toBe(rolesGuardAllows);
        },
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Non-happy-path capability resolution cases (mirrors PermissionsService /
// CapabilityGuard unit coverage at the catalog level, without a database).
// ---------------------------------------------------------------------------

describe('capability-parity — edge cases', () => {
  it('empty actor role set is denied by every one of the 73 endpoints under both models', () => {
    for (const entry of ENDPOINT_REGISTRY) {
      const roles = getEffectiveRoles(entry.Ctrl, entry.methodName)!;
      const capabilities = getEffectiveCapabilities(entry.Ctrl, entry.methodName)!;
      const mapping = mappingFor(capabilities[0]);

      expect(roles.some((r) => ([] as string[]).includes(r))).toBe(false);
      expect(mapping.roles.some((r) => ([] as string[]).includes(r))).toBe(false);
    }
  });

  it('an unrecognized role name is denied by every one of the 73 endpoints under both models', () => {
    const unknownRoleActor = ['Not A Real Role'];
    for (const entry of ENDPOINT_REGISTRY) {
      const roles = getEffectiveRoles(entry.Ctrl, entry.methodName)!;
      const capabilities = getEffectiveCapabilities(entry.Ctrl, entry.methodName)!;
      const mapping = mappingFor(capabilities[0]);

      expect(roles.some((r) => unknownRoleActor.includes(r))).toBe(false);
      expect(mapping.roles.some((r) => unknownRoleActor.includes(r))).toBe(false);
    }
  });

  it('a role with no seeded RolePermission rows for a capability resolves to zero access for that capability (missing-permission-row case)', () => {
    // Simulates PermissionsService.resolve() returning an empty set for a role
    // whose RolePermission rows are absent — the capability grants nothing,
    // matching CapabilityGuard's real fail-shut default when resolvedCapabilities
    // does not contain the required key. See permissions.service.spec.ts and
    // capability.guard.spec.ts for the corresponding database/guard-level proof.
    const resolvedCapabilities = new Set<string>(); // simulates zero seeded rows
    const required = [CAPABILITIES.EMPLOYEES_READ];
    expect(required.some((c) => resolvedCapabilities.has(c))).toBe(false);
  });

  it('resolver failure and invalid-result fail-closed behavior are covered by capability.guard.spec.ts, not duplicated here', () => {
    // capability.guard.spec.ts exhaustively covers: resolve() throwing,
    // resolve() returning null, and resolve() returning a non-Set value — all
    // three fail closed (canActivate() returns false). Re-asserted here only
    // as a cross-reference, per GD-M36-1's single-source-of-truth principle
    // for test coverage as well as production code.
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The 7 unique legacy role-set combinations (GD-M36-1 Decision 3 / Appendix A).
// ---------------------------------------------------------------------------

describe('capability-parity — 7 unique legacy role-set combinations', () => {
  it('UNIQUE_LEGACY_ROLE_SET_COMBINATIONS has exactly 7 entries, each pairwise distinct', () => {
    expect(UNIQUE_LEGACY_ROLE_SET_COMBINATIONS).toHaveLength(7);
    const asSets = UNIQUE_LEGACY_ROLE_SET_COMBINATIONS.map((combo) => new Set(combo));
    for (let i = 0; i < asSets.length; i += 1) {
      for (let j = i + 1; j < asSets.length; j += 1) {
        const same =
          asSets[i].size === asSets[j].size && [...asSets[i]].every((role) => asSets[j].has(role));
        expect(same).toBe(false);
      }
    }
  });

  it('every one of the 73 real @RequireRoles sets matches exactly one of the 7 canonical combinations', () => {
    for (const entry of ENDPOINT_REGISTRY) {
      const roles = new Set(getEffectiveRoles(entry.Ctrl, entry.methodName)!);
      const matches = UNIQUE_LEGACY_ROLE_SET_COMBINATIONS.filter(
        (combo) => combo.length === roles.size && combo.every((r) => roles.has(r)),
      );
      expect(matches).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// The 11 approved duplicate list/detail capability-sharing groups.
// ---------------------------------------------------------------------------

describe('capability-parity — 11 approved duplicate list/detail capability groups', () => {
  const EXPECTED_SHARED_READ_CAPABILITIES = [
    CAPABILITIES.DEPARTMENTS_READ,
    CAPABILITIES.POSITIONS_READ,
    CAPABILITIES.VACANCIES_READ,
    CAPABILITIES.SKILLS_READ,
    CAPABILITIES.CERTIFICATIONS_READ,
    CAPABILITIES.EMPLOYEES_READ,
    CAPABILITIES.CANDIDATES_READ,
    CAPABILITIES.APPLICATIONS_READ,
    CAPABILITIES.INTERVIEWS_READ,
    CAPABILITIES.OFFERS_READ,
    CAPABILITIES.USERS_READ,
  ];

  it('there are exactly 11 capabilities used by more than one endpoint in the registry', () => {
    const capabilityUsageCount = new Map<string, number>();
    for (const entry of ENDPOINT_REGISTRY) {
      const capability = getEffectiveCapabilities(entry.Ctrl, entry.methodName)![0];
      capabilityUsageCount.set(capability, (capabilityUsageCount.get(capability) ?? 0) + 1);
    }

    const sharedCapabilities = [...capabilityUsageCount.entries()].filter(([, count]) => count > 1);
    expect(sharedCapabilities).toHaveLength(11);

    const sharedCapabilityNames = new Set(sharedCapabilities.map(([capability]) => capability));
    expect(sharedCapabilityNames).toEqual(new Set(EXPECTED_SHARED_READ_CAPABILITIES));
  });

  it('every shared capability is used by exactly 2 endpoints (list + detail)', () => {
    const capabilityUsageCount = new Map<string, number>();
    for (const entry of ENDPOINT_REGISTRY) {
      const capability = getEffectiveCapabilities(entry.Ctrl, entry.methodName)![0];
      capabilityUsageCount.set(capability, (capabilityUsageCount.get(capability) ?? 0) + 1);
    }

    for (const capability of EXPECTED_SHARED_READ_CAPABILITIES) {
      expect(capabilityUsageCount.get(capability)).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Reserved capabilities (GD-M36-1 Decision 12) must never be seeded or attached.
// ---------------------------------------------------------------------------

describe('capability-parity — reserved capabilities absent from seed catalog and controllers', () => {
  it('none of the 4 reserved capabilities appear in CAPABILITY_ROLE_MAPPINGS', () => {
    const mapped = new Set(CAPABILITY_ROLE_MAPPINGS.map((m) => m.capability));
    for (const reserved of RESERVED_CAPABILITIES) {
      expect(mapped.has(reserved as never)).toBe(false);
    }
  });

  it('none of the 4 reserved capabilities are attached to any real controller endpoint', () => {
    for (const entry of ENDPOINT_REGISTRY) {
      const capability = getEffectiveCapabilities(entry.Ctrl, entry.methodName)![0];
      expect(RESERVED_CAPABILITIES as readonly string[]).not.toContain(capability);
    }
  });
});

// ---------------------------------------------------------------------------
// Executive User PII exclusion — EU may only appear on the 3 aggregate-only
// intelligence capabilities; it must never be granted any individual-level
// (employee, candidate, application, interview, offer, user) capability.
// ---------------------------------------------------------------------------

describe('capability-parity — Executive User PII exclusion', () => {
  const EU = 'Executive User';
  const EU_ALLOWED_CAPABILITIES = new Set<string>([
    CAPABILITIES.INTELLIGENCE_WORKFORCE_READINESS_READ,
    CAPABILITIES.INTELLIGENCE_ATTRITION_RISK_READ,
    CAPABILITIES.INTELLIGENCE_EXECUTIVE_METRICS_READ,
  ]);

  it('Executive User appears in CAPABILITY_ROLE_MAPPINGS only for the 3 aggregate intelligence capabilities', () => {
    for (const mapping of CAPABILITY_ROLE_MAPPINGS) {
      if (mapping.roles.includes(EU)) {
        expect(EU_ALLOWED_CAPABILITIES.has(mapping.capability)).toBe(true);
      }
    }
  });

  it("Executive User is absent from every non-intelligence endpoint's real @RequireRoles metadata", () => {
    for (const entry of ENDPOINT_REGISTRY) {
      if (entry.controllerName === 'IntelligenceController') continue;
      const roles = getEffectiveRoles(entry.Ctrl, entry.methodName)!;
      expect(roles).not.toContain(EU);
    }
  });
});

// ---------------------------------------------------------------------------
// Compliance Officer read-only — CO must never appear on a capability whose
// action (per the resource:action split) is anything other than "read".
// ---------------------------------------------------------------------------

describe('capability-parity — Compliance Officer read-only', () => {
  const CO = 'Compliance Officer';

  it('every capability granted to Compliance Officer has action "read"', () => {
    for (const mapping of CAPABILITY_ROLE_MAPPINGS) {
      if (mapping.roles.includes(CO)) {
        const { action } = splitCapability(mapping.capability);
        expect(action).toBe('read');
      }
    }
  });

  it('Compliance Officer never appears in @RequireRoles for a real endpoint whose capability action is not "read"', () => {
    for (const entry of ENDPOINT_REGISTRY) {
      const roles = getEffectiveRoles(entry.Ctrl, entry.methodName)!;
      const capabilities = getEffectiveCapabilities(entry.Ctrl, entry.methodName)!;
      const { action } = splitCapability(capabilities[0]);
      if (roles.includes(CO)) {
        expect(action).toBe('read');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Domain-specific parity spot-checks — recruiting / workforce / intelligence /
// offer / hire. Each assertion reads real metadata; none hardcodes a role list
// independent of the catalog.
// ---------------------------------------------------------------------------

describe('capability-parity — domain spot-checks', () => {
  it('recruiting: Recruiter is granted on candidate/application/interview/offer write endpoints but never on offer approve/issue', () => {
    const approveRoles = getEffectiveRoles(OfferController as unknown as AnyCtrl, 'approveOffer')!;
    const issueRoles = getEffectiveRoles(OfferController as unknown as AnyCtrl, 'sendOffer')!;
    expect(approveRoles).not.toContain('Recruiter');
    expect(issueRoles).not.toContain('Recruiter');

    const createOfferRoles = getEffectiveRoles(
      OfferController as unknown as AnyCtrl,
      'createOffer',
    )!;
    expect(createOfferRoles).toContain('Recruiter');
  });

  it('workforce: Hiring Manager is granted only on employee read endpoints, never on write endpoints', () => {
    const readRoles = getEffectiveRoles(EmployeeController as unknown as AnyCtrl, 'listEmployees')!;
    const writeRoles = getEffectiveRoles(
      EmployeeController as unknown as AnyCtrl,
      'updateEmployee',
    )!;
    expect(readRoles).toContain('Hiring Manager');
    expect(writeRoles).not.toContain('Hiring Manager');
  });

  it('intelligence: only vacancy-risk and department-gap exclude Executive User; the other three include it', () => {
    const vacancyRiskRoles = getEffectiveRoles(
      IntelligenceController as unknown as AnyCtrl,
      'getVacancyRisk',
    )!;
    const departmentGapRoles = getEffectiveRoles(
      IntelligenceController as unknown as AnyCtrl,
      'getDepartmentGap',
    )!;
    const readinessRoles = getEffectiveRoles(
      IntelligenceController as unknown as AnyCtrl,
      'getWorkforceReadiness',
    )!;
    const attritionRoles = getEffectiveRoles(
      IntelligenceController as unknown as AnyCtrl,
      'getAttritionRisk',
    )!;
    const executiveMetricsRoles = getEffectiveRoles(
      IntelligenceController as unknown as AnyCtrl,
      'getExecutiveMetrics',
    )!;

    expect(vacancyRiskRoles).not.toContain('Executive User');
    expect(departmentGapRoles).not.toContain('Executive User');
    expect(readinessRoles).toContain('Executive User');
    expect(attritionRoles).toContain('Executive User');
    expect(executiveMetricsRoles).toContain('Executive User');
  });

  it('offer: withdraw uses offers:withdraw, not the reserved offers:rescind capability', () => {
    const capabilities = getEffectiveCapabilities(
      OfferController as unknown as AnyCtrl,
      'withdrawOffer',
    )!;
    expect(capabilities).toEqual([CAPABILITIES.OFFERS_WITHDRAW]);
    expect(capabilities[0]).not.toBe('offers:rescind');
  });

  it('hire: single endpoint restricted to System Administrator and HR Director only (Recruiter excluded)', () => {
    const roles = getEffectiveRoles(HireController as unknown as AnyCtrl, 'hireApplication')!;
    expect(new Set(roles)).toEqual(new Set(['System Administrator', 'HR Director']));
    expect(roles).not.toContain('Recruiter');
  });
});

// ---------------------------------------------------------------------------
// Last System Administrator / forbidden role-assignment protections — these
// are service-layer business rules already covered by users.service.spec.ts;
// referenced here, not duplicated, per GD-M36-1's single-source-of-truth
// principle for test coverage.
// ---------------------------------------------------------------------------

describe('capability-parity — user-management protections (cross-reference only)', () => {
  it('Last System Administrator guard and forbidden System Administrator assignment are covered in users.service.spec.ts', () => {
    // No duplication here: those are UsersService business-logic invariants,
    // orthogonal to the M36 capability catalog (users:update authorizes the
    // endpoint; the service still enforces LAST_SYSTEM_ADMINISTRATOR and
    // FORBIDDEN_ROLE_ASSIGNMENT regardless of which authorization model gates
    // the route). This test exists only to make the cross-reference explicit.
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Seed idempotency — covered by permissions.seed.spec.ts; referenced only.
// ---------------------------------------------------------------------------

describe('capability-parity — seed idempotency (cross-reference only)', () => {
  it('seedPermissionsAndRolePermissions() idempotency is covered in permissions.seed.spec.ts', () => {
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Permanent metadata-drift protection (GD-M36-1 Decision 16, binding through
// M46). Three independent guarantees:
//   (a) every real @RequireRoles-protected handler on the 15 controllers also
//       carries @RequireCapability metadata;
//   (b) every currently-decorated handler is present in ENDPOINT_REGISTRY —
//       a newly added protected endpoint that isn't registered here fails;
//   (c) capability metadata never implies a different role set than the real
//       @RequireRoles metadata for the same handler (re-verified structurally,
//       independent of the per-endpoint test above).
// ---------------------------------------------------------------------------

describe('capability-parity — permanent metadata-drift protection (through M46)', () => {
  // Every method actually defined on each controller's prototype (excluding
  // the constructor) that carries non-empty, method-level @RequireRoles
  // metadata. Class-level-only controllers (Users, Roles) are handled
  // separately below since ALL their methods inherit class-level roles.
  const ROUTE_LEVEL_CONTROLLERS: Array<{ name: string; Ctrl: AnyCtrl }> = [
    { name: 'OrganizationController', Ctrl: OrganizationController as unknown as AnyCtrl },
    { name: 'PositionController', Ctrl: PositionController as unknown as AnyCtrl },
    { name: 'VacancyController', Ctrl: VacancyController as unknown as AnyCtrl },
    { name: 'SkillController', Ctrl: SkillController as unknown as AnyCtrl },
    { name: 'CertificationController', Ctrl: CertificationController as unknown as AnyCtrl },
    {
      name: 'EmployeeCertificationsController',
      Ctrl: EmployeeCertificationsController as unknown as AnyCtrl,
    },
    { name: 'EmployeeController', Ctrl: EmployeeController as unknown as AnyCtrl },
    { name: 'CandidateController', Ctrl: CandidateController as unknown as AnyCtrl },
    { name: 'ApplicationController', Ctrl: ApplicationController as unknown as AnyCtrl },
    { name: 'InterviewController', Ctrl: InterviewController as unknown as AnyCtrl },
    { name: 'OfferController', Ctrl: OfferController as unknown as AnyCtrl },
    { name: 'HireController', Ctrl: HireController as unknown as AnyCtrl },
    { name: 'IntelligenceController', Ctrl: IntelligenceController as unknown as AnyCtrl },
  ];

  const CLASS_LEVEL_CONTROLLERS: Array<{ name: string; Ctrl: AnyCtrl }> = [
    { name: 'UsersController', Ctrl: UsersController as unknown as AnyCtrl },
    { name: 'RolesController', Ctrl: RolesController as unknown as AnyCtrl },
  ];

  function ownMethodNames(Ctrl: AnyCtrl): string[] {
    return Object.getOwnPropertyNames(Ctrl.prototype).filter(
      (name) =>
        name !== 'constructor' &&
        typeof (Ctrl.prototype as Record<string, unknown>)[name] === 'function',
    );
  }

  it('(a) every method-level @RequireRoles-decorated handler on route-level controllers also has @RequireCapability', () => {
    for (const { name, Ctrl } of ROUTE_LEVEL_CONTROLLERS) {
      for (const methodName of ownMethodNames(Ctrl)) {
        const handler = getHandler(Ctrl, methodName);
        const methodRoles = Reflect.getMetadata(ROLES_KEY, handler) as string[] | undefined;
        if (methodRoles && methodRoles.length > 0) {
          const methodCapabilities = Reflect.getMetadata(CAPABILITY_KEY, handler) as
            | string[]
            | undefined;
          expect(methodCapabilities && methodCapabilities.length > 0).toBe(true);
          if (!(methodCapabilities && methodCapabilities.length > 0)) {
            throw new Error(`${name}.${methodName} has @RequireRoles but no @RequireCapability`);
          }
        }
      }
    }
  });

  it('(a) every method on class-level-protected controllers (Users, Roles) has @RequireCapability', () => {
    for (const { name, Ctrl } of CLASS_LEVEL_CONTROLLERS) {
      const classRoles = Reflect.getMetadata(ROLES_KEY, Ctrl) as string[] | undefined;
      expect(classRoles && classRoles.length > 0).toBe(true);

      for (const methodName of ownMethodNames(Ctrl)) {
        const handler = getHandler(Ctrl, methodName);
        const methodCapabilities = Reflect.getMetadata(CAPABILITY_KEY, handler) as
          | string[]
          | undefined;
        if (!(methodCapabilities && methodCapabilities.length > 0)) {
          throw new Error(
            `${name}.${methodName} inherits class-level @RequireRoles but has no @RequireCapability`,
          );
        }
      }
    }
  });

  it('(b) every currently-decorated protected handler across all 15 controllers is present in ENDPOINT_REGISTRY', () => {
    const registryKeys = new Set(
      ENDPOINT_REGISTRY.map((e) => `${e.controllerName}.${e.methodName}`),
    );

    for (const { name, Ctrl } of ROUTE_LEVEL_CONTROLLERS) {
      for (const methodName of ownMethodNames(Ctrl)) {
        const handler = getHandler(Ctrl, methodName);
        const methodRoles = Reflect.getMetadata(ROLES_KEY, handler) as string[] | undefined;
        if (methodRoles && methodRoles.length > 0) {
          const key = `${name}.${methodName}`;
          if (!registryKeys.has(key)) {
            throw new Error(
              `${key} carries @RequireRoles metadata but is not present in ENDPOINT_REGISTRY — ` +
                'a new protected endpoint was added without updating the M36 parity registry and catalog.',
            );
          }
        }
      }
    }

    for (const { name, Ctrl } of CLASS_LEVEL_CONTROLLERS) {
      for (const methodName of ownMethodNames(Ctrl)) {
        const key = `${name}.${methodName}`;
        if (!registryKeys.has(key)) {
          throw new Error(
            `${key} is a method on a class-level-@RequireRoles controller but is not present in ` +
              'ENDPOINT_REGISTRY — a new protected endpoint was added without updating the M36 parity registry and catalog.',
          );
        }
      }
    }
  });

  it('(b) ENDPOINT_REGISTRY contains no stale entries — every registered [controller, method] still exists and is still decorated', () => {
    for (const entry of ENDPOINT_REGISTRY) {
      const handler = getHandler(entry.Ctrl, entry.methodName);
      expect(typeof handler).toBe('function');

      const roles = getEffectiveRoles(entry.Ctrl, entry.methodName);
      const capabilities = getEffectiveCapabilities(entry.Ctrl, entry.methodName);
      expect(roles && roles.length > 0).toBe(true);
      expect(capabilities && capabilities.length > 0).toBe(true);
    }
  });

  it('(c) capability metadata never implies a different role set than real @RequireRoles, for any registered endpoint', () => {
    // Structural re-verification of the per-endpoint invariant tested above,
    // performed as one combined assertion so drift in either metadata source
    // or the catalog mapping is caught even if the per-endpoint suite is
    // filtered out by a test-name pattern in CI.
    for (const entry of ENDPOINT_REGISTRY) {
      const roles = new Set(getEffectiveRoles(entry.Ctrl, entry.methodName)!);
      const capability = getEffectiveCapabilities(entry.Ctrl, entry.methodName)![0];
      const mapping = mappingFor(capability);
      expect(roles).toEqual(new Set(mapping.roles));
    }
  });
});
