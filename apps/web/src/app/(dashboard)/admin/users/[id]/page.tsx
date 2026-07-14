// User detail page — Server Component.
// Fetches GET /api/v1/users/:id with JWT from session cookie.
// M27: Edit button (SA always; HRD only for non-SA targets) and status actions added (GD-M27-1 D10, D11).
// canRead gated by roles: SA + HRD only (GD-M25-1 D5).
// Reference: governance/GD-M25-1.md — Decisions 3, 5, 9, 10, 12
// Reference: governance/GD-M27-1.md — Decisions 6, 10, 11

import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { serverFetch, ApiError } from '@/lib/api';
import { getSessionRoles } from '@/lib/session';
import { SESSION_COOKIE } from '@/lib/auth';
import { AdminShell } from '@/features/admin/components/admin-shell';
import { StatusPill } from '@/components/shared/status-pill';
import { UserStatusActions } from '@/features/admin/components/user-status-actions';
import type { AdminUserDetailApiResponse } from '@/features/admin/types';
import type { StatusPillColor } from '@/components/shared/status-pill';

const STATUS_COLOR: Record<string, StatusPillColor> = {
  ACTIVE:      'green',
  INVITED:     'blue',
  SUSPENDED:   'yellow',
  DEACTIVATED: 'gray',
};

const BLUE   = '#2563eb';
const TEXT   = '#0f172a';
const SUB    = '#475569';
const BORDER = '#e2e8f0';

type Props = { params: { id: string } };

export default async function UserDetailPage({ params }: Props) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const actorRoles = token ? getSessionRoles(token) : [];
  const isSA  = actorRoles.includes('System Administrator');
  const isHRD = actorRoles.includes('HR Director');
  const canRead = isSA || isHRD;

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

  // Actor-level visibility: SA can manage any user; HRD can only manage non-SA users (D6/D11)
  const targetIsSA = user.roles.includes('System Administrator');
  const canManage  = isSA || (isHRD && !targetIsSA);

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
          <div className="flex items-center gap-3">
            <StatusPill color={STATUS_COLOR[user.status] ?? 'gray'} label={user.status} />
            {canManage && (
              <Link
                href={`/admin/users/${user.id}/edit`}
                className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50"
                style={{ color: BLUE, borderColor: BORDER }}
              >
                Edit
              </Link>
            )}
          </div>
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
        {/* Status actions — SA always; HRD only for non-SA targets (D11) */}
        {canManage && (
          <div className="mt-6">
            <p
              className="mb-3 text-xs font-semibold uppercase tracking-wider"
              style={{ color: '#94a3b8', letterSpacing: '0.09em' }}
            >
              Status Actions
            </p>
            <UserStatusActions userId={user.id} currentStatus={user.status} />
          </div>
        )}
      </div>
    </AdminShell>
  );
}
