// Dashboard — Agency Workforce Health Overview
// Server Component: all data fetched server-side via serverFetch.
// Uses Promise.allSettled so any single endpoint failure silently omits that widget.
// No BFF routes used — dashboard calls NestJS directly (serverFetch pattern).
// Certifications panel omitted if endpoint returns 403 (role not authorized).
// No fake data, no placeholders, no unsupported mockup sections.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { serverFetch } from '@/lib/api';
import { SESSION_COOKIE } from '@/lib/auth';
import { getSessionRoles } from '@/lib/session';
import { LogoutButton } from '@/features/auth/logout-button';
import { UserIdentityChip } from '@/components/shared/user-identity-chip';

// ── Design tokens — match Dashboard mockup exactly ──────────────────────────
const NAVY   = '#0c2340';
const CANVAS = '#f8fafc';
const BORDER = '#e2e8f0';
const TEXT   = '#0f172a';
const SUB    = '#475569';
const MUTED  = '#94a3b8';
const BLUE   = '#2563eb';
const GREEN  = '#16a34a';
const AMBER  = '#d97706';
const RED    = '#dc2626';
const MONO   = "'IBM Plex Mono','Cascadia Code',Consolas,monospace";
const SHADOW = '0 1px 3px rgba(0,0,0,.05),0 1px 2px rgba(0,0,0,.04)';

// ── Response shapes ──────────────────────────────────────────────────────────
type Count = { data: { total: number } } | null;
type VacancyItem = {
  id: string;
  positionTitle: string;
  priority: string;
  departmentName?: string | null;
};
type VacancyListRes  = { data: { vacancies: VacancyItem[] } };
type CertItem = {
  certificationName: string;
  firstName: string;
  lastName: string;
  expirationDate: string;
};
type CertsRes = { data: { expiringCertifications: CertItem[]; total: number } };
type VacancyRiskItem = {
  vacancyId: string;
  positionTitle: string;
  departmentName: string | null;
  status: string;
  daysOpen: number;
  priority: string | null;
  riskScore: number;
  riskLevel: string;
  confidence: number;
  reasoning: string;
  computedAt: string;
  formulaVersion: string;
};
type VacancyRiskRes = {
  success: boolean;
  data: {
    items: VacancyRiskItem[];
    total: number;
    scoredAt: string;
    formulaVersion: string;
  };
};
type WorkforceReadinessFactor = { name: string; contribution: number; detail: string };
type WorkforceReadinessRes = {
  success: boolean;
  data: {
    readinessScore: number;
    readinessLevel: string;
    confidence: number;
    reasoning: string;
    factors: WorkforceReadinessFactor[];
    computedAt: string;
    formulaVersion: string;
  };
};
type AttritionRiskFactor = { name: string; contribution: number; detail: string };
type AttritionRiskRes = {
  success: boolean;
  data: {
    attritionScore: number;
    attritionRiskLevel: string;
    confidence: number;
    reasoning: string;
    factors: AttritionRiskFactor[];
    computedAt: string;
    formulaVersion: string;
  };
};

// ── Data helpers ─────────────────────────────────────────────────────────────
function n(r: PromiseSettledResult<unknown>): number | null {
  if (r.status !== 'fulfilled') return null;
  const v = r.value as Count;
  return v?.data?.total ?? null;
}
function settled<T>(r: PromiseSettledResult<unknown>): T | null {
  return r.status === 'fulfilled' ? (r.value as T | null) : null;
}
function fmt(v: number | null): string {
  return v != null ? String(v) : '—';
}

