// User list table — Server Component.
// Name links to detail page. No write actions (GD-M25-1 D3).
// Status pill: ACTIVE=green, INVITED=blue, SUSPENDED=amber(yellow), DEACTIVATED=gray (GD-M25-1 D9).
// Reference: governance/GD-M25-1.md — Decisions 3, 9, 12

import Link from 'next/link';
import type { UserRow } from '@/features/admin/types';
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
  ACTIVE:      'green',
  INVITED:     'blue',
  SUSPENDED:   'yellow',
  DEACTIVATED: 'gray',
};

type Props = { users: UserRow[] };

export function UserTable({ users }: Props) {
  if (users.length === 0) {
    return <EmptyState message="No users found." />;
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
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Email</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Status</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Roles</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Created</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u.id}
                className="h-12 border-b last:border-0 transition-colors hover:bg-slate-50"
                style={{ borderColor: '#e2e8f0' }}
              >
                <td className="px-4 py-3 font-medium">
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="hover:underline"
                    style={{ color: '#2563eb' }}
                  >
                    {u.firstName} {u.lastName}
                  </Link>
                </td>
                <td className="px-4 py-3" style={{ color: '#475569' }}>
                  {u.email}
                </td>
                <td className="px-4 py-3">
                  <StatusPill color={STATUS_COLOR[u.status] ?? 'gray'} label={u.status} />
                </td>
                <td
                  className="max-w-[220px] truncate px-4 py-3"
                  style={{ color: '#475569' }}
                  title={u.roles.join(', ')}
                >
                  {u.roles.length > 0 ? u.roles.join(', ') : '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-3" style={{ color: '#475569' }}>
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
