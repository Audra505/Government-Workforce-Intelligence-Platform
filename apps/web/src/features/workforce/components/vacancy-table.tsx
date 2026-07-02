// Server Component — no 'use client' directive.
// M21C: VacancyStatusDot replaces StatusBadge; aligned headers/rows; EmptyState.
// PriorityBadge, AgingCell, requiresReview badge: retained per GD-M21-1 D10.
// Reference: directives/03_vacancy_management_rules.md
//   VAC-200: priority values LOW/MEDIUM/HIGH/CRITICAL
//   VAC-601: requiresReview = CRITICAL + OPEN vacancies
//   VAC-701: WARNING agingStatus threshold (≥30 days)
//   VAC-702: HIGH_RISK agingStatus threshold (≥90 days)

import Link from 'next/link';
import type { VacancyRow } from '@/features/workforce/types';
import {
  VacancyStatusDot,
  PriorityBadge,
  AgingCell,
} from '@/features/workforce/components/vacancy-badges';
import { EmptyState } from '@/components/shared/empty-state';

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

const TH_STYLE = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  color: '#94a3b8',
  backgroundColor: '#f8fafc',
} as const;

type Props = {
  vacancies: VacancyRow[];
  hasFilters: boolean;
};

export function VacancyTable({ vacancies, hasFilters }: Props) {
  if (vacancies.length === 0) {
    return (
      <EmptyState
        message={hasFilters
          ? 'No vacancies match the current filters.'
          : 'No vacancies found in your tenant.'}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-md border" style={{ borderColor: '#e2e8f0' }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
            <th className="px-4 py-3 text-left uppercase" style={TH_STYLE}>Position</th>
            <th className="px-4 py-3 text-left uppercase" style={TH_STYLE}>Department</th>
            <th className="px-4 py-3 text-left uppercase" style={TH_STYLE}>Status</th>
            <th className="px-4 py-3 text-left uppercase" style={TH_STYLE}>Priority</th>
            <th className="px-4 py-3 text-left uppercase" style={TH_STYLE}>Age</th>
            <th className="px-4 py-3 text-left uppercase" style={TH_STYLE}>Expected Fill</th>
            <th className="px-4 py-3 text-left uppercase" style={TH_STYLE}>Created</th>
          </tr>
        </thead>
        <tbody>
          {vacancies.map((v) => (
            <tr
              key={v.id}
              className="relative h-12 border-b last:border-0 transition-colors hover:bg-slate-50"
              style={{ borderColor: '#e2e8f0' }}
            >
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
              <td className="px-4 py-3" style={{ color: '#475569' }}>{v.departmentName}</td>
              <td className="px-4 py-3">
                <VacancyStatusDot status={v.status} />
              </td>
              <td className="px-4 py-3">
                {v.priority ? (
                  <PriorityBadge priority={v.priority} />
                ) : (
                  <span style={{ color: '#94a3b8' }}>—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <AgingCell ageInDays={v.ageInDays} agingStatus={v.agingStatus} />
              </td>
              <td className="px-4 py-3" style={{ color: '#475569' }}>
                {v.expectedFillDate ? formatDate(v.expectedFillDate) : '—'}
              </td>
              <td className="px-4 py-3" style={{ color: '#475569' }}>{formatDate(v.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
