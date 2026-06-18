'use client';

// Error boundary for the /workforce/vacancies/[id] route segment.
// Catches ApiError thrown by VacancyDetailPage when GET /api/v1/vacancies/:id returns non-404 errors.
// 404 responses use notFound() (GD-11-1) and do not reach this boundary.
// Copy is specific to vacancy detail failure — distinct from VacancyBoard and new/ error copy.
// Reference: apps/web/src/app/(dashboard)/workforce/vacancies/new/error.tsx — sibling boundary pattern

import Link from 'next/link';

export default function VacancyDetailError({
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
          <h2 className="text-lg font-semibold text-destructive">Unable to load vacancy</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This vacancy could not be found or is no longer available.
          </p>
          {process.env.NODE_ENV === 'development' && error.message && (
            <p className="mt-2 font-mono text-xs text-muted-foreground">{error.message}</p>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={reset}
            className="rounded-md border px-4 py-2 text-sm transition-colors hover:bg-muted"
          >
            Try again
          </button>
          <Link
            href="/workforce/vacancies"
            className="rounded-md border px-4 py-2 text-sm transition-colors hover:bg-muted"
          >
            Back to Vacancies
          </Link>
        </div>
      </main>
    </div>
  );
}
