// Department list page — Server Component.
// Fetches GET /api/v1/departments with JWT from session cookie.
// URL search params drive filtering (search, status) and pagination (page).
// canWrite gated by roles: SA + HRD (GD-M25-1 D5).
// canRead gated by roles: SA + HRD + WP (GD-M25-1 D5).
// Reference: governance/GD-M25-1.md — Decisions 2, 5, 10, 12

import { Suspense } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { serverFetch } from '@/lib/api';
import { getSessionRoles } from '@/lib/session';
import { SESSION_COOKIE } from '@/lib/auth';
import { AdminShell } from '@/features/admin/components/admin-shell';
import { DepartmentTable } from '@/features/admin/components/department-table';
import { DepartmentFilters } from '@/features/admin/components/department-filters';
import { Pagination } from '@/components/shared/pagination';
import type { AdminDepartmentListApiResponse } from '@/features/admin/types';

type PageSearchParams = { [key: string]: string | string[] | undefined };
type Props = { searchParams: PageSearchParams };

function getString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function buildPageUrl(searchParams: PageSearchParams, targetPage: number): string {
  const params = new URLSearchParams();
  const search = getString(searchParams.search);
  const status = getString(searchParams.status);
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  params.set('page', String(targetPage));
  return `/admin/departments?${params.toString()}`;
}

export default async function AdminDepartmentsPage({ searchParams }: Props) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];

  const canRead =
    roles.includes('System Administrator') ||
    roles.includes('HR Director') ||
    roles.includes('Workforce Planner');
  const canWrite =
    roles.includes('System Administrator') || roles.includes('HR Director');

  if (!canRead) {
    return (
      <AdminShell activeTab="departments" breadcrumb="Departments">
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

  const response = await serverFetch<AdminDepartmentListApiResponse>(
    `/api/v1/departments?${params.toString()}`,
  );

  const { departments, total, page: currentPage, pageSize, totalPages } = response.data;

  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd   = Math.min(currentPage * pageSize, total);

  return (
    <AdminShell activeTab="departments" breadcrumb="Departments">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#0f172a' }}>
            Departments
          </h2>
          <p className="mt-1 text-sm" style={{ color: '#475569' }}>
            Agency departments and their current status
          </p>
        </div>
        {canWrite && (
          <Link
            href="/admin/departments/new"
            className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#2563eb' }}
          >
            + Add Department
          </Link>
        )}
      </div>

      <div className="mb-4">
        <Suspense fallback={<div className="h-10" />}>
          <DepartmentFilters total={total} />
        </Suspense>
      </div>

      <DepartmentTable departments={departments} canWrite={canWrite} />

      {total > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          buildUrl={(p) => buildPageUrl(searchParams, p)}
          summary={
            <span>
              Showing {rangeStart}–{rangeEnd} of {total}{' '}
              {total === 1 ? 'department' : 'departments'}
            </span>
          }
        />
      )}
    </AdminShell>
  );
}
