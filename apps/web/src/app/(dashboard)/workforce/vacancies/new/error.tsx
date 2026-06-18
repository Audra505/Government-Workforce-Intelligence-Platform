'use client';

// Error boundary for the /workforce/vacancies/new route segment.
// Catches ApiError thrown by NewVacancyPage when GET /api/v1/positions fails.
// Copy is specific to position loading failure — not the VacancyBoard error copy.
// Reference: apps/web/src/app/(dashboard)/workforce/vacancies/error.tsx — sibling boundary
// Reference: M11 Step 10 — approved additional requirement (position-specific error copy)

import Link from 'next/link';

export default function NewVacancyError({
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
            Unable to load vacancy form
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The position list could not be loaded. Please try again.
          </p>
          {process.env.NODE_ENV === 'development' && error.message && (
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {error.message}
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={reset}
            className="rounded-md border px-4 py-2 text-sm hover:bg-muted transition-colors"
          >
            Try again
          </button>
          <Link
            href="/workforce/vacancies"
            className="rounded-md border px-4 py-2 text-sm hover:bg-muted transition-colors"
          >
            Back to Vacancies
          </Link>
        </div>
      </main>
    </div>
  );
}
