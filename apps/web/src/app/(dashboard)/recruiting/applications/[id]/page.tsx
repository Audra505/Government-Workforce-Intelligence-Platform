// /recruiting/applications/[id] — Application detail with write actions (M20C Batch 4 / M20D Batch 3)
//
// Server Component: fetches application detail with JWT from session cookie.
// Client Component ApplicationActions handles advance, reject, and withdraw.
// M20D additions: ScheduleInterviewForm, CreateOfferForm, HireAction.
//
// Role gate (UX only — NestJS enforces real RBAC):
//   canWrite → System Administrator, HR Director, Recruiter
//   canHire  → System Administrator, HR Director only (Recruiter excluded — GD-M20-1 D5, D7)
//   CO/HM/WP/EU → read-only; no action surfaces rendered
//
// Reference: governance/GD-M20-1.md — Decision 2, 3, 5, 7 (Applications), 16
// Reference: apps/api/src/recruiting/application.controller.ts
// Reference: apps/api/src/recruiting/hire.controller.ts

import { cookies } from 'next/headers';
import Link from 'next/link';
import { serverFetch } from '@/lib/api';
import { SESSION_COOKIE } from '@/lib/auth';
import { RecruitingShell } from '@/features/recruiting/components/recruiting-shell';
import { ApplicationStatusDot } from '@/features/recruiting/components/status-dot';
import { ApplicationActions } from '@/features/recruiting/components/application-actions';
import { ScheduleInterviewForm } from '@/features/recruiting/components/schedule-interview-form';
import { CreateOfferForm } from '@/features/recruiting/components/create-offer-form';
import { HireAction } from '@/features/recruiting/components/hire-action';
import type { ApplicationDetailApiResponse, CandidateDetailApiResponse, VacancyInfoApiResponse } from '@/features/recruiting/types';

type Props = { params: { id: string } };

// UX gate roles — NestJS enforces all real RBAC
const WRITE_ROLES = ['System Administrator', 'HR Director', 'Recruiter'];
const HIRE_ROLES  = ['System Administrator', 'HR Director'];

