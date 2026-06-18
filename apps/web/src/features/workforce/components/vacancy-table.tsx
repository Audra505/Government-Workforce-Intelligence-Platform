// Server Component — no 'use client' directive.
// Renders the vacancy list table including status badges, priority badges, aging indicators,
// requiresReview flags, and an empty state.
// positionTitle column links to /workforce/vacancies/[id] (Step 11 — GD-11-2).
// Reference: directives/03_vacancy_management_rules.md
//   VAC-200: priority values LOW/MEDIUM/HIGH/CRITICAL
//   VAC-601: requiresReview = CRITICAL + OPEN vacancies
//   VAC-701: WARNING agingStatus threshold (≥30 days)
//   VAC-702: HIGH_RISK agingStatus threshold (≥90 days)

import Link from 'next/link';
import type { VacancyRow } from '@/features/workforce/types';
import {
  StatusBadge,
  PriorityBadge,
  AgingCell,
} from '@/features/workforce/components/vacancy-badges';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

type Props = {
  vacancies: VacancyRow[];
  hasFilters: boolean;
};

export function VacancyTable({ vacancies, hasFilters }: Props) {
  if (vacancies.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-12 text-center">
        <p className="text-sm text-muted-foreground">
          {hasFilters
            ? 'No vacancies match the current filters.'
            : 'No vacancies found in your tenant.'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Position</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Department</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Priority</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Age</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Expected Fill</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Created</th>
          </tr>
        </thead>
        <tbody>
          {vacancies.map((v) => (
            <tr key={v.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors relative">
              <td className="px-4 py-3 font-medium">
                <Link
                  href={`/workforce/vacancies/${v.id}`}
                  className="hover:underline after:absolute after:inset-0 after:content-['']"
                >
                  {v.positionTitle}
                </Link>
                {v.requiresReview && (
                  <span
                    className="ml-2 inline-flex items-center rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700"
                    title="Critical vacancy requires HR Director review (VAC-601)"
                  >
                    Review
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{v.departmentName}</td>
              <td className="px-4 py-3">
                <StatusBadge status={v.status} />
              </td>
              <td className="px-4 py-3">
                {v.priority ? (
                  <PriorityBadge priority={v.priority} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <AgingCell ageInDays={v.ageInDays} agingStatus={v.agingStatus} />
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {v.expectedFillDate ? formatDate(v.expectedFillDate) : '—'}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{formatDate(v.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
