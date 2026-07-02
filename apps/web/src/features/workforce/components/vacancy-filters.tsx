'use client';

// Client Component — requires interactivity for filter selects.
// Reads current URL search params via useSearchParams(); updates URL via router.push().
// Wrapped in <Suspense> by the parent page (required for useSearchParams in App Router).

import { useRouter, useSearchParams } from 'next/navigation';

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_RECRUITMENT', label: 'In Recruitment' },
  { value: 'CLOSED', label: 'Closed' },
] as const;

const PRIORITY_OPTIONS = [
  { value: '', label: 'All Priorities' },
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
] as const;

const SELECT_CLASS =
  'rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

type Props = { total?: number };

export function VacancyFilters({ total }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentStatus = searchParams.get('status') ?? '';
  const currentPriority = searchParams.get('priority') ?? '';
  const hasFilters = currentStatus !== '' || currentPriority !== '';

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete('page');
    router.push(`/workforce/vacancies?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={currentStatus}
          onChange={(e) => updateFilter('status', e.target.value)}
          className={SELECT_CLASS}
          aria-label="Filter by status"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={currentPriority}
          onChange={(e) => updateFilter('priority', e.target.value)}
          className={SELECT_CLASS}
          aria-label="Filter by priority"
        >
          {PRIORITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {hasFilters && (
          <button
            onClick={() => router.push('/workforce/vacancies')}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {total !== undefined && (
        <span className="text-sm" style={{ color: '#94a3b8' }}>{total} results</span>
      )}
    </div>
  );
}
