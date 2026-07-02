// Position list table — Server Component.
// M21C: PositionStatusDot replaces PositionStatusBadge; aligned headers/rows; EmptyState.
// Authority: directives/02_position_management_rules.md — POS-AUTH-002 (list access)

import Link from 'next/link';
import type { PositionRow } from '@/features/workforce/types';
import { PositionStatusDot } from '@/features/workforce/components/position-status-badge';
import { EmptyState } from '@/components/shared/empty-state';

const TH_STYLE = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  color: '#94a3b8',
  backgroundColor: '#f8fafc',
} as const;

type Props = {
  positions: PositionRow[];
  hasFilters: boolean;
};

export function PositionTable({ positions, hasFilters }: Props) {
  if (positions.length === 0) {
    return (
      <EmptyState
        message={hasFilters
          ? 'No positions match the current filters.'
          : 'No positions found in your organization.'}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-md border" style={{ borderColor: '#e2e8f0' }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
            <th className="px-4 py-3 text-left uppercase" style={TH_STYLE}>Title</th>
            <th className="px-4 py-3 text-left uppercase" style={TH_STYLE}>Status</th>
            <th className="px-4 py-3 text-left uppercase" style={TH_STYLE}>Classification</th>
            <th className="px-4 py-3 text-left uppercase" style={TH_STYLE}>Salary Band</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr
              key={p.id}
              className="relative h-12 border-b last:border-0 transition-colors hover:bg-slate-50"
              style={{ borderColor: '#e2e8f0' }}
            >
              <td className="px-4 py-3 font-medium">
                <Link
                  href={`/workforce/positions/${p.id}`}
                  className="hover:underline after:absolute after:inset-0 after:content-['']"
                >
                  {p.title}
                </Link>
              </td>
              <td className="px-4 py-3">
                <PositionStatusDot status={p.status} />
              </td>
              <td className="px-4 py-3" style={{ color: '#475569' }}>
                {p.classification ?? '—'}
              </td>
              <td className="px-4 py-3" style={{ color: '#475569' }}>
                {p.salaryBand ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
