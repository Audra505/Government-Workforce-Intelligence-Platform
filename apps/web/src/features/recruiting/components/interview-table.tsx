// Interview list table — Server Component.
// M23: Pill status, table shadow/radius per mockup.
// No after:absolute row-click pattern — both Type and Application columns are navigable links.

import Link from 'next/link';
import type { InterviewRow } from '@/features/recruiting/types';
import { InterviewStatusDot } from './status-dot';

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

const TYPE_LABEL: Record<string, string> = {
  PHONE_SCREEN: 'Phone Screen',
  PANEL:        'Panel',
  TECHNICAL:    'Technical',
  FINAL:        'Final',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function shortId(id: string): string {
  return id.slice(0, 8) + '…';
}

type Props = {
  interviews: InterviewRow[];
  hasFilters: boolean;
};

export function InterviewTable({ interviews, hasFilters }: Props) {
  if (interviews.length === 0) {
    return (
      <div
        className="rounded-lg border py-16 text-center text-sm"
        style={{ borderColor: BORDER, color: MUTED }}
      >
        {hasFilters
          ? 'No interviews match the current filters.'
          : 'No interviews yet.'}
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
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Type</th>
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Application</th>
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Scheduled</th>
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Interviewer</th>
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Status</th>
            </tr>
          </thead>
          <tbody>
            {interviews.map((iv) => (
              <tr
                key={iv.id}
                className="h-12 border-b transition-colors hover:bg-slate-50 last:border-0"
                style={{ borderColor: BORDER }}
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/recruiting/interviews/${iv.id}`}
                    className="font-medium hover:underline"
                    style={{ color: '#2563eb' }}
                  >
                    {TYPE_LABEL[iv.interviewType] ?? iv.interviewType}
                  </Link>
                </td>

                <td className="px-4 py-3">
                  <Link
                    href={`/recruiting/applications/${iv.applicationId}`}
                    className="hover:underline"
                    style={{ ...MONO_STYLE, color: MUTED }}
                  >
                    {shortId(iv.applicationId)}
                  </Link>
                </td>

                <td className="px-4 py-3" style={{ ...MONO_STYLE, color: iv.scheduledAt ? SUB : MUTED }}>
                  {iv.scheduledAt ? formatDateTime(iv.scheduledAt) : '—'}
                </td>

                <td className="px-4 py-3" style={{ color: iv.interviewerName ? SUB : MUTED }}>
                  {iv.interviewerName ?? '—'}
                </td>

                <td className="px-4 py-3">
                  <InterviewStatusDot status={iv.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
