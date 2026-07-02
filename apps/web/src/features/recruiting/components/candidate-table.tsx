import Link from 'next/link';
import type { CandidateRow } from '@/features/recruiting/types';
import { CandidateStatusDot } from './status-dot';

const BORDER  = '#e2e8f0';
const CANVAS  = '#f8fafc';
const SUB     = '#475569';
const MUTED   = '#94a3b8';
const BLUE    = '#2563eb';

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

type Props = {
  candidates: CandidateRow[];
  hasFilters: boolean;
};

export function CandidateTable({ candidates, hasFilters }: Props) {
  if (candidates.length === 0) {
    return (
      <div
        className="rounded-md border py-16 text-center text-sm"
        style={{ borderColor: BORDER, color: MUTED }}
      >
        {hasFilters
          ? 'No candidates match the current filters.'
          : 'No candidates yet. Add the first candidate to get started.'}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border" style={{ borderColor: BORDER }}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr style={TH}>
            <th className="px-4 py-3 text-left font-medium">Name</th>
            <th className="px-4 py-3 text-left font-medium">Email</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-left font-medium">Added</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr
              key={c.id}
              className="border-t transition-colors hover:bg-slate-50"
              style={{ borderColor: BORDER, height: 48 }}
            >
              <td className="px-4 py-3.5">
                <Link
                  href={`/recruiting/candidates/${c.id}`}
                  className="font-medium hover:underline"
                  style={{ color: BLUE }}
                >
                  {c.lastName}, {c.firstName}
                </Link>
              </td>

              <td className="px-4 py-3.5" style={{ color: SUB }}>
                {c.email}
              </td>

              <td className="px-4 py-3.5">
                <CandidateStatusDot status={c.status} />
              </td>

              <td
                className="px-4 py-3.5"
                style={{
                  color: MUTED,
                  fontFamily: "var(--font-ibm-plex-mono, 'IBM Plex Mono', monospace)",
                  fontSize: 12,
                }}
              >
                {formatDate(c.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
