import Link from 'next/link';
import type { OfferRow } from '@/features/recruiting/types';
import { OfferStatusDot } from './status-dot';

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
  offers: OfferRow[];
  hasFilters: boolean;
};

export function OfferTable({ offers, hasFilters }: Props) {
  if (offers.length === 0) {
    return (
      <div
        className="rounded-md border py-16 text-center text-sm"
        style={{ borderColor: BORDER, color: MUTED }}
      >
        {hasFilters
          ? 'No offers match the current filters.'
          : 'No offers yet.'}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border" style={{ borderColor: BORDER }}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr style={TH}>
            <th className="px-4 py-3 text-left font-medium">Application</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-left font-medium">Offer Date</th>
            <th className="px-4 py-3 text-left font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((o) => (
            <tr
              key={o.id}
              className="border-t transition-colors hover:bg-slate-50"
              style={{ borderColor: BORDER, height: 48 }}
            >
              <td className="px-4 py-3.5">
                <Link
                  href={`/recruiting/applications/${o.applicationId}`}
                  className="hover:underline"
                  style={{ ...MONO, color: BLUE }}
                >
                  {shortId(o.applicationId)}
                </Link>
              </td>

              <td className="px-4 py-3.5">
                <OfferStatusDot status={o.status} />
              </td>

              <td className="px-4 py-3.5" style={{ ...MONO, color: o.offerDate ? SUB : MUTED }}>
                {o.offerDate ? formatDate(o.offerDate) : '—'}
              </td>

              <td className="px-4 py-3.5" style={{ ...MONO, color: MUTED }}>
                {formatDate(o.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
