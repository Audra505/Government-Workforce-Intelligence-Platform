import { Suspense } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { Pagination } from '@/components/shared/pagination';
import { serverFetch } from '@/lib/api';
import { SESSION_COOKIE } from '@/lib/auth';
import { RecruitingShell } from '@/features/recruiting/components/recruiting-shell';
import { CandidateTable } from '@/features/recruiting/components/candidate-table';
import { CandidateFilters } from '@/features/recruiting/components/candidate-filters';
import type { CandidateListApiResponse } from '@/features/recruiting/types';

type PageSearchParams = { [key: string]: string | string[] | undefined };
type Props = { searchParams: PageSearchParams };
type CountResponse = { data: { total: number } };

function getString(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

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

async function getCandidates(searchParams: PageSearchParams): Promise<CandidateListApiResponse> {
  const status = getString(searchParams.status);
  const page   = getString(searchParams.page) ?? '1';
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('page', page);
  params.set('pageSize', '25');
  return serverFetch<CandidateListApiResponse>(`/api/v1/candidates?${params.toString()}`);
}

async function getTabCounts() {
  const [c, a, i, o] = await Promise.all([
    serverFetch<CountResponse>('/api/v1/candidates?pageSize=1').catch(() => null),
    serverFetch<CountResponse>('/api/v1/applications?pageSize=1').catch(() => null),
    serverFetch<CountResponse>('/api/v1/interviews?pageSize=1').catch(() => null),
    serverFetch<CountResponse>('/api/v1/offers?pageSize=1').catch(() => null),
  ]);
  return {
    candidates:   c?.data.total,
    applications: a?.data.total,
    interviews:   i?.data.total,
    offers:       o?.data.total,
  };
}

function buildPageUrl(searchParams: PageSearchParams, targetPage: number): string {
  const params = new URLSearchParams();
  const status = getString(searchParams.status);
  const search = getString(searchParams.search);
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  params.set('page', String(targetPage));
  return `/recruiting/candidates?${params.toString()}`;
}

const SUB    = '#475569';
const BLUE   = '#2563eb';

export default async function CandidatesPage({ searchParams }: Props) {
  const [response, counts] = await Promise.all([
    getCandidates(searchParams),
    getTabCounts(),
  ]);
  const { candidates, total, page: currentPage, pageSize, totalPages } = response.data;

  const hasFilters = Boolean(getString(searchParams.status));

  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canCreate =
    roles.includes('System Administrator') ||
    roles.includes('HR Director') ||
    roles.includes('Recruiter');

  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd   = Math.min(currentPage * pageSize, total);

  return (
    <RecruitingShell activeTab="candidates" breadcrumb="Candidates" counts={counts}>
      {getString(searchParams.archived) === '1' && (
        <div
          role="status"
          style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: 6,
            padding: '10px 14px',
            fontSize: 13,
            color: '#15803d',
            marginBottom: 16,
          }}
        >
          Candidate archived successfully.
        </div>
      )}

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#0f172a' }}>
            Candidates
          </h2>
          <p className="mt-1 text-sm" style={{ color: SUB }}>
            Active candidate pool for open positions
          </p>
        </div>

        {canCreate && (
          <Link
            href="/recruiting/candidates/new"
            className="rounded-md px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: BLUE }}
          >
            + Add Candidate
          </Link>
        )}
      </div>

      <div className="mb-4">
        <Suspense fallback={<div className="h-10" />}>
          <CandidateFilters total={total} />
        </Suspense>
      </div>

      <CandidateTable candidates={candidates} hasFilters={hasFilters} />

      {total > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          buildUrl={(page) => buildPageUrl(searchParams, page)}
          summary={`Showing ${rangeStart}–${rangeEnd} of ${total}`}
        />
      )}
    </RecruitingShell>
  );
}
