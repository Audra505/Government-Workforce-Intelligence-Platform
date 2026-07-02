'use client';

// Candidate action surfaces for the candidate detail page (M20C Batch 3).
// Rendered only for roles that can write (SA, HRD, Recruiter) — gate applied in Server Component.
// Handles two actions:
//   1. Archive candidate  → POST /api/recruiting/candidates/:id  (no body, 204 from NestJS)
//   2. Submit application → POST /api/recruiting/applications     (candidateId fixed from page)
//
// candidateId is derived from the Server Component URL param, not from user input.
//
// On success: toast + router.refresh() to reload Server Component data.
// On error:   toast + inline error banner.
//
// Reference: governance/GD-M20-1.md — Decision 3, 5, 6, 7 (Candidates)
// Reference: apps/api/src/recruiting/candidate.controller.ts — POST /candidates/:id/archive (line 267)
// Reference: apps/api/src/recruiting/application.controller.ts — POST /applications (line 72)

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRecruitingToast, RecruitingToastContainer } from './recruiting-toast';
import type { CandidateStatus } from '@/features/recruiting/types';

// ---------------------------------------------------------------------------
// Vacancy option — subset of VacancyRow used for the vacancy dropdown.
// Exported so the parent Server Component can type-check the prop.
// ---------------------------------------------------------------------------

export type VacancyOption = {
  id: string;
  positionTitle: string;
  departmentName: string;
};

// ---------------------------------------------------------------------------
// Zod schema — submit application form
// Field constraints match CreateApplicationDto in the backend.
// ---------------------------------------------------------------------------

const appSchema = z.object({
  vacancyId:    z.string().min(1, 'Please select a vacancy'),
  currentStage: z.string().max(100, 'Stage must be 100 characters or fewer').optional(),
  notes:        z.string().max(5000, 'Notes must be 5000 characters or fewer').optional(),
});

type AppFormValues = z.infer<typeof appSchema>;

// ---------------------------------------------------------------------------
// User-readable error messages keyed by NestJS BFF error code
// ---------------------------------------------------------------------------

const ARCHIVE_ERRORS: Record<string, string> = {
  CANDIDATE_HAS_ACTIVE_APPLICATIONS:
    'Cannot archive: this candidate has active applications. Close or withdraw all applications before archiving.',
  CANDIDATE_NOT_FOUND: 'Candidate not found.',
  UNAUTHORIZED:        'Your session has expired. Please sign in again.',
  FORBIDDEN:           "You don't have permission to archive candidates.",
  INTERNAL_ERROR:      'Service unavailable. Please try again.',
};

const APP_ERRORS: Record<string, string> = {
  APPLICATION_ALREADY_EXISTS:
    'An active application already exists for this candidate and vacancy.',
  CANDIDATE_ARCHIVED:   'This candidate is archived and cannot submit new applications.',
  VACANCY_NOT_OPEN:     'The selected vacancy is not open for applications.',
  VACANCY_NOT_FOUND:    'The selected vacancy was not found.',
  CANDIDATE_NOT_FOUND:  'Candidate not found.',
  VALIDATION_ERROR:     'Invalid form data. Please review your entries.',
  UNAUTHORIZED:         'Your session has expired. Please sign in again.',
  FORBIDDEN:            "You don't have permission to create applications.",
  INTERNAL_ERROR:       'Service unavailable. Please try again.',
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

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 14,
  color: TEXT,
  backgroundColor: '#ffffff',
  outline: 'none',
  boxSizing: 'border-box',
};

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

type Props = {
  candidateId: string;
  candidateStatus: CandidateStatus;
  eligibleVacancies: VacancyOption[];
};

