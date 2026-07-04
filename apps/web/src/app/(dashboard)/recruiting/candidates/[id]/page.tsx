// /recruiting/candidates/[id] — Candidate detail with actions and linked applications (M20C Batch 3)
//
// Server Component: fetches candidate detail, linked applications, and eligible vacancies.
// Client Component CandidateActions handles archive and submit-application write actions.
//
// Role gate (UX only — NestJS enforces real RBAC):
//   canWrite → System Administrator, HR Director, Recruiter
//   CO/HM/WP/EU → read-only; no action surfaces rendered
//
// Eligible vacancies are fetched only when canWrite + candidate is ACTIVE to avoid
// unnecessary backend calls and gracefully degrade (empty list) on fetch failure.
//
// Reference: governance/GD-M20-1.md — Decision 2, 3, 5, 6, 7 (Candidates), 16
// Reference: apps/api/src/recruiting/candidate.controller.ts
// Reference: apps/api/src/recruiting/application.controller.ts

import { cookies } from 'next/headers';
import Link from 'next/link';
import { serverFetch } from '@/lib/api';
import { SESSION_COOKIE } from '@/lib/auth';
import { RecruitingShell } from '@/features/recruiting/components/recruiting-shell';
import { CandidateStatusDot, ApplicationStatusDot } from '@/features/recruiting/components/status-dot';
import { CandidateActions } from '@/features/recruiting/components/candidate-actions';
import type { CandidateDetailApiResponse, ApplicationListApiResponse } from '@/features/recruiting/types';
import type { VacancyListApiResponse } from '@/features/workforce/types';
import type { VacancyOption } from '@/features/recruiting/components/candidate-actions';

type Props = { params: { id: string } };

// UX gate roles — NestJS enforces all real RBAC
const WRITE_ROLES = ['System Administrator', 'HR Director', 'Recruiter'];

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
const CANVAS = '#f8fafc';

const MONO: React.CSSProperties = {
  fontFamily: "var(--font-ibm-plex-mono, 'IBM Plex Mono', monospace)",
  fontSize: 12,
};

