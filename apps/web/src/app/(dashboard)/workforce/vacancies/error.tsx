'use client';

// Error boundary for the VacancyBoard route segment.
// Must be a Client Component — Next.js App Router requirement.
// Catches errors thrown by page.tsx (e.g., ApiError from serverFetch).
// The reset() function retriggers the page's data fetch.

export default function VacanciesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">
            Government Workforce Intelligence Platform
          </h1>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <div>
          <h2 className="text-lg font-semibold text-destructive">
            Unable to load vacancies
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            An error occurred while fetching vacancy data. Please try again.
          </p>
          {process.env.NODE_ENV === 'development' && error.message && (
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {error.message}
            </p>
          )}
        </div>
        <button
          onClick={reset}
          className="rounded-md border px-4 py-2 text-sm hover:bg-muted transition-colors"
        >
          Try again
        </button>
      </main>
    </div>
  );
}
