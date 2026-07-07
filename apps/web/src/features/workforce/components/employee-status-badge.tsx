// Employment status indicator — pill variant for list tables (M23 visual refinement).
// Export name EmploymentStatusDot retained for backward compatibility with
// employee-detail.tsx, position-detail.tsx, and other consumers.
// GD-M12-1: canonical states PENDING_ONBOARDING, ACTIVE, ON_LEAVE, SUSPENDED, SEPARATED.
// Reference: directives/13_employee_management_rules.md

import { StatusPill } from '@/components/shared/status-pill';
import type { StatusPillColor } from '@/components/shared/status-pill';
import type { EmploymentStatus } from '@/features/workforce/types';

const STATUS_PILL: Record<EmploymentStatus, { color: StatusPillColor; label: string }> = {
  PENDING_ONBOARDING: { color: 'yellow', label: 'Pending Onboarding' },
  ACTIVE:             { color: 'green',  label: 'Active' },
  ON_LEAVE:           { color: 'blue',   label: 'On Leave' },
  SUSPENDED:          { color: 'orange', label: 'Suspended' },
  SEPARATED:          { color: 'gray',   label: 'Separated' },
};

export function EmploymentStatusDot({ status }: { status: EmploymentStatus }) {
  const { color, label } = STATUS_PILL[status];
  return <StatusPill color={color} label={label} />;
}
