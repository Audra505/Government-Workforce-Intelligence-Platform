// Reference: governance/GD-M37-1.md — Decision 10 (grantable-capability
// allowlist), Appendix A
//
// The exhaustive, hard-coded set of capabilities that may be requested
// through an ElevationSession. Deliberately narrower than the full 62-entry
// M36 catalog: every entry here touches only User identity/account data
// (never Employee/Candidate PII), and every entry is copied verbatim from
// permissions.catalog.ts — no new capability key is introduced, renamed, or
// duplicated as a separate string literal.
//
// This module is read-only data. It grants nothing by itself: the allowlist
// is consulted by ElevationSessionService only at ElevationSessionCapability
// row-creation time (request-submission time), never by any runtime
// authorization path.

import { CAPABILITIES, type Capability } from './permissions.catalog';

export const ELEVATION_SESSION_ALLOWED_CAPABILITIES: readonly Capability[] = [
  CAPABILITIES.USERS_CREATE,
  CAPABILITIES.USERS_READ,
  CAPABILITIES.USERS_UPDATE,
  CAPABILITIES.ROLES_ASSIGNABLE_READ,
] as const;

const ELEVATION_SESSION_ALLOWED_CAPABILITY_SET = new Set<Capability>(
  ELEVATION_SESSION_ALLOWED_CAPABILITIES,
);

export function isElevationSessionAllowedCapability(capability: string): capability is Capability {
  return ELEVATION_SESSION_ALLOWED_CAPABILITY_SET.has(capability as Capability);
}
