'use client';

import { useRouter, useSearchParams } from 'next/navigation';

const BORDER = '#e2e8f0';
const MUTED  = '#94a3b8';
const SUB    = '#475569';

const SELECT_CLASS =
  'rounded-md border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

type Props = { total?: number };

export function InterviewFilters({ total }: Props) {
  const router      = useRouter();
  const searchParams = useSearchParams();

  const currentStatus = searchParams.get('status') ?? '';
  const currentType   = searchParams.get('interviewType') ?? '';
  const hasFilters    = currentStatus !== '' || currentType !== '';

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) { params.set(key, value); } else { params.delete(key); }
    params.delete('page');
    router.push(`/recruiting/interviews?${params.toString()}`);
  }

  function clearFilters() {
    router.push('/recruiting/interviews');
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
          <option value="SCHEDULED">Scheduled</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="NO_SHOW">No Show</option>
        </select>

        <select
          value={currentType}
          onChange={(e) => updateParam('interviewType', e.target.value)}
          className={SELECT_CLASS}
          aria-label="Filter by interview type"
          style={{ borderColor: BORDER }}
        >
          <option value="">All Types</option>
          <option value="PHONE_SCREEN">Phone Screen</option>
          <option value="PANEL">Panel</option>
          <option value="TECHNICAL">Technical</option>
          <option value="FINAL">Final</option>
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
