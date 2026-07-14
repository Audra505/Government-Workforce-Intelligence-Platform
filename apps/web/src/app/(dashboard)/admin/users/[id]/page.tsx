// User detail page — Server Component.
// Fetches GET /api/v1/users/:id with JWT from session cookie.
// Read-only — no edit, deactivate, suspend, delete, or role change affordances (GD-M25-1 D3).
// canRead gated by roles: SA + HRD only (GD-M25-1 D5).
// Reference: governance/GD-M25-1.md — Decisions 3, 5, 9, 10, 12

import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { serverFetch, ApiError } from '@/lib/api';
import { getSessionRoles } from '@/lib/session';
import { SESSION_COOKIE } from '@/lib/auth';
import { AdminShell } from '@/features/admin/components/admin-shell';
import { StatusPill } from '@/components/shared/status-pill';
import type { AdminUserDetailApiResponse } from '@/features/admin/types';
import type { StatusPillColor } from '@/components/shared/status-pill';

const STATUS_COLOR: Record<string, StatusPillColor> = {
  ACTIVE:      'green',
  INVITED:     'blue',
  SUSPENDED:   'yellow',
  DEACTIVATED: 'gray',
};

const TEXT   = '#0f172a';
const SUB    = '#475569';
const BORDER = '#e2e8f0';

type Props = { params: { id: string } };

export default async function UserDetailPage({ params }: Props) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canRead = roles.includes('System Administrator') || roles.includes('HR Director');

  if (!canRead) {
    return (
      <AdminShell activeTab="users" breadcrumb="User">
        <div className="flex min-h-[300px] items-center justify-center">
          <p className="text-sm" style={{ color: '#dc2626' }}>
            You do not have permission to view this user.
          </p>
        </div>
      </AdminShell>
    );
  }

  let response: AdminUserDetailApiResponse;
  try {
    response = await serverFetch<AdminUserDetailApiResponse>(
      `/api/v1/users/${params.id}`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const user = response.data;
  const fullName = `${user.firstName} ${user.lastName}`;

  return (
    <AdminShell activeTab="users" breadcrumb={fullName}>
      <div className="mx-auto max-w-2xl">
        {/* Header row */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight" style={{ color: TEXT }}>
              {fullName}
            </h2>
            <p className="mt-1 text-sm" style={{ color: SUB }}>{user.email}</p>
          </div>
          <StatusPill color={STATUS_COLOR[user.status] ?? 'gray'} label={user.status} />
        </div>

        {/* Detail card */}
        <div className="rounded-lg border p-5" style={{ borderColor: BORDER }}>
          <dl className="space-y-4">
            <div>
              <dt
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: '#94a3b8', letterSpacing: '0.09em' }}
              >
                Email
              </dt>
              <dd className="mt-1 text-sm" style={{ color: TEXT }}>{user.email}</dd>
            </div>

            <div>
              <dt
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: '#94a3b8', letterSpacing: '0.09em' }}
              >
                Status
              </dt>
              <dd className="mt-1">
                <StatusPill color={STATUS_COLOR[user.status] ?? 'gray'} label={user.status} />
              </dd>
            </div>

            <div>
              <dt
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: '#94a3b8', letterSpacing: '0.09em' }}
              >
                Roles
              </dt>
              <dd className="mt-1 text-sm" style={{ color: user.roles.length > 0 ? TEXT : SUB }}>
                {user.roles.length > 0 ? user.roles.join(', ') : 'No roles assigned.'}
              </dd>
            </div>

            <div>
              <dt
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: '#94a3b8', letterSpacing: '0.09em' }}
              >
                Member Since
              </dt>
              <dd className="mt-1 text-sm" style={{ color: SUB }}>
                {new Date(user.createdAt).toLocaleDateString(undefined, {
                  year: 'numeric', month: 'long', day: 'numeric',
                })}
              </dd>
            </div>

            <div>
              <dt
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: '#94a3b8', letterSpacing: '0.09em' }}
              >
                Last Sign In
              </dt>
              <dd className="mt-1 text-sm" style={{ color: SUB }}>
                {user.lastLoginAt
                  ? new Date(user.lastLoginAt).toLocaleDateString(undefined, {
                      year: 'numeric', month: 'long', day: 'numeric',
                    })
                  : 'Never'}
              </dd>
            </div>

            <div>
              <dt
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: '#94a3b8', letterSpacing: '0.09em' }}
              >
                User ID
              </dt>
              <dd
                className="mt-1 font-mono text-xs"
                style={{ color: SUB }}
              >
                {user.id}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </AdminShell>
  );
}
