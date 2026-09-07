// Reference: governance/GD-M39-1.md — Decision 18 (Metadata and PII Controls)
//
// A per-event-type response allowlist — NEVER a generic "full metadata"
// passthrough. Unknown metadata keys are always omitted, never returned;
// unknown/unlisted event types return no metadata at all (fail closed).
// `separationReason` (WORKFORCE_EMPLOYEE_SEPARATED) is genuinely free-form
// and is excluded from every event type's allowlist, under every role,
// including System Administrator, with no exception — enforced twice below
// (never listed, and defensively skipped even if it ever were).
//
// The `updatedFields`/`fieldsChanged` keys below are confirmed field-name
// arrays only by direct source trace (never field values), across the
// seven production call sites GD-M39-1's References section cites:
// application.service.ts, candidate.service.ts, interview.service.ts,
// offer.service.ts, certification.service.ts, employee.service.ts,
// skill.service.ts.

import { AuditEventType } from './enums/audit-event-type.enum';

const SEPARATION_REASON_KEY = 'separationReason';

// Every entry here MUST already be confirmed safe (field names, ids,
// small governed counts, or a fixed-vocabulary enum string) by direct
// source trace before being added — never guessed.
const AUDIT_METADATA_ALLOWLIST: Partial<Record<AuditEventType, readonly string[]>> = {
  [AuditEventType.RECRUITING_APPLICATION_STATUS_CHANGED]: ['updatedFields'],
  [AuditEventType.RECRUITING_CANDIDATE_UPDATED]: ['updatedFields'],
  [AuditEventType.RECRUITING_INTERVIEW_UPDATED]: ['interviewId', 'fieldsChanged'],
  [AuditEventType.RECRUITING_OFFER_UPDATED]: ['offerId', 'applicationId', 'fieldsChanged'],
  [AuditEventType.WORKFORCE_CERTIFICATION_UPDATED]: ['certificationId', 'updatedFields'],
  [AuditEventType.WORKFORCE_EMPLOYEE_UPDATED]: ['updatedFields'],
  [AuditEventType.WORKFORCE_SKILL_UPDATED]: ['updatedFields'],

  // M37 elevation-session events (GD-M37-1) — small, non-PII counts/ids
  // only, confirmed by direct source trace of elevation-session.service.ts.
  [AuditEventType.ELEVATION_SESSION_REQUESTED]: ['granteeUserId', 'capabilityCount'],
  [AuditEventType.ELEVATION_SESSION_CAPABILITY_DECIDED]: ['decidedCount'],
  [AuditEventType.ELEVATION_SESSION_ACTIVATION_FAILED]: ['reason'],

  // M39's own new event types carry only ids already surfaced as
  // entityType/entityId — no additional metadata is ever written for
  // these, so their allowlist is deliberately empty rather than absent
  // (absent would return null identically, but an explicit empty array
  // documents that this was a considered decision, not an oversight).
  [AuditEventType.AUDIT_LOG_QUERIED]: [],
  [AuditEventType.AUDIT_WRITE_RECOVERY_SUCCEEDED]: [],
  [AuditEventType.AUDIT_WRITE_RECOVERY_ABANDONED]: [],
  [AuditEventType.AUDIT_WRITE_RECOVERY_REQUEUED]: [],
  [AuditEventType.AUDIT_CHAIN_VERIFICATION_FAILED]: [],
  [AuditEventType.AUDIT_CHAIN_REVERIFICATION_REQUESTED]: [],
};

// Returns null when the event type is unlisted (fail closed — never a raw
// passthrough) or when metadata is absent/not an object, or when none of
// the allowed keys are present. Never returns separationReason under any
// circumstance, regardless of what is (mis)configured above.
export function filterAuditEventMetadata(
  action: string,
  metadata: unknown,
): Record<string, unknown> | null {
  const allowedKeys = AUDIT_METADATA_ALLOWLIST[action as AuditEventType];
  if (!allowedKeys || allowedKeys.length === 0) {
    return null;
  }
  if (metadata === null || metadata === undefined || typeof metadata !== 'object') {
    return null;
  }

  const record = metadata as Record<string, unknown>;
  const filtered: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (key === SEPARATION_REASON_KEY) continue; // defense in depth, never reachable via the table above
    if (key in record) {
      filtered[key] = record[key];
    }
  }

  return Object.keys(filtered).length > 0 ? filtered : null;
}
