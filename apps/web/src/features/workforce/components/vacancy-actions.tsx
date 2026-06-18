'use client';

// Actions section for the Vacancy Detail page.
// Renders Edit link, Open Vacancy modal, and Close Vacancy modal.
// canWrite is derived server-side from JWT roles (GD-12-4).
// NestJS remains the authoritative RBAC enforcer — canWrite is for UX only.
//
// Open Vacancy (Step 12): DRAFT → OPEN via PUT /api/vacancies/:id { status: 'OPEN' }
// Close Vacancy (Step 13): any non-CLOSED → CLOSED via POST /api/vacancies/:id/close
//   GD-13-1: DRAFT shows CANCELLED only; OPEN/IN_RECRUITMENT shows FILLED + CANCELLED
//   GD-13-2: Close button visible for DRAFT, OPEN, IN_RECRUITMENT
//   GD-13-3: Separate state variables per modal
//   GD-13-4: On success → modal closes, loading resets, router.refresh() — no manual refresh required
//   GD-13-5: Radio-button closureType selection + single Confirm action
//
// VAC-602 (Manager Approval for CANCELLED) is documented tech debt — backend does not
// currently enforce an approval gate. Both FILLED and CANCELLED require SA or HR Director only.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { VacancyStatus } from '@/features/workforce/types';

type Props = {
  id: string;
  status: VacancyStatus;
  canWrite: boolean;
};

// ---------------------------------------------------------------------------
// Error message maps
// ---------------------------------------------------------------------------

const OPEN_ERROR_MESSAGES: Record<string, string> = {
  INVALID_TRANSITION: 'This vacancy can only be opened from Draft status.',
  VACANCY_CLOSED: 'This vacancy is already closed.',
  NOT_FOUND: 'This vacancy could not be found.',
  FORBIDDEN: "You don't have permission to open vacancies.",
  UNAUTHORIZED: 'Session expired. Please sign in again.',
  INTERNAL_ERROR: 'Service unavailable. Please try again.',
};

