'use client';

// Lifecycle action buttons for the Position Detail page.
// Activate: DRAFT → ACTIVE via PUT /api/positions/:id { status: 'ACTIVE' }
// Freeze: ACTIVE → FROZEN via PUT /api/positions/:id { status: 'FROZEN' }
// Resume: FROZEN → ACTIVE via PUT /api/positions/:id { status: 'ACTIVE' } (GD-M15-1 UpdatePositionDto)
// Close: ACTIVE/FROZEN → CLOSED via POST /api/positions/:id/close
//   Surfaces HAS_ACTIVE_VACANCIES and HAS_ACTIVE_INCUMBENT errors per GD-PHASE2-CLOSURE-002 D3.
// canWrite derived server-side from JWT roles (GD-12-4 pattern).
// NestJS remains the authoritative RBAC and lifecycle enforcer.
// Reference: directives/02_position_management_rules.md — POS-AUTH-002, POS-500, POS-501
// Reference: governance/GD-M15-1.md — Decision 5 (HAS_ACTIVE_INCUMBENT)
// Reference: governance/GD-PHASE2-CLOSURE-002.md — Decision 3

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { PositionStatus } from '@/features/workforce/types';

type Props = {
  id: string;
  status: PositionStatus;
  canWrite: boolean;
};

// ---------------------------------------------------------------------------
// Error message maps
// ---------------------------------------------------------------------------

const ACTIVATE_ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND:          'Position could not be found.',
  POSITION_CLOSED:    'This position is already closed and cannot be activated.',
  INVALID_TRANSITION: 'Activate is only allowed from Draft status.',
  FORBIDDEN:          "You don't have permission to activate positions.",
  UNAUTHORIZED:       'Session expired. Please sign in again.',
  INTERNAL_ERROR:     'Service unavailable. Please try again.',
};

const FREEZE_ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND:          'Position could not be found.',
  POSITION_CLOSED:    'This position is closed and cannot be frozen.',
  INVALID_TRANSITION: 'Freeze is only allowed from Active status.',
  FORBIDDEN:          "You don't have permission to freeze positions.",
  UNAUTHORIZED:       'Session expired. Please sign in again.',
  INTERNAL_ERROR:     'Service unavailable. Please try again.',
};

const RESUME_ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND:       'Position could not be found.',
  POSITION_CLOSED: 'This position is closed and cannot be resumed.',
  FORBIDDEN:       "You don't have permission to resume positions.",
  UNAUTHORIZED:    'Session expired. Please sign in again.',
  INTERNAL_ERROR:  'Service unavailable. Please try again.',
};

