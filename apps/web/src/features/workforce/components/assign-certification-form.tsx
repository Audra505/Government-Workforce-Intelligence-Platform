'use client';

// Assign / Update Certification form — embedded in employee detail Certifications card.
// Upsert: POST /api/employees/:id/certifications
// 201 on first assignment (INSERT), 200 on update.
// Rules:
//   - New assignment: status sent as ACTIVE (first assignment must be active, CRT-207).
//   - Update (non-REVOKED): ACTIVE or EXPIRED selectable.
//   - REVOKED assignment: read-only warning row; this form blocks submission.
//   - expirationRequired=true on catalog cert: expirationDate is required.
//   - REVOKED is terminal — no outbound transitions from this form (CRT-301).
// SEC-003: tenantId never sent from client.
// On success: toast + router.refresh() + form reset. No navigation.
// Reference: governance/GD-M24-1.md — Decisions 7, 8, 9
// Reference: governance/GD-M13-3.md — certification status enumeration, CRT-207, CRT-301

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast, ToastContainer } from '@/components/shared/toast';
import type {
  CertificationRow,
  EmployeeCertificationAssignment,
  AssignCertificationBffResponse,
} from '@/features/workforce/types';

const ERROR_MESSAGES: Record<string, string> = {
  CERTIFICATION_NOT_FOUND:    'The selected certification was not found. Refresh and try again.',
  EXPIRATION_DATE_REQUIRED:   'An expiration date is required for this certification.',
  INVALID_DATE_RANGE:         'The expiration date must be after the issue date.',
  INVALID_STATUS_TRANSITION:  'This status change is not allowed for the current certification state.',
  CERTIFICATION_REVOKED:      'This certification is revoked and cannot be updated.',
  EMPLOYEE_SEPARATED:         'This employee is separated and cannot be modified.',
  UNAUTHORIZED:               'Session expired. Please sign in again.',
  FORBIDDEN:                  "You don't have permission to assign certifications.",
  INTERNAL_ERROR:             'Service unavailable. Please try again.',
};

const SELECT_CLASS =
  'block w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';

const TEXT   = '#0f172a';
const SUB    = '#475569';
const BORDER = '#e2e8f0';
const BLUE   = '#2563eb';

type Props = {
  employeeId: string;
  certificationsCatalog: CertificationRow[];
  existingAssignments: EmployeeCertificationAssignment[];
};

