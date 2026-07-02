import Link from 'next/link';
import type { ApplicationRow } from '@/features/recruiting/types';
import { ApplicationStatusDot } from './status-dot';

const BORDER = '#e2e8f0';
const CANVAS = '#f8fafc';
const SUB    = '#475569';
const MUTED  = '#94a3b8';
const BLUE   = '#2563eb';

const MONO: React.CSSProperties = {
  fontFamily: "var(--font-ibm-plex-mono, 'IBM Plex Mono', monospace)",
  fontSize: 12,
};

const TH: React.CSSProperties = {
  backgroundColor: CANVAS,
  color: MUTED,
  fontSize: 11,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};


function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function shortId(id: string): string {
  return id.slice(0, 8) + '…';
}

type Props = {
  applications: ApplicationRow[];
  hasFilters: boolean;
};

export function ApplicationTable({ applications, hasFilters }: Props) {
  if (applications.length === 0) {
    return (
      <div
        className="rounded-md border py-16 text-center text-sm"
        style={{ borderColor: BORDER, color: MUTED }}
      >
        {hasFilters
          ? 'No applications match the current filters.'
          : 'No applications yet.'}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border" style={{ borderColor: BORDER }}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr style={TH}>
            <th className="px-4 py-3 text-left font-medium">Candidate</th>
            <th className="px-4 py-3 text-left font-medium">Vacancy</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-left font-medium">Submitted</th>
            <th className="px-4 py-3 text-left font-medium">Last Updated</th>
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
                <Link
                  href={`/recruiting/applications/${a.id}`}
                  className="font-medium hover:underline"
                  style={{ ...MONO, color: BLUE }}
                >
                  {shortId(a.candidateId)}
                </Link>
              </td>

              <td className="px-4 py-3.5">
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  backgroundColor: '#f1f5f9', borderRadius: 4,
                  padding: '2px 8px', ...MONO, color: SUB,
                }}>
                  <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                  {shortId(a.vacancyId)}
                </span>
              </td>

              <td className="px-4 py-3.5">
                <ApplicationStatusDot status={a.status} />
              </td>

              <td className="px-4 py-3.5" style={{ ...MONO, color: MUTED }}>
                {formatDate(a.submittedAt)}
              </td>

              <td className="px-4 py-3.5" style={{ ...MONO, color: MUTED }}>
                {formatDate(a.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
