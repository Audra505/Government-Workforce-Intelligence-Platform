// Loading skeleton for the Certifications list page.
// Next.js App Router uses this file automatically during data fetch.

import { WorkforceShell } from '@/features/workforce/components/workforce-shell';

export default function CertificationsLoading() {
  return (
    <WorkforceShell activeTab="certifications" breadcrumb="Certifications">
      <div className="mb-6">
        <div className="h-8 w-36 animate-pulse rounded bg-muted" />
        <div className="mt-1 h-4 w-56 animate-pulse rounded bg-muted" />
      </div>
      <div className="rounded-md border">
        <div className="border-b bg-muted/50 px-4 py-3">
          <div className="flex gap-8">
            {['w-40', 'w-28', 'w-24', 'w-24'].map((w, i) => (
              <div key={i} className={`h-4 ${w} animate-pulse rounded bg-muted`} />
            ))}
          </div>
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-8 border-b px-4 py-3 last:border-0">
            <div className="h-4 w-44 animate-pulse rounded bg-muted" />
            <div className="h-4 w-28 animate-pulse rounded bg-muted" />
            <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </WorkforceShell>
  );
}
