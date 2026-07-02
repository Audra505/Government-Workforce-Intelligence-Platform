// Position list page — Server Component.
// Fetches GET /api/v1/positions with JWT from session cookie.
// URL search params drive filtering (status, departmentId, classification, search) and pagination (page).
// Departments loaded server-side and passed to PositionFilters for the department select.
// canWrite from JWT roles — gates "New Position" button (POS-AUTH-001).
// Reference: directives/02_position_management_rules.md — POS-AUTH-001, POS-AUTH-002
// Reference: governance/GD-PHASE2-CLOSURE-002.md — Decision 3 (list page requirement)
// Reference: spec/01_requirements.md — FR-100 through FR-107

import { Suspense } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { serverFetch } from '@/lib/api';
import { getSessionRoles } from '@/lib/session';
import { WorkforceShell } from '@/features/workforce/components/workforce-shell';
import { Pagination } from '@/components/shared/pagination';
import { PositionFilters } from '@/features/workforce/components/position-filters';
import { PositionTable } from '@/features/workforce/components/position-table';
import { SESSION_COOKIE } from '@/lib/auth';
import type { PositionFullListApiResponse, DepartmentListApiResponse, DepartmentOption } from '@/features/workforce/types';

type PageSearchParams = { [key: string]: string | string[] | undefined };
type Props = { searchParams: PageSearchParams };

function getString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function getPositions(searchParams: PageSearchParams): Promise<PositionFullListApiResponse> {
  const status         = getString(searchParams.status);
  const departmentId   = getString(searchParams.departmentId);
  const classification = getString(searchParams.classification);
  const search         = getString(searchParams.search);
  const page           = getString(searchParams.page) ?? '1';

  const params = new URLSearchParams();
  if (status)         params.set('status', status);
  if (departmentId)   params.set('departmentId', departmentId);
  if (classification) params.set('classification', classification);
  if (search)         params.set('search', search);
  params.set('page', page);
  params.set('pageSize', '20');

  return serverFetch<PositionFullListApiResponse>(`/api/v1/positions?${params.toString()}`);
}

async function getDepartments(): Promise<DepartmentOption[]> {
  try {
    const res = await serverFetch<DepartmentListApiResponse>(
      '/api/v1/departments?status=ACTIVE&pageSize=100',
    );
    return res.data.departments;
  } catch {
    return [];
  }
}

function buildPageUrl(searchParams: PageSearchParams, targetPage: number): string {
  const params = new URLSearchParams();
  const status         = getString(searchParams.status);
  const departmentId   = getString(searchParams.departmentId);
  const classification = getString(searchParams.classification);
  const search         = getString(searchParams.search);
  if (status)         params.set('status', status);
  if (departmentId)   params.set('departmentId', departmentId);
  if (classification) params.set('classification', classification);
  if (search)         params.set('search', search);
  params.set('page', String(targetPage));
  return `/workforce/positions?${params.toString()}`;
}

export default async function PositionsPage({ searchParams }: Props) {
  const [response, departments] = await Promise.all([
    getPositions(searchParams),
    getDepartments(),
  ]);
  const { positions, total, page: currentPage, pageSize, totalPages } = response.data;

  const hasFilters = Boolean(
    getString(searchParams.status) ||
    getString(searchParams.departmentId) ||
    getString(searchParams.classification) ||
    getString(searchParams.search),
  );

  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canWrite = roles.includes('System Administrator') || roles.includes('HR Director');

  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd   = Math.min(currentPage * pageSize, total);

  return (
    <WorkforceShell activeTab="positions" breadcrumb="Positions" counts={{ positions: total }}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Positions</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Authorized positions and occupancy status across your organization
          </p>
        </div>
        {canWrite && (
          <Link
            href="/workforce/positions/new"
            className="rounded-md px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: '#2563eb' }}
          >
            + New Position
          </Link>
        )}
      </div>

      <div className="mb-4">
        <Suspense fallback={<div className="h-10" />}>
          <PositionFilters departments={departments} />
        </Suspense>
      </div>

      <PositionTable positions={positions} hasFilters={hasFilters} />

      {total > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          buildUrl={(page) => buildPageUrl(searchParams, page)}
          summary={
            <span>
              Showing {rangeStart}–{rangeEnd} of {total}{' '}
              {total === 1 ? 'position' : 'positions'}
            </span>
          }
        />
      )}
    </WorkforceShell>
  );
}
