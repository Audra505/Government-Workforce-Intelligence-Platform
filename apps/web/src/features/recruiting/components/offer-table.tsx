// Offer list table — Server Component.
// M23: Pill status, table shadow/radius per mockup.
// No after:absolute row-click pattern — both Offer and Application columns are navigable links.

import Link from 'next/link';
import type { OfferRow } from '@/features/recruiting/types';
import { OfferStatusDot } from './status-dot';

const BORDER = '#e2e8f0';
const CANVAS = '#f8fafc';
const SUB    = '#475569';
const MUTED  = '#94a3b8';
const BLUE   = '#2563eb';
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
  offers: OfferRow[];
  hasFilters: boolean;
};

export function OfferTable({ offers, hasFilters }: Props) {
  if (offers.length === 0) {
    return (
      <div
        className="rounded-lg border py-16 text-center text-sm"
        style={{ borderColor: BORDER, color: MUTED }}
      >
        {hasFilters
          ? 'No offers match the current filters.'
          : 'No offers yet.'}
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
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Offer</th>
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Application</th>
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Status</th>
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Offer Date</th>
              <th className="px-4 py-2.5 text-left" style={TH_STYLE}>Created</th>
            </tr>
          </thead>
          <tbody>
            {offers.map((o) => (
              <tr
                key={o.id}
                className="h-12 border-b transition-colors hover:bg-slate-50 last:border-0"
                style={{ borderColor: BORDER }}
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/recruiting/offers/${o.id}`}
                    className="hover:underline"
                    style={{ ...MONO_STYLE, color: BLUE }}
                  >
                    {shortId(o.id)}
                  </Link>
                </td>

                <td className="px-4 py-3">
                  <Link
                    href={`/recruiting/applications/${o.applicationId}`}
                    className="hover:underline"
                    style={{ ...MONO_STYLE, color: MUTED }}
                  >
                    {shortId(o.applicationId)}
                  </Link>
                </td>

                <td className="px-4 py-3">
                  <OfferStatusDot status={o.status} />
                </td>

                <td className="px-4 py-3" style={{ ...MONO_STYLE, color: o.offerDate ? SUB : MUTED }}>
                  {o.offerDate ? formatDate(o.offerDate) : '—'}
                </td>

                <td className="px-4 py-3" style={{ ...MONO_STYLE, color: MUTED }}>
                  {formatDate(o.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
