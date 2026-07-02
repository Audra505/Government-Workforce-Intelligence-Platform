// Position lifecycle status indicator — 6px dot + label (M21C, GD-M21-1 D10).
// Replaces pill badge; used in position-table.tsx and position-detail.tsx.
// Authority: directives/02_position_management_rules.md — POS-001 canonical states

import { StatusDot } from '@/components/shared/status-dot';
import type { StatusDotColor } from '@/components/shared/status-dot';
import type { PositionStatus } from '@/features/workforce/types';

const STATUS_DOT: Record<PositionStatus, { color: StatusDotColor; label: string }> = {
  DRAFT:  { color: 'gray',  label: 'Draft' },
  ACTIVE: { color: 'green', label: 'Active' },
  FROZEN: { color: 'blue',  label: 'Frozen' },
  CLOSED: { color: 'gray',  label: 'Closed' },
};

export function PositionStatusDot({ status }: { status: PositionStatus }) {
  const { color, label } = STATUS_DOT[status];
  return <StatusDot color={color} label={label} />;
}
