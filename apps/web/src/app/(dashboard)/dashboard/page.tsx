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

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  // 22 parallel fetches — allSettled so no single failure crashes the page
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

  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canSeeAdmin = roles.includes('System Administrator') || roles.includes('HR Director');

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
