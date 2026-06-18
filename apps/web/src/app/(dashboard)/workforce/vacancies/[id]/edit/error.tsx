'use client';

// Error boundary for the /workforce/vacancies/[id]/edit route segment.
// Catches ApiError thrown by EditVacancyPage when the vacancy fetch fails.
// 404/400 responses use notFound() and do not reach this boundary.
// Copy distinct from sibling [id]/ error.tsx.
// Reference: apps/web/src/app/(dashboard)/workforce/vacancies/[id]/error.tsx — sibling pattern

import Link from 'next/link';

export default function EditVacancyError({
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
          <h2 className="text-lg font-semibold text-destructive">Unable to load edit form</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The vacancy data could not be loaded for editing. Please try again.
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
