import Link from 'next/link';

const NAVY   = '#0c2340';
const CANVAS = '#f8fafc';
const BORDER = '#e2e8f0';

export default function DashboardLoading() {
  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: CANVAS }}>
      <header style={{ backgroundColor: NAVY }} className="pl-6 pr-10 py-3.5">
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-10">
            <span className="text-base font-semibold tracking-wide text-white">GWIP</span>
            <nav className="flex items-center gap-6" aria-label="Domain navigation">
              <span className="text-sm font-semibold text-white">Dashboard</span>
              <Link href="/workforce/employees" className="text-sm text-white/60 transition-colors hover:text-white">
                Workforce
              </Link>
              <Link href="/recruiting/candidates" className="text-sm text-white/60 transition-colors hover:text-white">
                Recruiting
              </Link>
            </nav>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto max-w-[1200px] px-6 pt-8 pb-16">
          <div className="mb-8">
            <div className="mb-1 h-8 w-36 animate-pulse rounded" style={{ backgroundColor: BORDER }} />
            <div className="h-4 w-48 animate-pulse rounded" style={{ backgroundColor: BORDER }} />
          </div>
          <div className="mb-3 h-2.5 w-16 animate-pulse rounded" style={{ backgroundColor: BORDER }} />
          <div className="mb-8 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="animate-pulse bg-white"
                style={{ border: `1px solid ${BORDER}`, borderRadius: 4, padding: '20px 20px 16px' }}
              >
                <div className="mb-2 h-2.5 w-20 rounded" style={{ backgroundColor: BORDER }} />
                <div className="mb-2 h-9 w-14 rounded" style={{ backgroundColor: BORDER }} />
                <div className="h-3 w-28 rounded" style={{ backgroundColor: BORDER }} />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
