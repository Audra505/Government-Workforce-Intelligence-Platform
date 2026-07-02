// Employee list page — Server Component.
// Fetches GET /api/v1/employees with JWT from session cookie.
// URL search params drive filtering (employmentStatus) and pagination (page).
// canWrite derived from JWT roles — gates "New Employee" button (GD-M12-S4-1).
// RBAC-952: Executive User → NestJS returns 403 → caught by error.tsx.
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-002, RBAC-952

import { Suspense } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { serverFetch } from '@/lib/api';
import { getSessionRoles } from '@/lib/session';
import { WorkforceShell } from '@/features/workforce/components/workforce-shell';
import { Pagination } from '@/components/shared/pagination';
import { EmployeeFilters } from '@/features/workforce/components/employee-filters';
import { EmployeeTable } from '@/features/workforce/components/employee-table';
import { SESSION_COOKIE } from '@/lib/auth';
import type { EmployeeListApiResponse } from '@/features/workforce/types';

type PageSearchParams = {
  [key: string]: string | string[] | undefined;
};

type Props = {
  searchParams: PageSearchParams;
};

function getString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function getEmployees(searchParams: PageSearchParams): Promise<EmployeeListApiResponse> {
  const status = getString(searchParams.employmentStatus);
  const page   = getString(searchParams.page) ?? '1';

  const params = new URLSearchParams();
  if (status) params.set('employmentStatus', status);
  params.set('page', page);
  params.set('pageSize', '20');

  return serverFetch<EmployeeListApiResponse>(`/api/v1/employees?${params.toString()}`);
}

export default async function EmployeesPage({ searchParams }: Props) {
  const response = await getEmployees(searchParams);
  const { employees, total, page: currentPage, pageSize, totalPages } = response.data;

  const hasFilters = Boolean(getString(searchParams.employmentStatus));

  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canWrite = roles.includes('System Administrator') || roles.includes('HR Director');

  function buildPageUrl(targetPage: number): string {
    const params = new URLSearchParams();
    const status = getString(searchParams.employmentStatus);
    if (status) params.set('employmentStatus', status);
    params.set('page', String(targetPage));
    return `/workforce/employees?${params.toString()}`;
  }

  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd   = Math.min(currentPage * pageSize, total);

  return (
    <WorkforceShell activeTab="employees" breadcrumb="Employees" counts={{ employees: total }}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Employees</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Active workforce headcount and employment lifecycle status
          </p>
        </div>
        {canWrite && (
          <Link
            href="/workforce/employees/new"
            className="rounded-md px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: '#2563eb' }}
          >
            + New Employee
          </Link>
        )}
      </div>

      <div className="mb-4">
        <Suspense fallback={<div className="h-10" />}>
          <EmployeeFilters />
        </Suspense>
      </div>

      <EmployeeTable employees={employees} hasFilters={hasFilters} />

      {total > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          buildUrl={buildPageUrl}
          summary={
            <span>
              Showing {rangeStart}–{rangeEnd} of {total}{' '}
              {total === 1 ? 'employee' : 'employees'}
            </span>
          }
        />
      )}
    </WorkforceShell>
  );
}
