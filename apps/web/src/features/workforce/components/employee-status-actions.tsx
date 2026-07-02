'use client';

// Status change actions for the Employee Detail page.
// M21C: toast feedback added for successful status change.
// GD-M12-1: allowed transitions derived client-side from current status.
// EMP-302: SEPARATED is terminal — no modal rendered; parent hides this component.
// GD-M12-S4-1: canWrite = SA + HR Director only (same predicate as vacancy canWrite).
// NestJS is the authoritative RBAC and lifecycle enforcer; canWrite is UX-only.
// On success: close modal, reset loading, call router.refresh() — same pattern as VacancyActions.
// Reference: directives/13_employee_management_rules.md — GD-M12-1, EMP-302, EMP-AUTH-005

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { EmploymentStatus } from '@/features/workforce/types';
import { useToast, ToastContainer } from '@/components/shared/toast';

// ---------------------------------------------------------------------------
// GD-M12-1: allowed transitions map
// ---------------------------------------------------------------------------

const NEXT_STATES: Record<EmploymentStatus, EmploymentStatus[]> = {
  PENDING_ONBOARDING: ['ACTIVE'],
  ACTIVE:             ['ON_LEAVE', 'SUSPENDED', 'SEPARATED'],
  ON_LEAVE:           ['ACTIVE'],
  SUSPENDED:          ['ACTIVE'],
  SEPARATED:          [],
};

const STATUS_LABELS: Record<EmploymentStatus, string> = {
  PENDING_ONBOARDING: 'Pending Onboarding',
  ACTIVE:             'Active',
  ON_LEAVE:           'On Leave',
  SUSPENDED:          'Suspended',
  SEPARATED:          'Separated',
};

// Separation reasons — authority: directives/13_employee_management_rules.md
const SEPARATION_REASONS = [
  { value: 'TERMINATION',   label: 'Termination' },
  { value: 'RETIREMENT',    label: 'Retirement' },
  { value: 'RESIGNATION',   label: 'Resignation' },
  { value: 'TRANSFER_OUT',  label: 'Transfer Out' },
] as const;

type SeparationReason = 'TERMINATION' | 'RETIREMENT' | 'RESIGNATION' | 'TRANSFER_OUT';

// ---------------------------------------------------------------------------
// Error message map
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_TRANSITION:            'This status change is not allowed from the current state.',
  EMPLOYEE_IS_SEPARATED:         'This employee is separated and cannot be modified.',
  TERMINATION_BEFORE_HIRE_DATE:  'Employee cannot be separated before their hire date.',
  NOT_FOUND:                     'This employee record could not be found.',
  FORBIDDEN:                     "You don't have permission to change employee status.",
  UNAUTHORIZED:                  'Session expired. Please sign in again.',
  INTERNAL_ERROR:                'Service unavailable. Please try again.',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  id: string;
  currentStatus: EmploymentStatus;
  canWrite: boolean;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EmployeeStatusActions({ id, currentStatus, canWrite }: Props) {
  const router = useRouter();
  const { toasts, addToast, dismissToast } = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<EmploymentStatus | ''>('');
  const [separationReason, setSeparationReason] = useState<SeparationReason | ''>('');

  const nextStates = NEXT_STATES[currentStatus];

  // No write actions for read-only roles (GD-M12-S4-1) or SEPARATED (EMP-302: terminal).
  if (!canWrite || nextStates.length === 0) return null;

  const targetIsSeparated = selectedStatus === 'SEPARATED';

  function openModal() {
    setSelectedStatus(nextStates.length === 1 ? nextStates[0]! : '');
    setSeparationReason('');
    setError(null);
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setError(null);
  }

  async function handleStatusChange() {
    if (!selectedStatus) return;
    if (targetIsSeparated && !separationReason) {
      setError('Please select a separation reason.');
      return;
    }

    setIsLoading(true);
    setError(null);

    const body: Record<string, string> = { status: selectedStatus };
    if (targetIsSeparated && separationReason) {
      body.separationReason = separationReason;
    }

    try {
      const res = await fetch(`/api/employees/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setIsModalOpen(false);
        setIsLoading(false);
        addToast({
          type: 'success',
          title: 'Status updated',
          message: `Employee status changed to ${STATUS_LABELS[selectedStatus as EmploymentStatus]}`,
        });
        router.refresh();
        return;
      }

      let errorCode = 'INTERNAL_ERROR';
      try {
        const data = (await res.json()) as { success: false; error?: { code: string } };
        if (data.error?.code) errorCode = data.error.code;
      } catch {
        // Use default
      }

      setError(ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.INTERNAL_ERROR);
      setIsLoading(false);
    } catch {
      setError('Unable to reach the server. Please check your connection.');
      setIsLoading(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={openModal}>
        Change Status
      </Button>

      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="status-modal-title"
        >
          <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
            <h3 id="status-modal-title" className="text-lg font-semibold">
              Change Employment Status
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Current status:{' '}
              <span className="font-medium">{STATUS_LABELS[currentStatus]}</span>
            </p>

            {/* Status selection — dropdown when multiple options; static text when only one */}
            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium">New Status</p>
              {nextStates.length === 1 ? (
                <p className="rounded-md border border-input bg-muted/50 px-3 py-2 text-sm">
                  {STATUS_LABELS[nextStates[0]!]}
                </p>
              ) : (
                <select
                  id="targetStatus"
                  value={selectedStatus}
                  onChange={(e) => {
                    setSelectedStatus(e.target.value as EmploymentStatus);
                    setSeparationReason('');
                    setError(null);
                  }}
                  disabled={isLoading}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select a status...</option>
                  {nextStates.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Separation reason — shown only when target is SEPARATED */}
            {targetIsSeparated && (
              <div className="mt-4 space-y-2">
                <label
                  htmlFor="separationReason"
                  className="text-sm font-medium"
                >
                  Separation Reason{' '}
                  <span aria-hidden="true" className="text-destructive">*</span>
                </label>
                <select
                  id="separationReason"
                  value={separationReason}
                  onChange={(e) => setSeparationReason(e.target.value as SeparationReason)}
                  disabled={isLoading}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select a reason...</option>
                  {SEPARATION_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {error && (
              <p role="alert" className="mt-3 text-sm font-medium text-destructive">
                {error}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={isLoading}
                onClick={closeModal}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={isLoading || !selectedStatus || (targetIsSeparated && !separationReason)}
                onClick={handleStatusChange}
              >
                {isLoading ? 'Saving…' : 'Confirm Change'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
