import Link from 'next/link';
import type { InterviewRow } from '@/features/recruiting/types';
import { InterviewStatusDot } from './status-dot';

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
        className="rounded-md border py-16 text-center text-sm"
        style={{ borderColor: BORDER, color: MUTED }}
      >
        {hasFilters
          ? 'No interviews match the current filters.'
          : 'No interviews yet.'}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border" style={{ borderColor: BORDER }}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr style={TH}>
            <th className="px-4 py-3 text-left font-medium">Type</th>
            <th className="px-4 py-3 text-left font-medium">Application</th>
            <th className="px-4 py-3 text-left font-medium">Scheduled</th>
            <th className="px-4 py-3 text-left font-medium">Interviewer</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {interviews.map((iv) => (
            <tr
              key={iv.id}
              className="border-t transition-colors hover:bg-slate-50"
              style={{ borderColor: BORDER, height: 48 }}
            >
              <td className="px-4 py-3.5" style={{ color: SUB }}>
                {TYPE_LABEL[iv.interviewType] ?? iv.interviewType}
              </td>

              <td className="px-4 py-3.5">
                <Link
                  href={`/recruiting/applications/${iv.applicationId}`}
                  className="hover:underline"
                  style={{ ...MONO, color: BLUE }}
                >
                  {shortId(iv.applicationId)}
                </Link>
              </td>

              <td className="px-4 py-3.5" style={{ ...MONO, color: iv.scheduledAt ? SUB : MUTED }}>
                {iv.scheduledAt ? formatDateTime(iv.scheduledAt) : '—'}
              </td>

              <td className="px-4 py-3.5" style={{ color: iv.interviewerName ? SUB : MUTED }}>
                {iv.interviewerName ?? '—'}
              </td>

              <td className="px-4 py-3.5">
                <InterviewStatusDot status={iv.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
