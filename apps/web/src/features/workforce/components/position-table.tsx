// Position list table — Server Component.
// Renders position rows; title links to /workforce/positions/:id.
// Authority: directives/02_position_management_rules.md — POS-AUTH-002 (list access)

import Link from 'next/link';
import type { PositionRow } from '@/features/workforce/types';
import { PositionStatusBadge } from '@/features/workforce/components/position-status-badge';

type Props = {
  positions: PositionRow[];
  hasFilters: boolean;
};

export function PositionTable({ positions, hasFilters }: Props) {
  if (positions.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-12 text-center">
        <p className="text-sm text-muted-foreground">
          {hasFilters
            ? 'No positions match the current filters.'
            : 'No positions found in your organization.'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Title</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Classification</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Salary Band</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr
              key={p.id}
              className="border-b last:border-0 hover:bg-muted/30 transition-colors relative"
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
                <PositionStatusBadge status={p.status} />
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {p.classification ?? '—'}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {p.salaryBand ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
