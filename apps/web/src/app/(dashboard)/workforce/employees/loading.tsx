// Loading skeleton for the employee list route segment.
// Shown during Server Component data fetching.

export default function EmployeesLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">
            Government Workforce Intelligence Platform
          </h1>
        </div>
      </header>
      <main className="flex-1 p-6">
        <div className="mb-6">
          <div className="h-8 w-40 animate-pulse rounded-md bg-muted" />
          <div className="mt-2 h-4 w-24 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="mb-4 h-10 w-64 animate-pulse rounded-md bg-muted" />
        <div className="rounded-md border">
          <div className="h-12 border-b bg-muted/50" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4 border-b px-4 py-3 last:border-0">
              <div className="h-4 w-36 animate-pulse rounded bg-muted" />
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
              <div className="h-4 w-28 animate-pulse rounded bg-muted" />
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
