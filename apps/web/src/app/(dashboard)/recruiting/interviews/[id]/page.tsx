// /recruiting/interviews/[id] — Interview detail (M20B read + M20D write actions)
// Server Component: fetches GET /api/v1/interviews/:id with JWT from session cookie.
// Write-capable roles (SA, HRD, Recruiter) receive InterviewActions below the detail card.
// Reference: governance/GD-M20-1.md — Decision 2, 7 (Interviews), 16

import Link from 'next/link';
import { cookies } from 'next/headers';
import { serverFetch } from '@/lib/api';
import { SESSION_COOKIE } from '@/lib/auth';
import { RecruitingShell } from '@/features/recruiting/components/recruiting-shell';
import { InterviewStatusDot } from '@/features/recruiting/components/status-dot';
import { InterviewActions } from '@/features/recruiting/components/interview-actions';
import type { InterviewDetailApiResponse } from '@/features/recruiting/types';

const WRITE_ROLES = ['System Administrator', 'HR Director', 'Recruiter'];

function getSessionRoles(token: string): string[] {
  try {
    const payload = atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = JSON.parse(payload) as { roles?: string[] };
    return Array.isArray(parsed.roles) ? parsed.roles : [];
  } catch {
    return [];
  }
}

type Props = { params: { id: string } };

const BORDER = '#e2e8f0';
const SUB    = '#475569';
const MUTED  = '#94a3b8';
const BLUE   = '#2563eb';

const MONO: React.CSSProperties = {
  fontFamily: "var(--font-ibm-plex-mono, 'IBM Plex Mono', monospace)",
  fontSize: 12,
};

const TYPE_LABEL: Record<string, string> = {
  PHONE_SCREEN: 'Phone Screen',
  PANEL:        'Panel',
  TECHNICAL:    'Technical',
  FINAL:        'Final',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

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
    <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-0" style={{ borderBottom: `1px solid ${BORDER}` }}>
      <dt className="w-40 shrink-0 text-sm font-medium" style={{ color: MUTED }}>{label}</dt>
      <dd className="text-sm" style={{ color: SUB }}>{children}</dd>
    </div>
  );
}

export default async function InterviewDetailPage({ params }: Props) {
  const response = await serverFetch<InterviewDetailApiResponse>(`/api/v1/interviews/${params.id}`);
  const iv = response.data;

  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canWrite = roles.some((r) => WRITE_ROLES.includes(r));

  return (
    <RecruitingShell activeTab="interviews" breadcrumb="Interview Detail">
      <div className="mb-4">
        <Link href="/recruiting/interviews" className="text-sm hover:underline" style={{ color: BLUE }}>
          ← Interviews
        </Link>
      </div>

      <div className="rounded-md border" style={{ borderColor: BORDER }}>
        <div
          className="flex items-start justify-between border-b px-6 py-4"
          style={{ borderColor: BORDER }}
        >
          <div>
            <h2 className="text-xl font-semibold" style={{ color: '#0f172a', ...MONO }}>
              {shortId(iv.id)}
            </h2>
            <div className="mt-1.5">
              <InterviewStatusDot status={iv.status} />
            </div>
          </div>
        </div>

        <dl className="px-6">
          <DetailRow label="Application">
            <Link
              href={`/recruiting/applications/${iv.applicationId}`}
              className="hover:underline"
              style={{ ...MONO, color: BLUE }}
            >
              {shortId(iv.applicationId)}
            </Link>
          </DetailRow>
          <DetailRow label="Type">
            {TYPE_LABEL[iv.interviewType] ?? iv.interviewType}
          </DetailRow>
          <DetailRow label="Scheduled">
            {iv.scheduledAt ? (
              <span style={MONO}>{formatDateTime(iv.scheduledAt)}</span>
            ) : (
              <span style={{ color: MUTED }}>—</span>
            )}
          </DetailRow>
          <DetailRow label="Interviewer">
            {iv.interviewerName ?? <span style={{ color: MUTED }}>—</span>}
          </DetailRow>
          <DetailRow label="Interviewer ID">
            {iv.interviewerUserId ? (
              <span style={{ ...MONO, color: MUTED }}>{shortId(iv.interviewerUserId)}</span>
            ) : (
              <span style={{ color: MUTED }}>—</span>
            )}
          </DetailRow>
          <DetailRow label="Feedback">
            {iv.feedback ? (
              <span style={{ whiteSpace: 'pre-wrap' }}>{iv.feedback}</span>
            ) : (
              <span style={{ color: MUTED }}>—</span>
            )}
          </DetailRow>
          <DetailRow label="Added">
            <span style={MONO}>{formatDate(iv.createdAt)}</span>
          </DetailRow>
          <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-0">
            <dt className="w-40 shrink-0 text-sm font-medium" style={{ color: MUTED }}>Last Updated</dt>
            <dd className="text-sm">
              <span style={{ ...MONO, color: MUTED }}>{formatDate(iv.updatedAt)}</span>
            </dd>
          </div>
        </dl>
      </div>

      {canWrite && (
        <div className="mt-6">
          <InterviewActions interviewId={iv.id} interviewStatus={iv.status} />
        </div>
      )}
    </RecruitingShell>
  );
}
