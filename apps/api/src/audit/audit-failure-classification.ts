// Reference: governance/GD-M39-1.md — Decision 9 (AuditWriteFailure.failureReason,
// AuditWriteFailureAttempt.failureCategory: "sanitized, fixed vocabulary —
// never a raw DB driver error"), Decision 12 (WORKER_TIMEOUT)
//
// Single, shared, fixed-vocabulary classifier — reused by AuditService's
// dead-letter path and by the recovery worker's per-attempt failure
// handling, so the two never drift into inconsistent category names.

import { Prisma } from '@prisma/client';

export const AUDIT_FAILURE_CATEGORIES = {
  UNIQUE_CONSTRAINT_VIOLATION: 'UNIQUE_CONSTRAINT_VIOLATION',
  CONNECTION_ERROR: 'CONNECTION_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  // GD-M39-1 Decision 12 — the governed category for a crashed worker's
  // stale IN_PROGRESS claim, closed by claim-expiry logic.
  WORKER_TIMEOUT: 'WORKER_TIMEOUT',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type AuditFailureCategory =
  (typeof AUDIT_FAILURE_CATEGORIES)[keyof typeof AUDIT_FAILURE_CATEGORIES];

// Never returns, includes, or logs the original error's message/stack —
// callers that also want operator-visible detail must log the raw error
// themselves, separately, never persist it.
export function classifyAuditFailure(error: unknown): AuditFailureCategory {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return AUDIT_FAILURE_CATEGORIES.UNIQUE_CONSTRAINT_VIOLATION;
    }
    return AUDIT_FAILURE_CATEGORIES.DATABASE_ERROR;
  }
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return AUDIT_FAILURE_CATEGORIES.CONNECTION_ERROR;
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return AUDIT_FAILURE_CATEGORIES.DATABASE_ERROR;
  }
  return AUDIT_FAILURE_CATEGORIES.UNKNOWN_ERROR;
}
