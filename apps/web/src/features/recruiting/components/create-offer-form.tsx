'use client';

// Create Offer form — application detail page (M20D Batch 3).
// Uses existing POST /api/recruiting/offers BFF (Batch 2).
// applicationId is always passed from the Server Component (not user input).
//
// Form visibility: only shown when application status is OFFER (GD-M20-1 D7).
// Gate is applied in the Server Component — this component does NOT re-check status.
// Backend enforces preconditions (APPLICATION_NOT_AT_OFFER_STATUS 422, ACTIVE_OFFER_EXISTS 409).
//
// On success: toast + router.refresh() to reload Server Component data.
// On error:   toast + inline error banner.
//
// Reference: governance/GD-M20-1.md — Decision 3, 7 (Applications / Create Offer)
// Reference: apps/web/src/app/api/recruiting/offers/route.ts

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
const BLUE      = '#2563eb';
const ERROR_COL = '#dc2626';
const CANVAS    = '#f8fafc';
const RED_BG    = '#fef2f2';
const RED_BDR   = '#fecaca';

// ---------------------------------------------------------------------------
// Error messages keyed by BFF / NestJS error codes
// ---------------------------------------------------------------------------

const FORM_ERRORS: Record<string, string> = {
  APPLICATION_NOT_FOUND:           'Application not found.',
  APPLICATION_NOT_AT_OFFER_STATUS: 'The application must be at OFFER status to create an offer.',
  ACTIVE_OFFER_EXISTS:             'An active offer already exists for this application.',
  VALIDATION_ERROR:                'Invalid form data. Please check your entries and try again.',
  UNAUTHORIZED:                    'Your session has expired. Please sign in again.',
  FORBIDDEN:                       "You don't have permission to create offers.",
  INTERNAL_ERROR:                  'Service unavailable. Please try again.',
};

const NOTES_MAX = 5000;

// ---------------------------------------------------------------------------
// Label + input helpers
// ---------------------------------------------------------------------------

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: SUB,
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  fontSize: 13,
  color: TEXT,
  background: '#ffffff',
  boxSizing: 'border-box',
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

export function CreateOfferForm({ applicationId }: Props) {
  const router = useRouter();
  const { toasts, addToast, dismissToast } = useRecruitingToast();

  const [isOpen,       setIsOpen]       = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  // Form fields
  const [offerDate, setOfferDate] = useState('');
  const [notes,     setNotes]     = useState('');

  function resetForm() {
    setOfferDate('');
    setNotes('');
    setError(null);
    setIsOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (notes.length > NOTES_MAX) {
      setError(`Notes must be ${NOTES_MAX.toLocaleString()} characters or fewer.`);
      return;
    }

    // Build body — applicationId always from props; never from user input
    const body: Record<string, string> = { applicationId };
    // offerDate from <input type="date"> → "YYYY-MM-DD"; IsISO8601 (strict: false) accepts it
    if (offerDate)    body.offerDate = offerDate;
    if (notes.trim()) body.notes     = notes.trim();

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/recruiting/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        addToast({ type: 'success', title: 'Offer created', message: 'The offer has been created successfully.' });
        resetForm();
        router.refresh();
        return;
      }

      let errorCode = 'INTERNAL_ERROR';
      try {
        const data = (await res.json()) as { success: false; error: { code: string } };
        if (!data.success) errorCode = data.error?.code ?? 'INTERNAL_ERROR';
      } catch { /* ignore parse failure */ }

      const msg = FORM_ERRORS[errorCode] ?? FORM_ERRORS.INTERNAL_ERROR;
      setError(msg);
      addToast({ type: 'error', title: 'Create offer failed', message: msg });
    } catch {
      const msg = 'Unable to reach the server. Please check your connection.';
      setError(msg);
      addToast({ type: 'error', title: 'Connection error', message: msg });
    } finally {
      setIsSubmitting(false);
    }
  }

  // =========================================================================
  // Render
  // =========================================================================

  if (!isOpen) {
    return (
      <>
        <RecruitingToastContainer toasts={toasts} onDismiss={dismissToast} />
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          style={{
            backgroundColor: 'transparent',
            color: BLUE,
            border: `1px solid ${BORDER}`,
            borderRadius: 6,
            padding: '7px 14px',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Create Offer
        </button>
      </>
    );
  }

  const notesOverLimit = notes.length > NOTES_MAX;

  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: 20,
        backgroundColor: CANVAS,
      }}
    >
      <RecruitingToastContainer toasts={toasts} onDismiss={dismissToast} />

      <h3 style={{ fontSize: 15, fontWeight: 600, color: TEXT, marginTop: 0, marginBottom: 16 }}>
        Create Offer
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
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        {/* Offer Date */}
        <div>
          <label htmlFor="cof-date" style={labelStyle}>
            Offer Date <span style={{ color: MUTED }}>(optional)</span>
          </label>
          <input
            id="cof-date"
            type="date"
            value={offerDate}
            onChange={(e) => setOfferDate(e.target.value)}
            disabled={isSubmitting}
            style={{ ...inputStyle, cursor: isSubmitting ? 'not-allowed' : 'default' }}
          />
        </div>

        {/* Notes */}
        <div>
          <label htmlFor="cof-notes" style={labelStyle}>
            Notes <span style={{ color: MUTED }}>(optional)</span>
          </label>
          <textarea
            id="cof-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isSubmitting}
            rows={4}
            placeholder="Optional notes for this offer…"
            style={{
              ...inputStyle,
              resize: 'vertical',
              fontFamily: 'inherit',
              lineHeight: 1.5,
              cursor: isSubmitting ? 'not-allowed' : 'default',
              borderColor: notesOverLimit ? ERROR_COL : BORDER,
            }}
          />
          <p
            style={{
              fontSize: 11,
              marginTop: 4,
              textAlign: 'right',
              color: notesOverLimit ? ERROR_COL : MUTED,
            }}
          >
            {notes.length.toLocaleString()} / {NOTES_MAX.toLocaleString()}
          </p>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button
            type="submit"
            disabled={isSubmitting || notesOverLimit}
            style={{
              backgroundColor: isSubmitting || notesOverLimit ? MUTED : BLUE,
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              padding: '7px 16px',
              fontSize: 13,
              fontWeight: 500,
              cursor: isSubmitting || notesOverLimit ? 'not-allowed' : 'pointer',
            }}
          >
            {isSubmitting ? 'Creating…' : 'Create Offer'}
          </button>
          <button
            type="button"
            onClick={resetForm}
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
      </form>
    </div>
  );
}
