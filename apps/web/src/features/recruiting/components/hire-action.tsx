'use client';

// Hire Action — application detail page (M20D Batch 3).
// Uses POST /api/recruiting/applications/:id/hire BFF (Batch 3).
//
// Visibility: only shown when application status is OFFER AND caller role is
//   System Administrator or HR Director (canHire).
//   Gate applied in Server Component — Recruiter never receives this component.
//   Backend enforces RBAC independently (403 for unauthorized callers).
//
// UX pattern: two-step inline confirmation before issuing hire request.
//   Step 1 — "Hire Applicant" button triggers confirm prompt (no network call).
//   Step 2 — "Confirm Hire" issues POST; "Cancel" returns to Step 1.
//
// On success: toast + router.refresh() to reload Server Component data.
// On error:   toast + inline error banner; confirm panel collapses to Step 1.
//
// Reference: governance/GD-M20-1.md — Decision 3, 5, 7 (Applications / Hire), GD-M19-1 D3, D6
// Reference: apps/web/src/app/api/recruiting/applications/[id]/hire/route.ts
// Reference: apps/api/src/recruiting/hire.controller.ts

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecruitingToast, RecruitingToastContainer } from './recruiting-toast';

// ---------------------------------------------------------------------------
// Design tokens — GD-M20-1 D16
// ---------------------------------------------------------------------------

const BORDER    = '#e2e8f0';
const TEXT      = '#0f172a';
const SUB       = '#475569';
const MUTED     = '#94a3b8';
const ERROR_COL = '#dc2626';
const RED_BG    = '#fef2f2';
const RED_BDR   = '#fecaca';
const CANVAS    = '#f8fafc';

// Hire button uses a distinct amber/warning tone to signal the weight of this action
const HIRE_COL = '#92400e';   // amber-800
const HIRE_BG  = '#fef3c7';   // amber-100
const HIRE_BDR = '#fcd34d';   // amber-300

// ---------------------------------------------------------------------------
// Error messages keyed by NestJS BFF error codes
// ---------------------------------------------------------------------------

const HIRE_ERRORS: Record<string, string> = {
  APPLICATION_NOT_FOUND:             'Application not found.',
  APPLICATION_ALREADY_HIRED:         'This application has already been hired.',
  APPLICATION_NOT_AT_OFFER_STATUS:   'The application must be at OFFER status to initiate a hire.',
  ACCEPTED_OFFER_NOT_FOUND:          'No accepted offer found. Record an ACCEPTED offer response before hiring.',
  CANDIDATE_NOT_FOUND:               'Candidate record not found.',
  CANDIDATE_ARCHIVED:                'Candidate is archived and cannot be hired.',
  VACANCY_NOT_FOUND:                 'Vacancy not found.',
  VACANCY_NOT_AVAILABLE:             'The vacancy is no longer available (filled or cancelled).',
  POSITION_NOT_FOUND:                'Position not found.',
  POSITION_NOT_AVAILABLE:            'The position is already occupied by an active employee.',
  EMPLOYEE_NUMBER_GENERATION_FAILED: 'Employee number generation conflict. Please try again.',
  UNAUTHORIZED:                      'Your session has expired. Please sign in again.',
  FORBIDDEN:                         "You don't have permission to initiate a hire.",
  INTERNAL_ERROR:                    'Service unavailable. Please try again.',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  applicationId: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HireAction({ applicationId }: Props) {
  const router = useRouter();
  const { toasts, addToast, dismissToast } = useRecruitingToast();

  const [confirming,   setConfirming]   = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  async function handleHire() {
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/recruiting/applications/${applicationId}/hire`, {
        method: 'POST',
      });

      if (res.ok) {
        addToast({ type: 'success', title: 'Hire initiated', message: 'Employee record created with status PENDING_ONBOARDING.' });
        router.refresh();
        return;
      }

      let errorCode = 'INTERNAL_ERROR';
      try {
        const data = (await res.json()) as { success: false; error: { code: string } };
        if (!data.success) errorCode = data.error?.code ?? 'INTERNAL_ERROR';
      } catch { /* ignore parse failure */ }

      const msg = HIRE_ERRORS[errorCode] ?? HIRE_ERRORS.INTERNAL_ERROR;
      setError(msg);
      addToast({ type: 'error', title: 'Hire failed', message: msg });
      setConfirming(false);
    } catch {
      const msg = 'Unable to reach the server. Please check your connection.';
      setError(msg);
      addToast({ type: 'error', title: 'Connection error', message: msg });
      setConfirming(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  // =========================================================================
  // Render
  // =========================================================================

  // Step 1 — initial trigger (no confirm panel open yet)
  if (!confirming) {
    return (
      <>
        <RecruitingToastContainer toasts={toasts} onDismiss={dismissToast} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {error && (
            <div
              role="alert"
              style={{
                backgroundColor: RED_BG,
                border: `1px solid ${RED_BDR}`,
                borderRadius: 6,
                padding: '10px 14px',
                fontSize: 13,
                color: ERROR_COL,
              }}
            >
              {error}
            </div>
          )}
          <div>
            <button
              type="button"
              onClick={() => { setError(null); setConfirming(true); }}
              style={{
                backgroundColor: HIRE_BG,
                color: HIRE_COL,
                border: `1px solid ${HIRE_BDR}`,
                borderRadius: 6,
                padding: '7px 14px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Hire Applicant
            </button>
          </div>
        </div>
      </>
    );
  }

  // Step 2 — confirmation panel
  return (
    <>
      <RecruitingToastContainer toasts={toasts} onDismiss={dismissToast} />
      <div
        style={{
          border: `1px solid ${HIRE_BDR}`,
          borderRadius: 8,
          padding: 20,
          backgroundColor: CANVAS,
        }}
      >
        <h3
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: HIRE_COL,
            marginTop: 0,
            marginBottom: 8,
          }}
        >
          Confirm Hire
        </h3>

        {error && (
          <div
            role="alert"
            style={{
              backgroundColor: RED_BG,
              border: `1px solid ${RED_BDR}`,
              borderRadius: 6,
              padding: '10px 14px',
              fontSize: 13,
              color: ERROR_COL,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        <p style={{ fontSize: 13, color: SUB, marginBottom: 16 }}>
          This will create an employee record and mark the application as{' '}
          <strong style={{ color: TEXT }}>HIRED</strong>. This action cannot be undone.
          Ensure an <strong style={{ color: TEXT }}>accepted offer</strong> exists before
          proceeding.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={handleHire}
            disabled={isSubmitting}
            style={{
              backgroundColor: isSubmitting ? MUTED : HIRE_BG,
              color: isSubmitting ? '#ffffff' : HIRE_COL,
              border: `1px solid ${isSubmitting ? MUTED : HIRE_BDR}`,
              borderRadius: 6,
              padding: '7px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            {isSubmitting ? 'Hiring…' : 'Confirm Hire'}
          </button>
          <button
            type="button"
            onClick={() => { setConfirming(false); setError(null); }}
            disabled={isSubmitting}
            style={{
              backgroundColor: 'transparent',
              color: isSubmitting ? MUTED : SUB,
              border: `1px solid ${BORDER}`,
              borderRadius: 6,
              padding: '7px 14px',
              fontSize: 13,
              fontWeight: 500,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