const TH: React.CSSProperties = {
  backgroundColor: CANVAS,
  color: MUTED,
  fontSize: 11,
  fontWeight: 500,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
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

export default async function CandidateDetailPage({ params }: Props) {
  // Decode JWT roles for UX gate — NestJS enforces real RBAC on every request.
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canWrite = roles.some((r) => WRITE_ROLES.includes(r));

  // Candidate detail + linked applications in parallel
  const [candidateRes, appsRes] = await Promise.all([
    serverFetch<CandidateDetailApiResponse>(`/api/v1/candidates/${params.id}`),
    serverFetch<ApplicationListApiResponse>(
      `/api/v1/applications?candidateId=${params.id}&pageSize=25`,
    ),
  ]);
  const c = candidateRes.data;
  const applications = appsRes.data.applications;

  // Eligible vacancies — only needed for write-capable users on active candidates.
  // Graceful degradation: empty list if fetch fails; form shows "No open vacancies" message.
  let eligibleVacancies: VacancyOption[] = [];
  if (canWrite && c.status === 'ACTIVE') {
    try {
      const [openRes, recruitRes] = await Promise.all([
        serverFetch<VacancyListApiResponse>('/api/v1/vacancies?status=OPEN&pageSize=100'),
        serverFetch<VacancyListApiResponse>(
          '/api/v1/vacancies?status=IN_RECRUITMENT&pageSize=100',
        ),
      ]);
      eligibleVacancies = [
        ...openRes.data.vacancies.map((v) => ({
          id: v.id,
          positionTitle: v.positionTitle,
          departmentName: v.departmentName,
        })),
        ...recruitRes.data.vacancies.map((v) => ({
          id: v.id,
          positionTitle: v.positionTitle,
          departmentName: v.departmentName,
        })),
      ];
    } catch {
      // graceful degradation — vacancy selector shows empty state
    }
  }

  return (
    <RecruitingShell activeTab="candidates" breadcrumb={`${c.firstName} ${c.lastName}`}>
      {/* Back link */}
      <div className="mb-4">
        <Link href="/recruiting/candidates" className="text-sm hover:underline" style={{ color: BLUE }}>
          ← Candidates
        </Link>
      </div>

      {/* Candidate detail card */}
      <div className="rounded-md border" style={{ borderColor: BORDER }}>
        <div
          className="flex items-start justify-between border-b px-6 py-4"
          style={{ borderColor: BORDER }}
        >
          <div>
            <h2 className="text-xl font-semibold" style={{ color: TEXT }}>
              {c.firstName} {c.lastName}
            </h2>
            <div className="mt-1.5">
              <CandidateStatusDot status={c.status} />
            </div>
          </div>
          {canWrite && (
            <Link
              href={`/recruiting/candidates/${c.id}/edit`}
              className="text-sm hover:underline"
              style={{ color: BLUE }}
            >
              Edit
            </Link>
          )}
        </div>

        <dl className="px-6">
          <DetailRow label="Email">{c.email}</DetailRow>
          <DetailRow label="Phone">
            {c.phone ?? <span style={{ color: MUTED }}>—</span>}
          </DetailRow>
          <DetailRow label="Source">
            {c.source ?? <span style={{ color: MUTED }}>—</span>}
          </DetailRow>
          <DetailRow label="Notes">
            {c.notes ? (
              <span style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</span>
            ) : (
              <span style={{ color: MUTED }}>—</span>
            )}
          </DetailRow>
          <DetailRow label="Added">
            <span style={MONO}>{formatDate(c.createdAt)}</span>
          </DetailRow>
          <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-0">
            <dt className="w-40 shrink-0 text-sm font-medium" style={{ color: MUTED }}>Last Updated</dt>
            <dd className="text-sm">
              <span style={{ ...MONO, color: MUTED }}>{formatDate(c.updatedAt)}</span>
            </dd>
          </div>
        </dl>
      </div>

      {/* Candidate actions — SA, HRD, Recruiter only (GD-M20-1 D7) */}
      {canWrite && (
        <div className="mt-6">
          <CandidateActions
            candidateId={c.id}
            candidateStatus={c.status}
            eligibleVacancies={eligibleVacancies}
          />
        </div>
      )}

      {/* Linked applications */}
      <div className="mt-8">
        <h3 className="mb-3 text-base font-semibold" style={{ color: TEXT }}>
          Applications
        </h3>

        {applications.length === 0 ? (
          <div
            className="rounded-md border py-10 text-center text-sm"
            style={{ borderColor: BORDER, color: MUTED }}
          >
            No applications on file.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border" style={{ borderColor: BORDER }}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr style={TH}>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Application</th>
                  <th className="px-4 py-3 text-left font-medium">Vacancy</th>
                  <th className="px-4 py-3 text-left font-medium">Stage</th>
                  <th className="px-4 py-3 text-left font-medium">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((a) => (
                  <tr
                    key={a.id}
                    className="border-t transition-colors hover:bg-slate-50"
                    style={{ borderColor: BORDER, height: 48 }}
                  >
                    <td className="px-4 py-3.5">
                      <ApplicationStatusDot status={a.status} />
                    </td>
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/recruiting/applications/${a.id}`}
                        className="font-medium hover:underline"
                        style={{ ...MONO, color: BLUE }}
                      >
                        {shortId(a.id)}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5" style={{ ...MONO, color: MUTED }}>
                      {shortId(a.vacancyId)}
                    </td>
                    <td className="px-4 py-3.5" style={{ color: a.currentStage ? SUB : MUTED }}>
                      {a.currentStage ?? '—'}
                    </td>
                    <td className="px-4 py-3.5" style={{ ...MONO, color: MUTED }}>
                      {formatDate(a.submittedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </RecruitingShell>
  );
}
