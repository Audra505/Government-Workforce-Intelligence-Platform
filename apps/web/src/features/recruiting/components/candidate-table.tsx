// Candidate list table — Server Component.
// M23: Pill status, table shadow/radius per mockup, Candidate ID + Source columns added.
// Applications column deferred — not available in CandidateRow (requires backend + BFF work).
// Email column removed per mockup (email available on detail page).
// Row-click via after:absolute pattern on name link.

import Link from 'next/link';
import type { CandidateRow } from '@/features/recruiting/types';
import { CandidateStatusDot } from './status-dot';

const BORDER  = '#e2e8f0';
const CANVAS  = '#f8fafc';
const SUB     = '#475569';
const MUTED   = '#94a3b8';
const MONO    = "'IBM Plex Mono','Cascadia Code',Consolas,monospace";

const TH_STYLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.09em',
  color: MUTED,
  backgroundColor: CANVAS,
  whiteSpace: 'nowrap',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

type Props = {
  candidates: CandidateRow[];
  hasFilters: boolean;
};

export function CandidateTable({ candidates, hasFilters }: Props) {
  if (candidates.length === 0) {
    return (
      <div
        className="rounded-lg border py-16 text-center text-sm"
        style={{ borderColor: BORDER, color: MUTED }}
      >
        {hasFilters
          ? 'No candidates match the current filters.'
          : 'No candidates yet. Add the first candidate to get started.'}
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{ borderColor: BORDER, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Candidate ID</th>
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Name</th>
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Status</th>
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Source</th>
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Added</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr
                key={c.id}
                className="relative h-12 border-b transition-colors hover:bg-slate-50 last:border-0"
                style={{ borderColor: BORDER }}
              >
                <td
                  className="px-4 py-3"
                  style={{ fontFamily: MONO, fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}
                >
                  {c.id.slice(0, 8)}
                </td>

                <td className="px-4 py-3 font-medium">
                  <Link
                    href={`/recruiting/candidates/${c.id}`}
                    className="hover:underline after:absolute after:inset-0 after:content-['']"
                    style={{ color: '#2563eb' }}
                  >
                    {c.lastName}, {c.firstName}
                  </Link>
                </td>

                <td className="px-4 py-3">
                  <CandidateStatusDot status={c.status} />
                </td>

                <td className="px-4 py-3" style={{ color: SUB }}>
                  {c.source ?? '—'}
                </td>

                <td
                  className="px-4 py-3"
                  style={{ fontFamily: MONO, fontSize: 12, color: MUTED }}
                >
                  {formatDate(c.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
