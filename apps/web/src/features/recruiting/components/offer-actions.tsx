'use client';

// Offer action surfaces for the offer detail page (M20D Batch 2).
// Rendered only for write-capable roles (SA, HRD, Recruiter) — gate applied in Server Component.
//
// Status-based behavior (GD-M20-1 D7):
//   DRAFT             → Submit + Withdraw
//   PENDING_APPROVAL  → Approve (SA/HRD only, canApproveAndSend) + Withdraw
//   APPROVED          → Send   (SA/HRD only, canApproveAndSend) + Withdraw
//   SENT              → Record Response (ACCEPTED | DECLINED) inline form + Withdraw
//   ACCEPTED          → null (terminal)
//   DECLINED          → null (terminal)
//   WITHDRAWN         → null (terminal)
//
// canApproveAndSend prop: true only for SA and HR Director; false for Recruiter.
// Gated at Server Component — this component trusts the prop.
//
// On success: toast + router.refresh() to reload Server Component data.
// On error:   toast + inline error banner.
//
// Reference: governance/GD-M20-1.md — Decision 3, 5, 7 (Offers)
// Reference: apps/api/src/recruiting/offer.controller.ts

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecruitingToast, RecruitingToastContainer } from './recruiting-toast';
import type { OfferStatus } from '@/features/recruiting/types';

// ---------------------------------------------------------------------------
// Error messages keyed by NestJS BFF error code
// ---------------------------------------------------------------------------

const TRANSITION_ERRORS: Record<string, string> = {
  OFFER_NOT_FOUND:           'Offer not found.',
  OFFER_IN_TERMINAL_STATE:   'This offer is already in a terminal state and cannot be changed.',
  OFFER_NOT_IN_DRAFT:        'The offer must be in DRAFT status to submit.',
  OFFER_NOT_PENDING_APPROVAL:'The offer must be in PENDING_APPROVAL status to approve.',
  OFFER_NOT_APPROVED:        'The offer must be in APPROVED status to send.',
  UNAUTHORIZED:              'Your session has expired. Please sign in again.',
  FORBIDDEN:                 "You don't have permission to perform this action.",
  INTERNAL_ERROR:            'Service unavailable. Please try again.',
};

