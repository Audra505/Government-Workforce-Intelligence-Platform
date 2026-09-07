// Response shapes for the M39 audit-read/recovery/integrity surface.
// Reference: governance/GD-M39-1.md — Decision 16 (five endpoints), Decision
// 17 (list/detail shape), Decision 20 (viewer)

export interface AuditEventSummary {
  id: string;
  tenantId: string;
  actorUserId: string;
  actorDisplayName: string | null;
  action: string;
  result: string;
  entityType: string | null;
  entityId: string | null;
  occurredAt: string;
  createdAt: string;
  recordedLate: boolean;
  metadata: Record<string, unknown> | null;
}

export interface AuditEventListApiResponse {
  success: true;
  data: { events: AuditEventSummary[]; nextCursor: string | null };
}

export interface AuditEventDetailApiResponse {
  success: true;
  data: AuditEventSummary;
}

export interface RecoveryStatusSummary {
  counts: { pending: number; inProgress: number; abandoned: number; retried: number };
  abandonedFailures: Array<{
    id: string;
    action: string;
    entityType: string | null;
    entityId: string | null;
    occurredAt: string;
    attemptCount: number;
    failureReason: string;
  }>;
  chain: {
    status: 'OK' | 'BROKEN' | 'UNVERIFIED';
    lastVerifiedAt: string | null;
    nextVerificationAt: string | null;
  };
}

export interface RecoveryStatusApiResponse {
  success: true;
  data: RecoveryStatusSummary;
}

export type AuditMutationBffResponse =
  | { success: true; data: Record<string, unknown> }
  | { success: false; error: { code: string; message: string } };
