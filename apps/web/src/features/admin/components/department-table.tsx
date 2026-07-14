// Department list table — Server Component.
// Name links to detail page. Edit link gated by canWrite.
// Status pill: ACTIVE=green, INACTIVE=gray (GD-M25-1 D9).
// No delete action (GD-M25-1 D2). No reactivate action.
// Reference: governance/GD-M25-1.md — Decisions 2, 9, 12

import Link from 'next/link';
import type { DepartmentRow } from '@/features/admin/types';
import { StatusPill } from '@/components/shared/status-pill';
import { EmptyState } from '@/components/shared/empty-state';
import type { StatusPillColor } from '@/components/shared/status-pill';

const TH_STYLE = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.09em',
  color: '#94a3b8',
  backgroundColor: '#f8fafc',
  whiteSpace: 'nowrap',
} as const;

const STATUS_COLOR: Record<string, StatusPillColor> = {
  ACTIVE:   'green',
  INACTIVE: 'gray',
};

type Props = {
  departments: DepartmentRow[];
  canWrite: boolean;
};

export function DepartmentTable({ departments, canWrite }: Props) {
  if (departments.length === 0) {
    return <EmptyState message="No departments found." />;
  }

  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{ borderColor: '#e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Name</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Code</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Description</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Status</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Created</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d) => (
              <tr
                key={d.id}
                className="h-12 border-b last:border-0 transition-colors hover:bg-slate-50"
                style={{ borderColor: '#e2e8f0' }}
              >
                <td className="px-4 py-3 font-medium">
                  <Link
                    href={`/admin/departments/${d.id}`}
                    className="hover:underline"
                    style={{ color: '#2563eb' }}
                  >
                    {d.name}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-xs" style={{ color: '#475569' }}>
                  {d.code}
                </td>
                <td
                  className="max-w-[200px] truncate px-4 py-3"
                  style={{ color: '#475569' }}
                  title={d.description ?? undefined}
                >
                  {d.description ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <StatusPill color={STATUS_COLOR[d.status] ?? 'gray'} label={d.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3" style={{ color: '#475569' }}>
                  {new Date(d.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  {canWrite ? (
                    <Link
                      href={`/admin/departments/${d.id}/edit`}
                      className="text-sm hover:underline"
                      style={{ color: '#2563eb' }}
                    >
                      Edit
                    </Link>
                  ) : (
                    <span style={{ color: '#94a3b8', fontSize: 13 }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