// ── Date helpers ─────────────────────────────────────────────────────────────
const DAYS_LONG  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatPageDate(): string {
  const d = new Date();
  return `${DAYS_LONG[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function formatExpiryDate(s: string): string {
  const [yr, mo, dy] = s.split('-').map(Number);
  return `${MONTHS_SHORT[mo - 1]} ${dy}, ${yr}`;
}
function daysUntil(s: string): number {
  const [yr, mo, dy] = s.split('-').map(Number);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const exp = new Date(yr, mo - 1, dy);
  return Math.ceil((exp.getTime() - now.getTime()) / 86_400_000);
}

// ── Shared card shell ────────────────────────────────────────────────────────
const CARD = {
  background: '#ffffff',
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  boxShadow: SHADOW,
  overflow: 'hidden',
} as const;

// Vacancy Risk Signals column template — explicit grid so header labels and
// row values stay aligned (Risk / Vacancy / Priority / Why This Is Risky /
// Confidence). Same technique already used by .pipe-item below. Narrower
// fixed tracks + fr-based flexible tracks so the panel fits its dashboard
// column without a horizontal scrollbar — Vacancy and Why This Is Risky wrap
// or truncate instead of forcing extra width.
const RISK_GRID_COLS = '92px 1.1fr 78px 1.5fr 56px';

// ── Sub-components (Server-safe: no hooks) ───────────────────────────────────

function CardHead({ title, href, cta = 'View all →' }: { title: string; href?: string; cta?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: `1px solid ${BORDER}` }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{title}</span>
      {href && (
        <Link href={href} style={{ fontSize: 11, color: BLUE, textDecoration: 'none', fontWeight: 500 }}>
          {cta}
        </Link>
      )}
    </div>
  );
}

function KpiCard({
  label, value, note, barColor, barPct = 100,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  barColor: string;
  barPct?: number;
}) {
  return (
    <div style={CARD}>
      <div style={{ padding: 20 }}>
        <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: MUTED, marginBottom: 10 }}>
          {label}
        </p>
        <p style={{ fontFamily: MONO, fontSize: 32, fontWeight: 700, color: TEXT, lineHeight: 1, letterSpacing: '-.025em', fontVariantNumeric: 'tabular-nums', marginBottom: 8 }}>
          {value}
        </p>
        {note && (
          <p style={{ fontSize: 12, color: MUTED, lineHeight: 1.4 }}>{note}</p>
        )}
        <div style={{ height: 3, borderRadius: 2, marginTop: 16, background: BORDER, overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 2, background: barColor, width: `${barPct}%` }} />
        </div>
      </div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const cfg: Record<string, { bg: string; c: string; bd: string }> = {
    CRITICAL: { bg: '#fef2f2', c: RED,   bd: '#fecaca' },
    HIGH:     { bg: '#fffbeb', c: AMBER, bd: '#fde68a' },
    MEDIUM:   { bg: '#eff6ff', c: BLUE,  bd: 'rgba(37,99,235,.2)' },
    LOW:      { bg: CANVAS,    c: MUTED, bd: BORDER },
  };
  const t = cfg[priority] ?? cfg.LOW;
  return (
    <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, lineHeight: 1.5, whiteSpace: 'nowrap', background: t.bg, color: t.c, border: `1px solid ${t.bd}` }}>
      {priority.charAt(0) + priority.slice(1).toLowerCase()}
    </span>
  );
}

function WfRow({ dotColor, label, count, isLast = false }: { dotColor: string; label: string; count: number | null; isLast?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: isLast ? 'none' : `1px solid ${BORDER}`, fontSize: 13 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: SUB }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block' }} />
        {label}
      </span>
      <span style={{ fontFamily: MONO, fontWeight: 700, color: TEXT, fontVariantNumeric: 'tabular-nums' }}>
        {count != null ? count : '—'}
      </span>
    </div>
  );
}

// Section-level eyebrow label — groups panels visually (e.g. "Operational
// Snapshot" vs "Intelligence Signal") without introducing new page chrome.
// Reuses existing tokens only; the amber badge treatment matches the same
// amber-wash pair (#fffbeb / #fde68a) already used by riskCfg.HIGH and
// PriorityBadge below — no new colors introduced.
function SectionEyebrow({ label, accentColor = MUTED, badges }: { label: string; accentColor?: string; badges?: string[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' as const, color: accentColor, whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {badges?.map((b) => (
        <span
          key={b}
          style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, color: AMBER, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, padding: '1px 6px' }}
        >
          {b}
        </span>
      ))}
      <span aria-hidden="true" style={{ flex: 1, height: 1, background: BORDER }} />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  // Role resolution before fetch group so forbidden roles skip the intelligence endpoint
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canSeeAdmin = roles.includes('System Administrator') || roles.includes('HR Director');
  // GD-M31-1 Decision 10: independent per-signal gating — vacancy risk and
  // workforce readiness have different allowed-role lists (Executive User is
  // allowed for readiness only), so each signal is gated separately rather
  // than sharing one broad "canSeeIntelligence" boolean.
  const canSeeVacancyRisk = roles.some(r =>
    ['System Administrator', 'HR Director', 'Workforce Planner'].includes(r)
  );
  const canSeeWorkforceReadiness = roles.some(r =>
    ['System Administrator', 'HR Director', 'Workforce Planner', 'Executive User'].includes(r)
  );
  // GD-M32-1 Decision 10: independent per-signal gating extended to a third signal —
  // attrition risk shares the exact same allowed-role list as workforce readiness
  // (SA/HRD/WP/Executive User), but is still gated by its own boolean rather than
  // reusing canSeeWorkforceReadiness, matching the established one-boolean-per-signal
  // discipline (each signal's RBAC is independently governed even when the role
  // lists happen to be identical today).
  const canSeeAttritionRisk = roles.some(r =>
    ['System Administrator', 'HR Director', 'Workforce Planner', 'Executive User'].includes(r)
  );
  // GD-M32-1 Decision 20 (Amendment 1): Intelligence workspace nav visibility —
  // same allowed-role list as Workforce Signals (SA/HRD/WP/Executive User),
  // kept as its own boolean per the established one-boolean-per-signal
  // discipline rather than reusing canSeeWorkforceReadiness.
  const canSeeIntelligence = roles.some(r =>
    ['System Administrator', 'HR Director', 'Workforce Planner', 'Executive User'].includes(r)
  );

  // 25 parallel fetches — allSettled so no single failure crashes the page
  const [
    r0, r1, r2, r3, r4,     // employee status counts
    r5,                      // active positions
    r6, r7, r8,              // vacancies: open / in_recruitment / critical
    r9, r10, r11, r12, r13, // application pipeline stages
    r14,                     // total applications
    r15,                     // scheduled interviews
    r16, r17, r18,           // offers: sent / accepted / declined
    r19,                     // open vacancy list (top 3)
    r20,                     // expiring certifications (top 3)
    r21,                     // total positions (for KPI bar proportion)
    r22,                     // intelligence: vacancy risk scores (only fetched for allowed roles)
    r23,                     // intelligence: workforce readiness (only fetched for allowed roles)
    r24,                     // intelligence: aggregate attrition risk (only fetched for allowed roles)
  ] = await Promise.allSettled([
    serverFetch<Count>('/api/v1/employees?employmentStatus=ACTIVE&pageSize=1').catch(() => null),
    serverFetch<Count>('/api/v1/employees?employmentStatus=PENDING_ONBOARDING&pageSize=1').catch(() => null),
    serverFetch<Count>('/api/v1/employees?employmentStatus=ON_LEAVE&pageSize=1').catch(() => null),
    serverFetch<Count>('/api/v1/employees?employmentStatus=SUSPENDED&pageSize=1').catch(() => null),
    serverFetch<Count>('/api/v1/employees?employmentStatus=SEPARATED&pageSize=1').catch(() => null),
    serverFetch<Count>('/api/v1/positions?status=ACTIVE&pageSize=1').catch(() => null),
    serverFetch<Count>('/api/v1/vacancies?status=OPEN&pageSize=1').catch(() => null),
    serverFetch<Count>('/api/v1/vacancies?status=IN_RECRUITMENT&pageSize=1').catch(() => null),
    serverFetch<Count>('/api/v1/vacancies?priority=CRITICAL&pageSize=1').catch(() => null),
    serverFetch<Count>('/api/v1/applications?status=SCREENING&pageSize=1').catch(() => null),
    serverFetch<Count>('/api/v1/applications?status=EVALUATION&pageSize=1').catch(() => null),
    serverFetch<Count>('/api/v1/applications?status=INTERVIEW&pageSize=1').catch(() => null),
    serverFetch<Count>('/api/v1/applications?status=OFFER&pageSize=1').catch(() => null),
    serverFetch<Count>('/api/v1/applications?status=HIRED&pageSize=1').catch(() => null),
    serverFetch<Count>('/api/v1/applications?pageSize=1').catch(() => null),
    serverFetch<Count>('/api/v1/interviews?status=SCHEDULED&pageSize=1').catch(() => null),
    serverFetch<Count>('/api/v1/offers?status=SENT&pageSize=1').catch(() => null),
    serverFetch<Count>('/api/v1/offers?status=ACCEPTED&pageSize=1').catch(() => null),
    serverFetch<Count>('/api/v1/offers?status=DECLINED&pageSize=1').catch(() => null),
    serverFetch<VacancyListRes>('/api/v1/vacancies?status=OPEN&pageSize=3').catch(() => null),
    serverFetch<CertsRes>('/api/v1/employee-certifications/expiring?withinDays=30&pageSize=3').catch(() => null),
    serverFetch<Count>('/api/v1/positions?pageSize=1').catch(() => null),
    canSeeVacancyRisk
      ? serverFetch<VacancyRiskRes>('/api/v1/intelligence/vacancy-risk?pageSize=5')
      : Promise.resolve(null),
    canSeeWorkforceReadiness
      ? serverFetch<WorkforceReadinessRes>('/api/v1/intelligence/workforce-readiness')
      : Promise.resolve(null),
    canSeeAttritionRisk
      ? serverFetch<AttritionRiskRes>('/api/v1/intelligence/attrition-risk')
      : Promise.resolve(null),
  ]);

  // ── Extract counts ───────────────────────────────────────────────────────
  const activeEmployees    = n(r0);
  const pendingOnboarding  = n(r1);
  const onLeave            = n(r2);
  const suspended          = n(r3);
  const separated          = n(r4);
  const activePositions    = n(r5);
  const totalPositions     = n(r21);
  const openVacancies      = n(r6);
  const inRecruitment      = n(r7);
  const criticalVacancies  = n(r8);
  const screeningCount     = n(r9);
  const evaluationCount    = n(r10);
  const interviewCount     = n(r11);
  const offerCount         = n(r12);
  const hiredCount         = n(r13);
  const totalApplications  = n(r14);
  const scheduledInterviews = n(r15);
  const sentOffers         = n(r16);
  const acceptedOffers     = n(r17);
  const declinedOffers     = n(r18);
  const openVacancyList    = settled<VacancyListRes>(r19);
  const certsData          = settled<CertsRes>(r20);
  const vacancyRiskData        = settled<VacancyRiskRes>(r22);
  const vacancyRiskFetchFailed = canSeeVacancyRisk && r22.status === 'rejected';
  const readinessData          = settled<WorkforceReadinessRes>(r23);
  const readinessFetchFailed   = canSeeWorkforceReadiness && r23.status === 'rejected';
  const attritionData          = settled<AttritionRiskRes>(r24);
  const attritionFetchFailed   = canSeeAttritionRisk && r24.status === 'rejected';

  // ── Derived ──────────────────────────────────────────────────────────────
  // Unfilled = OPEN + IN_RECRUITMENT; show partial sum if only one succeeded
  const unfilledTotal =
    openVacancies != null || inRecruitment != null
      ? (openVacancies ?? 0) + (inRecruitment ?? 0)
      : null;

  // Workforce stacked bar — denominator excludes Separated (not current workforce)
  const wfCurrent = (activeEmployees ?? 0) + (pendingOnboarding ?? 0) + (onLeave ?? 0) + (suspended ?? 0);
  const activePct  = wfCurrent > 0 ? (activeEmployees ?? 0) / wfCurrent * 100 : 0;
  const onLeavePct = wfCurrent > 0 ? (onLeave ?? 0) / wfCurrent * 100 : 0;
  const otherPct   = Math.max(0, 100 - activePct - onLeavePct);
  const activeRate = wfCurrent > 0 ? ((activeEmployees ?? 0) / wfCurrent * 100).toFixed(1) : null;

  // Pipeline bars — relative to the largest stage count
  const maxPL = Math.max(screeningCount ?? 0, evaluationCount ?? 0, interviewCount ?? 0, offerCount ?? 0, hiredCount ?? 0, 1);
  const pct   = (c: number | null) => c != null ? Math.round((c / maxPL) * 100) : 0;

  // Vacancy list
  const vacancies     = openVacancyList?.data?.vacancies ?? [];
  const moreOpenCount = (openVacancies ?? 0) - vacancies.length;

  // Certifications — panel shown only if endpoint was accessible
  const certsFetchable = certsData !== null;
  const certs          = certsData?.data?.expiringCertifications ?? [];
  const certsTotal     = certsData?.data?.total ?? 0;

  const pageDate = formatPageDate();

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: CANVAS, fontFamily: "var(--font-ibm-plex-sans,'IBM Plex Sans',system-ui,sans-serif)" }}>

      {/* ── Header — unchanged M23 nav pill treatment ── */}
      <header style={{ backgroundColor: NAVY }} className="pl-6 pr-10 py-3.5">
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-10">
            <span className="text-base font-semibold tracking-wide text-white">GWIP</span>
            <nav className="flex items-center gap-0.5" aria-label="Domain navigation">
              <span
                className="rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-white"
                style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}
              >
                Dashboard
              </span>
              {canSeeIntelligence && (
                <Link
                  href="/intelligence"
                  className="rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-[#60a5fa] transition-all hover:bg-white/[0.08] hover:text-[#93c5fd]"
                >
                  Intelligence
                </Link>
              )}
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

          {/* ── Page heading ─────────────────────────────────────────────────
               Reconciled: app-standard text-2xl (24px) matching Workforce /
               Recruiting pages; date element added from Dashboard mockup.
               Mockup specifies 22px — keeping 24px for app-wide consistency.
          ─────────────────────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28 }}>
            <div>
              <h2
                className="text-2xl font-bold tracking-tight"
                style={{ color: TEXT, margin: 0 }}
              >
                Dashboard
              </h2>
              <p style={{ fontSize: 13, color: SUB, marginTop: 3 }}>
                Agency Workforce Overview
              </p>
            </div>
            <span style={{ fontSize: 12, color: MUTED, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
              {pageDate}
            </span>
          </div>

          {/* ── KPI ROW — 4 cards ────────────────────────────────────────── */}
          <SectionEyebrow label="Operational Snapshot" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 16 }}>

            <KpiCard
              label="Active Workforce"
              value={fmt(activeEmployees)}
              note={
                pendingOnboarding != null
                  ? <>{pendingOnboarding} pending onboarding</>
                  : undefined
              }
              barColor={GREEN}
            />

            <KpiCard
              label="Active Positions"
              value={fmt(activePositions)}
              note={
                activePositions != null && totalPositions != null
                  ? <>{activePositions} of {totalPositions} total positions</>
                  : undefined
              }
              barColor={BLUE}
            />

            <KpiCard
              label="Unfilled Vacancies"
              value={fmt(unfilledTotal)}
              note={
                openVacancies != null && inRecruitment != null
                  ? <>{openVacancies} open · {inRecruitment} in recruitment</>
                  : undefined
              }
              barColor={AMBER}
            />

            <KpiCard
              label="Critical Vacancies"
              value={fmt(criticalVacancies)}
              note={
                criticalVacancies != null && criticalVacancies > 0
                  ? <span style={{ color: RED, fontWeight: 600 }}>Requires immediate attention</span>
                  : criticalVacancies === 0
                  ? <span style={{ color: GREEN, fontWeight: 600 }}>None at critical priority</span>
                  : undefined
              }
              barColor={criticalVacancies != null && criticalVacancies > 0 ? RED : MUTED}
            />

          </div>

          {/* ── WORKFORCE INTELLIGENCE — independent per-signal gating (GD-M31-1 D10,
               extended by GD-M32-1 D10 to a third signal): the eyebrow renders if any
               signal is visible; each card beneath it is gated by its own boolean,
               since the three signals have different allowed-role lists (vacancy risk:
               SA/HRD/WP only; readiness and attrition risk: SA/HRD/WP/Executive User).
               Governed order: Workforce Readiness -> Attrition Risk -> Vacancy Risk
               Signals. Column template (GD-M32-1 D10): '1fr 1fr 2fr' when all three
               signals are visible (SA/HRD/WP); '1fr 1fr' when exactly Workforce
               Readiness + Attrition Risk are visible (Executive User, no Vacancy Risk);
               an even split for any other combination; collapses to a single column
               when only one signal is visible. */}
          {(canSeeVacancyRisk || canSeeWorkforceReadiness || canSeeAttritionRisk) && (
            <SectionEyebrow label="Workforce Intelligence" accentColor={AMBER} />
          )}

          {(() => {
            const visibleIntelCount =
              (canSeeWorkforceReadiness ? 1 : 0) +
              (canSeeAttritionRisk ? 1 : 0) +
              (canSeeVacancyRisk ? 1 : 0);
            if (visibleIntelCount === 0) return null;

            // When all three signals are visible (SA/HRD/WP), Workforce Readiness and
            // Attrition Risk stack vertically in the left column so Vacancy Risk Signals
            // (a wide ranked table) gets the room it needs on the right — two grid
            // columns, not three. Executive User (readiness + attrition, no vacancy risk)
            // keeps the existing side-by-side pair; there is no competing wide panel to
            // make room for.
            const stackReadinessAndAttrition = canSeeWorkforceReadiness && canSeeAttritionRisk && canSeeVacancyRisk;
            const intelGridCols = stackReadinessAndAttrition
              // Stacked left column only needs to fit a score, a level pill, and one
              // reasoning line — narrower than a 50/50 split so Vacancy Risk Signals
              // (a 5-column table) gets the extra room instead.
              ? '1fr 1.4fr'
              : canSeeWorkforceReadiness && canSeeAttritionRisk && !canSeeVacancyRisk
              ? '1fr 1fr'
              : `repeat(${visibleIntelCount}, 1fr)`;

            return (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: intelGridCols,
                gap: 16,
                marginBottom: 16,
                // 'stretch' (grid default) — the stacked left column and Vacancy Risk
                // Signals share the same row height, so their bottoms align.
                alignItems: 'stretch',
              }}
            >

              {/* ── WORKFORCE READINESS — condensed (GD-M32-1 Amendment 1, Decision 19):
                   score + level + one-line reasoning only. No factor chips, no long
                   formula-description footer — that detail now lives on /intelligence.
                   Role-gated (SA, HRD, WP, Executive User) — GD-M31-1 D10/D11. Stacks
                   above Attrition Risk in the left column when Vacancy Risk Signals is
                   also visible (SA/HRD/WP); no per-card "View all" link — the Intelligence
                   nav item is the way in, and a link on every stacked card is redundant. */}
              {(() => { const readinessCard = canSeeWorkforceReadiness ? (
                <div style={{ ...CARD, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                  {/* minHeight matches Vacancy Risk Signals' two-line header (title +
                      subtitle) so the amber divider lands at the same height across
                      every card in the row, regardless of one-line vs two-line title. */}
                  <div style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a', padding: '14px 20px', minHeight: 64, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span
                      aria-hidden="true"
                      style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: '#ffffff', border: '1px solid #fde68a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: AMBER }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                      </svg>
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Workforce Readiness</span>
                  </div>
                  <div aria-hidden="true" style={{ height: 1, background: 'rgba(217,119,6,.25)' }} />

                  {readinessFetchFailed ? (
                    <p style={{ padding: '20px', fontSize: 13, color: SUB, flex: 1, display: 'flex', alignItems: 'center', margin: 0 }}>
                      Workforce readiness unavailable. Reload the dashboard to try again.
                    </p>
                  ) : readinessData !== null ? (
                    (() => {
                      // readinessLevel pill colors — same wash-tint derivation as riskCfg below
                      // (a light tint of an already-used solid token); no new visual system.
                      const readinessCfg: Record<string, { bg: string; c: string; bd: string }> = {
                        READY:      { bg: '#f0fdf4', c: GREEN, bd: '#bbf7d0' },
                        DEVELOPING: { bg: '#eff6ff', c: BLUE,  bd: 'rgba(37,99,235,.2)' },
                        AT_RISK:    { bg: '#fffbeb', c: AMBER, bd: '#fde68a' },
                        CRITICAL:   { bg: '#fef2f2', c: RED,   bd: '#fecaca' },
                      };
                      const rc = readinessCfg[readinessData.data.readinessLevel] ?? readinessCfg.AT_RISK!;
                      const confidenceLabel =
                        readinessData.data.confidence >= 70 ? 'High'
                        : readinessData.data.confidence >= 40 ? 'Medium'
                        : 'Low';
                      return (
                        // flex:1 + justifyContent:center — when the grid stretches this
                        // card taller than its natural content height (to match Vacancy
                        // Risk Signals), the score/reasoning/footer block centers in the
                        // available space instead of sitting at the top with dead space
                        // below (same pattern established for this card in M31).
                        <div style={{ padding: '16px 20px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                            <span style={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, color: TEXT, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>
                              {readinessData.data.readinessScore}
                            </span>
                            <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 9999, letterSpacing: '.04em', textTransform: 'uppercase' as const, whiteSpace: 'nowrap', background: rc.bg, color: rc.c, border: `1px solid ${rc.bd}` }}>
                              {readinessData.data.readinessLevel.replace('_', ' ')}
                            </span>
                          </div>
                          {/* Reasoning — the exact string returned by the API; never composed on the frontend */}
                          <p style={{ fontSize: 12, color: SUB, lineHeight: 1.5, marginBottom: 12 }}>
                            {readinessData.data.reasoning}
                          </p>
                          <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 10.5, color: MUTED }}>Human review required before action.</span>
                            <span style={{ fontSize: 10.5, color: MUTED, whiteSpace: 'nowrap' }}>Confidence: {confidenceLabel}</span>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <p style={{ padding: '20px', fontSize: 13, color: MUTED, flex: 1, display: 'flex', alignItems: 'center', margin: 0 }}>
                      Workforce readiness not available at this time.
                    </p>
                  )}
                </div>
              ) : null;

              // ── AGGREGATE ATTRITION RISK — condensed (GD-M32-1 Amendment 1, Decision 19).
              // Role-gated (SA, HRD, WP, Executive User) — GD-M32-1 D10/D11. Executive User
              // receives this exact same aggregate card — no individual employee detail,
              // ranking, list, identifier, or department breakdown exists in this panel for
              // any role. Stacks below Workforce Readiness in the left column when Vacancy
              // Risk Signals is also visible; no per-card "View all" link (see above).
              const attritionCard = canSeeAttritionRisk ? (
                <div style={{ ...CARD, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                  <div style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a', padding: '14px 20px', minHeight: 64, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span
                      aria-hidden="true"
                      style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: '#ffffff', border: '1px solid #fde68a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: AMBER }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
                        <polyline points="17 18 23 18 23 12" />
                      </svg>
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Attrition Risk</span>
                  </div>
                  <div aria-hidden="true" style={{ height: 1, background: 'rgba(217,119,6,.25)' }} />

                  {attritionFetchFailed ? (
                    <p style={{ padding: '20px', fontSize: 13, color: SUB, flex: 1, display: 'flex', alignItems: 'center', margin: 0 }}>
                      Attrition risk unavailable. Reload the dashboard to try again.
                    </p>
                  ) : attritionData !== null ? (
                    (() => {
                      // attritionRiskLevel pill colors — reuses the existing Vacancy Risk Signals
                      // LOW/MEDIUM/HIGH/CRITICAL treatment verbatim (GD-M32-1 Decision 6/10 — attrition
                      // risk runs the same direction as vacancy risk, unlike the inverted readiness scale).
                      const attritionCfg: Record<string, { bg: string; c: string; bd: string }> = {
                        LOW:      { bg: CANVAS,    c: MUTED, bd: BORDER },
                        MEDIUM:   { bg: '#eff6ff', c: BLUE,  bd: 'rgba(37,99,235,.2)' },
                        HIGH:     { bg: '#fffbeb', c: AMBER, bd: '#fde68a' },
                        CRITICAL: { bg: '#fef2f2', c: RED,   bd: '#fecaca' },
                      };
                      const ac = attritionCfg[attritionData.data.attritionRiskLevel] ?? attritionCfg.MEDIUM!;
                      const confidenceLabel =
                        attritionData.data.confidence >= 70 ? 'High'
                        : attritionData.data.confidence >= 40 ? 'Medium'
                        : 'Low';
                      return (
                        <div style={{ padding: '16px 20px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                            <span style={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, color: TEXT, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>
                              {attritionData.data.attritionScore}
                            </span>
                            <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 9999, letterSpacing: '.04em', textTransform: 'uppercase' as const, whiteSpace: 'nowrap', background: ac.bg, color: ac.c, border: `1px solid ${ac.bd}` }}>
                              {attritionData.data.attritionRiskLevel}
                            </span>
                          </div>
                          {/* Reasoning — the exact string returned by the API; never composed on the frontend */}
                          <p style={{ fontSize: 12, color: SUB, lineHeight: 1.5, marginBottom: 12 }}>
                            {attritionData.data.reasoning}
                          </p>
                          <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 10.5, color: MUTED }}>Human review required before action.</span>
                            <span style={{ fontSize: 10.5, color: MUTED, whiteSpace: 'nowrap' }}>Confidence: {confidenceLabel}</span>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <p style={{ padding: '20px', fontSize: 13, color: MUTED, flex: 1, display: 'flex', alignItems: 'center', margin: 0 }}>
                      Attrition risk not available at this time.
                    </p>
                  )}
                </div>
              ) : null;

              return stackReadinessAndAttrition ? (
                // height:'100%' — this wrapper is itself a grid item stretched by the
                // parent's alignItems:'stretch', so it fills the row's full height
                // (matching Vacancy Risk Signals); flex:1 on each card above splits
                // that height evenly, aligning the bottom of Attrition Risk with the
                // bottom of Vacancy Risk Signals.
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
                  {readinessCard}
                  {attritionCard}
                </div>
              ) : (
                <>
                  {readinessCard}
                  {attritionCard}
                </>
              ); })()}

              {/* ── VACANCY RISK SIGNALS — role-gated (SA, HRD, WP) — GD-M30-1 D10. Comes third
                   (right). Stays full-size — not condensed (GD-M32-1 Amendment 1, Decision 15
                   Background note: this panel is unchanged in content and behavior). No
                   per-card "View all" link — same as Workforce Readiness/Attrition Risk;
                   the Intelligence nav item is the way in. */}
              {canSeeVacancyRisk && (
                <div style={CARD}>
                  {/* Warm intelligence panel treatment — amber-tinted header + accent
                      line, reusing the same amber-wash pair used elsewhere in this
                      file (riskCfg.HIGH / PriorityBadge). Card body below remains the
                      standard white CARD shell — no new visual system. */}
                  <div style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a', padding: '14px 20px', minHeight: 64, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span
                      aria-hidden="true"
                      style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: '#ffffff', border: '1px solid #fde68a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: AMBER }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2 4 5v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V5z" />
                      </svg>
                    </span>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Vacancy Risk Signals</span>
                      <p style={{ fontSize: 11, color: SUB, margin: '2px 0 0' }}>
                        Ranked by computed risk — highest attention first
                      </p>
                    </div>
                  </div>
                  <div aria-hidden="true" style={{ height: 1, background: 'rgba(217,119,6,.25)' }} />
                  {/* No horizontal scroll — RISK_GRID_COLS uses narrow fixed tracks for the
                      badge/label columns and fr-based tracks for Vacancy/Why This Is Risky,
                      which wrap/truncate instead of forcing extra width. This panel must
                      fit within its dashboard column at normal viewport widths. */}
                  <div>
                    {vacancyRiskFetchFailed ? (
                      <p style={{ padding: '20px', fontSize: 13, color: SUB }}>
                        Vacancy risk scores unavailable. Reload the dashboard to try again.
                      </p>
                    ) : vacancyRiskData !== null && vacancyRiskData.data.items.length > 0 ? (
                      <>
                        {/* Column headers — explicit grid so values align under their label across every row. */}
                        <div style={{ display: 'grid', gridTemplateColumns: RISK_GRID_COLS, gap: 10, padding: '10px 20px 8px', borderBottom: `1px solid ${BORDER}` }}>
                          {(['Risk', 'Vacancy', 'Priority', 'Why This Is Risky', 'Confidence'] as const).map((h) => (
                            <span
                              key={h}
                              style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.08em', color: MUTED, textAlign: h === 'Risk' ? 'center' : 'left' }}
                            >
                              {h}
                            </span>
                          ))}
                        </div>
                        {vacancyRiskData.data.items.map((item) => {
                          // Risk stays the one strong badge treatment per row (GD-M30-1 D10).
                          const riskCfg: Record<string, { bg: string; c: string; bd: string }> = {
                            CRITICAL: { bg: '#fef2f2', c: RED,   bd: '#fecaca' },
                            HIGH:     { bg: '#fffbeb', c: AMBER, bd: '#fde68a' },
                            MEDIUM:   { bg: '#eff6ff', c: BLUE,  bd: 'rgba(37,99,235,.2)' },
                            LOW:      { bg: CANVAS,    c: MUTED, bd: BORDER },
                          };
                          const rt = riskCfg[item.riskLevel] ?? riskCfg.LOW!;
                          // Priority: lower-emphasis dot + text, not a pill (GD-M30-1 D10 row-level display hierarchy).
                          const priorityDotColor: Record<string, string> = {
                            CRITICAL: RED, HIGH: AMBER, MEDIUM: BLUE, LOW: MUTED,
                          };
                          const priorityLabel = item.priority
                            ? item.priority.charAt(0) + item.priority.slice(1).toLowerCase()
                            : null;
                          // Confidence: plain muted text, not a pill or raw percentage (GD-M30-1 D10).
                          const confidenceLabel =
                            item.confidence >= 70 ? 'High' : item.confidence >= 40 ? 'Medium' : 'Low';
                          return (
                            <div
                              key={item.vacancyId}
                              style={{ display: 'grid', gridTemplateColumns: RISK_GRID_COLS, gap: 10, alignItems: 'start', padding: '12px 20px', borderBottom: `1px solid ${BORDER}` }}
                            >
                              {/* Risk — pill auto-sizes to its own label (LOW/MEDIUM/HIGH/CRITICAL)
                                  and the score sits below it, stacked and centered, so the widest
                                  label never forces the 92px Risk column wider (no horizontal
                                  overflow), and every score lands in the same horizontal position
                                  regardless of digit count (fixed-width, centered). */}
                              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                                <span style={{ display: 'inline-block', textAlign: 'center' as const, fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 9999, letterSpacing: '.03em', textTransform: 'uppercase' as const, whiteSpace: 'nowrap', background: rt.bg, color: rt.c, border: `1px solid ${rt.bd}` }}>
                                  {item.riskLevel}
                                </span>
                                <span style={{ display: 'inline-block', width: 28, textAlign: 'center' as const, fontFamily: MONO, fontSize: 13, fontWeight: 700, color: TEXT, fontVariantNumeric: 'tabular-nums' }}>
                                  {item.riskScore}
                                </span>
                              </span>

                              {/* Vacancy */}
                              <div style={{ minWidth: 0 }}>
                                <p style={{ fontSize: 13, fontWeight: 500, color: TEXT, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {item.positionTitle}
                                </p>
                                {item.departmentName && (
                                  <p style={{ fontSize: 11, color: MUTED, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {item.departmentName}
                                  </p>
                                )}
                              </div>

                              {/* Priority — dot + text, not a pill */}
                              {priorityLabel ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: SUB, whiteSpace: 'nowrap' }}>
                                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: priorityDotColor[item.priority!] ?? MUTED, flexShrink: 0, display: 'inline-block' }} />
                                  {priorityLabel}
                                </span>
                              ) : <span />}

                              {/* Why This Is Risky — the exact reasoning string returned by the API (GD-M30-1 D8/D10). Never composed on the frontend. */}
                              <p style={{ fontSize: 12, color: SUB, margin: 0, lineHeight: 1.45 }}>
                                {item.reasoning}
                              </p>

                              {/* Confidence — plain muted text, not a pill */}
                              <span style={{ fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>
                                {confidenceLabel}
                              </span>
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <p style={{ padding: '20px', fontSize: 13, color: MUTED }}>
                        No open vacancies scored at this time.
                      </p>
                    )}
                  </div>
                  <div style={{ borderTop: `1px solid ${BORDER}`, padding: '10px 20px' }}>
                    <p style={{ fontSize: 11, color: MUTED, margin: 0, lineHeight: 1.5 }}>
                      Scores computed from live vacancy data using deterministic-v1 formula. Human review required before action.
                    </p>
                  </div>
                </div>
              )}

            </div>
            );
          })()}

          {/* ── PIPELINE + OPEN VACANCIES — 2/3 + 1/3 ───────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>

            {/* Recruiting Pipeline */}
            <div style={CARD}>
              <CardHead title="Recruiting Pipeline" href="/recruiting/applications" />
              <p style={{ fontSize: 11, color: MUTED, padding: '8px 20px 0', margin: 0 }}>Application counts by current status</p>
              <div style={{ padding: '12px 20px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {([
                  { label: 'Screening',       count: screeningCount,  color: MUTED  },
                  { label: 'Evaluation',      count: evaluationCount, color: SUB    },
                  { label: 'Interview',       count: interviewCount,  color: BLUE   },
                  { label: 'Offer Stage',     count: offerCount,      color: AMBER  },
                  { label: 'Converted Hires', count: hiredCount,      color: GREEN  },
                ] as const).map(({ label, count, color }) => (
                  <div key={label} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 32px', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, color: SUB, fontWeight: 500 }}>{label}</span>
                    <div style={{ height: 7, background: BORDER, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 4, background: color, width: `${pct(count)}%`, transition: 'width .2s' }} />
                    </div>
                    <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: TEXT, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {count != null ? count : '—'}
                    </span>
                  </div>
                ))}
              </div>
              {/* Pipeline footer stats */}
              <div style={{ borderTop: `1px solid ${BORDER}`, padding: '12px 20px', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                {(
                  [
                    { label: 'Applications',          value: totalApplications   },
                    { label: 'Interviews scheduled',  value: scheduledInterviews },
                    { label: 'Offers sent',           value: sentOffers          },
                    { label: 'Accepted',              value: acceptedOffers, accent: GREEN },
                    { label: 'Declined',              value: declinedOffers, accent: RED   },
                  ] as { label: string; value: number | null; accent?: string }[]
                ).map(({ label, value, accent }) => (
                  <span key={label} style={{ fontSize: 12, color: SUB }}>
                    {label}:{' '}
                    <strong style={{ fontFamily: MONO, fontWeight: 700, color: accent ?? TEXT, fontVariantNumeric: 'tabular-nums' }}>
                      {value != null ? value : '—'}
                    </strong>
                  </span>
                ))}
              </div>
            </div>

            {/* Open Vacancies — replaces Position Fill Rate (no fill data available) */}
            <div style={CARD}>
              <CardHead title="Open Vacancies" href="/workforce/vacancies" />
              {vacancies.length > 0 ? (
                <>
                  {vacancies.map((vac) => (
                    <div key={vac.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', borderBottom: `1px solid ${BORDER}`, gap: 10 }}>
                      <span style={{ fontSize: 12, color: SUB, flex: 1, minWidth: 0 }}>{vac.positionTitle}</span>
                      <PriorityBadge priority={vac.priority} />
                    </div>
                  ))}
                  {moreOpenCount > 0 && (
                    <div style={{ padding: '9px 20px' }}>
                      <span style={{ fontSize: 12, color: MUTED }}>+ {moreOpenCount} more open</span>
                    </div>
                  )}
                </>
              ) : (
                <p style={{ padding: '20px', fontSize: 13, color: MUTED }}>No open vacancies.</p>
              )}
              {inRecruitment != null && inRecruitment > 0 && (
                <div style={{ borderTop: `1px solid ${BORDER}`, padding: '10px 20px' }}>
                  <span style={{ fontSize: 11, color: MUTED }}>
                    + {inRecruitment} {inRecruitment === 1 ? 'vacancy' : 'vacancies'} in active recruitment
                  </span>
                </div>
              )}
            </div>

          </div>

          {/* ── WORKFORCE STATUS + CERTIFICATIONS — 1/3 + 2/3 (certs conditional) */}
          <div style={{ display: 'grid', gridTemplateColumns: certsFetchable ? '1fr 2fr' : '1fr', gap: 16 }}>

            {/* Workforce Status */}
            <div style={CARD}>
              <CardHead title="Workforce Status" href="/workforce/employees" cta="Employees →" />
              <div style={{ padding: '16px 20px' }}>
                {/* Stacked bar: Active / On Leave / Other */}
                <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', margin: '0 0 6px' }}>
                  <div style={{ background: GREEN, width: `${activePct.toFixed(1)}%` }} />
                  <div style={{ background: AMBER, width: `${onLeavePct.toFixed(1)}%` }} />
                  <div style={{ background: MUTED, width: `${otherPct.toFixed(1)}%` }} />
                </div>
                <p style={{ fontSize: 11, color: MUTED, marginBottom: 14 }}>
                  {activeRate != null ? `${activeRate}% active current workforce` : 'Current workforce rate unavailable'}
                </p>
                <div style={{ borderTop: `1px solid ${BORDER}` }}>
                  <WfRow dotColor={GREEN}    label="Active"             count={activeEmployees}   />
                  <WfRow dotColor={AMBER}    label="On Leave"           count={onLeave}            />
                  <WfRow dotColor={BLUE}     label="Pending Onboarding" count={pendingOnboarding}  />
                  <WfRow dotColor="#f97316"  label="Suspended"          count={suspended}           />
                  <WfRow dotColor={MUTED}    label="Separated"          count={separated} isLast   />
                </div>
              </div>
            </div>

            {/* Certifications — only if endpoint was accessible for this role */}
            {certsFetchable && (
              <div style={CARD}>
                <CardHead title="Certifications Expiring Soon" href="/workforce/certifications/expiring" />
                {certs.length > 0 ? (
                  <>
                    {certs.map((cert, i) => {
                      const days = daysUntil(cert.expirationDate);
                      const pillBg  = days <= 0 ? '#fef2f2' : days <= 30 ? '#fffbeb' : CANVAS;
                      const pillC   = days <= 0 ? RED : days <= 30 ? AMBER : MUTED;
                      const pillBd  = days <= 0 ? '#fecaca' : days <= 30 ? '#fde68a' : BORDER;
                      const pillTxt = days <= 0 ? 'Past due' : `${days}d`;
                      return (
                        <div
                          key={`${cert.certificationName}-${cert.lastName}-${i}`}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px', borderBottom: `1px solid ${BORDER}` }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 13, fontWeight: 500, color: TEXT }}>{cert.certificationName}</p>
                            <p style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>
                              {cert.firstName} {cert.lastName}
                            </p>
                          </div>
                          <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, lineHeight: 1.5, whiteSpace: 'nowrap', background: pillBg, color: pillC, border: `1px solid ${pillBd}` }}>
                            {pillTxt}
                          </span>
                          <span style={{ fontFamily: MONO, fontSize: 11, color: SUB, whiteSpace: 'nowrap' }}>
                            {formatExpiryDate(cert.expirationDate)}
                          </span>
                        </div>
                      );
                    })}
                    {certsTotal > certs.length && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 20px' }}>
                        <span style={{ fontSize: 12, color: MUTED }}>
                          {certsTotal} total certification{certsTotal !== 1 ? 's' : ''} expiring within 30 days
                        </span>
                        <Link href="/workforce/certifications/expiring" style={{ fontSize: 11, color: BLUE }}>View all →</Link>
                      </div>
                    )}
                  </>
                ) : (
                  <p style={{ padding: '20px', fontSize: 13, color: MUTED }}>No certifications expiring within 30 days.</p>
                )}
              </div>
            )}

          </div>

        </div>
      </main>
    </div>
  );
}
