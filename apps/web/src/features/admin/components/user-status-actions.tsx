'use client';

// Status action buttons for /admin/users/[id] detail page.
// Issues PATCH /api/users/[id] with { status } for governance-approved transitions.
// INVITED users: read-only note — INVITED lifecycle is managed by NotificationModule (not built).
// Buttons rendered are conditional on current user status (D11 action matrix).
// HRD boundary enforced by the calling server component — this component renders as-given.
// Reference: governance/GD-M27-1.md — Decision 11

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { UpdateUserBffResponse, UserStatus } from '@/features/admin/types';

type ActionTarget = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

type Action = {
  label: string;
  target: ActionTarget;
  borderColor: string;
  color: string;
  hoverClass: string;
};

type Props = {
  userId: string;
  currentStatus: UserStatus;
};

const BASE_BTN =
  'rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60';

const ACTIONS: Record<Exclude<UserStatus, 'INVITED'>, Action[]> = {
  ACTIVE: [
    { label: 'Suspend',    target: 'SUSPENDED',   borderColor: '#d97706', color: '#b45309', hoverClass: 'hover:bg-amber-50' },
    { label: 'Deactivate', target: 'DEACTIVATED', borderColor: '#dc2626', color: '#dc2626', hoverClass: 'hover:bg-red-50'   },
  ],
  SUSPENDED: [
    { label: 'Reactivate', target: 'ACTIVE',      borderColor: '#16a34a', color: '#16a34a', hoverClass: 'hover:bg-green-50' },
    { label: 'Deactivate', target: 'DEACTIVATED', borderColor: '#dc2626', color: '#dc2626', hoverClass: 'hover:bg-red-50'   },
  ],
  DEACTIVATED: [
    { label: 'Reactivate', target: 'ACTIVE',      borderColor: '#16a34a', color: '#16a34a', hoverClass: 'hover:bg-green-50' },
  ],
};

const STATUS_ERROR_MESSAGES: Record<string, string> = {
  LAST_SYSTEM_ADMINISTRATOR: 'Cannot modify the last active System Administrator in this tenant.',
  INVALID_STATUS_TRANSITION: 'This status change is not permitted.',
  FORBIDDEN_USER_MANAGEMENT: 'You do not have permission to manage this user.',
};

export function UserStatusActions({ userId, currentStatus }: Props) {
  const router = useRouter();
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<ActionTarget | null>(null);

  if (currentStatus === 'INVITED') {
    return (
      <p className="text-sm" style={{ color: '#475569' }}>
        This user has a pending invitation. Status changes are not available until the invitation flow is complete.
      </p>
    );
  }

  const actions = ACTIONS[currentStatus];

  async function applyStatusChange(target: ActionTarget) {
    setActionError(null);
    setPending(target);

    let res: Response;
    try {
      res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: target }),
      });
    } catch {
      setActionError('Unable to reach the server. Please try again.');
      setPending(null);
      return;
    }

    const json = (await res.json()) as UpdateUserBffResponse;
    setPending(null);

    if (json.success) {
      router.refresh();
    } else {
      setActionError(
        STATUS_ERROR_MESSAGES[json.error.code] ??
          json.error.message ??
          'An unexpected error occurred.',
      );
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action.target}
            type="button"
            disabled={pending !== null}
            onClick={() => void applyStatusChange(action.target)}
            className={`${BASE_BTN} ${action.hoverClass}`}
            style={{ borderColor: action.borderColor, color: action.color }}
          >
            {pending === action.target ? `${action.label}ing…` : action.label}
          </button>
        ))}
      </div>
      {actionError && (
        <p className="text-sm" style={{ color: '#dc2626' }} role="alert">
          {actionError}
        </p>
      )}
    </div>
  );
}
