// Shared badge and cell components for vacancy status, priority, and aging display.
// VacancyStatusDot: pill variant per M23 visual refinement; name retained for backward compat.
// PriorityBadge: outlined badge (4px radius, border-only) to stay visually distinct from
//   filled status pills — filled = lifecycle state, outlined = urgency attribute.
// AgingCell: unchanged.
// Reference: directives/03_vacancy_management_rules.md
//   VAC-200: priority values LOW/MEDIUM/HIGH/CRITICAL
//   VAC-601: requiresReview = CRITICAL + OPEN vacancies
//   VAC-701: WARNING agingStatus threshold (≥30 days)
//   VAC-702: HIGH_RISK agingStatus threshold (≥90 days)

import { StatusPill } from '@/components/shared/status-pill';
import type { StatusPillColor } from '@/components/shared/status-pill';
import type { AgingStatus, VacancyPriority, VacancyStatus } from '@/features/workforce/types';

// ---------------------------------------------------------------------------
// VacancyStatusDot (name retained; renders as filled pill)
// ---------------------------------------------------------------------------

const VACANCY_STATUS_PILL: Record<VacancyStatus, { color: StatusPillColor; label: string }> = {
  DRAFT:          { color: 'gray',   label: 'Draft' },
  OPEN:           { color: 'blue',   label: 'Open' },
  IN_RECRUITMENT: { color: 'yellow', label: 'In Recruitment' },
  CLOSED:         { color: 'gray',   label: 'Closed' },
};

export function VacancyStatusDot({ status }: { status: VacancyStatus }) {
  const { color, label } = VACANCY_STATUS_PILL[status];
  return <StatusPill color={color} label={label} />;
}

// ---------------------------------------------------------------------------
// PriorityBadge — plain colored text, no border, no background.
// Seamlessly distinct from filled status pills without adding visual weight.
// ---------------------------------------------------------------------------

const PRIORITY_COLOR: Record<VacancyPriority, string> = {
  LOW:      '#94a3b8',
  MEDIUM:   '#2563eb',
  HIGH:     '#d97706',
  CRITICAL: '#dc2626',
};

const PRIORITY_LABELS: Record<VacancyPriority, string> = {
  LOW:      'Low',
  MEDIUM:   'Medium',
  HIGH:     'High',
  CRITICAL: 'Critical',
};

export function PriorityBadge({ priority }: { priority: VacancyPriority }) {
  return (
    <span style={{ fontSize: 12, fontWeight: 500, color: PRIORITY_COLOR[priority], whiteSpace: 'nowrap' }}>
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// AgingCell — unchanged (GD-M21-1 D10)
// ---------------------------------------------------------------------------

const AGING_TEXT_CLASSES: Record<AgingStatus, string> = {
  OK:        'text-muted-foreground',
  WARNING:   'font-medium text-amber-600',
  HIGH_RISK: 'font-medium text-red-600',
};

export function AgingCell({
  ageInDays,
  agingStatus,
}: {
  ageInDays: number;
  agingStatus: AgingStatus;
}) {
  const suffix = agingStatus === 'HIGH_RISK' ? ' ⚠' : agingStatus === 'WARNING' ? ' ~' : '';
  return (
    <span className={AGING_TEXT_CLASSES[agingStatus]}>
      {ageInDays}d{suffix}
    </span>
  );
}
