'use client';

// Bounded filter form for the audit list page — search is bounded to
// action/entityType/result matching only (GD-M39-1 Decision 17); this form
// never offers a free-text metadata search.
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const BORDER = '#e2e8f0';
const TEXT = '#0f172a';

export function AuditFilters({
  initialSearch,
  initialResult,
}: {
  initialSearch?: string;
  initialResult?: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(initialSearch ?? '');
  const [result, setResult] = useState(initialResult ?? '');

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (result) params.set('result', result);
    router.push(`/oversight/audit?${params.toString()}`);
  }

  return (
    <form onSubmit={apply} className="mb-4 flex items-center gap-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search action / entity type / result…"
        className="rounded-md border px-3 py-1.5 text-sm"
        style={{ borderColor: BORDER, color: TEXT, minWidth: 280 }}
      />
      <select
        value={result}
        onChange={(e) => setResult(e.target.value)}
        className="rounded-md border px-3 py-1.5 text-sm"
        style={{ borderColor: BORDER, color: TEXT }}
      >
        <option value="">Any result</option>
        <option value="SUCCESS">Success</option>
        <option value="FAILURE">Failure</option>
      </select>
      <button
        type="submit"
        className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
        style={{ backgroundColor: '#2563eb' }}
      >
        Apply
      </button>
    </form>
  );
}
