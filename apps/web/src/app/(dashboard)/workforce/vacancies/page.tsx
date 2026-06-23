// VacancyBoard — primary read surface for workforce vacancy management.
// Server Component: fetches GET /api/v1/vacancies with JWT from session cookie.
// URL search params drive filtering (status, priority) and pagination (page).
// Reference: spec/01_requirements.md — FR-103 Vacancy Management
// Reference: spec/09_frontend_architecture.md — /workforce/vacancies route
// Reference: directives/03_vacancy_management_rules.md — VAC-700 through VAC-703 (aging)
// Reference: M11 Step 9 Governance — read-only board; no write actions in Step 9

import { Suspense } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { LogoutButton } from '@/features/auth/logout-button';
import { serverFetch } from '@/lib/api';
import { VacancyFilters } from '@/features/workforce/components/vacancy-filters';
import { VacancyTable } from '@/features/workforce/components/vacancy-table';
import { SESSION_COOKIE } from '@/lib/auth';
import type { VacancyListApiResponse } from '@/features/workforce/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PageSearchParams = {
  [key: string]: string | string[] | undefined;
};

type Props = {
  searchParams: PageSearchParams;
};

// ---------------------------------------------------------------------------
// Role check — same pattern as vacancy detail page (GD-12-4 established)
// NestJS is the authoritative RBAC enforcer; this is UX-only (hides false affordances).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

function getString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function getVacancies(searchParams: PageSearchParams): Promise<VacancyListApiResponse> {
  const status = getString(searchParams.status);
  const priority = getString(searchParams.priority);
  const page = getString(searchParams.page) ?? '1';

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (priority) params.set('priority', priority);
  params.set('page', page);
  params.set('pageSize', '20');

  return serverFetch<VacancyListApiResponse>(`/api/v1/vacancies?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function VacanciesPage({ searchParams }: Props) {
  const response = await getVacancies(searchParams);
  const { vacancies, total, page: currentPage, pageSize, totalPages } = response.data;

  const hasFilters = Boolean(getString(searchParams.status) || getString(searchParams.priority));

  // Derive write access from JWT — hides "New Vacancy" for read-only roles.
  // Workforce Planners have read-only access; showing "New Vacancy" would lead to a 403.
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canWrite = roles.includes('System Administrator') || roles.includes('HR Director');

  // Pagination URL builder — preserves current filter params
  function buildPageUrl(targetPage: number): string {
    const params = new URLSearchParams();
    const status = getString(searchParams.status);
    const priority = getString(searchParams.priority);
    if (status) params.set('status', status);
    if (priority) params.set('priority', priority);
    params.set('page', String(targetPage));
    return `/workforce/vacancies?${params.toString()}`;
  }

  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(currentPage * pageSize, total);

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
          <Link href="/workforce/employees" className="hover:text-foreground transition-colors">Employees</Link>
          <span aria-hidden="true">·</span>
          <Link href="/workforce/vacancies" className="font-medium text-foreground">Vacancies</Link>
        </nav>

        {/* Page heading */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Vacancies</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {total === 1 ? '1 vacancy' : `${total} vacancies`}
            </p>
          </div>
          {canWrite && (
            <Link
              href="/workforce/vacancies/new"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              New Vacancy
            </Link>
          )}
        </div>

        {/* Filter bar — Client Component, needs Suspense for useSearchParams() */}
        <div className="mb-4">
          <Suspense fallback={<div className="h-10" />}>
            <VacancyFilters />
          </Suspense>
        </div>

        {/* Table */}
        <VacancyTable vacancies={vacancies} hasFilters={hasFilters} />

        {/* Pagination — only rendered when there are results */}
        {total > 0 && (
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {rangeStart}–{rangeEnd} of {total}{' '}
              {total === 1 ? 'vacancy' : 'vacancies'}
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
