// Intelligence — deterministic workforce signals workspace.
// Server Component: role gate + one-time serverFetch for all signals, then
// hands the fetched data to a Client Component (IntelligenceWorkspace) for
// tab switching and Vacancy Risk master-detail selection — both instant,
// client-side only, no further navigation or fetch (GD-M32-1 Decisions 15-21).
// No BFF route — same direct serverFetch-to-NestJS pattern the dashboard uses.

import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { serverFetch } from '@/lib/api';
import { SESSION_COOKIE } from '@/lib/auth';
import { getSessionRoles } from '@/lib/session';
import { LogoutButton } from '@/features/auth/logout-button';
import { UserIdentityChip } from '@/components/shared/user-identity-chip';
import { IntelligenceWorkspace } from '@/features/intelligence/components/intelligence-workspace';
import type { WorkforceReadinessRes, AttritionRiskRes, VacancyRiskRes } from '@/features/intelligence/types';

const NAVY  = '#0c2340';
const CANVAS = '#f8fafc';
const TEXT  = '#0f172a';
const SUB   = '#475569';
const MUTED = '#94a3b8';

function settled<T>(r: PromiseSettledResult<unknown>): T | null {
  return r.status === 'fulfilled' ? (r.value as T | null) : null;
}

export default async function IntelligencePage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canSeeAdmin = roles.includes('System Administrator') || roles.includes('HR Director');

  // GD-M32-1 Decision 20: Workforce Signals allowed roles — reaching this
  // route at all requires at least this. Vacancy Risk is a narrower subset
  // checked independently below (Executive User: Workforce Signals only).
  const canSeeWorkforceSignals = roles.some((r) =>
    ['System Administrator', 'HR Director', 'Workforce Planner', 'Executive User'].includes(r),
  );
  const canSeeVacancyRisk = roles.some((r) =>
    ['System Administrator', 'HR Director', 'Workforce Planner'].includes(r),
  );

  // GD-M32-1 Decision 20/21: forbidden roles (Recruiter, Hiring Manager,
  // Compliance Officer) must not reach this route, not merely have the nav
  // item hidden.
  if (!canSeeWorkforceSignals) {
    redirect('/dashboard');
  }

  const [r0, r1, r2] = await Promise.allSettled([
    serverFetch<WorkforceReadinessRes>('/api/v1/intelligence/workforce-readiness'),
    serverFetch<AttritionRiskRes>('/api/v1/intelligence/attrition-risk'),
    // pageSize=5 — matches the approved mockup and dashboard-level expectation
    // (top 5 highest-risk vacancies, existing/governed pageSize query param;
    // no new endpoint behavior).
    canSeeVacancyRisk
      ? serverFetch<VacancyRiskRes>('/api/v1/intelligence/vacancy-risk?pageSize=5')
      : Promise.resolve(null),
  ]);

  const readinessData        = settled<WorkforceReadinessRes>(r0);
  const readinessFetchFailed = r0.status === 'rejected';
  const attritionData        = settled<AttritionRiskRes>(r1);
  const attritionFetchFailed = r1.status === 'rejected';
  const vacancyRiskData        = settled<VacancyRiskRes>(r2);
  const vacancyRiskFetchFailed = canSeeVacancyRisk && r2.status === 'rejected';

  // One-time initial tab selection from a query param (e.g. a "View all →"
  // link from the dashboard's Vacancy Risk card). This is not row selection —
  // it is read once, server-side, to set the client component's starting
  // state; every subsequent tab switch and vacancy selection is pure client
  // state with no further navigation (GD-M32-1 Decision 18).
  const requestedTab =
    searchParams?.tab === 'vacancy-risk' && canSeeVacancyRisk
      ? ('vacancy-risk' as const)
      : ('workforce-signals' as const);

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: CANVAS, fontFamily: "var(--font-ibm-plex-sans,'IBM Plex Sans',system-ui,sans-serif)" }}>

      {/* ── Header — identical structure to dashboard/page.tsx, Intelligence active ── */}
      <header style={{ backgroundColor: NAVY }} className="pl-6 pr-10 py-3.5">
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-10">
            <span className="text-base font-semibold tracking-wide text-white">GWIP</span>
            <nav className="flex items-center gap-0.5" aria-label="Domain navigation">
              <Link
                href="/dashboard"
                className="rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-white/50 transition-all hover:bg-white/[0.08] hover:text-white/[0.85]"
              >
                Dashboard
              </Link>
              {/* Active state carries the same blue accent used for the Intelligence
                  link elsewhere in the shell (dashboard/workforce/recruiting/admin nav),
                  rather than the neutral white pill other sections use when active —
                  keeps the page from losing its distinguishing color on arrival. */}
              <span
                className="rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-[#93c5fd]"
                style={{ backgroundColor: 'rgba(96,165,250,0.18)' }}
              >
                Intelligence
              </span>
              <Link
                href="/workforce/employees"
                className="rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-white/50 transition-all hover:bg-white/[0.08] hover:text-white/[0.85]"
              >
                Workforce
              </Link>
              <Link
                href="/recruiting/candidates"
                className="rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-white/50 transition-all hover:bg-white/[0.08] hover:text-white/[0.85]"
              >
                Recruiting
              </Link>
              {canSeeAdmin && (
                <Link
                  href="/admin/departments"
                  className="rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-white/50 transition-all hover:bg-white/[0.08] hover:text-white/[0.85]"
                >
                  Admin
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <UserIdentityChip />
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
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 72px' }}>
          <p style={{ fontSize: 11.5, color: MUTED, marginBottom: 4 }}>
            Intelligence{' '}
            <span style={{ color: SUB, fontWeight: 500 }}>
              · {requestedTab === 'vacancy-risk' ? 'Vacancy Risk' : 'Workforce Signals'}
            </span>
          </p>
          <div style={{ marginBottom: 4 }}>
            <h2 className="text-2xl font-bold tracking-tight" style={{ color: TEXT, margin: 0 }}>
              Intelligence
            </h2>
            <p style={{ fontSize: 13, color: SUB, marginTop: 3 }}>
              Deterministic workforce signals, explained — no external AI, advisory only
            </p>
          </div>

          <IntelligenceWorkspace
            initialTab={requestedTab}
            canSeeVacancyRisk={canSeeVacancyRisk}
            readinessData={readinessData}
            readinessFetchFailed={readinessFetchFailed}
            attritionData={attritionData}
            attritionFetchFailed={attritionFetchFailed}
            vacancyRiskData={vacancyRiskData}
            vacancyRiskFetchFailed={vacancyRiskFetchFailed}
          />
        </div>
      </main>
    </div>
  );
}
