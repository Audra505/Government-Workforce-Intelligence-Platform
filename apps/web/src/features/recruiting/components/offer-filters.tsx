'use client';

import { useRouter, useSearchParams } from 'next/navigation';

const BORDER = '#e2e8f0';
const MUTED  = '#94a3b8';
const SUB    = '#475569';

const SELECT_CLASS =
  'rounded-md border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

type Props = { total?: number };

export function OfferFilters({ total }: Props) {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const currentStatus = searchParams.get('status') ?? '';
  const hasFilters    = currentStatus !== '';

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) { params.set(key, value); } else { params.delete(key); }
    params.delete('page');
    router.push(`/recruiting/offers?${params.toString()}`);
  }

  function clearFilters() {
    router.push('/recruiting/offers');
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={currentStatus}
          onChange={(e) => updateParam('status', e.target.value)}
          className={SELECT_CLASS}
          aria-label="Filter by status"
          style={{ borderColor: BORDER }}
        >
          <option value="">All Status</option>
          <option value="DRAFT">Draft</option>
          <option value="PENDING_APPROVAL">Pending Approval</option>
          <option value="APPROVED">Approved</option>
          <option value="SENT">Sent</option>
          <option value="ACCEPTED">Accepted</option>
          <option value="DECLINED">Declined</option>
          <option value="WITHDRAWN">Withdrawn</option>
        </select>

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-sm underline-offset-4 hover:underline"
            style={{ color: SUB }}
          >
            Clear
          </button>
        )}
      </div>

      {total !== undefined && (
        <span className="text-sm" style={{ color: MUTED }}>{total} results</span>
      )}
    </div>
  );
}
