// Employee list page — Server Component.
// Fetches GET /api/v1/employees with JWT from session cookie.
// URL search params drive filtering (employmentStatus) and pagination (page).
// canWrite derived from JWT roles — gates "New Employee" button (GD-M12-S4-1).
// RBAC-952: Executive User → NestJS returns 403 → caught by error.tsx.
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-002, RBAC-952

import { Suspense } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { LogoutButton } from '@/features/auth/logout-button';
import { serverFetch } from '@/lib/api';
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

function getSessionRoles(token: string): string[] {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { roles?: unknown };
    return Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
  } catch {
    return [];
  }
}

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
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">
            Government Workforce Intelligence Platform
          </h1>
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 p-6">
        {/* Workforce nav */}
        <nav className="mb-6 flex items-center gap-4 text-sm text-muted-foreground">
          <Link href="/workforce/positions" className="hover:text-foreground transition-colors">Positions</Link>
          <span aria-hidden="true">·</span>
          <Link href="/workforce/vacancies" className="hover:text-foreground transition-colors">Vacancies</Link>
          <span aria-hidden="true">·</span>
          <Link href="/workforce/employees" className="font-medium text-foreground">Employees</Link>
        </nav>

        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Employees</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {total === 1 ? '1 employee' : `${total} employees`}
            </p>
          </div>
          {canWrite && (
            <Link
              href="/workforce/employees/new"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              New Employee
            </Link>
          )}
        </div>

        {/* Filter bar — Client Component, needs Suspense for useSearchParams() */}
        <div className="mb-4">
          <Suspense fallback={<div className="h-10" />}>
            <EmployeeFilters />
          </Suspense>
        </div>

        <EmployeeTable employees={employees} hasFilters={hasFilters} />

        {total > 0 && (
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {rangeStart}–{rangeEnd} of {total}{' '}
              {total === 1 ? 'employee' : 'employees'}
            </span>
            <div className="flex items-center gap-2">
              {currentPage > 1 ? (
                <Link
                  href={buildPageUrl(currentPage - 1)}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted transition-colors"
                >
                  ← Previous
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="rounded-md border px-3 py-1.5 text-sm opacity-40 cursor-not-allowed"
                >
                  ← Previous
                </span>
              )}
              <span className="px-2">
                Page {currentPage} of {totalPages}
              </span>
              {currentPage < totalPages ? (
                <Link
                  href={buildPageUrl(currentPage + 1)}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted transition-colors"
                >
                  Next →
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="rounded-md border px-3 py-1.5 text-sm opacity-40 cursor-not-allowed"
                >
                  Next →
                </span>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
