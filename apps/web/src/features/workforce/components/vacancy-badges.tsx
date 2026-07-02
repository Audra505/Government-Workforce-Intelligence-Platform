// Shared badge and cell components for vacancy status, priority, and aging display.
// VacancyStatusDot replaces StatusBadge (M21C, GD-M21-1 D10).
// PriorityBadge and AgingCell retain pill/text format — explicit exception per GD-M21-1 D10.
// Reference: directives/03_vacancy_management_rules.md
//   VAC-200: priority values LOW/MEDIUM/HIGH/CRITICAL
//   VAC-601: requiresReview = CRITICAL + OPEN vacancies
//   VAC-701: WARNING agingStatus threshold (≥30 days)
//   VAC-702: HIGH_RISK agingStatus threshold (≥90 days)

import { StatusDot } from '@/components/shared/status-dot';
import type { StatusDotColor } from '@/components/shared/status-dot';
import type { AgingStatus, VacancyPriority, VacancyStatus } from '@/features/workforce/types';

// ---------------------------------------------------------------------------
// VacancyStatusDot
// ---------------------------------------------------------------------------

const VACANCY_STATUS_DOT: Record<VacancyStatus, { color: StatusDotColor; label: string }> = {
  DRAFT:          { color: 'gray',   label: 'Draft' },
  OPEN:           { color: 'blue',   label: 'Open' },
  IN_RECRUITMENT: { color: 'yellow', label: 'In Recruitment' },
  CLOSED:         { color: 'gray',   label: 'Closed' },
};

export function VacancyStatusDot({ status }: { status: VacancyStatus }) {
  const { color, label } = VACANCY_STATUS_DOT[status];
  return <StatusDot color={color} label={label} />;
}

// ---------------------------------------------------------------------------
// PriorityBadge — retained as pill (GD-M21-1 D10)
// ---------------------------------------------------------------------------

const PRIORITY_CLASSES: Record<VacancyPriority, string> = {
  LOW:      'bg-gray-100 text-gray-600',
  MEDIUM:   'bg-blue-100 text-blue-700',
  HIGH:     'bg-amber-100 text-amber-700',
  CRITICAL: 'bg-red-100 text-red-700',
};

const PRIORITY_LABELS: Record<VacancyPriority, string> = {
  LOW:      'Low',
  MEDIUM:   'Medium',
  HIGH:     'High',
  CRITICAL: 'Critical',
};

export function PriorityBadge({ priority }: { priority: VacancyPriority }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${PRIORITY_CLASSES[priority]}`}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// AgingCell — retained as text with severity (GD-M21-1 D10)
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