export function AssignCertificationForm({ employeeId, certificationsCatalog, existingAssignments }: Props) {
  const router = useRouter();
  const { toasts, addToast, dismissToast } = useToast();
  const [certificationId, setCertificationId] = useState('');
  const [status, setStatus]                   = useState<'ACTIVE' | 'EXPIRED'>('ACTIVE');
  const [issueDate, setIssueDate]             = useState('');
  const [expirationDate, setExpirationDate]   = useState('');
  const [error, setError]                     = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting]       = useState(false);

  // Derived from selected certificationId
  const selectedCert = certificationsCatalog.find((c) => c.id === certificationId) ?? null;
  const existingAssignment = existingAssignments.find((a) => a.certificationId === certificationId) ?? null;
  const isRevoked  = existingAssignment?.status === 'REVOKED';
  const isUpdate   = existingAssignment !== null && !isRevoked;
  const expirationRequired = selectedCert?.expirationRequired ?? false;

  function handleCertChange(id: string) {
    setCertificationId(id);
    setStatus('ACTIVE');
    setIssueDate('');
    setExpirationDate('');
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!certificationId) { setError('Please select a certification.'); return; }
    if (isRevoked) { setError('This certification is revoked and cannot be updated.'); return; }
    if (expirationRequired && !expirationDate) {
      setError('Expiration date is required for this certification.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    const payload: Record<string, string> = {
      certificationId,
      status: isUpdate ? status : 'ACTIVE',
    };
    if (issueDate)      payload.issueDate      = issueDate;
    if (expirationDate) payload.expirationDate = expirationDate;

    try {
      const res = await fetch(`/api/employees/${employeeId}/certifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as AssignCertificationBffResponse;

      if (json.success) {
        const isInsert = res.status === 201;
        const certName = selectedCert?.name ?? certificationId;
        addToast({
          type: 'success',
          title: isInsert ? 'Certification assigned' : 'Certification updated',
          message: certName,
        });
        router.refresh();
        setCertificationId('');
        setStatus('ACTIVE');
        setIssueDate('');
        setExpirationDate('');
      } else {
        setError(ERROR_MESSAGES[json.error.code] ?? json.error.message);
      }
    } catch {
      setError('Unable to reach the server. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} noValidate>
        {error && (
          <div
            className="mb-4 rounded-md border px-4 py-2.5 text-sm"
            style={{ borderColor: '#fca5a5', backgroundColor: '#fef2f2', color: '#dc2626' }}
            role="alert"
          >
            {error}
          </div>
        )}

        {/* REVOKED guard banner — shown when selected cert is already REVOKED */}
        {isRevoked && !error && (
          <div
            className="mb-4 rounded-md border px-4 py-2.5 text-sm"
            style={{ borderColor: '#fca5a5', backgroundColor: '#fef2f2', color: '#dc2626' }}
            role="alert"
          >
            This certification is revoked. No further updates are permitted (CRT-301).
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Certification */}
          <div className="sm:col-span-2">
            <label
              htmlFor="assign-cert-id"
              className="mb-1 block text-xs font-medium uppercase tracking-wide"
              style={{ color: SUB }}
            >
              Certification <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <select
              id="assign-cert-id"
              value={certificationId}
              onChange={(e) => handleCertChange(e.target.value)}
              disabled={isSubmitting}
              className={SELECT_CLASS}
              style={{ borderColor: BORDER, color: certificationId ? TEXT : SUB }}
            >
              <option value="">Select a certification…</option>
              {certificationsCatalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.issuer ? ` — ${c.issuer}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Status — only for updates (existing non-REVOKED) */}
          {isUpdate && (
            <div>
              <label
                htmlFor="assign-cert-status"
                className="mb-1 block text-xs font-medium uppercase tracking-wide"
                style={{ color: SUB }}
              >
                Status
              </label>
              <select
                id="assign-cert-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'EXPIRED')}
                disabled={isSubmitting}
                className={SELECT_CLASS}
                style={{ borderColor: BORDER, color: TEXT }}
              >
                <option value="ACTIVE">Active</option>
                <option value="EXPIRED">Expired</option>
              </select>
            </div>
          )}

          {/* Issue Date */}
          <div>
            <label
              htmlFor="assign-cert-issue-date"
              className="mb-1 block text-xs font-medium uppercase tracking-wide"
              style={{ color: SUB }}
            >
              Issue Date
            </label>
            <input
              id="assign-cert-issue-date"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              disabled={isSubmitting}
              className={SELECT_CLASS}
              style={{ borderColor: BORDER, color: TEXT }}
            />
          </div>

          {/* Expiration Date — required when catalog cert has expirationRequired=true */}
          {selectedCert && (
            <div>
              <label
                htmlFor="assign-cert-expiration-date"
                className="mb-1 block text-xs font-medium uppercase tracking-wide"
                style={{ color: SUB }}
              >
                Expiration Date{expirationRequired && <span style={{ color: '#dc2626' }}> *</span>}
              </label>
              <input
                id="assign-cert-expiration-date"
                type="date"
                value={expirationDate}
                onChange={(e) => setExpirationDate(e.target.value)}
                disabled={isSubmitting}
                required={expirationRequired}
                className={SELECT_CLASS}
                style={{ borderColor: expirationRequired && !expirationDate ? '#fca5a5' : BORDER, color: TEXT }}
              />
              {expirationRequired && (
                <p className="mt-1 text-xs" style={{ color: SUB }}>
                  Required — this certification mandates an expiration date.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="mt-4">
          <button
            type="submit"
            disabled={isSubmitting || !certificationId || isRevoked}
            className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
            style={{ backgroundColor: BLUE }}
          >
            {isSubmitting
              ? 'Saving…'
              : isUpdate
                ? 'Update Certification'
                : 'Assign Certification'}
          </button>
        </div>
      </form>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
