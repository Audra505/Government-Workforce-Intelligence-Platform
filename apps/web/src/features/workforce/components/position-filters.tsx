'use client';

// Client Component — filter bar for the Position list page.
// Reads current URL search params via useSearchParams(); updates URL via router.push().
// Wrapped in <Suspense> by the parent page (required for useSearchParams in App Router).
// Filters: status, departmentId (select), classification (text), search (title contains).
// departments prop is loaded server-side by the parent and passed down.
// Authority: state/01_position_lifecycle.md — 4-state lifecycle
// Reference: governance/GD-PHASE2-CLOSURE-002.md — Decision 3 (status, department, classification filters)

import { useRouter, useSearchParams } from 'next/navigation';
import type { DepartmentOption } from '@/features/workforce/types';

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'FROZEN', label: 'Frozen' },
  { value: 'CLOSED', label: 'Closed' },
] as const;

const SELECT_CLASS =
  'rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const INPUT_CLASS =
  'rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring w-44';

type Props = { departments: DepartmentOption[]; total?: number };

export function PositionFilters({ departments, total }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentStatus         = searchParams.get('status')         ?? '';
  const currentDepartmentId   = searchParams.get('departmentId')   ?? '';
  const currentClassification = searchParams.get('classification') ?? '';
  const currentSearch         = searchParams.get('search')         ?? '';

  const hasFilters =
    currentStatus !== '' ||
    currentDepartmentId !== '' ||
    currentClassification !== '' ||
    currentSearch !== '';

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete('page');
    router.push(`/workforce/positions?${params.toString()}`);
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

      {departments.length > 0 && (
        <select
          value={currentDepartmentId}
          onChange={(e) => updateFilter('departmentId', e.target.value)}
          className={SELECT_CLASS}
          aria-label="Filter by department"
        >
          <option value="">All Departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}

      <input
        type="text"
        value={currentClassification}
        onChange={(e) => updateFilter('classification', e.target.value)}
        placeholder="Classification…"
        className={INPUT_CLASS}
        aria-label="Filter by classification"
      />

      <input
        type="text"
        value={currentSearch}
        onChange={(e) => updateFilter('search', e.target.value)}
        placeholder="Search by title…"
        className={INPUT_CLASS}
        aria-label="Search positions by title"
      />

      {hasFilters && (
        <button
          onClick={() => router.push('/workforce/positions')}
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
