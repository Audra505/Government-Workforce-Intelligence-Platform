// Reference: governance/GD-M36-1.md — Decision 14 (@RequireCapability and CapabilityGuard)
//
// Structurally identical to require-roles.decorator.ts's @RequireRoles — same
// Reflector/SetMetadata pattern, its own metadata key. Method-level metadata
// only (GD-M36-1 Decision 11) — every one of the 73 protected endpoint
// handlers listed in GD-M36-1 Appendix A carries exactly one @RequireCapability
// call, including the four users.controller.ts handlers and the one
// roles.controller.ts handler whose @RequireRoles is class-level.
//
// NON-ENFORCING IN M36: this metadata is read only by CapabilityGuard (never
// runtime-registered on any controller — see capability.guard.ts) and by the
// M36 parity-proof test suite. Applying this decorator to a handler has zero
// effect on that handler's actual authorization outcome; @RequireRoles remains
// the only decorator RolesGuard consults.
//
// Usage: @RequireCapability('employees:read')
import { SetMetadata } from '@nestjs/common';

export const CAPABILITY_KEY = 'capabilities';

export const RequireCapability = (...capabilities: string[]) =>
  SetMetadata(CAPABILITY_KEY, capabilities);
