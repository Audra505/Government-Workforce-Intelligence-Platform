import { Suspense } from 'react';
import { serverFetch } from '@/lib/api';
import { Pagination } from '@/components/shared/pagination';
import { RecruitingShell } from '@/features/recruiting/components/recruiting-shell';
import { InterviewTable } from '@/features/recruiting/components/interview-table';
import { InterviewFilters } from '@/features/recruiting/components/interview-filters';
import type { InterviewListApiResponse } from '@/features/recruiting/types';

type PageSearchParams = { [key: string]: string | string[] | undefined };
type Props = { searchParams: PageSearchParams };
type CountResponse = { data: { total: number } };

function getString(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

async function getInterviews(searchParams: PageSearchParams): Promise<InterviewListApiResponse> {
  const status        = getString(searchParams.status);
  const interviewType = getString(searchParams.interviewType);
  const page          = getString(searchParams.page) ?? '1';
  const params = new URLSearchParams();
  if (status)        params.set('status', status);
  if (interviewType) params.set('interviewType', interviewType);
  params.set('page', page);
  params.set('pageSize', '25');
  return serverFetch<InterviewListApiResponse>(`/api/v1/interviews?${params.toString()}`);
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
  const status        = getString(searchParams.status);
  const interviewType = getString(searchParams.interviewType);
  if (status)        params.set('status', status);
  if (interviewType) params.set('interviewType', interviewType);
  params.set('page', String(targetPage));
  return `/recruiting/interviews?${params.toString()}`;
}

const SUB    = '#475569';

export default async function InterviewsPage({ searchParams }: Props) {
  const [response, counts] = await Promise.all([
    getInterviews(searchParams),
    getTabCounts(),
  ]);
  const { interviews, total, page: currentPage, pageSize, totalPages } = response.data;

  const hasFilters = Boolean(
    getString(searchParams.status) || getString(searchParams.interviewType),
  );

  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd   = Math.min(currentPage * pageSize, total);

  return (
    <RecruitingShell activeTab="interviews" breadcrumb="Interviews" counts={counts}>
      <div className="mb-6">
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#0f172a' }}>
          Interviews
        </h2>
        <p className="mt-1 text-sm" style={{ color: SUB }}>
          Scheduled and completed interviews
        </p>
      </div>

      <div className="mb-4">
        <Suspense fallback={<div className="h-10" />}>
          <InterviewFilters total={total} />
        </Suspense>
      </div>

      <InterviewTable interviews={interviews} hasFilters={hasFilters} />

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
