'use client';

// Schedule Interview form — application detail page (M20D Batch 3).
// Uses existing POST /api/recruiting/interviews BFF (Batch 1).
// applicationId is always passed from the Server Component (not user input).
//
// Form visibility: shown for write-capable roles regardless of application status (GD-M20-1 D7).
// Backend enforces linkage preconditions (APPLICATION_NOT_FOUND, etc.).
//
// On success: toast + router.refresh() to reload Server Component data.
// On error:   toast + inline error banner.
//
// Reference: governance/GD-M20-1.md — Decision 3, 7 (Applications / Schedule Interview)
// Reference: apps/web/src/app/api/recruiting/interviews/route.ts

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
  INTERVIEWER_REQUIRED:   'Interviewer is required.',
  APPLICATION_NOT_FOUND:  'Application not found.',
  VALIDATION_ERROR:       'Invalid form data. Please check your entries and try again.',
  UNAUTHORIZED:           'Your session has expired. Please sign in again.',
  FORBIDDEN:              "You don't have permission to schedule interviews.",
  INTERNAL_ERROR:         'Service unavailable. Please try again.',
};

const INTERVIEW_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'PHONE_SCREEN', label: 'Phone Screen' },
  { value: 'PANEL',        label: 'Panel' },
  { value: 'TECHNICAL',    label: 'Technical' },
  { value: 'FINAL',        label: 'Final' },
];

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

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: MUTED,
  marginTop: 4,
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

export function ScheduleInterviewForm({ applicationId }: Props) {
  const router = useRouter();
  const { toasts, addToast, dismissToast } = useRecruitingToast();

  const [isOpen,        setIsOpen]        = useState(false);
  const [isSubmitting,  setIsSubmitting]  = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  // Form fields
  const [interviewType,     setInterviewType]     = useState('');
  const [scheduledDate,     setScheduledDate]     = useState('');
  const [scheduledTime,     setScheduledTime]     = useState('');
  const [interviewer, setInterviewer] = useState('');

  function resetForm() {
    setInterviewType('');
    setScheduledDate('');
    setScheduledTime('');
    setInterviewer('');
    setError(null);
    setIsOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Client-side validation
    if (!interviewType) {
      setError('Interview type is required.');
      return;
    }
    const interviewerValue = interviewer.trim();
    if (!interviewerValue) {
      setError(FORM_ERRORS.INTERVIEWER_REQUIRED);
      return;
    }

    // Build body — applicationId always from props; never from user input
    const body: Record<string, string> = {
      applicationId,
      interviewType,
    };
    if (scheduledDate) {
      const combined = scheduledTime ? `${scheduledDate}T${scheduledTime}:00` : `${scheduledDate}T00:00:00`;
      body.scheduledAt = new Date(combined).toISOString();
    }
    // Route to the correct API field: UUID pattern → interviewerUserId, otherwise → interviewerName
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (UUID_RE.test(interviewerValue)) {
      body.interviewerUserId = interviewerValue;
    } else {
      body.interviewerName = interviewerValue;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/recruiting/interviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        addToast({ type: 'success', title: 'Interview scheduled', message: 'The interview has been scheduled successfully.' });
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
      addToast({ type: 'error', title: 'Schedule failed', message: msg });
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
          Schedule Interview
        </button>
      </>
    );
  }

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
        Schedule Interview
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
        {/* Interview Type */}
        <div>
          <label htmlFor="sif-type" style={labelStyle}>
            Interview Type <span style={{ color: ERROR_COL }}>*</span>
          </label>
          <select
            id="sif-type"
            value={interviewType}
            onChange={(e) => setInterviewType(e.target.value)}
            disabled={isSubmitting}
            style={{ ...inputStyle, cursor: isSubmitting ? 'not-allowed' : 'default' }}
          >
            <option value="">Select type…</option>
            {INTERVIEW_TYPE_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {/* Scheduled At — split into date + time to avoid browser datetime-local overlay */}
        <div>
          <label style={labelStyle}>
            Scheduled At <span style={{ color: MUTED }}>(optional)</span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="sif-date"
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              disabled={isSubmitting}
              style={{ ...inputStyle, flex: 1, cursor: isSubmitting ? 'not-allowed' : 'default' }}
            />
            <input
              id="sif-time"
              type="time"
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
              disabled={isSubmitting || !scheduledDate}
              placeholder="HH:MM"
              style={{ ...inputStyle, width: 120, cursor: (isSubmitting || !scheduledDate) ? 'not-allowed' : 'default', opacity: scheduledDate ? 1 : 0.4 }}
            />
          </div>
        </div>

        {/* Interviewer */}
        <div>
          <label htmlFor="sif-interviewer" style={{ ...labelStyle, marginBottom: 4 }}>
            Interviewer <span style={{ color: '#dc2626', marginLeft: 2 }}>*</span>
          </label>
          <p style={{ ...hintStyle, marginBottom: 8 }}>
            Provide a name or a user ID
          </p>
          <input
            id="sif-interviewer"
            type="text"
            value={interviewer}
            onChange={(e) => setInterviewer(e.target.value)}
            disabled={isSubmitting}
            maxLength={255}
            placeholder="Name or user ID (UUID)"
            style={{ ...inputStyle, cursor: isSubmitting ? 'not-allowed' : 'default' }}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              backgroundColor: isSubmitting ? MUTED : BLUE,
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              padding: '7px 16px',
              fontSize: 13,
              fontWeight: 500,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            {isSubmitting ? 'Scheduling…' : 'Schedule Interview'}
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
