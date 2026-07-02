'use client';

// Employee position assignment, reassignment, and clearance actions.
// Assign:    positionId=null    → select ACTIVE position → POST /api/employees/:id/assign-position
// Reassign:  positionId!=null   → select different ACTIVE position → same endpoint
// Clear:     positionId!=null, status=PENDING_ONBOARDING → { positionId: null } → same endpoint
//   Clear is restricted to PENDING_ONBOARDING per GD-M15-1 D6.
// canWrite: SA + HR Director only (GD-M15-1 D10). NestJS is the authoritative enforcer.
// On success: router.refresh() — Server Component re-fetches updated employee data.
// Reference: governance/GD-M15-1.md — Decision 5, 6, 9, 10
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-005

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { EmploymentStatus, PositionOption } from '@/features/workforce/types';

// ---------------------------------------------------------------------------
// Error message map — keyed by NestJS error code
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND:                              'Employee record could not be found.',
  EMPLOYEE_SEPARATED:                     'Separated employees cannot have position assignments modified.',
  POSITION_NOT_FOUND:                     'The selected position could not be found. Please refresh and try again.',
  POSITION_NOT_ACTIVE_FOR_ASSIGNMENT:     'This position is not currently active and cannot accept assignments. Please select an Active position.',
  POSITION_ALREADY_OCCUPIED:              'This position already has an active incumbent. Select a different position.',
  POSITION_CLEARANCE_NOT_PERMITTED_FOR_STATUS:
    'Position can only be cleared for employees in Pending Onboarding status.',
  FORBIDDEN:                              "You don't have permission to assign positions.",
  UNAUTHORIZED:                           'Session expired. Please sign in again.',
  INTERNAL_ERROR:                         'Service unavailable. Please try again.',
};

const SELECT_CLASS =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  employeeId: string;
  positionId: string | null;
  employmentStatus: EmploymentStatus;
  canWrite: boolean;
  activePositions: PositionOption[];
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EmployeePositionActions({
  employeeId,
  positionId,
  employmentStatus,
  canWrite,
  activePositions,
}: Props) {
  const router = useRouter();

  const isSeparated = employmentStatus === 'SEPARATED';
  const canClear = positionId !== null && employmentStatus === 'PENDING_ONBOARDING';

  // Assign / Reassign modal state
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [isAssignLoading, setIsAssignLoading] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState('');

  // Clear modal state
  const [isClearOpen, setIsClearOpen] = useState(false);
  const [isClearLoading, setIsClearLoading] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  // Render nothing for read-only roles and SEPARATED employees (EMP-302)
  if (!canWrite || isSeparated) return null;

  const actionLabel = positionId === null ? 'Assign Position' : 'Reassign Position';

  // -------------------------------------------------------------------------
  // Assign / Reassign handler
  // -------------------------------------------------------------------------

  async function handleAssign() {
    if (!selectedPositionId) return;
    setIsAssignLoading(true);
    setAssignError(null);
    try {
      const res = await fetch(`/api/employees/${employeeId}/assign-position`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId: selectedPositionId }),
      });
      if (res.ok) {
        setIsAssignOpen(false);
        setIsAssignLoading(false);
        router.refresh();
        return;
      }
      let errorCode = 'INTERNAL_ERROR';
      try {
        const data = (await res.json()) as { success: false; error?: { code: string } };
        if (data.error?.code) errorCode = data.error.code;
      } catch { /* ignore */ }
      setAssignError(ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.INTERNAL_ERROR);
      setIsAssignLoading(false);
    } catch {
      setAssignError('Unable to reach the server. Please check your connection.');
      setIsAssignLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Clear handler (PENDING_ONBOARDING only — GD-M15-1 D6)
  // -------------------------------------------------------------------------

  async function handleClear() {
    setIsClearLoading(true);
    setClearError(null);
    try {
      const res = await fetch(`/api/employees/${employeeId}/assign-position`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId: null }),
      });
      if (res.ok) {
        setIsClearOpen(false);
        setIsClearLoading(false);
        router.refresh();
        return;
      }
      let errorCode = 'INTERNAL_ERROR';
      try {
        const data = (await res.json()) as { success: false; error?: { code: string } };
        if (data.error?.code) errorCode = data.error.code;
      } catch { /* ignore */ }
      setClearError(ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.INTERNAL_ERROR);
      setIsClearLoading(false);
    } catch {
      setClearError('Unable to reach the server. Please check your connection.');
      setIsClearLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <>
      <div className="flex items-center gap-2">
        {/* Assign / Reassign */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setSelectedPositionId('');
            setAssignError(null);
            setIsAssignOpen(true);
          }}
        >
          {actionLabel}
        </Button>

        {/* Clear — PENDING_ONBOARDING and currently assigned only */}
        {canClear && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setClearError(null);
              setIsClearOpen(true);
            }}
          >
            Clear Position
          </Button>
        )}
      </div>

      {/* Assign / Reassign modal */}
      {isAssignOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="assign-pos-modal-title"
        >
          <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
            <h3 id="assign-pos-modal-title" className="text-lg font-semibold">
              {actionLabel}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {positionId === null
                ? 'Select an active position to assign to this employee.'
                : 'Select a different active position to reassign this employee.'}
            </p>

            <div className="mt-4 space-y-2">
              <Label htmlFor="assign-position-select">Position</Label>
              {activePositions.length === 0 ? (
                <p className="rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  No active positions available. Activate a position before assigning.
                </p>
              ) : (
                <select
                  id="assign-position-select"
                  value={selectedPositionId}
                  onChange={(e) => {
                    setSelectedPositionId(e.target.value);
                    setAssignError(null);
                  }}
                  disabled={isAssignLoading}
                  className={SELECT_CLASS}
                >
                  <option value="">Select a position...</option>
                  {activePositions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}{p.classification ? ` (${p.classification})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {assignError && (
              <p role="alert" className="mt-3 text-sm font-medium text-destructive">
                {assignError}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={isAssignLoading}
                onClick={() => { setIsAssignOpen(false); setAssignError(null); }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                style={{ backgroundColor: '#2563eb' }}
                disabled={isAssignLoading || !selectedPositionId || activePositions.length === 0}
                onClick={handleAssign}
              >
                {isAssignLoading ? 'Saving…' : `Confirm — ${actionLabel}`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Clear modal */}
      {isClearOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-pos-modal-title"
        >
          <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
            <h3 id="clear-pos-modal-title" className="text-lg font-semibold">
              Clear Position Assignment
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              This will remove the current position assignment from this employee. The employee
              will return to unassigned status. Clearance is only available while the employee
              is in Pending Onboarding status.
            </p>

            {clearError && (
              <p role="alert" className="mt-3 text-sm font-medium text-destructive">
                {clearError}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={isClearLoading}
                onClick={() => { setIsClearOpen(false); setClearError(null); }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isClearLoading}
                onClick={handleClear}
              >
                {isClearLoading ? 'Clearing…' : 'Confirm — Clear Position'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
