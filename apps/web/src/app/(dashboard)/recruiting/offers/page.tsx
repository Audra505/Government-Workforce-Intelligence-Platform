import { Suspense } from 'react';
import { serverFetch } from '@/lib/api';
import { Pagination } from '@/components/shared/pagination';
import { RecruitingShell } from '@/features/recruiting/components/recruiting-shell';
import { OfferTable } from '@/features/recruiting/components/offer-table';
import { OfferFilters } from '@/features/recruiting/components/offer-filters';
import type { OfferListApiResponse } from '@/features/recruiting/types';

type PageSearchParams = { [key: string]: string | string[] | undefined };
type Props = { searchParams: PageSearchParams };
type CountResponse = { data: { total: number } };

function getString(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

async function getOffers(searchParams: PageSearchParams): Promise<OfferListApiResponse> {
  const status = getString(searchParams.status);
  const page   = getString(searchParams.page) ?? '1';
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('page', page);
  params.set('pageSize', '25');
  return serverFetch<OfferListApiResponse>(`/api/v1/offers?${params.toString()}`);
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
  if (status) params.set('status', status);
  params.set('page', String(targetPage));
  return `/recruiting/offers?${params.toString()}`;
}

const SUB    = '#475569';

export default async function OffersPage({ searchParams }: Props) {
  const [response, counts] = await Promise.all([
    getOffers(searchParams),
    getTabCounts(),
  ]);
  const { offers, total, page: currentPage, pageSize, totalPages } = response.data;

  const hasFilters = Boolean(getString(searchParams.status));

  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd   = Math.min(currentPage * pageSize, total);

  return (
    <RecruitingShell activeTab="offers" breadcrumb="Offers" counts={counts}>
      <div className="mb-6">
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#0f172a' }}>
          Offers
        </h2>
        <p className="mt-1 text-sm" style={{ color: SUB }}>
          Outstanding and historical employment offers
        </p>
      </div>

      <div className="mb-4">
        <Suspense fallback={<div className="h-10" />}>
          <OfferFilters total={total} />
        </Suspense>
      </div>

      <OfferTable offers={offers} hasFilters={hasFilters} />

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
