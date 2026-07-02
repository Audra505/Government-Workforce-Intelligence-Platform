// Loading skeleton for the Applications queue page.
// Next.js App Router renders this automatically while the page's async data fetch completes.
// Matches the RecruitingShell structure to prevent layout shift.

import { RecruitingShell } from '@/features/recruiting/components/recruiting-shell';

export default function ApplicationsLoading() {
  return (
    <RecruitingShell activeTab="applications" breadcrumb="Applications">
      {/* Heading skeleton */}
      <div className="mb-6">
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-1 h-4 w-28 animate-pulse rounded bg-muted" />
      </div>

      {/* Filter bar skeleton */}
      <div className="mb-4 flex gap-3">
        <div className="h-10 w-36 animate-pulse rounded-md bg-muted" />
      </div>

      {/* Table skeleton */}
      <div className="overflow-hidden rounded-md border" style={{ borderColor: '#e2e8f0' }}>
        <div className="border-b px-4 py-3" style={{ backgroundColor: '#f8fafc', borderColor: '#e2e8f0' }}>
          <div className="flex gap-8">
            {['w-12', 'w-20', 'w-20', 'w-20', 'w-24', 'w-16'].map((w, i) => (
              <div key={i} className={`h-3 ${w} animate-pulse rounded bg-muted`} />
            ))}
          </div>
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex gap-8 border-t px-4 py-3.5"
            style={{ borderColor: '#e2e8f0' }}
          >
            <div className="h-4 w-16 animate-pulse rounded bg-muted" />
            <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="h-4 w-16 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </RecruitingShell>
  );
}
