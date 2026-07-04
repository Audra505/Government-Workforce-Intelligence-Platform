'use client';

// Edit Candidate form — React Hook Form + Zod.
// Calls BFF PUT /api/recruiting/candidates/:id (never NestJS directly — JWT in httpOnly cookie).
//
// On 200 success:  show success toast → navigate back to /recruiting/candidates/:id.
// On error:        show error toast + inline form-level error with user-readable message.
// CANDIDATE_EMAIL_ALREADY_EXISTS is handled with a clear message.
//
// Field constraints mirror UpdateCandidateDto (all optional; firstName/lastName/email required
// by the form for a complete candidate record even though the DTO accepts sparse updates):
//   firstName  max 100 (required)
//   lastName   max 100 (required)
//   email      max 255 (required, validated email format)
//   phone      max 50  (optional)
//   source     max 100 (optional)
//   notes      no max  (optional)
//
// status and tenantId are never sent — managed via archive endpoint and SEC-003 respectively.
//
// Reference: governance/GD-M20-1.md — Decision 3 (BFF), 6 (SEC-003), 7 (Candidates), 16 (design)

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { useRecruitingToast, RecruitingToastContainer } from './recruiting-toast';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const schema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100, 'First name must be 100 characters or fewer'),
  lastName:  z.string().min(1, 'Last name is required').max(100, 'Last name must be 100 characters or fewer'),
  email:     z.string().min(1, 'Email is required').email('Please enter a valid email address').max(255, 'Email must be 255 characters or fewer'),
  phone:     z.string().max(50, 'Phone must be 50 characters or fewer').optional(),
  source:    z.string().max(100, 'Source must be 100 characters or fewer').optional(),
  notes:     z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

// ---------------------------------------------------------------------------
// Error messages keyed by NestJS BFF error code
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  CANDIDATE_EMAIL_ALREADY_EXISTS: 'A candidate with this email address already exists. Please use a different email.',
  VALIDATION_ERROR:               'Invalid form data. Please review your entries.',
  UNAUTHORIZED:                   'Your session has expired. Please sign in again.',
  FORBIDDEN:                      "You don't have permission to edit candidates.",
  INTERNAL_ERROR:                 'Service unavailable. Please try again in a moment.',
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

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 14,
  color: TEXT,
  backgroundColor: CANVAS,
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

