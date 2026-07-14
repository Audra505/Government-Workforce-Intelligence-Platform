// User list page — Server Component.
// Fetches GET /api/v1/users with JWT from session cookie.
// URL search params drive filtering (search, status) and pagination (page).
// canRead gated by roles: SA + HRD only (GD-M25-1 D5).
// No write affordances — read-only scope (GD-M25-1 D3, D10).
// Reference: governance/GD-M25-1.md — Decisions 3, 5, 10, 12

import { Suspense } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { serverFetch } from '@/lib/api';
import { getSessionRoles } from '@/lib/session';
import { SESSION_COOKIE } from '@/lib/auth';
import { AdminShell } from '@/features/admin/components/admin-shell';
import { UserTable } from '@/features/admin/components/user-table';
import { UserFilters } from '@/features/admin/components/user-filters';
import { Pagination } from '@/components/shared/pagination';
import type { AdminUserListApiResponse } from '@/features/admin/types';

type PageSearchParams = { [key: string]: string | string[] | undefined };
type Props = { searchParams: PageSearchParams };

function getString(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function buildPageUrl(searchParams: PageSearchParams, targetPage: number): string {
  const params = new URLSearchParams();
  const search = getString(searchParams.search);
  const status = getString(searchParams.status);
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  params.set('page', String(targetPage));
  return `/admin/users?${params.toString()}`;
}

export default async function AdminUsersPage({ searchParams }: Props) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canRead  = roles.includes('System Administrator') || roles.includes('HR Director');
  const canWrite = canRead;

  if (!canRead) {
    return (
      <AdminShell activeTab="users" breadcrumb="Users">
        <div className="flex min-h-[300px] items-center justify-center">
          <p className="text-sm" style={{ color: '#dc2626' }}>
            You do not have permission to view this page.
          </p>
        </div>
      </AdminShell>
    );
  }

  const search = getString(searchParams.search);
  const status = getString(searchParams.status);
  const page   = getString(searchParams.page) ?? '1';

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  params.set('page', page);
  params.set('pageSize', '20');

  const response = await serverFetch<AdminUserListApiResponse>(
    `/api/v1/users?${params.toString()}`,
  );

  const { users, total, page: currentPage, pageSize, totalPages } = response.data;

  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd   = Math.min(currentPage * pageSize, total);

  return (
    <AdminShell activeTab="users" breadcrumb="Users">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#0f172a' }}>
            Users
          </h2>
          <p className="mt-1 text-sm" style={{ color: '#475569' }}>
            Platform user accounts and their current status
          </p>
        </div>
        {canWrite && (
          <Link
            href="/admin/users/new"
            className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#2563eb' }}
          >
            + New User
          </Link>
        )}
      </div>

      <div className="mb-4">
        <Suspense fallback={<div className="h-10" />}>
          <UserFilters total={total} />
        </Suspense>
      </div>

      <UserTable users={users} />

      {total > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          buildUrl={(p) => buildPageUrl(searchParams, p)}
          summary={
            <span>
              Showing {rangeStart}–{rangeEnd} of {total}{' '}
              {total === 1 ? 'user' : 'users'}
            </span>
          }
        />
      )}
    </AdminShell>
  );
}
