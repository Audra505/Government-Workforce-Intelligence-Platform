// Employment status indicator — 6px dot + label (M21C, GD-M21-1 D10).
// Replaces pill badge; used in employee-table.tsx, employee-detail.tsx, position-detail.tsx.
// GD-M12-1: canonical states PENDING_ONBOARDING, ACTIVE, ON_LEAVE, SUSPENDED, SEPARATED.
// Reference: directives/13_employee_management_rules.md

import { StatusDot } from '@/components/shared/status-dot';
import type { StatusDotColor } from '@/components/shared/status-dot';
import type { EmploymentStatus } from '@/features/workforce/types';

const STATUS_DOT: Record<EmploymentStatus, { color: StatusDotColor; label: string }> = {
  PENDING_ONBOARDING: { color: 'yellow', label: 'Pending Onboarding' },
  ACTIVE:             { color: 'green',  label: 'Active' },
  ON_LEAVE:           { color: 'blue',   label: 'On Leave' },
  SUSPENDED:          { color: 'orange', label: 'Suspended' },
  SEPARATED:          { color: 'gray',   label: 'Separated' },
};

export function EmploymentStatusDot({ status }: { status: EmploymentStatus }) {
  const { color, label } = STATUS_DOT[status];
  return <StatusDot color={color} label={label} />;
}
