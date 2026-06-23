// Status badge for Position lifecycle states.
// Authority: directives/02_position_management_rules.md — POS-001 canonical states
// state/01_position_lifecycle.md — 4-state lifecycle DRAFT/ACTIVE/FROZEN/CLOSED

import type { PositionStatus } from '@/features/workforce/types';

const STATUS_CLASSES: Record<PositionStatus, string> = {
  DRAFT:  'bg-gray-100 text-gray-700',
  ACTIVE: 'bg-green-100 text-green-700',
  FROZEN: 'bg-blue-100 text-blue-700',
  CLOSED: 'bg-slate-100 text-slate-600',
};

const STATUS_LABELS: Record<PositionStatus, string> = {
  DRAFT:  'Draft',
  ACTIVE: 'Active',
  FROZEN: 'Frozen',
  CLOSED: 'Closed',
};

export function PositionStatusBadge({ status }: { status: PositionStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
