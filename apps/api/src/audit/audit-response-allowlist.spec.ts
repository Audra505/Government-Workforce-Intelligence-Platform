// Reference: governance/GD-M39-1.md — Decision 18 (Metadata and PII Controls)

import { filterAuditEventMetadata } from './audit-response-allowlist';
import { AuditEventType } from './enums/audit-event-type.enum';

describe('filterAuditEventMetadata', () => {
  it('returns null for an event type not present in the allowlist (fail closed)', () => {
    expect(filterAuditEventMetadata('SOME_UNKNOWN_ACTION', { a: 1 })).toBeNull();
  });

  it('returns null for an event type whose allowlist is an explicit empty array', () => {
    expect(
      filterAuditEventMetadata(AuditEventType.AUDIT_LOG_QUERIED, { anything: 'here' }),
    ).toBeNull();
  });

  it('returns null when metadata is null', () => {
    expect(
      filterAuditEventMetadata(AuditEventType.WORKFORCE_EMPLOYEE_UPDATED, null),
    ).toBeNull();
  });

  it('returns null when metadata is undefined', () => {
    expect(
      filterAuditEventMetadata(AuditEventType.WORKFORCE_EMPLOYEE_UPDATED, undefined),
    ).toBeNull();
  });

  it('returns null when metadata is not an object', () => {
    expect(filterAuditEventMetadata(AuditEventType.WORKFORCE_EMPLOYEE_UPDATED, 'x')).toBeNull();
  });

  it('returns only the allowlisted keys for a known event type', () => {
    const result = filterAuditEventMetadata(AuditEventType.WORKFORCE_EMPLOYEE_UPDATED, {
      updatedFields: ['firstName', 'lastName'],
      secretInternalNote: 'should never appear',
    });
    expect(result).toEqual({ updatedFields: ['firstName', 'lastName'] });
  });

  it('omits an allowlisted key that is absent from the stored metadata', () => {
    const result = filterAuditEventMetadata(AuditEventType.RECRUITING_OFFER_UPDATED, {
      offerId: 'x',
    });
    expect(result).toEqual({ offerId: 'x' });
    expect(result).not.toHaveProperty('fieldsChanged');
  });

  it('returns null when none of the allowlisted keys are present', () => {
    const result = filterAuditEventMetadata(AuditEventType.WORKFORCE_EMPLOYEE_UPDATED, {
      unrelatedKey: 'value',
    });
    expect(result).toBeNull();
  });

  it('never returns separationReason, even if present in stored metadata for WORKFORCE_EMPLOYEE_SEPARATED', () => {
    const result = filterAuditEventMetadata(AuditEventType.WORKFORCE_EMPLOYEE_SEPARATED, {
      separationReason: 'a free-form, potentially sensitive string',
    });
    expect(result).toBeNull();
  });

  it('never returns separationReason under any event type, even if a caller tried to sneak it into a listed key set', () => {
    const result = filterAuditEventMetadata(AuditEventType.WORKFORCE_EMPLOYEE_UPDATED, {
      updatedFields: ['a'],
      separationReason: 'should never leak here either',
    });
    expect(result).toEqual({ updatedFields: ['a'] });
    expect(result).not.toHaveProperty('separationReason');
  });

  // GD-M39-1 Decision 18 / Phase 9 validation requirement — enumerate
  // every one of the 128 governed AuditEventType values and prove the
  // allowlist is fail-closed for the ones that were never explicitly
  // reasoned about (only the 10 explicitly allowlisted types below may
  // ever return non-null metadata for arbitrary probe input).
  describe('fail-closed across all 128 governed event types', () => {
    const EXPLICITLY_ALLOWLISTED_TYPES = new Set<string>([
      AuditEventType.RECRUITING_APPLICATION_STATUS_CHANGED,
      AuditEventType.RECRUITING_CANDIDATE_UPDATED,
      AuditEventType.RECRUITING_INTERVIEW_UPDATED,
      AuditEventType.RECRUITING_OFFER_UPDATED,
      AuditEventType.WORKFORCE_CERTIFICATION_UPDATED,
      AuditEventType.WORKFORCE_EMPLOYEE_UPDATED,
      AuditEventType.WORKFORCE_SKILL_UPDATED,
      AuditEventType.ELEVATION_SESSION_REQUESTED,
      AuditEventType.ELEVATION_SESSION_CAPABILITY_DECIDED,
      AuditEventType.ELEVATION_SESSION_ACTIVATION_FAILED,
    ]);

    const allEventTypes = Object.values(AuditEventType);

    it('AuditEventType has exactly 128 values (122 pre-M39 + 6 new)', () => {
      expect(allEventTypes).toHaveLength(128);
    });

    it.each(allEventTypes.map((t) => [t] as const))(
      '%s: an arbitrary probe key never survives unless explicitly allowlisted',
      (eventType) => {
        const probe = { arbitraryProbeKey: 'should never leak', separationReason: 'never' };
        const result = filterAuditEventMetadata(eventType, probe);

        if (!EXPLICITLY_ALLOWLISTED_TYPES.has(eventType)) {
          expect(result).toBeNull();
        } else if (result !== null) {
          // Even for allowlisted types, an unlisted probe key must never
          // appear — only this event type's own specific allowed keys can.
          expect(result).not.toHaveProperty('arbitraryProbeKey');
          expect(result).not.toHaveProperty('separationReason');
        }
      },
    );
  });
});
