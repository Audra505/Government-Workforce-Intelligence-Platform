import Link from 'next/link';
import { serverFetch } from '@/lib/api';
import { LogoutButton } from '@/features/auth/logout-button';

const NAVY   = '#0c2340';
const CANVAS = '#f8fafc';
const BORDER = '#e2e8f0';
const TEXT   = '#0f172a';
const SUB    = '#475569';
const MUTED  = '#94a3b8';
const BLUE   = '#2563eb';

type CountResponse = { success: boolean; data: { total: number } };

const WORKFORCE_LINKS = ['Positions', 'Employees', 'Vacancies'];
const RECRUITING_LINKS = ['Candidates', 'Applications', 'Interviews', 'Offers'];

export default async function DashboardPage() {
  const [positions, employees, vacancies, candidates] = await Promise.all([
    serverFetch<CountResponse>('/api/v1/positions?pageSize=1').catch(() => null),
    serverFetch<CountResponse>('/api/v1/employees?pageSize=1').catch(() => null),
    serverFetch<CountResponse>('/api/v1/vacancies?status=OPEN&pageSize=1').catch(() => null),
    serverFetch<CountResponse>('/api/v1/candidates?pageSize=1').catch(() => null),
  ]);

  const metrics = [
    { label: 'Positions',      value: positions?.data?.total  ?? '—', detail: 'Authorized agency positions'   },
    { label: 'Employees',      value: employees?.data?.total  ?? '—', detail: 'Active workforce headcount'    },
    { label: 'Open Vacancies', value: vacancies?.data?.total  ?? '—', detail: 'Unfilled authorized positions' },
    { label: 'Candidates',     value: candidates?.data?.total ?? '—', detail: 'Active recruiting pipeline'    },
  ];
  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: CANVAS }}>
      {/* ── Header — matches WorkforceShell / RecruitingShell pattern ── */}
      <header style={{ backgroundColor: NAVY }} className="pl-6 pr-10 py-3.5">
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-10">
            <span className="text-base font-semibold tracking-wide text-white">
              GWIP
            </span>
            <nav className="flex items-center gap-6" aria-label="Domain navigation">
              <span className="text-sm font-semibold text-white">Dashboard</span>
              <Link
                href="/workforce/employees"
                className="text-sm text-white/60 transition-colors hover:text-white"
              >
                Workforce
              </Link>
              <Link
                href="/recruiting/candidates"
                className="text-sm text-white/60 transition-colors hover:text-white"
              >
                Recruiting
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span
              aria-hidden="true"
              style={{ width: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.2)', display: 'inline-block' }}
            />
            <LogoutButton />
          </div>
        </div>
      </header>

      {/* ── Content ── */}
      <main className="flex-1">
        <div className="mx-auto max-w-[1200px] px-6 pt-8 pb-16">

          {/* Page heading */}
          <div className="mb-8">
            <h2 className="mb-1 text-2xl font-bold tracking-tight" style={{ color: TEXT }}>
              Dashboard
            </h2>
            <p className="text-[13px]" style={{ color: MUTED }}>
              Agency workforce overview
            </p>
          </div>

          {/* Overview */}
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: MUTED }}>
            Overview
          </p>
          <div className="mb-8 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {metrics.map(({ label, value, detail }) => (
              <div
                key={label}
                className="bg-white"
                style={{
                  borderTop: `1px solid ${BORDER}`,
                  borderRight: `1px solid ${BORDER}`,
                  borderBottom: `1px solid ${BORDER}`,
                  borderLeft: `1px solid ${BORDER}`,
                  borderRadius: 4,
                  padding: '20px 20px 16px',
                }}
              >
                <p
                  className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em]"
                  style={{ color: MUTED }}
                >
                  {label}
                </p>
                <p
                  className="mb-2 text-[36px] font-bold leading-none"
                  style={{ color: NAVY, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.025em' }}
                >
                  {value}
                </p>
                <p className="text-[12px]" style={{ color: MUTED }}>{detail}</p>
              </div>
            ))}
          </div>

          {/* Modules */}
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: MUTED }}>
            Modules
          </p>
          <div className="mb-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {/* Workforce */}
            <div
              className="bg-white"
              style={{
                borderTop: `1px solid ${BORDER}`,
                borderRight: `1px solid ${BORDER}`,
                borderBottom: `1px solid ${BORDER}`,
                borderLeft: `3px solid ${NAVY}`,
                borderRadius: 4,
                padding: '22px 24px',
              }}
            >
              <p
                className="mb-3.5 text-[10px] font-bold uppercase tracking-[0.12em]"
                style={{ color: NAVY }}
              >
                Workforce Management
              </p>
              <ul className="mb-4 flex flex-col gap-2">
                {WORKFORCE_LINKS.map((item) => (
                  <li key={item}>
                    <Link
                      href={`/workforce/${item.toLowerCase()}`}
                      className="inline-flex items-center gap-2 text-[13px] font-medium transition-colors hover:text-[#2563eb]"
                      style={{ color: SUB }}
                    >
                      <span
                        className="inline-block h-1 w-1 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: BORDER }}
                      />
                      {item}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link
                href="/workforce/positions"
                className="text-[12px] font-semibold hover:opacity-80 transition-opacity"
                style={{ color: BLUE }}
              >
                Go to Workforce →
              </Link>
            </div>

            {/* Recruiting */}
            <div
              className="bg-white"
              style={{
                borderTop: `1px solid ${BORDER}`,
                borderRight: `1px solid ${BORDER}`,
                borderBottom: `1px solid ${BORDER}`,
                borderLeft: `3px solid ${NAVY}`,
                borderRadius: 4,
                padding: '22px 24px',
              }}
            >
              <p
                className="mb-3.5 text-[10px] font-bold uppercase tracking-[0.12em]"
                style={{ color: NAVY }}
              >
                Recruiting
              </p>
              <ul className="mb-4 flex flex-col gap-2">
                {RECRUITING_LINKS.map((item) => (
                  <li key={item}>
                    <Link
                      href={`/recruiting/${item.toLowerCase()}`}
                      className="inline-flex items-center gap-2 text-[13px] font-medium transition-colors hover:text-[#2563eb]"
                      style={{ color: SUB }}
                    >
                      <span
                        className="inline-block h-1 w-1 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: BORDER }}
                      />
                      {item}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link
                href="/recruiting/candidates"
                className="text-[12px] font-semibold hover:opacity-80 transition-opacity"
                style={{ color: BLUE }}
              >
                Go to Recruiting →
              </Link>
            </div>
          </div>

          {/* Phase notice */}
          <div
            className="flex items-center gap-2.5"
            style={{
              backgroundColor: 'rgba(37,99,235,0.04)',
              border: '1px solid rgba(37,99,235,0.12)',
              borderRadius: 4,
              padding: '11px 16px',
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{ backgroundColor: BLUE }}
            />
            <span className="text-[13px]" style={{ color: SUB }}>
              Additional capabilities coming soon.
            </span>
          </div>

        </div>
      </main>
    </div>
  );
}
