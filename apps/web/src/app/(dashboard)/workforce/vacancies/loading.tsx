// Loading skeleton for the VacancyBoard page.
// Next.js App Router automatically wraps page.tsx in a <Suspense> using this file.
// Matches the page shell layout to prevent layout shift during data fetch.

export default function VacanciesLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">
            Government Workforce Intelligence Platform
          </h1>
          <div className="h-9 w-20 animate-pulse rounded-md bg-muted" />
        </div>
      </header>

      <main className="flex-1 p-6">
        {/* Heading skeleton */}
        <div className="mb-6">
          <div className="h-8 w-36 animate-pulse rounded bg-muted" />
          <div className="mt-1 h-4 w-24 animate-pulse rounded bg-muted" />
        </div>

        {/* Filter bar skeleton */}
        <div className="mb-4 flex gap-3">
          <div className="h-10 w-36 animate-pulse rounded-md bg-muted" />
          <div className="h-10 w-36 animate-pulse rounded-md bg-muted" />
        </div>

        {/* Table skeleton */}
        <div className="rounded-md border">
          <div className="border-b bg-muted/50 px-4 py-3">
            <div className="flex gap-8">
              {['w-28', 'w-24', 'w-16', 'w-16', 'w-12', 'w-24', 'w-20'].map((w, i) => (
                <div key={i} className={`h-4 ${w} animate-pulse rounded bg-muted`} />
              ))}
            </div>
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-8 border-b px-4 py-3 last:border-0">
              <div className="h-4 w-36 animate-pulse rounded bg-muted" />
              <div className="h-4 w-28 animate-pulse rounded bg-muted" />
              <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
              <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
              <div className="h-4 w-12 animate-pulse rounded bg-muted" />
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
