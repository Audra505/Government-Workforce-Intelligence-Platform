'use client';

// Client Component — requires interactivity for filter select.
// Reads current URL search params via useSearchParams(); updates URL via router.push().
// Wrapped in <Suspense> by the parent page (required for useSearchParams in App Router).
// Reference: directives/13_employee_management_rules.md — GD-M12-1 canonical status values

import { useRouter, useSearchParams } from 'next/navigation';

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'PENDING_ONBOARDING', label: 'Pending Onboarding' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ON_LEAVE', label: 'On Leave' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'SEPARATED', label: 'Separated' },
] as const;

const SELECT_CLASS =
  'rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

type Props = { total?: number };

export function EmployeeFilters({ total }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentStatus = searchParams.get('employmentStatus') ?? '';
  const hasFilters = currentStatus !== '';

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete('page');
    router.push(`/workforce/employees?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={currentStatus}
          onChange={(e) => updateFilter('employmentStatus', e.target.value)}
          className={SELECT_CLASS}
          aria-label="Filter by employment status"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {hasFilters && (
          <button
            onClick={() => router.push('/workforce/employees')}
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
