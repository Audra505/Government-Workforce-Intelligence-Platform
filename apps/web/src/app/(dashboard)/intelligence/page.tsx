// Intelligence — deterministic workforce signals workspace.
// Server Component: role gate + one-time serverFetch for all signals, then
// hands the fetched data to a Client Component (IntelligenceWorkspace) for
// tab switching and Vacancy Risk master-detail selection — both instant,
// client-side only, no further navigation or fetch (GD-M32-1 Decisions 15-21).
// No BFF route — same direct serverFetch-to-NestJS pattern the dashboard uses.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { serverFetch } from '@/lib/api';
import { SESSION_COOKIE } from '@/lib/auth';
import { getSessionRoles } from '@/lib/session';
import { PlatformHeader } from '@/components/shared/platform-header';
import { IntelligenceWorkspace } from '@/features/intelligence/components/intelligence-workspace';
import type { WorkforceReadinessRes, AttritionRiskRes, VacancyRiskRes, DepartmentGapRes, ExecutiveMetricsRes } from '@/features/intelligence/types';

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

  // GD-M32-1 Decision 20: Workforce Signals allowed roles — reaching this
  // route at all requires at least this. Vacancy Risk is a narrower subset
  // checked independently below (Executive User: Workforce Signals only).
  const canSeeWorkforceSignals = roles.some((r) =>
    ['System Administrator', 'HR Director', 'Workforce Planner', 'Executive User'].includes(r),
  );
  const canSeeVacancyRisk = roles.some((r) =>
    ['System Administrator', 'HR Director', 'Workforce Planner'].includes(r),
  );
  // GD-M33-1 Decision 4: same allowed-role list as Vacancy Risk (Executive User
  // explicitly excluded — Decision 4's deliberate exclusion, not an oversight),
  // kept as its own boolean per the established one-boolean-per-signal discipline.
  const canSeeDepartmentGap = roles.some((r) =>
    ['System Administrator', 'HR Director', 'Workforce Planner'].includes(r),
  );
  // GD-M34-1 Decision 4: same allowed-role list as Workforce Signals
  // (SA/HRD/WP/Executive User) — Executive User IS allowed here (unlike
  // Department Gap), kept as its own boolean per the established
  // one-boolean-per-signal discipline.
  const canSeeExecutiveMetrics = roles.some((r) =>
    ['System Administrator', 'HR Director', 'Workforce Planner', 'Executive User'].includes(r),
  );
  // Top-level nav visibility (Workforce/Recruiting/Admin/Intelligence links)
  // now lives entirely in PlatformHeader, computed from `roles` — single
  // source of truth shared with every other authenticated page/shell.

  // GD-M32-1 Decision 20/21: forbidden roles (Recruiter, Hiring Manager,
  // Compliance Officer) must not reach this route, not merely have the nav
  // item hidden.
  if (!canSeeWorkforceSignals) {
    redirect('/dashboard');
  }

  const [r0, r1, r2, r3, r4] = await Promise.allSettled([
    serverFetch<WorkforceReadinessRes>('/api/v1/intelligence/workforce-readiness'),
    serverFetch<AttritionRiskRes>('/api/v1/intelligence/attrition-risk'),
    // pageSize=5 — matches the approved mockup and dashboard-level expectation
    // (top 5 highest-risk vacancies, existing/governed pageSize query param;
    // no new endpoint behavior).
    canSeeVacancyRisk
      ? serverFetch<VacancyRiskRes>('/api/v1/intelligence/vacancy-risk?pageSize=5')
      : Promise.resolve(null),
    // GD-M33-1 Decision 4: Executive User never issues this fetch at all — not
    // fetched-then-hidden, simply never requested, matching the existing
    // Vacancy Risk fetch-gating pattern above.
    canSeeDepartmentGap
      ? serverFetch<DepartmentGapRes>('/api/v1/intelligence/department-gap')
      : Promise.resolve(null),
    // GD-M34-1 Decision 3/4: no query parameters; forbidden roles never issue
    // this fetch at all, matching every other signal's gating pattern above.
    canSeeExecutiveMetrics
      ? serverFetch<ExecutiveMetricsRes>('/api/v1/intelligence/executive-metrics')
      : Promise.resolve(null),
  ]);

  const readinessData        = settled<WorkforceReadinessRes>(r0);
  const readinessFetchFailed = r0.status === 'rejected';
  const attritionData        = settled<AttritionRiskRes>(r1);
  const attritionFetchFailed = r1.status === 'rejected';
  const vacancyRiskData        = settled<VacancyRiskRes>(r2);
  const vacancyRiskFetchFailed = canSeeVacancyRisk && r2.status === 'rejected';
  const departmentGapData        = settled<DepartmentGapRes>(r3);
  const departmentGapFetchFailed = canSeeDepartmentGap && r3.status === 'rejected';
  const executiveMetricsData        = settled<ExecutiveMetricsRes>(r4);
  const executiveMetricsFetchFailed = canSeeExecutiveMetrics && r4.status === 'rejected';

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

      {/* ── Header — shared PlatformHeader (polished nav treatment), same
           component as every other authenticated page/shell. Intelligence
           renders as the single unified active pill (white, matching every
           other section's active state) rather than the previous
           page-specific blue active treatment. ── */}
      <PlatformHeader roles={roles} activeItem="intelligence" />

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
            canSeeDepartmentGap={canSeeDepartmentGap}
            departmentGapData={departmentGapData}
            departmentGapFetchFailed={departmentGapFetchFailed}
            canSeeExecutiveMetrics={canSeeExecutiveMetrics}
            executiveMetricsData={executiveMetricsData}
            executiveMetricsFetchFailed={executiveMetricsFetchFailed}
          />
        </div>
      </main>
    </div>
  );
}