const RESPONSE_ERRORS: Record<string, string> = {
  OFFER_NOT_FOUND:         'Offer not found.',
  OFFER_IN_TERMINAL_STATE: 'This offer is already in a terminal state.',
  OFFER_NOT_SENT:          'The offer must be in SENT status to record a response.',
  UNAUTHORIZED:            'Your session has expired. Please sign in again.',
  FORBIDDEN:               "You don't have permission to record a response.",
  INTERNAL_ERROR:          'Service unavailable. Please try again.',
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ActiveAction = 'submit' | 'approve' | 'send' | 'withdraw' | null;

type Props = {
  offerId: string;
  offerStatus: OfferStatus;
  canApproveAndSend: boolean;
};

export function OfferActions({ offerId, offerStatus, canApproveAndSend }: Props) {
  const router = useRouter();
  const { toasts, addToast, dismissToast } = useRecruitingToast();

  // Transition action state
  const [activeAction,   setActiveAction]   = useState<ActiveAction>(null);
  const [actionError,    setActionError]    = useState<string | null>(null);

  // Record-response state (SENT status only)
  const [selectedResponse,   setSelectedResponse]   = useState<'ACCEPTED' | 'DECLINED' | ''>('');
  const [isResponseSubmitting, setIsResponseSubmitting] = useState(false);
  const [responseError,      setResponseError]      = useState<string | null>(null);

  // Terminal statuses — no surfaces (GD-M20-1 D7).
  if (offerStatus === 'ACCEPTED' || offerStatus === 'DECLINED' || offerStatus === 'WITHDRAWN') {
    return null;
  }

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
  // Transition handlers
  // -------------------------------------------------------------------------

  async function handleSubmit() {
    setActionError(null);
    setActiveAction('submit');
    try {
      const res = await fetch(`/api/recruiting/offers/${offerId}/submit`, { method: 'POST' });
      await handleTransitionResult(res, 'Offer submitted', 'The offer has been submitted for approval.');
    } catch {
      handleNetworkError(setActionError, 'Connection error');
    } finally {
      setActiveAction(null);
    }
  }

  async function handleApprove() {
    setActionError(null);
    setActiveAction('approve');
    try {
      const res = await fetch(`/api/recruiting/offers/${offerId}/approve`, { method: 'POST' });
      await handleTransitionResult(res, 'Offer approved', 'The offer has been approved.');
    } catch {
      handleNetworkError(setActionError, 'Connection error');
    } finally {
      setActiveAction(null);
    }
  }

  async function handleSend() {
    setActionError(null);
    setActiveAction('send');
    try {
      const res = await fetch(`/api/recruiting/offers/${offerId}/send`, { method: 'POST' });
      await handleTransitionResult(res, 'Offer sent', 'The offer has been sent to the candidate.');
    } catch {
      handleNetworkError(setActionError, 'Connection error');
    } finally {
      setActiveAction(null);
    }
  }

  async function handleWithdraw() {
    setActionError(null);
    setActiveAction('withdraw');
    try {
      const res = await fetch(`/api/recruiting/offers/${offerId}/withdraw`, { method: 'POST' });
      await handleTransitionResult(res, 'Offer withdrawn', 'The offer has been withdrawn.');
    } catch {
      handleNetworkError(setActionError, 'Connection error');
    } finally {
      setActiveAction(null);
    }
  }

  // -------------------------------------------------------------------------
  // Record-response handler (SENT status only — GD-M20-1 D7)
  // -------------------------------------------------------------------------

  async function handleRecordResponse(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setResponseError(null);

    if (!selectedResponse) {
      setResponseError('Please select ACCEPTED or DECLINED.');
      return;
    }

    setIsResponseSubmitting(true);
    try {
      const res = await fetch(`/api/recruiting/offers/${offerId}/record-response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: selectedResponse }),
      });
      if (res.ok) {
        addToast({
          type: 'success',
          title: 'Response recorded',
          message: `Offer response recorded as ${selectedResponse}.`,
        });
        setSelectedResponse('');
        router.refresh();
        return;
      }
      let errorCode = 'INTERNAL_ERROR';
      try {
        const data = (await res.json()) as { success: false; error: { code: string } };
        if (!data.success) errorCode = data.error?.code ?? 'INTERNAL_ERROR';
      } catch { /* ignore parse failure */ }
      const msg = RESPONSE_ERRORS[errorCode] ?? RESPONSE_ERRORS.INTERNAL_ERROR;
      setResponseError(msg);
      addToast({ type: 'error', title: 'Response failed', message: msg });
    } catch {
      handleNetworkError(setResponseError, 'Connection error');
    } finally {
      setIsResponseSubmitting(false);
    }
  }

  // =========================================================================
  // Render: status-gated surfaces
  // =========================================================================

  const isLoading = activeAction !== null;

  // Common error banner
  const errorBanner = actionError ? (
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
  ) : null;

  // Withdraw button — shared across DRAFT, PENDING_APPROVAL, APPROVED, SENT
  const withdrawButton = (
    <button
      type="button"
      onClick={handleWithdraw}
      disabled={isLoading || isResponseSubmitting}
      style={{
        backgroundColor: 'transparent',
        color: isLoading || isResponseSubmitting ? MUTED : ERROR_COL,
        border: `1px solid ${isLoading || isResponseSubmitting ? BORDER : RED_BDR}`,
        borderRadius: 6,
        padding: '7px 14px',
        fontSize: 13,
        fontWeight: 500,
        cursor: isLoading || isResponseSubmitting ? 'not-allowed' : 'pointer',
      }}
    >
      {activeAction === 'withdraw' ? 'Withdrawing…' : 'Withdraw Offer'}
    </button>
  );

  // -------------------------------------------------------------------------
  // DRAFT: Submit + Withdraw
  // -------------------------------------------------------------------------
  if (offerStatus === 'DRAFT') {
    return (
      <>
        <RecruitingToastContainer toasts={toasts} onDismiss={dismissToast} />
        {errorBanner}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleSubmit}
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
            {activeAction === 'submit' ? 'Submitting…' : 'Submit for Approval'}
          </button>
          {withdrawButton}
        </div>
      </>
    );
  }

  // -------------------------------------------------------------------------
  // PENDING_APPROVAL: Approve (SA/HRD only) + Withdraw
  // -------------------------------------------------------------------------
  if (offerStatus === 'PENDING_APPROVAL') {
    return (
      <>
        <RecruitingToastContainer toasts={toasts} onDismiss={dismissToast} />
        {errorBanner}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {canApproveAndSend && (
            <button
              type="button"
              onClick={handleApprove}
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
              {activeAction === 'approve' ? 'Approving…' : 'Approve Offer'}
            </button>
          )}
          {withdrawButton}
        </div>
      </>
    );
  }

  // -------------------------------------------------------------------------
  // APPROVED: Send (SA/HRD only) + Withdraw
  // -------------------------------------------------------------------------
  if (offerStatus === 'APPROVED') {
    return (
      <>
        <RecruitingToastContainer toasts={toasts} onDismiss={dismissToast} />
        {errorBanner}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {canApproveAndSend && (
            <button
              type="button"
              onClick={handleSend}
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
              {activeAction === 'send' ? 'Sending…' : 'Send to Candidate'}
            </button>
          )}
          {withdrawButton}
        </div>
      </>
    );
  }

  // -------------------------------------------------------------------------
  // SENT: Record response inline form + Withdraw (GD-M20-1 D7)
  // -------------------------------------------------------------------------
  if (offerStatus === 'SENT') {
    return (
      <>
        <RecruitingToastContainer toasts={toasts} onDismiss={dismissToast} />
        {errorBanner}

        <div
          style={{
            padding: 20,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            backgroundColor: CANVAS,
            marginBottom: 12,
          }}
        >
          <h3 style={{ fontSize: 15, fontWeight: 600, color: TEXT, marginTop: 0, marginBottom: 16 }}>
            Record Candidate Response
          </h3>

          {responseError && (
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
              {responseError}
            </div>
          )}

          <form
            onSubmit={handleRecordResponse}
            noValidate
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => { setSelectedResponse('ACCEPTED'); setResponseError(null); }}
                disabled={isResponseSubmitting}
                style={{
                  padding: '8px 20px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: isResponseSubmitting ? 'not-allowed' : 'pointer',
                  border: selectedResponse === 'ACCEPTED'
                    ? '2px solid #16a34a'
                    : `1px solid ${BORDER}`,
                  backgroundColor: selectedResponse === 'ACCEPTED' ? '#f0fdf4' : '#ffffff',
                  color: selectedResponse === 'ACCEPTED' ? '#15803d' : SUB,
                }}
              >
                Accepted
              </button>
              <button
                type="button"
                onClick={() => { setSelectedResponse('DECLINED'); setResponseError(null); }}
                disabled={isResponseSubmitting}
                style={{
                  padding: '8px 20px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: isResponseSubmitting ? 'not-allowed' : 'pointer',
                  border: selectedResponse === 'DECLINED'
                    ? `2px solid ${ERROR_COL}`
                    : `1px solid ${BORDER}`,
                  backgroundColor: selectedResponse === 'DECLINED' ? RED_BG : '#ffffff',
                  color: selectedResponse === 'DECLINED' ? ERROR_COL : SUB,
                }}
              >
                Declined
              </button>
            </div>

            {selectedResponse && (
              <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>
                Recording response as{' '}
                <strong style={{ color: selectedResponse === 'ACCEPTED' ? '#15803d' : ERROR_COL }}>
                  {selectedResponse}
                </strong>
                . This cannot be undone.
              </p>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="submit"
                disabled={isResponseSubmitting || !selectedResponse}
                style={{
                  backgroundColor: isResponseSubmitting || !selectedResponse ? MUTED : BLUE,
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '7px 16px',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: isResponseSubmitting || !selectedResponse ? 'not-allowed' : 'pointer',
                }}
              >
                {isResponseSubmitting ? 'Recording…' : 'Confirm Response'}
              </button>
            </div>
          </form>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {withdrawButton}
        </div>
      </>
    );
  }

  // Fallback — should not be reached given terminal check above, but satisfies TypeScript.
  return null;
}
