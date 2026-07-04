'use client';

export default function OfferDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ fontFamily: "var(--font-ibm-plex-sans, 'IBM Plex Sans', system-ui, sans-serif)" }}
    >
      <header style={{ backgroundColor: '#0c2340' }} className="px-6 py-3.5">
        <div className="mx-auto flex max-w-[1200px] items-center">
          <span className="text-base font-semibold tracking-wide text-white">GWIP</span>
        </div>
      </header>

      <main
        className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
        style={{ backgroundColor: '#f8fafc' }}
      >
        <div>
          <h2 className="text-lg font-semibold" style={{ color: '#dc2626' }}>
            Unable to load offer
          </h2>
          <p className="mt-1 text-sm" style={{ color: '#475569' }}>
            An error occurred while fetching offer data. Please try again.
          </p>
          {process.env.NODE_ENV === 'development' && error.message && (
            <p
              className="mt-2 text-xs"
              style={{ color: '#94a3b8', fontFamily: "var(--font-ibm-plex-mono, 'IBM Plex Mono', monospace)" }}
            >
              {error.message}
            </p>
          )}
        </div>
        <button
          onClick={reset}
          className="rounded-md border px-4 py-2 text-sm transition-colors hover:bg-slate-50"
          style={{ borderColor: '#e2e8f0', color: '#0f172a' }}
        >
          Try again
        </button>
      </main>
    </div>
  );
}
