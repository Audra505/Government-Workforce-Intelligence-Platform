'use client';

// Error boundary for the /workforce/employees route segment.
// Catches ApiError thrown by EmployeesPage (e.g., 403 for insufficient role, 5xx).
// RBAC-952: Executive User → NestJS returns 403 → surfaces here.

import Link from 'next/link';

export default function EmployeesError({
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
          <h2 className="text-lg font-semibold text-destructive">Unable to load employees</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The employee list could not be loaded. You may not have permission to view this page.
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
            Go to Vacancies
          </Link>
        </div>
      </main>
    </div>
  );
}
