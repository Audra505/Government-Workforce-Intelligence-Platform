// Status dot + label indicator.
// GD-M20-1 Decision 16 — Mandatory format: 6px solid filled circle + space + label.
// Pill badges are explicitly prohibited for M20 recruiting pages.

import type { CandidateStatus, ApplicationStatus, InterviewStatus, OfferStatus } from '@/features/recruiting/types';

// Design system dot colors (GD-M20-1 D16)
const DOT_HEX: Record<string, string> = {
  green:  '#16a34a',
  yellow: '#ca8a04',
  blue:   '#2563eb',
  orange: '#ea580c',
  purple: '#7c3aed',
  red:    '#dc2626',
  gray:   '#64748b',
};

type StatusDotColor = keyof typeof DOT_HEX;

type StatusDotProps = {
  color: StatusDotColor;
  label: string;
};

export function StatusDot({ color, label }: StatusDotProps) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: '#0f172a', fontWeight: 500 }}>
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: DOT_HEX[color],
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
}

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