function getSessionRoles(token: string): string[] {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { roles?: unknown };
    return Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Design tokens — GD-M20-1 D16
// ---------------------------------------------------------------------------

const BORDER = '#e2e8f0';
const TEXT   = '#0f172a';
const SUB    = '#475569';
const MUTED  = '#94a3b8';
const BLUE   = '#2563eb';

const MONO: React.CSSProperties = {
  fontFamily: "var(--font-ibm-plex-mono, 'IBM Plex Mono', monospace)",
  fontSize: 12,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function shortId(id: string): string {
  return id.slice(0, 8) + '…';
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-0"
      style={{ borderBottom: `1px solid ${BORDER}` }}
    >
      <dt className="w-40 shrink-0 text-sm font-medium" style={{ color: MUTED }}>{label}</dt>
      <dd className="text-sm" style={{ color: SUB }}>{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ApplicationDetailPage({ params }: Props) {
  // Decode JWT roles for UX gate — NestJS enforces real RBAC on every request.
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canWrite = roles.some((r) => WRITE_ROLES.includes(r));
  const canHire  = roles.some((r) => HIRE_ROLES.includes(r));

  const response = await serverFetch<ApplicationDetailApiResponse>(`/api/v1/applications/${params.id}`);
  const a = response.data;

  // Fetch candidate name and vacancy title in parallel — graceful degradation on failure
  let candidateName: string | null = null;
  let positionTitle: string | null = null;
  let requiresReview = false;
  const [candidateRes, vacancyRes] = await Promise.allSettled([
    serverFetch<CandidateDetailApiResponse>(`/api/v1/candidates/${a.candidateId}`),
    serverFetch<VacancyInfoApiResponse>(`/api/v1/vacancies/${a.vacancyId}`),
  ]);
  if (candidateRes.status === 'fulfilled') {
    const c = candidateRes.value.data;
    candidateName = `${c.lastName}, ${c.firstName}`;
  }
  if (vacancyRes.status === 'fulfilled') {
    positionTitle = vacancyRes.value.data.positionTitle;
    requiresReview = vacancyRes.value.data.requiresReview;
  }

  return (
    <RecruitingShell activeTab="applications" breadcrumb="Application Detail">
      {/* Back link */}
      <div className="mb-4">
        <Link href="/recruiting/applications" className="text-sm hover:underline" style={{ color: BLUE }}>
          ← Applications
        </Link>
      </div>

      {/* Application detail card */}
      <div className="rounded-md border" style={{ borderColor: BORDER }}>
        <div
          className="flex items-start justify-between border-b px-6 py-4"
          style={{ borderColor: BORDER }}
        >
          <div>
            <h2 className="text-xl font-semibold" style={{ color: TEXT, ...MONO }}>
              {shortId(a.id)}
            </h2>
            <div className="mt-1.5">
              <ApplicationStatusDot status={a.status} />
            </div>
          </div>
        </div>

        <dl className="px-6">
          <DetailRow label="Candidate">
            <Link
              href={`/recruiting/candidates/${a.candidateId}`}
              className="hover:underline"
              style={{ color: BLUE, fontWeight: 500 }}
            >
              {candidateName ?? shortId(a.candidateId)}
            </Link>
          </DetailRow>
          <DetailRow label="Vacancy">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: SUB, fontWeight: 500 }}>{positionTitle ?? shortId(a.vacancyId)}</span>
              {requiresReview && (
                <span
                  style={{
                    backgroundColor: '#fef3c7',
                    color: '#92400e',
                    border: '1px solid #fcd34d',
                    borderRadius: 4,
                    padding: '1px 6px',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: 0.3,
                  }}
                >
                  Review Required
                </span>
              )}
            </span>
          </DetailRow>
          <DetailRow label="Stage">
            {a.currentStage ?? <span style={{ color: MUTED }}>—</span>}
          </DetailRow>
          <DetailRow label="Notes">
            {a.notes ? (
              <span style={{ whiteSpace: 'pre-wrap' }}>{a.notes}</span>
            ) : (
              <span style={{ color: MUTED }}>—</span>
            )}
          </DetailRow>
          <DetailRow label="Submitted">
            <span style={MONO}>{formatDate(a.submittedAt)}</span>
          </DetailRow>
          <DetailRow label="Added">
            <span style={MONO}>{formatDate(a.createdAt)}</span>
          </DetailRow>
          <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-0">
            <dt className="w-40 shrink-0 text-sm font-medium" style={{ color: MUTED }}>Last Updated</dt>
            <dd className="text-sm">
              <span style={{ ...MONO, color: MUTED }}>{formatDate(a.updatedAt)}</span>
            </dd>
          </div>
        </dl>
      </div>

      {/* Application actions — SA, HRD, Recruiter only (GD-M20-1 D7) */}
      {canWrite && (
        <div className="mt-6">
          <ApplicationActions
            applicationId={a.id}
            applicationStatus={a.status}
          />
        </div>
      )}

      {/* Schedule Interview — write-capable roles; shown regardless of application status (GD-M20-1 D7) */}
      {canWrite && (
        <div className="mt-4">
          <ScheduleInterviewForm applicationId={a.id} />
        </div>
      )}

      {/* Create Offer — write-capable roles; only when application status is OFFER (GD-M20-1 D7) */}
      {canWrite && a.status === 'OFFER' && (
        <div className="mt-4">
          <CreateOfferForm applicationId={a.id} />
        </div>
      )}

      {/* Hire Applicant — SA and HR Director only; only when application status is OFFER (GD-M20-1 D5, D7) */}
      {canHire && a.status === 'OFFER' && (
        <div className="mt-4">
          <HireAction applicationId={a.id} />
        </div>
      )}
    </RecruitingShell>
  );
}
