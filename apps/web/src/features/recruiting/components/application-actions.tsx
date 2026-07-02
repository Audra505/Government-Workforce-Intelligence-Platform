'use client';

// Application action surfaces for the application detail page (M20C Batch 4).
// Rendered only for write-capable roles (SA, HRD, Recruiter) — gate applied in Server Component.
// Handles three actions:
//   1. Advance  → POST /api/recruiting/applications/:id/advance { targetStatus }
//   2. Reject   → POST /api/recruiting/applications/:id/reject  (no body)
//   3. Withdraw → POST /api/recruiting/applications/:id/withdraw (no body)
//
// Hire action: M20D scope — not implemented here; no placeholder rendered.
// Terminal statuses (HIRED, REJECTED, WITHDRAWN): component renders null — no actions shown.
//
// On success: toast + router.refresh() to reload Server Component data.
// On error:   toast + inline error banner with user-readable message.
//
// Reference: governance/GD-M20-1.md — Decision 3, 5, 7 (Applications)
// Reference: apps/api/src/recruiting/application.controller.ts

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecruitingToast, RecruitingToastContainer } from './recruiting-toast';
import type { ApplicationStatus } from '@/features/recruiting/types';

// ---------------------------------------------------------------------------
// Advance transition map — OFFER has no entry (advance not available at that stage).
// GD-M20-1 D7
// ---------------------------------------------------------------------------

type AdvanceTarget = { targetStatus: string; label: string };

const ADVANCE_MAP: Partial<Record<ApplicationStatus, AdvanceTarget>> = {
  APPLIED:    { targetStatus: 'SCREENING',   label: 'Advance to Screening' },
  SCREENING:  { targetStatus: 'INTERVIEW',   label: 'Advance to Interview' },
  INTERVIEW:  { targetStatus: 'EVALUATION',  label: 'Advance to Evaluation' },
  EVALUATION: { targetStatus: 'OFFER',       label: 'Advance to Offer' },
};

// Terminal statuses — no action surfaces rendered.
const TERMINAL = new Set<ApplicationStatus>(['HIRED', 'REJECTED', 'WITHDRAWN']);

// ---------------------------------------------------------------------------
// User-readable error messages keyed by NestJS BFF error code
// ---------------------------------------------------------------------------

const ACTION_ERRORS: Record<string, string> = {
  APPLICATION_IN_TERMINAL_STATE:
    'This application is already in a terminal state and cannot be changed.',
  APPLICATION_AWAITING_HIRE:
    'This application is awaiting hire and cannot be advanced or rejected.',
  INVALID_APPLICATION_TRANSITION:
    'This status transition is not allowed for the current application stage.',
  APPLICATION_NOT_FOUND: 'Application not found.',
  UNAUTHORIZED:          'Your session has expired. Please sign in again.',
  FORBIDDEN:             "You don't have permission to perform this action.",
  VALIDATION_ERROR:      'Invalid request. Please try again.',
  INTERNAL_ERROR:        'Service unavailable. Please try again.',
};

// ---------------------------------------------------------------------------
// Design tokens — GD-M20-1 D16
// ---------------------------------------------------------------------------

const BORDER    = '#e2e8f0';
const SUB       = '#475569';
const MUTED     = '#94a3b8';
const BLUE      = '#2563eb';
const ERROR_COL = '#dc2626';
const RED_BG    = '#fef2f2';
const RED_BDR   = '#fecaca';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ActiveAction = 'advance' | 'reject' | 'withdraw' | null;

type Props = {
  applicationId: string;
  applicationStatus: ApplicationStatus;
};

