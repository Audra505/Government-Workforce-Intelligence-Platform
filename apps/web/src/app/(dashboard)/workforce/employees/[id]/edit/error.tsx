'use client';

// Error boundary for the /workforce/employees/:id/edit route segment.
// Catches ApiError from employee or department fetch that doesn't result in notFound().

import Link from 'next/link';

export default function EditEmployeeError({
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
            The employee edit form could not be loaded.
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
            href="/workforce/employees"
            className="rounded-md border px-4 py-2 text-sm transition-colors hover:bg-muted"
          >
            Back to Employees
          </Link>
        </div>
      </main>
    </div>
  );
}
