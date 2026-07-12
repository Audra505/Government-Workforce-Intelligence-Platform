// Certifications catalog list page — Server Component.
// Fetches GET /api/v1/certifications with JWT from session cookie.
// canWrite from JWT roles — gates "New Certification" button (GD-M24-1 D3).
// Reference: governance/GD-M24-1.md — Decisions 1, 2, 3

import Link from 'next/link';
import { cookies } from 'next/headers';
import { serverFetch } from '@/lib/api';
import { getSessionRoles } from '@/lib/session';
import { WorkforceShell } from '@/features/workforce/components/workforce-shell';
import { Pagination } from '@/components/shared/pagination';
import { CertificationTable } from '@/features/workforce/components/certification-table';
import { SESSION_COOKIE } from '@/lib/auth';
import type { CertificationListApiResponse } from '@/features/workforce/types';

type PageSearchParams = { [key: string]: string | string[] | undefined };
type Props = { searchParams: PageSearchParams };
type CountResponse = { data: { total: number } };

function getString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function getCertifications(searchParams: PageSearchParams): Promise<CertificationListApiResponse> {
  const page = getString(searchParams.page) ?? '1';
  const params = new URLSearchParams();
  params.set('page', page);
  params.set('pageSize', '20');
  return serverFetch<CertificationListApiResponse>(`/api/v1/certifications?${params.toString()}`);
}

async function getTabCounts() {
  const [p, v, e, s, c] = await Promise.all([
    serverFetch<CountResponse>('/api/v1/positions?pageSize=1').catch(() => null),
    serverFetch<CountResponse>('/api/v1/vacancies?pageSize=1').catch(() => null),
    serverFetch<CountResponse>('/api/v1/employees?pageSize=1').catch(() => null),
    serverFetch<CountResponse>('/api/v1/skills?pageSize=1').catch(() => null),
    serverFetch<CountResponse>('/api/v1/certifications?pageSize=1').catch(() => null),
  ]);
  return {
    positions: p?.data.total,
    vacancies: v?.data.total,
    employees: e?.data.total,
    skills: s?.data.total,
    certifications: c?.data.total,
  };
}

function buildPageUrl(searchParams: PageSearchParams, targetPage: number): string {
  const params = new URLSearchParams();
  params.set('page', String(targetPage));
  return `/workforce/certifications?${params.toString()}`;
}

export default async function CertificationsPage({ searchParams }: Props) {
  const [response, counts] = await Promise.all([
    getCertifications(searchParams),
    getTabCounts(),
  ]);
  const { certifications, total, page: currentPage, pageSize, totalPages } = response.data;

  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canWrite = roles.includes('System Administrator') || roles.includes('HR Director');

  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(currentPage * pageSize, total);

  return (
    <WorkforceShell activeTab="certifications" breadcrumb="Certifications" counts={counts}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Certifications</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Certification catalog available for assignment to employees
          </p>
        </div>
        {canWrite && (
          <Link
            href="/workforce/certifications/new"
            className="rounded-md px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: '#2563eb' }}
          >
            + Add Certification
          </Link>
        )}
      </div>

      <CertificationTable certifications={certifications} canWrite={canWrite} />

      {total > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          buildUrl={(page) => buildPageUrl(searchParams, page)}
          summary={
            <span>
              Showing {rangeStart}–{rangeEnd} of {total}{' '}
              {total === 1 ? 'certification' : 'certifications'}
            </span>
          }
        />
      )}
    </WorkforceShell>
  );
}