export function ApplicationActions({ applicationId, applicationStatus }: Props) {
  const router = useRouter();
  const { toasts, addToast, dismissToast } = useRecruitingToast();
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // No action surfaces for terminal statuses (GD-M20-1 D7).
  if (TERMINAL.has(applicationStatus)) return null;

  const advance = ADVANCE_MAP[applicationStatus] ?? null;
  const isLoading = activeAction !== null;

  // -------------------------------------------------------------------------
  // Shared response handler
  // -------------------------------------------------------------------------

  async function handleResult(
    res: Response,
    successTitle: string,
    successMessage: string,
  ): Promise<void> {
    if (res.ok) {
      addToast({ type: 'success', title: successTitle, message: successMessage });
      router.refresh();
      return;
    }
    let errorCode = 'INTERNAL_ERROR';
    try {
      const data = (await res.json()) as { success: false; error: { code: string } };
      if (!data.success) errorCode = data.error?.code ?? 'INTERNAL_ERROR';
    } catch { /* ignore parse failure */ }
    const msg = ACTION_ERRORS[errorCode] ?? ACTION_ERRORS.INTERNAL_ERROR;
    setActionError(msg);
    addToast({ type: 'error', title: 'Action failed', message: msg });
  }

  function handleNetworkError(): void {
    const msg = 'Unable to reach the server. Please check your connection.';
    setActionError(msg);
    addToast({ type: 'error', title: 'Connection error', message: msg });
  }

  // -------------------------------------------------------------------------
  // Action handlers
  // -------------------------------------------------------------------------

  async function handleAdvance() {
    if (!advance) return;
    setActionError(null);
    setActiveAction('advance');
    try {
      const res = await fetch(
        `/api/recruiting/applications/${applicationId}/advance`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetStatus: advance.targetStatus }),
        },
      );
      await handleResult(
        res,
        'Application advanced',
        `Application advanced to ${advance.targetStatus.toLowerCase()}.`,
      );
    } catch {
      handleNetworkError();
    } finally {
      setActiveAction(null);
    }
  }

  async function handleReject() {
    setActionError(null);
    setActiveAction('reject');
    try {
      const res = await fetch(
        `/api/recruiting/applications/${applicationId}/reject`,
        { method: 'POST' },
      );
      await handleResult(res, 'Application rejected', 'The application has been rejected.');
    } catch {
      handleNetworkError();
    } finally {
      setActiveAction(null);
    }
  }

  async function handleWithdraw() {
    setActionError(null);
    setActiveAction('withdraw');
    try {
      const res = await fetch(
        `/api/recruiting/applications/${applicationId}/withdraw`,
        { method: 'POST' },
      );
      await handleResult(res, 'Application withdrawn', 'The application has been withdrawn.');
    } catch {
      handleNetworkError();
    } finally {
      setActiveAction(null);
    }
  }

  return (
    <>
      <RecruitingToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Inline error banner */}
      {actionError && (
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
          {actionError}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {/* Advance — not rendered for OFFER or terminal statuses */}
        {advance && (
          <button
            type="button"
            onClick={handleAdvance}
            disabled={isLoading}
            style={{
              backgroundColor: isLoading ? MUTED : BLUE,
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              padding: '7px 14px',
              fontSize: 13,
              fontWeight: 500,
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {activeAction === 'advance' ? 'Advancing…' : advance.label}
          </button>
        )}

        {/* Reject — rendered for all non-terminal statuses */}
        <button
          type="button"
          onClick={handleReject}
          disabled={isLoading}
          style={{
            backgroundColor: 'transparent',
            color: isLoading ? MUTED : ERROR_COL,
            border: `1px solid ${isLoading ? BORDER : RED_BDR}`,
            borderRadius: 6,
            padding: '7px 14px',
            fontSize: 13,
            fontWeight: 500,
            cursor: isLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {activeAction === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>

        {/* Withdraw — rendered for all non-terminal statuses */}
        <button
          type="button"
          onClick={handleWithdraw}
          disabled={isLoading}
          style={{
            backgroundColor: 'transparent',
            color: isLoading ? MUTED : SUB,
            border: `1px solid ${BORDER}`,
            borderRadius: 6,
            padding: '7px 14px',
            fontSize: 13,
            fontWeight: 500,
            cursor: isLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {activeAction === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
        </button>
      </div>
    </>
  );
}