export function CandidateActions({ candidateId, candidateStatus, eligibleVacancies }: Props) {
  const router = useRouter();
  const { toasts, addToast, dismissToast } = useRecruitingToast();

  const [isArchiving,   setIsArchiving]   = useState(false);
  const [archiveError,  setArchiveError]  = useState<string | null>(null);
  const [showAppForm,   setShowAppForm]   = useState(false);
  const [appError,      setAppError]      = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset: resetAppForm,
    formState: { errors: appErrors, isSubmitting },
  } = useForm<AppFormValues>({
    resolver: zodResolver(appSchema),
    defaultValues: { vacancyId: '', currentStage: '', notes: '' },
  });

  // Archived candidates have no action surfaces (GD-M20-1 D7).
  if (candidateStatus === 'ARCHIVED') return null;

  // -------------------------------------------------------------------------
  // Archive
  // -------------------------------------------------------------------------

  async function handleArchive() {
    setArchiveError(null);
    setIsArchiving(true);
    try {
      const res = await fetch(`/api/recruiting/candidates/${candidateId}`, {
        method: 'POST',
      });
      if (res.ok) {
        addToast({ type: 'success', title: 'Candidate archived', message: 'The candidate record has been archived.' });
        router.push('/recruiting/candidates?archived=1');
        return;
      }
      let errorCode = 'INTERNAL_ERROR';
      try {
        const data = (await res.json()) as { success: false; error: { code: string } };
        if (!data.success) errorCode = data.error?.code ?? 'INTERNAL_ERROR';
      } catch { /* ignore parse failure */ }
      const msg = ARCHIVE_ERRORS[errorCode] ?? ARCHIVE_ERRORS.INTERNAL_ERROR;
      setArchiveError(msg);
      addToast({ type: 'error', title: 'Archive failed', message: msg });
    } catch {
      const msg = 'Unable to reach the server. Please check your connection.';
      setArchiveError(msg);
      addToast({ type: 'error', title: 'Connection error', message: msg });
    } finally {
      setIsArchiving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Submit application
  // -------------------------------------------------------------------------

  async function onSubmitApp(values: AppFormValues) {
    setAppError(null);

    const body: Record<string, string> = {
      candidateId,
      vacancyId: values.vacancyId,
    };
    if (values.currentStage?.trim()) body.currentStage = values.currentStage.trim();
    if (values.notes?.trim())        body.notes        = values.notes.trim();

    try {
      const res = await fetch('/api/recruiting/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 201) {
        addToast({ type: 'success', title: 'Application submitted', message: 'The application has been created successfully.' });
        resetAppForm();
        setShowAppForm(false);
        router.refresh();
        return;
      }
      let errorCode = 'INTERNAL_ERROR';
      try {
        const data = (await res.json()) as { success: false; error: { code: string } };
        if (!data.success) errorCode = data.error?.code ?? 'INTERNAL_ERROR';
      } catch { /* ignore parse failure */ }
      const msg = APP_ERRORS[errorCode] ?? APP_ERRORS.INTERNAL_ERROR;
      setAppError(msg);
      addToast({ type: 'error', title: 'Application failed', message: msg });
    } catch {
      const msg = 'Unable to reach the server. Please check your connection.';
      setAppError(msg);
      addToast({ type: 'error', title: 'Connection error', message: msg });
    }
  }

  const submitDisabled = isSubmitting || eligibleVacancies.length === 0;

  return (
    <>
      <RecruitingToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Archive error banner */}
      {archiveError && (
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
          {archiveError}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleArchive}
          disabled={isArchiving}
          style={{
            backgroundColor: 'transparent',
            color: isArchiving ? MUTED : ERROR_COL,
            border: `1px solid ${isArchiving ? BORDER : RED_BDR}`,
            borderRadius: 6,
            padding: '7px 14px',
            fontSize: 13,
            fontWeight: 500,
            cursor: isArchiving ? 'not-allowed' : 'pointer',
          }}
        >
          {isArchiving ? 'Archiving…' : 'Archive Candidate'}
        </button>

        {!showAppForm && (
          <button
            type="button"
            onClick={() => { setShowAppForm(true); setAppError(null); }}
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
            Submit Application
          </button>
        )}
      </div>

      {/* Inline submit application form */}
      {showAppForm && (
        <div
          style={{
            marginTop: 20,
            padding: 20,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            backgroundColor: CANVAS,
          }}
        >
          <h3 style={{ fontSize: 15, fontWeight: 600, color: TEXT, marginTop: 0, marginBottom: 16 }}>
            Submit Application
          </h3>

          {appError && (
            <div
              role="alert"
              style={{
                backgroundColor: RED_BG,
                border: `1px solid ${RED_BDR}`,
                borderRadius: 6,
                padding: '10px 14px',
                fontSize: 13,
                color: ERROR_COL,
                marginBottom: 16,
              }}
            >
              {appError}
            </div>
          )}

          <form
            onSubmit={handleSubmit(onSubmitApp)}
            noValidate
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            {/* Vacancy selector */}
            <div>
              <label htmlFor="vacancyId" style={labelStyle}>
                Vacancy{' '}
                <span aria-hidden="true" style={{ color: ERROR_COL }}>*</span>
              </label>
              {eligibleVacancies.length === 0 ? (
                <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>
                  No open vacancies available at this time.
                </p>
              ) : (
                <select
                  id="vacancyId"
                  {...register('vacancyId')}
                  style={inputStyle}
                  aria-describedby={appErrors.vacancyId ? 'vacancyId-error' : undefined}
                >
                  <option value="">Select a vacancy…</option>
                  {eligibleVacancies.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.positionTitle} — {v.departmentName}
                    </option>
                  ))}
                </select>
              )}
              {appErrors.vacancyId && (
                <p id="vacancyId-error" role="alert" style={{ fontSize: 12, color: ERROR_COL, marginTop: 4 }}>
                  {appErrors.vacancyId.message}
                </p>
              )}
            </div>

            {/* Current stage — optional */}
            <div>
              <label htmlFor="currentStage" style={labelStyle}>
                Current stage{' '}
                <span style={{ color: MUTED, fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                id="currentStage"
                type="text"
                placeholder="e.g. Phone Screening"
                {...register('currentStage')}
                style={inputStyle}
              />
              {appErrors.currentStage && (
                <p role="alert" style={{ fontSize: 12, color: ERROR_COL, marginTop: 4 }}>
                  {appErrors.currentStage.message}
                </p>
              )}
            </div>

            {/* Notes — optional */}
            <div>
              <label htmlFor="appNotes" style={labelStyle}>
                Notes{' '}
                <span style={{ color: MUTED, fontWeight: 400 }}>(optional)</span>
              </label>
              <textarea
                id="appNotes"
                rows={3}
                placeholder="Internal notes about this application"
                {...register('notes')}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
              {appErrors.notes && (
                <p role="alert" style={{ fontSize: 12, color: ERROR_COL, marginTop: 4 }}>
                  {appErrors.notes.message}
                </p>
              )}
            </div>

            {/* Form actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="submit"
                disabled={submitDisabled}
                style={{
                  backgroundColor: submitDisabled ? MUTED : BLUE,
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '7px 16px',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: submitDisabled ? 'not-allowed' : 'pointer',
                }}
              >
                {isSubmitting ? 'Submitting…' : 'Submit Application'}
              </button>
              <button
                type="button"
                onClick={() => { setShowAppForm(false); setAppError(null); resetAppForm(); }}
                style={{
                  fontSize: 13,
                  color: SUB,
                  background: 'none',
                  border: `1px solid ${BORDER}`,
                  borderRadius: 6,
                  padding: '7px 14px',
                  cursor: 'pointer',
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
