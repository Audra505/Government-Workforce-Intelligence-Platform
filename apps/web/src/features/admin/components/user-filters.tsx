'use client';

// User list filter bar — Client Component.
// Drives URL search params for search (firstName/lastName/email) and status filter.
// Must be wrapped in <Suspense> on the server side (useSearchParams requirement).
// Reference: governance/GD-M25-1.md — Decisions 3, 12

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

type Props = { total: number };

export function UserFilters({ total }: Props) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  const currentSearch = searchParams.get('search') ?? '';
  const currentStatus = searchParams.get('status') ?? '';

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete('page');
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="search"
        placeholder="Search name or email…"
        defaultValue={currentSearch}
        onChange={(e) => update('search', e.target.value)}
        className="h-9 w-64 rounded-md border px-3 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
        style={{ borderColor: '#e2e8f0', color: '#0f172a' }}
      />
      <select
        value={currentStatus}
        onChange={(e) => update('status', e.target.value)}
        className="h-9 rounded-md border px-3 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
        style={{ borderColor: '#e2e8f0', color: '#0f172a' }}
      >
        <option value="">All statuses</option>
        <option value="ACTIVE">Active</option>
        <option value="INVITED">Invited</option>
        <option value="SUSPENDED">Suspended</option>
        <option value="DEACTIVATED">Deactivated</option>
      </select>
      {total > 0 && (
        <span className="text-sm" style={{ color: '#94a3b8' }}>
          {total} {total === 1 ? 'user' : 'users'}
        </span>
      )}
    </div>
  );
}
