'use client';

// Interview action surfaces for the interview detail page (M20D Batch 1).
// Rendered only for write-capable roles (SA, HRD, Recruiter) — gate applied in Server Component.
//
// Status-based behavior (GD-M20-1 D7):
//   SCHEDULED → Complete, Cancel, No-show buttons
//   COMPLETED → Feedback form toggle only (status transitions not available)
//   CANCELLED → null (no surfaces rendered)
//   NO_SHOW   → null (no surfaces rendered)
//
// On success: toast + router.refresh() to reload Server Component data.
// On error:   toast + inline error banner.
//
// Reference: governance/GD-M20-1.md — Decision 3, 5, 7 (Interviews)
// Reference: apps/api/src/recruiting/interview.controller.ts

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecruitingToast, RecruitingToastContainer } from './recruiting-toast';
import type { InterviewStatus } from '@/features/recruiting/types';

// ---------------------------------------------------------------------------
// Error messages keyed by NestJS BFF error code
// ---------------------------------------------------------------------------

const TRANSITION_ERRORS: Record<string, string> = {
  INTERVIEW_NOT_FOUND:          'Interview not found.',
  INTERVIEW_IN_TERMINAL_STATE:  'This interview is already in a terminal state and cannot be changed.',
  UNAUTHORIZED:                 'Your session has expired. Please sign in again.',
  FORBIDDEN:                    "You don't have permission to perform this action.",
  INTERNAL_ERROR:               'Service unavailable. Please try again.',
};

const FEEDBACK_ERRORS: Record<string, string> = {
  INTERVIEW_NOT_FOUND:             'Interview not found.',
  INTERVIEW_FEEDBACK_NOT_ALLOWED:  'Feedback cannot be recorded for cancelled or no-show interviews.',
  VALIDATION_ERROR:                'Invalid feedback. Please check your input.',
  UNAUTHORIZED:                    'Your session has expired. Please sign in again.',
  FORBIDDEN:                       "You don't have permission to record feedback.",
  INTERNAL_ERROR:                  'Service unavailable. Please try again.',
};

// ---------------------------------------------------------------------------
// Design tokens — GD-M20-1 D16
// ---------------------------------------------------------------------------

const BORDER    = '#e2e8f0';
const TEXT      = '#0f172a';
const SUB       = '#475569';
const MUTED     = '#94a3b8';
const BLUE      = '#2563eb';
const ERROR_COL = '#dc2626';
const CANVAS    = '#f8fafc';
const RED_BG    = '#fef2f2';
const RED_BDR   = '#fecaca';

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: TEXT,
  marginBottom: 4,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ActiveAction = 'complete' | 'cancel' | 'no-show' | null;

type Props = {
  interviewId: string;
  interviewStatus: InterviewStatus;
};