const CLOSE_ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND:              'Position could not be found.',
  ALREADY_CLOSED:         'This position is already closed.',
  HAS_ACTIVE_VACANCIES:   'Close blocked — this position has open vacancies. Close all vacancies before closing the position.',
  HAS_ACTIVE_INCUMBENT:   'Close blocked — an employee is currently assigned to this position. Reassign or separate the employee before closing.',
  FORBIDDEN:              "You don't have permission to close positions.",
  UNAUTHORIZED:           'Session expired. Please sign in again.',
  INTERNAL_ERROR:         'Service unavailable. Please try again.',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PositionActions({ id, status, canWrite }: Props) {
  const router = useRouter();

  const [isActivateOpen, setIsActivateOpen] = useState(false);
  const [isActivateLoading, setIsActivateLoading] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  const [isFreezeOpen, setIsFreezeOpen] = useState(false);
  const [isFreezeLoading, setIsFreezeLoading] = useState(false);
  const [freezeError, setFreezeError] = useState<string | null>(null);

  const [isResumeOpen, setIsResumeOpen] = useState(false);
  const [isResumeLoading, setIsResumeLoading] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const [isCloseOpen, setIsCloseOpen] = useState(false);
  const [isCloseLoading, setIsCloseLoading] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const isClosed = status === 'CLOSED';
  const isDraft  = status === 'DRAFT';
  const isActive = status === 'ACTIVE';
  const isFrozen = status === 'FROZEN';

  if (!canWrite) return null;

  // --------------------------------------------------------------------------
  // Activate handler (DRAFT → ACTIVE)
  // --------------------------------------------------------------------------

  async function handleActivate() {
    setIsActivateLoading(true);
    setActivateError(null);
    try {
      const res = await fetch(`/api/positions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      });
      if (res.ok) {
        setIsActivateOpen(false);
        setIsActivateLoading(false);
        router.refresh();
        return;
      }
      let errorCode = 'INTERNAL_ERROR';
      try {
        const data = (await res.json()) as { success: false; error?: { code: string } };
        if (data.error?.code) errorCode = data.error.code;
      } catch { /* ignore */ }
      setActivateError(ACTIVATE_ERROR_MESSAGES[errorCode] ?? ACTIVATE_ERROR_MESSAGES.INTERNAL_ERROR);
      setIsActivateLoading(false);
    } catch {
      setActivateError('Unable to reach the server. Please check your connection.');
      setIsActivateLoading(false);
    }
  }

  // --------------------------------------------------------------------------
  // Freeze handler (ACTIVE → FROZEN)
  // --------------------------------------------------------------------------

  async function handleFreeze() {
    setIsFreezeLoading(true);
    setFreezeError(null);
    try {
      const res = await fetch(`/api/positions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'FROZEN' }),
      });
      if (res.ok) {
        setIsFreezeOpen(false);
        setIsFreezeLoading(false);
        router.refresh();
        return;
      }
      let errorCode = 'INTERNAL_ERROR';
      try {
        const data = (await res.json()) as { success: false; error?: { code: string } };
        if (data.error?.code) errorCode = data.error.code;
      } catch { /* ignore */ }
      setFreezeError(FREEZE_ERROR_MESSAGES[errorCode] ?? FREEZE_ERROR_MESSAGES.INTERNAL_ERROR);
      setIsFreezeLoading(false);
    } catch {
      setFreezeError('Unable to reach the server. Please check your connection.');
      setIsFreezeLoading(false);
    }
  }

  // --------------------------------------------------------------------------
  // Resume handler (FROZEN → ACTIVE)
  // --------------------------------------------------------------------------

  async function handleResume() {
    setIsResumeLoading(true);
    setResumeError(null);
    try {
      const res = await fetch(`/api/positions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      });
      if (res.ok) {
        setIsResumeOpen(false);
        setIsResumeLoading(false);
        router.refresh();
        return;
      }
      let errorCode = 'INTERNAL_ERROR';
      try {
        const data = (await res.json()) as { success: false; error?: { code: string } };
        if (data.error?.code) errorCode = data.error.code;
      } catch { /* ignore */ }
      setResumeError(RESUME_ERROR_MESSAGES[errorCode] ?? RESUME_ERROR_MESSAGES.INTERNAL_ERROR);
      setIsResumeLoading(false);
    } catch {
      setResumeError('Unable to reach the server. Please check your connection.');
      setIsResumeLoading(false);
    }
  }

  // --------------------------------------------------------------------------
  // Close handler (ACTIVE/FROZEN → CLOSED)
  // --------------------------------------------------------------------------

  async function handleClose() {
    setIsCloseLoading(true);
    setCloseError(null);
    try {
      const res = await fetch(`/api/positions/${id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        setIsCloseOpen(false);
        setIsCloseLoading(false);
        router.refresh();
        return;
      }
      let errorCode = 'INTERNAL_ERROR';
      try {
        const data = (await res.json()) as { success: false; error?: { code: string } };
        if (data.error?.code) errorCode = data.error.code;
      } catch { /* ignore */ }
      setCloseError(CLOSE_ERROR_MESSAGES[errorCode] ?? CLOSE_ERROR_MESSAGES.INTERNAL_ERROR);
      setIsCloseLoading(false);
    } catch {
      setCloseError('Unable to reach the server. Please check your connection.');
      setIsCloseLoading(false);
    }
  }

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <>
      <div className="flex items-center gap-3">
        {/* Edit — available for non-CLOSED positions */}
        {!isClosed && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/workforce/positions/${id}/edit`}>Edit</Link>
          </Button>
        )}

        {!isClosed && (isDraft || isActive || isFrozen) && (
          <span className="h-4 w-px bg-border" aria-hidden="true" />
        )}

        {/* Activate — DRAFT only */}
        {isDraft && (
          <Button
            size="sm"
            onClick={() => { setIsActivateOpen(true); setActivateError(null); }}
          >
            Activate
          </Button>
        )}

        {/* Freeze — ACTIVE only */}
        {isActive && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setIsFreezeOpen(true); setFreezeError(null); }}
          >
            Freeze
          </Button>
        )}

        {/* Resume — FROZEN only */}
        {isFrozen && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setIsResumeOpen(true); setResumeError(null); }}
          >
            Resume Position
          </Button>
        )}

        {/* Close — ACTIVE or FROZEN */}
        {(isActive || isFrozen) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setIsCloseOpen(true); setCloseError(null); }}
          >
            Close Position
          </Button>
        )}
      </div>

      {/* Activate modal */}
      {isActivateOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="activate-modal-title"
        >
          <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
            <h3 id="activate-modal-title" className="text-lg font-semibold">Activate Position</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Activating this position makes it available for employee assignment and vacancy creation.
            </p>
            {activateError && (
              <p role="alert" className="mt-3 text-sm font-medium text-destructive">{activateError}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={isActivateLoading}
                onClick={() => { setIsActivateOpen(false); setActivateError(null); }}
              >
                Cancel
              </Button>
              <Button size="sm" disabled={isActivateLoading} onClick={handleActivate}>
                {isActivateLoading ? 'Activating…' : 'Confirm — Activate'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Freeze modal */}
      {isFreezeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="freeze-modal-title"
        >
          <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
            <h3 id="freeze-modal-title" className="text-lg font-semibold">Freeze Position</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Freezing this position prevents new vacancy creation and new employee assignments.
              Existing occupants are unaffected.
            </p>
            {freezeError && (
              <p role="alert" className="mt-3 text-sm font-medium text-destructive">{freezeError}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={isFreezeLoading}
                onClick={() => { setIsFreezeOpen(false); setFreezeError(null); }}
              >
                Cancel
              </Button>
              <Button size="sm" disabled={isFreezeLoading} onClick={handleFreeze}>
                {isFreezeLoading ? 'Freezing…' : 'Confirm — Freeze'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Resume modal */}
      {isResumeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="resume-modal-title"
        >
          <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
            <h3 id="resume-modal-title" className="text-lg font-semibold">Resume Position</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Resuming this position returns it to Active status. Vacancy creation and employee
              assignment will be available again.
            </p>
            {resumeError && (
              <p role="alert" className="mt-3 text-sm font-medium text-destructive">{resumeError}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={isResumeLoading}
                onClick={() => { setIsResumeOpen(false); setResumeError(null); }}
              >
                Cancel
              </Button>
              <Button size="sm" disabled={isResumeLoading} onClick={handleResume}>
                {isResumeLoading ? 'Resuming…' : 'Confirm — Resume'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Close modal */}
      {isCloseOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-pos-modal-title"
        >
          <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
            <h3 id="close-pos-modal-title" className="text-lg font-semibold">Close Position</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Closing this position is permanent. The position will no longer be available for
              assignment or vacancy creation. All open vacancies must be closed first, and any
              current incumbent must be reassigned or separated.
            </p>
            {closeError && (
              <p role="alert" className="mt-3 text-sm font-medium text-destructive">{closeError}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={isCloseLoading}
                onClick={() => { setIsCloseOpen(false); setCloseError(null); }}
              >
                Go back
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isCloseLoading}
                onClick={handleClose}
              >
                {isCloseLoading ? 'Closing…' : 'Confirm — Close Position'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
