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
import { serverFetch } from '@/lib/api';
import { getSessionRoles } from '@/lib/session';
import { WorkforceShell } from '@/features/workforce/components/workforce-shell';
import { Pagination } from '@/components/shared/pagination';
import { VacancyFilters } from '@/features/workforce/components/vacancy-filters';
import { VacancyTable } from '@/features/workforce/components/vacancy-table';
import { SESSION_COOKIE } from '@/lib/auth';
import type { VacancyListApiResponse } from '@/features/workforce/types';

type PageSearchParams = {
  [key: string]: string | string[] | undefined;
};

type Props = {
  searchParams: PageSearchParams;
};

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

export default async function VacanciesPage({ searchParams }: Props) {
  const response = await getVacancies(searchParams);
  const { vacancies, total, page: currentPage, pageSize, totalPages } = response.data;

  const hasFilters = Boolean(getString(searchParams.status) || getString(searchParams.priority));

  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canWrite = roles.includes('System Administrator') || roles.includes('HR Director');

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
    <WorkforceShell activeTab="vacancies" breadcrumb="Vacancies" counts={{ vacancies: total }}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Vacancies</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Open vacancies and recruitment progress across active positions
          </p>
        </div>
        {canWrite && (
          <Link
            href="/workforce/vacancies/new"
            className="rounded-md px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: '#2563eb' }}
          >
            + Add Vacancy
          </Link>
        )}
      </div>

      <div className="mb-4">
        <Suspense fallback={<div className="h-10" />}>
          <VacancyFilters total={total} />
        </Suspense>
      </div>

      <VacancyTable vacancies={vacancies} hasFilters={hasFilters} />

      {total > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          buildUrl={buildPageUrl}
          summary={
            <span>
              Showing {rangeStart}–{rangeEnd} of {total}{' '}
              {total === 1 ? 'vacancy' : 'vacancies'}
            </span>
          }
        />
      )}
    </WorkforceShell>
  );
}
