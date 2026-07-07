// Recruiting status convenience wrappers — pill variant per M23 visual refinement.
// Export names unchanged for backward compatibility with all existing consumers.
// StatusDot and StatusDotColor re-exported for any consumers that import them directly.
// Reference: governance/GD-M21-1.md — Decision 14
// Reference: governance/GD-M20-1.md — Decision 16

import type { CandidateStatus, ApplicationStatus, InterviewStatus, OfferStatus } from '@/features/recruiting/types';
import { StatusPill } from '@/components/shared/status-pill';

export type { StatusDotColor } from '@/components/shared/status-dot';
export { StatusDot } from '@/components/shared/status-dot';

// ---------------------------------------------------------------------------
// Candidate status
// ---------------------------------------------------------------------------

export function CandidateStatusDot({ status }: { status: CandidateStatus }) {
  if (status === 'ACTIVE') return <StatusPill color="green" label="Active" />;
  return <StatusPill color="gray" label="Archived" />;
}

// ---------------------------------------------------------------------------
// Application status (GD-M20-1 D7)
// APPLIED / SCREENING → blue   INTERVIEW / EVALUATION → yellow
// OFFER / HIRED → green        REJECTED → red   WITHDRAWN → gray
// ---------------------------------------------------------------------------

export function ApplicationStatusDot({ status }: { status: ApplicationStatus }) {
  switch (status) {
    case 'APPLIED':    return <StatusPill color="blue"   label="Applied" />;
    case 'SCREENING':  return <StatusPill color="blue"   label="Under Review" />;
    case 'INTERVIEW':  return <StatusPill color="yellow" label="Interview" />;
    case 'EVALUATION': return <StatusPill color="yellow" label="Evaluation" />;
    case 'OFFER':      return <StatusPill color="green"  label="Offer" />;
    case 'HIRED':      return <StatusPill color="green"  label="Hired" />;
    case 'REJECTED':   return <StatusPill color="red"    label="Rejected" />;
    case 'WITHDRAWN':  return <StatusPill color="gray"   label="Withdrawn" />;
  }
}

// ---------------------------------------------------------------------------
// Interview status (GD-M20-1 D7)
// SCHEDULED → blue   COMPLETED → green   CANCELLED → gray   NO_SHOW → red
// ---------------------------------------------------------------------------

export function InterviewStatusDot({ status }: { status: InterviewStatus }) {
  switch (status) {
    case 'SCHEDULED':  return <StatusPill color="blue"  label="Scheduled" />;
    case 'COMPLETED':  return <StatusPill color="green" label="Completed" />;
    case 'CANCELLED':  return <StatusPill color="gray"  label="Cancelled" />;
    case 'NO_SHOW':    return <StatusPill color="red"   label="No Show" />;
  }
}

// ---------------------------------------------------------------------------
// Offer status (GD-M20-1 D7)
// DRAFT → gray   PENDING_APPROVAL → yellow   APPROVED/SENT → blue
// ACCEPTED → green   DECLINED → red   WITHDRAWN → gray
// ---------------------------------------------------------------------------

export function OfferStatusDot({ status }: { status: OfferStatus }) {
  switch (status) {
    case 'DRAFT':             return <StatusPill color="gray"   label="Draft" />;
    case 'PENDING_APPROVAL':  return <StatusPill color="yellow" label="Pending Approval" />;
    case 'APPROVED':          return <StatusPill color="blue"   label="Approved" />;
    case 'SENT':              return <StatusPill color="blue"   label="Sent" />;
    case 'ACCEPTED':          return <StatusPill color="green"  label="Accepted" />;
    case 'DECLINED':          return <StatusPill color="red"    label="Declined" />;
    case 'WITHDRAWN':         return <StatusPill color="gray"   label="Withdrawn" />;
  }
}
