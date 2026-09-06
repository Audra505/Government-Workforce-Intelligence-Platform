// Governance authority: governance/GD-M38-1.md Decision 6 / Decision 10.
//
// Internal, deterministic, fail-closed subject resolver. Supports ONLY the
// governed DecisionCaseSubjectType values. No HTTP surface, no generic
// subject API — this module is imported only by DecisionCaseService and
// EvidenceItem-attachment logic (which reuses the same enum for
// EvidenceItem.sourceType per Decision 14). Never creates a database copy
// of a referenced subject; only verifies existence + tenant ownership.

import { DecisionCaseSubjectType } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export class SubjectNotFoundViolation extends Error {
  constructor(
    public readonly subjectType: DecisionCaseSubjectType,
    public readonly subjectId: string,
  ) {
    super('SUBJECT_NOT_FOUND');
  }
}

// Covers both "GENERAL must have a null id" and "non-GENERAL must have a
// non-null id" (GD-M38-1 Decision 6) and any subject type this resolver does
// not explicitly support — fails closed rather than silently accepting an
// unsupported or malformed reference.
export class InvalidSubjectReferenceViolation extends Error {
  constructor(public readonly reason: string) {
    super('INVALID_SUBJECT_REFERENCE');
  }
}

// Verifies a (subjectType, subjectId) pair against real, tenant-owned
// records. Reused identically for EvidenceItem.sourceType/sourceId (the
// enum, and this resolver, are explicitly shared per Decision 14).
export async function assertGovernedSubjectExists(
  tx: Prisma.TransactionClient,
  tenantId: string,
  subjectType: DecisionCaseSubjectType,
  subjectId: string | null,
): Promise<void> {
  if (subjectType === DecisionCaseSubjectType.GENERAL) {
    if (subjectId !== null) {
      throw new InvalidSubjectReferenceViolation('GENERAL_SUBJECT_MUST_HAVE_NULL_ID');
    }
    return;
  }

  if (!subjectId) {
    throw new InvalidSubjectReferenceViolation('NON_GENERAL_SUBJECT_REQUIRES_ID');
  }

  switch (subjectType) {
    case DecisionCaseSubjectType.OFFER: {
      const row = await tx.offer.findFirst({ where: { id: subjectId, tenantId }, select: { id: true } });
      if (!row) throw new SubjectNotFoundViolation(subjectType, subjectId);
      return;
    }
    case DecisionCaseSubjectType.APPLICATION: {
      const row = await tx.application.findFirst({ where: { id: subjectId, tenantId }, select: { id: true } });
      if (!row) throw new SubjectNotFoundViolation(subjectType, subjectId);
      return;
    }
    case DecisionCaseSubjectType.EMPLOYEE: {
      const row = await tx.employee.findFirst({ where: { id: subjectId, tenantId }, select: { id: true } });
      if (!row) throw new SubjectNotFoundViolation(subjectType, subjectId);
      return;
    }
    case DecisionCaseSubjectType.ELEVATION_SESSION: {
      const row = await tx.elevationSession.findFirst({ where: { id: subjectId, tenantId }, select: { id: true } });
      if (!row) throw new SubjectNotFoundViolation(subjectType, subjectId);
      return;
    }
    default: {
      // Exhaustiveness guard — fails closed for any future enum value that
      // has not been explicitly wired into this resolver.
      const exhaustiveCheck: never = subjectType;
      throw new InvalidSubjectReferenceViolation(`UNSUPPORTED_SUBJECT_TYPE:${String(exhaustiveCheck)}`);
    }
  }
}

// GD-M38-1 Decision 15/18 — used by Tier 3 independence checks when the
// case subject (or an evidence source) is an ElevationSession: the
// grantee is the "beneficiary" a Tier 3 reviewer must differ from. Returns
// null for every other subject type (no beneficiary concept applies).
export async function resolveGovernedSubjectBeneficiaryUserId(
  tx: Prisma.TransactionClient,
  tenantId: string,
  subjectType: DecisionCaseSubjectType,
  subjectId: string | null,
): Promise<string | null> {
  if (subjectType === DecisionCaseSubjectType.ELEVATION_SESSION && subjectId) {
    const row = await tx.elevationSession.findFirst({
      where: { id: subjectId, tenantId },
      select: { granteeUserId: true },
    });
    return row?.granteeUserId ?? null;
  }
  return null;
}
