// Status badge for EmploymentStatus values.
// GD-M12-1: canonical states are PENDING_ONBOARDING, ACTIVE, ON_LEAVE, SUSPENDED, SEPARATED.
// Server Component — no interactivity required.
// Reference: directives/13_employee_management_rules.md — GD-M12-1

import type { EmploymentStatus } from '@/features/workforce/types';

const STATUS_CLASSES: Record<EmploymentStatus, string> = {
  PENDING_ONBOARDING: 'bg-amber-100 text-amber-700',
  ACTIVE:             'bg-green-100 text-green-700',
  ON_LEAVE:           'bg-blue-100 text-blue-700',
  SUSPENDED:          'bg-orange-100 text-orange-700',
  SEPARATED:          'bg-gray-100 text-gray-500',
};

const STATUS_LABELS: Record<EmploymentStatus, string> = {
  PENDING_ONBOARDING: 'Pending Onboarding',
  ACTIVE:             'Active',
  ON_LEAVE:           'On Leave',
  SUSPENDED:          'Suspended',
  SEPARATED:          'Separated',
};

export function EmploymentStatusBadge({ status }: { status: EmploymentStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