const CLOSE_ERROR_MESSAGES: Record<string, string> = {
  INVALID_TRANSITION: 'This vacancy cannot be closed as Filled from its current status.',
  VACANCY_CLOSED: 'This vacancy is already closed.',
  NOT_FOUND: 'This vacancy could not be found.',
  FORBIDDEN: "You don't have permission to close vacancies.",
  UNAUTHORIZED: 'Session expired. Please sign in again.',
  INTERNAL_ERROR: 'Service unavailable. Please try again.',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VacancyActions({ id, status, canWrite }: Props) {
  const router = useRouter();

  // Open Vacancy modal state (Step 12 — preserved unchanged)
  const [isOpenModalOpen, setIsOpenModalOpen] = useState(false);
  const [isOpenLoading, setIsOpenLoading] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  // Close Vacancy modal state (Step 13 — GD-13-3: separate state)
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [isCloseLoading, setIsCloseLoading] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [selectedClosureType, setSelectedClosureType] = useState<'FILLED' | 'CANCELLED'>('CANCELLED');

  const isClosed = status === 'CLOSED';
  const isDraft = status === 'DRAFT';
  // GD-13-1: FILLED closure available only from OPEN or IN_RECRUITMENT
  const canSelectFilled = status === 'OPEN' || status === 'IN_RECRUITMENT';

  // No write actions for read-only users (GD-12-4: JWT role check upstream)
  if (!canWrite) return null;

  // --------------------------------------------------------------------------
  // Open Vacancy handler (Step 12 — logic preserved)
  // --------------------------------------------------------------------------

  async function handleOpenVacancy() {
    setIsOpenLoading(true);
    setOpenError(null);

    try {
      const res = await fetch(`/api/vacancies/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'OPEN' }),
      });

      if (res.ok) {
        // Close modal and reset loading before refresh so the user sees a clean state.
        // router.push() intentionally omitted — we are already on this page.
        // router.refresh() re-fetches the Server Component (status → OPEN, button hidden).
        setIsOpenModalOpen(false);
        setIsOpenLoading(false);
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

      setOpenError(OPEN_ERROR_MESSAGES[errorCode] ?? OPEN_ERROR_MESSAGES.INTERNAL_ERROR);
      setIsOpenLoading(false);
    } catch {
      setOpenError('Unable to reach the server. Please check your connection.');
      setIsOpenLoading(false);
    }
  }

  // --------------------------------------------------------------------------
  // Close Vacancy handler (Step 13 — GD-13-4)
  // --------------------------------------------------------------------------

  async function handleCloseVacancy() {
    setIsCloseLoading(true);
    setCloseError(null);

    try {
      const res = await fetch(`/api/vacancies/${id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closureType: selectedClosureType }),
      });

      if (res.ok) {
        // Close modal and reset loading before refresh — GD-13-4 requirement.
        // router.refresh() re-fetches the Server Component (status → CLOSED, all action
        // buttons hidden, filledAt rendered in Timeline if FILLED).
        setIsCloseModalOpen(false);
        setIsCloseLoading(false);
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
        {/* Edit — field operation; visually separated from lifecycle actions below */}
        {!isClosed && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/workforce/vacancies/${id}/edit`}>Edit</Link>
          </Button>
        )}

        {/* Separator — present whenever Edit and lifecycle actions are both visible */}
        {!isClosed && (
          <span className="h-4 w-px bg-border" aria-hidden="true" />
        )}

        {/* Open Vacancy — DRAFT only; lifecycle transition (GD-12-2) */}
        {isDraft && (
          <Button
            size="sm"
            onClick={() => { setIsOpenModalOpen(true); setOpenError(null); }}
          >
            Open Vacancy
          </Button>
        )}

        {/* Close Vacancy — all non-CLOSED statuses; lifecycle transition (GD-13-2) */}
        {!isClosed && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectedClosureType('CANCELLED');
              setCloseError(null);
              setIsCloseModalOpen(true);
            }}
          >
            Close Vacancy
          </Button>
        )}
      </div>

      {/* Open Vacancy confirmation modal (Step 12 — preserved) */}
      {isOpenModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="open-modal-title"
        >
          <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
            <h3 id="open-modal-title" className="text-lg font-semibold">
              Open Vacancy
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Opening this vacancy will make it available for recruitment. This
              transition cannot be undone from this page.
            </p>

            {openError && (
              <p role="alert" className="mt-3 text-sm font-medium text-destructive">
                {openError}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={isOpenLoading}
                onClick={() => { setIsOpenModalOpen(false); setOpenError(null); }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={isOpenLoading}
                onClick={handleOpenVacancy}
              >
                {isOpenLoading ? 'Opening…' : 'Confirm — Open Vacancy'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Close Vacancy confirmation modal (Step 13 — GD-13-5: radio + single confirm) */}
      {isCloseModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-modal-title"
        >
          <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
            <h3 id="close-modal-title" className="text-lg font-semibold">
              Close Vacancy
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Closing this vacancy is permanent and cannot be undone.
            </p>

            {/* Closure type selection — GD-13-1, GD-13-5 */}
            {canSelectFilled ? (
              /* OPEN / IN_RECRUITMENT: user selects FILLED or CANCELLED */
              <fieldset className="mt-4 space-y-3" disabled={isCloseLoading}>
                <legend className="text-sm font-medium">Closure reason</legend>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="closureType"
                    value="FILLED"
                    checked={selectedClosureType === 'FILLED'}
                    onChange={() => setSelectedClosureType('FILLED')}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="text-sm font-medium">Filled</span>
                    <span className="block text-xs text-muted-foreground">
                      A candidate has been hired for this position.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="closureType"
                    value="CANCELLED"
                    checked={selectedClosureType === 'CANCELLED'}
                    onChange={() => setSelectedClosureType('CANCELLED')}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="text-sm font-medium">Cancelled</span>
                    <span className="block text-xs text-muted-foreground">
                      The vacancy is being withdrawn without filling.
                    </span>
                  </span>
                </label>
              </fieldset>
            ) : (
              /* DRAFT: CANCELLED only — fixed, no selection needed (GD-13-1) */
              <p className="mt-4 text-sm text-muted-foreground">
                Draft vacancies can only be cancelled. The position will remain
                available for future vacancies.
              </p>
            )}

            {closeError && (
              <p role="alert" className="mt-3 text-sm font-medium text-destructive">
                {closeError}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={isCloseLoading}
                onClick={() => { setIsCloseModalOpen(false); setCloseError(null); }}
              >
                Go back
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isCloseLoading}
                onClick={handleCloseVacancy}
              >
                {isCloseLoading ? 'Closing…' : 'Confirm — Close Vacancy'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
