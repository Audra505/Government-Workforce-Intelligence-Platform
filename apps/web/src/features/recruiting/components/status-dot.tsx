// Recruiting status dot convenience wrappers.
// The StatusDot primitive has moved to @/components/shared/status-dot (GD-M21-1 D14).
// This file re-exports StatusDot and wraps it with Recruiting-specific status mappings.
// All existing imports of CandidateStatusDot, ApplicationStatusDot, etc. from this path
// continue to work without change.
// Reference: governance/GD-M21-1.md — Decision 14
// Reference: governance/GD-M20-1.md — Decision 16

import type { CandidateStatus, ApplicationStatus, InterviewStatus, OfferStatus } from '@/features/recruiting/types';
import { StatusDot } from '@/components/shared/status-dot';

export type { StatusDotColor } from '@/components/shared/status-dot';
export { StatusDot };

// ---------------------------------------------------------------------------
// Candidate status convenience component
// ---------------------------------------------------------------------------

export function CandidateStatusDot({ status }: { status: CandidateStatus }) {
  if (status === 'ACTIVE') return <StatusDot color="green" label="Active" />;
  return <StatusDot color="gray" label="Archived" />;
}

// ---------------------------------------------------------------------------
// Application status convenience component (GD-M20-1 D7)
// APPLIED / SCREENING → blue   INTERVIEW / EVALUATION → yellow
// OFFER / HIRED → green        REJECTED → red   WITHDRAWN → gray
// ---------------------------------------------------------------------------

export function ApplicationStatusDot({ status }: { status: ApplicationStatus }) {
  switch (status) {
    case 'APPLIED':    return <StatusDot color="blue"   label="Applied" />;
    case 'SCREENING':  return <StatusDot color="blue"   label="Under Review" />;
    case 'INTERVIEW':  return <StatusDot color="yellow" label="Interview" />;
    case 'EVALUATION': return <StatusDot color="yellow" label="Evaluation" />;
    case 'OFFER':      return <StatusDot color="green"  label="Offer" />;
    case 'HIRED':      return <StatusDot color="green"  label="Hired" />;
    case 'REJECTED':   return <StatusDot color="red"    label="Rejected" />;
    case 'WITHDRAWN':  return <StatusDot color="gray"   label="Withdrawn" />;
  }
}

// ---------------------------------------------------------------------------
// Interview status convenience component (GD-M20-1 D7)
// SCHEDULED → blue   COMPLETED → green   CANCELLED → grey   NO_SHOW → red
// ---------------------------------------------------------------------------

export function InterviewStatusDot({ status }: { status: InterviewStatus }) {
  switch (status) {
    case 'SCHEDULED':  return <StatusDot color="blue"  label="Scheduled" />;
    case 'COMPLETED':  return <StatusDot color="green" label="Completed" />;
    case 'CANCELLED':  return <StatusDot color="gray"  label="Cancelled" />;
    case 'NO_SHOW':    return <StatusDot color="red"   label="No Show" />;
  }
}

// ---------------------------------------------------------------------------
// Offer status convenience component (GD-M20-1 D7)
// DRAFT → grey   PENDING_APPROVAL → yellow   APPROVED/SENT → blue
// ACCEPTED → green   DECLINED → red   WITHDRAWN → grey
// ---------------------------------------------------------------------------

export function OfferStatusDot({ status }: { status: OfferStatus }) {
  switch (status) {
    case 'DRAFT':             return <StatusDot color="gray"   label="Draft" />;
    case 'PENDING_APPROVAL':  return <StatusDot color="yellow" label="Pending Approval" />;
    case 'APPROVED':          return <StatusDot color="blue"   label="Approved" />;
    case 'SENT':              return <StatusDot color="blue"   label="Sent" />;
    case 'ACCEPTED':          return <StatusDot color="green"  label="Accepted" />;
    case 'DECLINED':          return <StatusDot color="red"    label="Declined" />;
    case 'WITHDRAWN':         return <StatusDot color="gray"   label="Withdrawn" />;
  }
}
