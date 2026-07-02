// /recruiting/offers/[id] — Offer detail (M20B read + M20D write actions)
// Server Component: fetches GET /api/v1/offers/:id with JWT from session cookie.
// Write-capable roles (SA, HRD, Recruiter) receive OfferActions below the detail card.
// SA and HR Director additionally receive approve and send buttons (canApproveAndSend).
// Reference: governance/GD-M20-1.md — Decision 2, 5, 7 (Offers), 16

import Link from 'next/link';
import { cookies } from 'next/headers';
import { serverFetch } from '@/lib/api';
import { SESSION_COOKIE } from '@/lib/auth';
import { RecruitingShell } from '@/features/recruiting/components/recruiting-shell';
import { OfferStatusDot } from '@/features/recruiting/components/status-dot';
import { OfferActions } from '@/features/recruiting/components/offer-actions';
import type { OfferDetailApiResponse } from '@/features/recruiting/types';

const WRITE_ROLES        = ['System Administrator', 'HR Director', 'Recruiter'];
const APPROVE_SEND_ROLES = ['System Administrator', 'HR Director'];

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

export default async function OfferDetailPage({ params }: Props) {
  const response = await serverFetch<OfferDetailApiResponse>(`/api/v1/offers/${params.id}`);
  const o = response.data;

  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canWrite          = roles.some((r) => WRITE_ROLES.includes(r));
  const canApproveAndSend = roles.some((r) => APPROVE_SEND_ROLES.includes(r));

  return (
    <RecruitingShell activeTab="offers" breadcrumb="Offer Detail">
      <div className="mb-4">
        <Link href="/recruiting/offers" className="text-sm hover:underline" style={{ color: BLUE }}>
          ← Offers
        </Link>
      </div>

      <div className="rounded-md border" style={{ borderColor: BORDER }}>
        <div
          className="flex items-start justify-between border-b px-6 py-4"
          style={{ borderColor: BORDER }}
        >
          <div>
            <h2 className="text-xl font-semibold" style={{ color: '#0f172a', ...MONO }}>
              {shortId(o.id)}
            </h2>
            <div className="mt-1.5">
              <OfferStatusDot status={o.status} />
            </div>
          </div>
        </div>

        <dl className="px-6">
          <DetailRow label="Application">
            <Link
              href={`/recruiting/applications/${o.applicationId}`}
              className="hover:underline"
              style={{ ...MONO, color: BLUE }}
            >
              {shortId(o.applicationId)}
            </Link>
          </DetailRow>
          <DetailRow label="Offer Date">
            {o.offerDate ? (
              <span style={MONO}>{formatDate(o.offerDate)}</span>
            ) : (
              <span style={{ color: MUTED }}>—</span>
            )}
          </DetailRow>
          <DetailRow label="Accepted">
            {o.acceptedAt ? (
              <span style={MONO}>{formatDate(o.acceptedAt)}</span>
            ) : (
              <span style={{ color: MUTED }}>—</span>
            )}
          </DetailRow>
          <DetailRow label="Declined">
            {o.declinedAt ? (
              <span style={MONO}>{formatDate(o.declinedAt)}</span>
            ) : (
              <span style={{ color: MUTED }}>—</span>
            )}
          </DetailRow>
          <DetailRow label="Notes">
            {o.notes ? (
              <span style={{ whiteSpace: 'pre-wrap' }}>{o.notes}</span>
            ) : (
              <span style={{ color: MUTED }}>—</span>
            )}
          </DetailRow>
          <DetailRow label="Created">
            <span style={MONO}>{formatDate(o.createdAt)}</span>
          </DetailRow>
          <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-0">
            <dt className="w-40 shrink-0 text-sm font-medium" style={{ color: MUTED }}>Last Updated</dt>
            <dd className="text-sm">
              <span style={{ ...MONO, color: MUTED }}>{formatDate(o.updatedAt)}</span>
            </dd>
          </div>
        </dl>
      </div>

      {canWrite && (
        <div className="mt-6">
          <OfferActions
            offerId={o.id}
            offerStatus={o.status}
            canApproveAndSend={canApproveAndSend}
          />
        </div>
      )}
    </RecruitingShell>
  );
}
