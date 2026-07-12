// Loading skeleton for the Expiring Certifications page.
// Next.js App Router uses this automatically during server-side data fetch.

import { WorkforceShell } from '@/features/workforce/components/workforce-shell';

export default function ExpiringCertificationsLoading() {
  return (
    <WorkforceShell activeTab="certifications" breadcrumb="Expiring Certifications">
      <div className="mb-6">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="mt-1 h-4 w-72 animate-pulse rounded bg-muted" />
      </div>
      {/* Window filter skeleton */}
      <div className="mb-5 flex items-center gap-2">
        <div className="h-4 w-14 animate-pulse rounded bg-muted" />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-7 w-16 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
      {/* Table skeleton */}
      <div className="rounded-md border">
        <div className="border-b bg-muted/50 px-4 py-3">
          <div className="flex gap-8">
            {['w-32', 'w-40', 'w-16', 'w-20', 'w-24', 'w-24'].map((w, i) => (
              <div key={i} className={`h-4 ${w} animate-pulse rounded bg-muted`} />
            ))}
          </div>
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex gap-8 border-b px-4 py-3 last:border-0">
            <div className="h-4 w-36 animate-pulse rounded bg-muted" />
            <div className="h-4 w-44 animate-pulse rounded bg-muted" />
            <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
            <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="h-5 w-12 animate-pulse rounded-full bg-muted" />
          </div>
        ))}
      </div>
    </WorkforceShell>
  );
}
