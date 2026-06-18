// Shared badge and cell components for vacancy status, priority, and aging display.
// Extracted from vacancy-table.tsx (Step 11) for reuse in vacancy-detail.tsx.
// Reference: directives/03_vacancy_management_rules.md
//   VAC-200: priority values LOW/MEDIUM/HIGH/CRITICAL
//   VAC-601: requiresReview = CRITICAL + OPEN vacancies
//   VAC-701: WARNING agingStatus threshold (≥30 days)
//   VAC-702: HIGH_RISK agingStatus threshold (≥90 days)

import type { AgingStatus, VacancyPriority, VacancyStatus } from '@/features/workforce/types';

// ---------------------------------------------------------------------------
// StatusBadge
// ---------------------------------------------------------------------------

const STATUS_CLASSES: Record<VacancyStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  OPEN: 'bg-blue-100 text-blue-700',
  IN_RECRUITMENT: 'bg-amber-100 text-amber-700',
  CLOSED: 'bg-slate-100 text-slate-600',
};

const STATUS_LABELS: Record<VacancyStatus, string> = {
  DRAFT: 'Draft',
  OPEN: 'Open',
  IN_RECRUITMENT: 'In Recruitment',
  CLOSED: 'Closed',
};

export function StatusBadge({ status }: { status: VacancyStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// PriorityBadge
// ---------------------------------------------------------------------------

const PRIORITY_CLASSES: Record<VacancyPriority, string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-blue-100 text-blue-700',
  HIGH: 'bg-amber-100 text-amber-700',
  CRITICAL: 'bg-red-100 text-red-700',
};

const PRIORITY_LABELS: Record<VacancyPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
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
// AgingCell
// ---------------------------------------------------------------------------

const AGING_TEXT_CLASSES: Record<AgingStatus, string> = {
  OK: 'text-muted-foreground',
  WARNING: 'font-medium text-amber-600',
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