const fieldErrorStyle: React.CSSProperties = {
  fontSize: 12,
  color: ERROR_COL,
  marginTop: 4,
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  candidateId: string;
  defaultValues: {
    firstName: string;
    lastName:  string;
    email:     string;
    phone:     string;
    source:    string;
    notes:     string;
  };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EditCandidateForm({ candidateId, defaultValues }: Props) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading]     = useState(false);
  const { toasts, addToast, dismissToast } = useRecruitingToast();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    setIsLoading(true);

    // Always include optional fields — sending empty string allows clearing a prior value.
    // phone/source/notes have no @IsNotEmpty() in UpdateCandidateDto, so "" is valid.
    const body: Record<string, string> = {
      firstName: values.firstName,
      lastName:  values.lastName,
      email:     values.email,
      phone:     values.phone?.trim()  ?? '',
      source:    values.source?.trim() ?? '',
      notes:     values.notes?.trim()  ?? '',
    };

    try {
      const res = await fetch(`/api/recruiting/candidates/${candidateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        addToast({
          type: 'success',
          title: 'Candidate updated',
          message: `${values.firstName} ${values.lastName} has been updated.`,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 600));
        router.push(`/recruiting/candidates/${candidateId}`);
        return;
      }

      let errorCode = 'INTERNAL_ERROR';
      try {
        const data = (await res.json()) as { success: false; error: { code: string; message: string } };
        if (!data.success) {
          errorCode = data.error?.code ?? 'INTERNAL_ERROR';
        }
      } catch {
        // body parse failed — use default error code
      }

      const userMessage = ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.INTERNAL_ERROR;
      setServerError(userMessage);
      addToast({ type: 'error', title: 'Could not update candidate', message: userMessage });
    } catch {
      const msg = 'Unable to reach the server. Please check your connection and try again.';
      setServerError(msg);
      addToast({ type: 'error', title: 'Connection error', message: msg });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <RecruitingToastContainer toasts={toasts} onDismiss={dismissToast} />

      <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Form-level server error */}
        {serverError && (
          <div
            role="alert"
            style={{
              backgroundColor: '#fef2f2',
              border: `1px solid #fecaca`,
              borderRadius: 6,
              padding: '10px 14px',
              fontSize: 13,
              color: ERROR_COL,
            }}
          >
            {serverError}
          </div>
        )}

        {/* First name */}
        <div>
          <label htmlFor="firstName" style={labelStyle}>
            First name{' '}
            <span aria-hidden="true" style={{ color: ERROR_COL }}>*</span>
          </label>
          <input
            id="firstName"
            type="text"
            autoComplete="given-name"
            {...register('firstName')}
            style={inputStyle}
            aria-describedby={errors.firstName ? 'firstName-error' : undefined}
          />
          {errors.firstName && (
            <p id="firstName-error" role="alert" style={fieldErrorStyle}>
              {errors.firstName.message}
            </p>
          )}
        </div>

        {/* Last name */}
        <div>
          <label htmlFor="lastName" style={labelStyle}>
            Last name{' '}
            <span aria-hidden="true" style={{ color: ERROR_COL }}>*</span>
          </label>
          <input
            id="lastName"
            type="text"
            autoComplete="family-name"
            {...register('lastName')}
            style={inputStyle}
            aria-describedby={errors.lastName ? 'lastName-error' : undefined}
          />
          {errors.lastName && (
            <p id="lastName-error" role="alert" style={fieldErrorStyle}>
              {errors.lastName.message}
            </p>
          )}
        </div>

        {/* Email */}
        <div>
          <label htmlFor="email" style={labelStyle}>
            Email{' '}
            <span aria-hidden="true" style={{ color: ERROR_COL }}>*</span>
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            {...register('email')}
            style={inputStyle}
            aria-describedby={errors.email ? 'email-error' : undefined}
          />
          {errors.email && (
            <p id="email-error" role="alert" style={fieldErrorStyle}>
              {errors.email.message}
            </p>
          )}
        </div>

        {/* Phone — optional */}
        <div>
          <label htmlFor="phone" style={labelStyle}>
            Phone{' '}
            <span style={{ color: MUTED, fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            id="phone"
            type="tel"
            autoComplete="tel"
            placeholder="e.g. 202-555-0001"
            {...register('phone')}
            style={inputStyle}
            aria-describedby={errors.phone ? 'phone-error' : undefined}
          />
          {errors.phone && (
            <p id="phone-error" role="alert" style={fieldErrorStyle}>
              {errors.phone.message}
            </p>
          )}
        </div>

        {/* Source — optional */}
        <div>
          <label htmlFor="source" style={labelStyle}>
            Source{' '}
            <span style={{ color: MUTED, fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            id="source"
            type="text"
            placeholder="e.g. USAJOBS, referral, LinkedIn"
            {...register('source')}
            style={inputStyle}
            aria-describedby={errors.source ? 'source-error' : undefined}
          />
          {errors.source && (
            <p id="source-error" role="alert" style={fieldErrorStyle}>
              {errors.source.message}
            </p>
          )}
        </div>

        {/* Notes — optional */}
        <div>
          <label htmlFor="notes" style={labelStyle}>
            Notes{' '}
            <span style={{ color: MUTED, fontWeight: 400 }}>(optional)</span>
          </label>
          <textarea
            id="notes"
            rows={4}
            placeholder="Internal notes about this candidate"
            {...register('notes')}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
          {errors.notes && (
            <p style={fieldErrorStyle}>{errors.notes.message}</p>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
          <button
            type="submit"
            disabled={isLoading}
            style={{
              backgroundColor: isLoading ? MUTED : BLUE,
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 20px',
              fontSize: 14,
              fontWeight: 500,
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {isLoading ? 'Saving…' : 'Save Changes'}
          </button>
          <Link
            href={`/recruiting/candidates/${candidateId}`}
            style={{
              fontSize: 14,
              color: SUB,
              textDecoration: 'none',
              padding: '7px 14px',
              border: `1px solid ${BORDER}`,
              borderRadius: 6,
            }}
          >
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
