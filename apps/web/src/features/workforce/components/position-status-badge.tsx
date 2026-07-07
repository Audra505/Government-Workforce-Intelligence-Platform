// Position lifecycle status indicator — pill variant for list tables (M23 visual refinement).
// Export name PositionStatusDot retained for backward compatibility.
// Authority: directives/02_position_management_rules.md — POS-001 canonical states

import { StatusPill } from '@/components/shared/status-pill';
import type { StatusPillColor } from '@/components/shared/status-pill';
import type { PositionStatus } from '@/features/workforce/types';

const STATUS_PILL: Record<PositionStatus, { color: StatusPillColor; label: string }> = {
  DRAFT:  { color: 'gray',  label: 'Draft' },
  ACTIVE: { color: 'green', label: 'Active' },
  FROZEN: { color: 'blue',  label: 'Frozen' },
  CLOSED: { color: 'gray',  label: 'Closed' },
};

export function PositionStatusDot({ status }: { status: PositionStatus }) {
  const { color, label } = STATUS_PILL[status];
  return <StatusPill color={color} label={label} />;
}