export function InterviewActions({ interviewId, interviewStatus }: Props) {
  const router = useRouter();
  const { toasts, addToast, dismissToast } = useRecruitingToast();

  const [activeAction,         setActiveAction]         = useState<ActiveAction>(null);
  const [actionError,          setActionError]          = useState<string | null>(null);
  const [showFeedback,         setShowFeedback]         = useState(false);
  const [feedbackText,         setFeedbackText]         = useState('');
  const [feedbackError,        setFeedbackError]        = useState<string | null>(null);
  const [isFeedbackSubmitting, setIsFeedbackSubmitting] = useState(false);

  // CANCELLED and NO_SHOW: no surfaces rendered (GD-M20-1 D7).
  if (interviewStatus === 'CANCELLED' || interviewStatus === 'NO_SHOW') return null;

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------

  async function handleTransitionResult(
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
    const msg = TRANSITION_ERRORS[errorCode] ?? TRANSITION_ERRORS.INTERNAL_ERROR;
    setActionError(msg);
    addToast({ type: 'error', title: 'Action failed', message: msg });
  }

  function handleNetworkError(setErr: (m: string) => void, title: string): void {
    const msg = 'Unable to reach the server. Please check your connection.';
    setErr(msg);
    addToast({ type: 'error', title, message: msg });
  }

  // -------------------------------------------------------------------------
  // Status transition handlers (SCHEDULED only)
  // -------------------------------------------------------------------------

  async function handleComplete() {
    setActionError(null);
    setActiveAction('complete');
    try {
      const res = await fetch(`/api/recruiting/interviews/${interviewId}/complete`, { method: 'POST' });
      await handleTransitionResult(res, 'Interview completed', 'The interview has been marked as completed.');
    } catch {
      handleNetworkError(setActionError, 'Connection error');
    } finally {
      setActiveAction(null);
    }
  }

  async function handleCancel() {
    setActionError(null);
    setActiveAction('cancel');
    try {
      const res = await fetch(`/api/recruiting/interviews/${interviewId}/cancel`, { method: 'POST' });
      await handleTransitionResult(res, 'Interview cancelled', 'The interview has been cancelled.');
    } catch {
      handleNetworkError(setActionError, 'Connection error');
    } finally {
      setActiveAction(null);
    }
  }

  async function handleNoShow() {
    setActionError(null);
    setActiveAction('no-show');
    try {
      const res = await fetch(`/api/recruiting/interviews/${interviewId}/no-show`, { method: 'POST' });
      await handleTransitionResult(res, 'No-show recorded', 'The interview has been marked as no-show.');
    } catch {
      handleNetworkError(setActionError, 'Connection error');
    } finally {
      setActiveAction(null);
    }
  }

  // -------------------------------------------------------------------------
  // Feedback handler (COMPLETED only — GD-M20-1 D7)
  // -------------------------------------------------------------------------

  async function handleFeedbackSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setFeedbackError(null);

    const trimmed = feedbackText.trim();
    if (!trimmed) {
      setFeedbackError('Feedback cannot be empty.');
      return;
    }
    if (trimmed.length > 5000) {
      setFeedbackError('Feedback must be 5000 characters or fewer.');
      return;
    }

    setIsFeedbackSubmitting(true);
    try {
      const res = await fetch(`/api/recruiting/interviews/${interviewId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: trimmed }),
      });
      if (res.ok) {
        addToast({ type: 'success', title: 'Feedback recorded', message: 'Interview feedback has been saved.' });
        setFeedbackText('');
        setShowFeedback(false);
        router.refresh();
        return;
      }
      let errorCode = 'INTERNAL_ERROR';
      try {
        const data = (await res.json()) as { success: false; error: { code: string } };
        if (!data.success) errorCode = data.error?.code ?? 'INTERNAL_ERROR';
      } catch { /* ignore parse failure */ }
      const msg = FEEDBACK_ERRORS[errorCode] ?? FEEDBACK_ERRORS.INTERNAL_ERROR;
      setFeedbackError(msg);
      addToast({ type: 'error', title: 'Feedback failed', message: msg });
    } catch {
      handleNetworkError(setFeedbackError, 'Connection error');
    } finally {
      setIsFeedbackSubmitting(false);
    }
  }

  // =========================================================================
  // COMPLETED: feedback surface only (GD-M20-1 D7)
  // =========================================================================

  if (interviewStatus === 'COMPLETED') {
    return (
      <>
        <RecruitingToastContainer toasts={toasts} onDismiss={dismissToast} />

        {!showFeedback ? (
          <button
            type="button"
            onClick={() => { setShowFeedback(true); setFeedbackError(null); }}
            style={{
              backgroundColor: BLUE,
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              padding: '7px 14px',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Record Feedback
          </button>
        ) : (
          <div
            style={{
              padding: 20,
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              backgroundColor: CANVAS,
            }}
          >
            <h3 style={{ fontSize: 15, fontWeight: 600, color: TEXT, marginTop: 0, marginBottom: 16 }}>
              Record Feedback
            </h3>

            {feedbackError && (
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
                {feedbackError}
              </div>
            )}

            <form
              onSubmit={handleFeedbackSubmit}
              noValidate
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div>
                <label htmlFor="feedbackText" style={labelStyle}>
                  Feedback{' '}
                  <span aria-hidden="true" style={{ color: ERROR_COL }}>*</span>
                </label>
                <textarea
                  id="feedbackText"
                  rows={5}
                  placeholder="Enter interview feedback…"
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  disabled={isFeedbackSubmitting}
                  style={{
                    width: '100%',
                    border: `1px solid ${BORDER}`,
                    borderRadius: 6,
                    padding: '8px 12px',
                    fontSize: 14,
                    color: TEXT,
                    backgroundColor: '#ffffff',
                    outline: 'none',
                    boxSizing: 'border-box',
                    resize: 'vertical',
                  }}
                />
                <p style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
                  {feedbackText.length} / 5000
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="submit"
                  disabled={isFeedbackSubmitting}
                  style={{
                    backgroundColor: isFeedbackSubmitting ? MUTED : BLUE,
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '7px 16px',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: isFeedbackSubmitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isFeedbackSubmitting ? 'Saving…' : 'Save Feedback'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowFeedback(false); setFeedbackError(null); setFeedbackText(''); }}
                  disabled={isFeedbackSubmitting}
                  style={{
                    fontSize: 13,
                    color: isFeedbackSubmitting ? MUTED : SUB,
                    background: 'none',
                    border: `1px solid ${BORDER}`,
                    borderRadius: 6,
                    padding: '7px 14px',
                    cursor: isFeedbackSubmitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}
      </>
    );
  }

  // =========================================================================
  // SCHEDULED: status transition buttons (GD-M20-1 D7)
  // =========================================================================

  const isLoading = activeAction !== null;

  return (
    <>
      <RecruitingToastContainer toasts={toasts} onDismiss={dismissToast} />

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

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleComplete}
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
          {activeAction === 'complete' ? 'Completing…' : 'Mark Complete'}
        </button>

        <button
          type="button"
          onClick={handleCancel}
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
          {activeAction === 'cancel' ? 'Cancelling…' : 'Cancel Interview'}
        </button>

        <button
          type="button"
          onClick={handleNoShow}
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
          {activeAction === 'no-show' ? 'Recording…' : 'No Show'}
        </button>
      </div>
    </>
  );
}
