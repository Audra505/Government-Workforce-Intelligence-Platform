// Application list table — Server Component.
// M23: Pill status, table shadow/radius per mockup.
// Primary navigation: application ID link (application identifier per instruction).
// Vacancy column: short ID reference, plain text (SVG icon removed for table cleanliness).
// Row-click via after:absolute on application ID link.

import Link from 'next/link';
import type { ApplicationRow } from '@/features/recruiting/types';
import { ApplicationStatusDot } from './status-dot';

const BORDER = '#e2e8f0';
const CANVAS = '#f8fafc';
const SUB    = '#475569';
const MUTED  = '#94a3b8';
const MONO   = "'IBM Plex Mono','Cascadia Code',Consolas,monospace";

const TH_STYLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.09em',
  color: MUTED,
  backgroundColor: CANVAS,
  whiteSpace: 'nowrap',
};

const MONO_STYLE: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 12,
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
        className="rounded-lg border py-16 text-center text-sm"
        style={{ borderColor: BORDER, color: MUTED }}
      >
        {hasFilters
          ? 'No applications match the current filters.'
          : 'No applications yet.'}
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
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Application</th>
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Vacancy</th>
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Status</th>
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Submitted</th>
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((a) => (
              <tr
                key={a.id}
                className="relative h-12 border-b transition-colors hover:bg-slate-50 last:border-0"
                style={{ borderColor: BORDER }}
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/recruiting/applications/${a.id}`}
                    className="hover:underline after:absolute after:inset-0 after:content-['']"
                    style={{ ...MONO_STYLE, color: '#2563eb' }}
                  >
                    {shortId(a.id)}
                  </Link>
                </td>

                <td className="px-4 py-3" style={{ ...MONO_STYLE, color: SUB }}>
                  {shortId(a.vacancyId)}
                </td>

                <td className="px-4 py-3">
                  <ApplicationStatusDot status={a.status} />
                </td>

                <td className="px-4 py-3" style={{ ...MONO_STYLE, color: MUTED }}>
                  {formatDate(a.submittedAt)}
                </td>

                <td className="px-4 py-3" style={{ ...MONO_STYLE, color: MUTED }}>
                  {formatDate(a.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
