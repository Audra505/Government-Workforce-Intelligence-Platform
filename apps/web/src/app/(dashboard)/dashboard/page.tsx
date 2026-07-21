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
import { PlatformHeader } from '@/components/shared/platform-header';

// ── Design tokens — match Dashboard mockup exactly ──────────────────────────
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
// GD-M34-1 Decision 10 — mirrors GET /api/v1/intelligence/executive-metrics
// exactly. value may be null (undefined-denominator or zero-sample case);
// never rendered as a fabricated 0 (see fmtExecutiveMetric below).
type ExecutiveMetricValue = {
  value: number | null;
  unit: 'PERCENT' | 'DAYS' | 'COUNT';
  confidence: number;
  detail: string;
  windowDays: number | null;
};
type ExecutiveMetricsRes = {
  success: boolean;
  data: {
    vacancyRate: ExecutiveMetricValue;
    coverageRate: ExecutiveMetricValue;
    timeToFill: ExecutiveMetricValue;
    hiringVelocity: ExecutiveMetricValue;
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
// GD-M34-1 Decision 12: dashboard shows the formatted value only — no raw
// formula math (no "6 of 50" breakdowns; that detail lives on /intelligence).
const EXEC_METRIC_UNIT_SUFFIX: Record<ExecutiveMetricValue['unit'], string> = {
  PERCENT: '%',
  DAYS: 'd',
  COUNT: '',
};
function fmtExecutiveMetric(metric: ExecutiveMetricValue | undefined): string {
  if (!metric || metric.value === null) return '—';
  const formatted = metric.unit === 'COUNT' ? String(metric.value) : metric.value.toFixed(1);
  return `${formatted}${EXEC_METRIC_UNIT_SUFFIX[metric.unit]}`;
}

// Shared confidence-label rule already used inline in the operational
// dashboard's Workforce Readiness / Attrition Risk cards (confidence >= 70 →
// High, >= 40 → Medium, else Low) — extracted here as a named helper for the
// Executive User dashboard below, without touching the existing inline
// computations elsewhere in this file.
function confidenceLabel(c: number): string {
  return c >= 70 ? 'High' : c >= 40 ? 'Medium' : 'Low';
}

// Executive User dashboard — posture statement. Purely descriptive synthesis
// of fields the API already returns and already classifies (readinessLevel,
// attritionRiskLevel) or already computes (coverageRate, vacancyRate) — no
// new score, threshold, or classification is introduced here. Returns null
// when there isn't enough real data to say anything, so the caller can show
// a graceful fallback instead of a fabricated sentence.
function composePostureStatement(
  readinessLevel: string | null,
  attritionRiskLevel: string | null,
  coverageRate: number | null,
  vacancyRate: number | null,
): string | null {
  const clauses: string[] = [];
  if (readinessLevel) clauses.push(`workforce readiness is ${readinessLevel.toLowerCase().replace('_', ' ')}`);
  if (attritionRiskLevel) clauses.push(`attrition risk is ${attritionRiskLevel.toLowerCase()}`);
  const lead = clauses.length > 0 ? clauses.join(' and ') : null;

  const capacityClause = coverageRate !== null
    ? (vacancyRate !== null && vacancyRate > coverageRate
        ? `coverage sits at ${coverageRate.toFixed(1)}%, with more roles open than filled`
        : `coverage sits at ${coverageRate.toFixed(1)}%`)
    : null;

  const sentence = [lead, capacityClause].filter((s): s is string => s !== null).join(' — ');
  if (!sentence) return null;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
}

// Small ring gauge — CSS conic-gradient, no chart library. `pct` is the
// already-governed 0–100 score itself (readinessScore / attritionScore);
// no new math is applied to it beyond using it directly as a fill percentage.
function RingGauge({ pct, color, children }: { pct: number; color: string; children: ReactNode }) {
  return (
    <span
      style={{
        width: 100, height: 100, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `conic-gradient(${color} ${Math.max(0, Math.min(100, pct))}%, ${BORDER} 0)`,
      }}
    >
      <span style={{ width: 78, height: 78, borderRadius: '50%', background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </span>
    </span>
  );
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

// ── Executive User dashboard (M34 approved mockup) ────────────────────────────
// A purpose-built executive view, not the operational dashboard with rows
// hidden. Uses only the three signals Executive User is authorized for
// (Workforce Readiness, Attrition Risk, Workforce Metrics) — same data already
// fetched by DashboardPage above, passed down as props; no new fetch, no new
// endpoint. See the deviation notes on confidenceLabel/composePostureStatement/
// RingGauge above and in the reasoning/caption rendering below for the three
// points where this cannot literally match the approved mockup and why.
const READINESS_LEVEL_COLOR: Record<string, string> = {
  READY: GREEN, DEVELOPING: BLUE, AT_RISK: AMBER, CRITICAL: RED,
};
const READINESS_LEVEL_PILL: Record<string, { bg: string; c: string; bd: string }> = {
  READY:      { bg: '#f0fdf4', c: GREEN, bd: '#bbf7d0' },
  DEVELOPING: { bg: '#eff6ff', c: BLUE,  bd: 'rgba(37,99,235,.2)' },
  AT_RISK:    { bg: '#fffbeb', c: AMBER, bd: '#fde68a' },
  CRITICAL:   { bg: '#fef2f2', c: RED,   bd: '#fecaca' },
};
const ATTRITION_LEVEL_COLOR: Record<string, string> = {
  LOW: MUTED, MEDIUM: BLUE, HIGH: AMBER, CRITICAL: RED,
};
const ATTRITION_LEVEL_PILL: Record<string, { bg: string; c: string; bd: string }> = {
  LOW:      { bg: CANVAS,    c: MUTED, bd: BORDER },
  MEDIUM:   { bg: '#eff6ff', c: BLUE,  bd: 'rgba(37,99,235,.2)' },
  HIGH:     { bg: '#fffbeb', c: AMBER, bd: '#fde68a' },
  CRITICAL: { bg: '#fef2f2', c: RED,   bd: '#fecaca' },
};

function ExecutiveDashboardView({
  roles,
  pageDate,
  readinessData, readinessFetchFailed,
  attritionData, attritionFetchFailed,
  executiveMetricsData, executiveMetricsFetchFailed,
}: {
  roles: string[];
  pageDate: string;
  readinessData: WorkforceReadinessRes | null;
  readinessFetchFailed: boolean;
  attritionData: AttritionRiskRes | null;
  attritionFetchFailed: boolean;
  executiveMetricsData: ExecutiveMetricsRes | null;
  executiveMetricsFetchFailed: boolean;
}) {
  const coverage = executiveMetricsData?.data.coverageRate;
  const vacancy = executiveMetricsData?.data.vacancyRate;
  const timeToFill = executiveMetricsData?.data.timeToFill;
  const hiringVelocity = executiveMetricsData?.data.hiringVelocity;

  const postureStatement = composePostureStatement(
    readinessData?.data.readinessLevel ?? null,
    attritionData?.data.attritionRiskLevel ?? null,
    coverage?.value ?? null,
    vacancy?.value ?? null,
  );

  // Vacancy Rate can exceed 100% (more open vacancies than active positions —
  // a real, observed condition, not a display bug). Scaled against a 150%
  // reference ceiling purely for the bar's visual fill; the displayed number
  // itself is always the real, unrounded-scale value from the API.
  const vacancyBarPct = vacancy?.value != null ? Math.max(0, Math.min(100, (vacancy.value / 150) * 100)) : 0;
  const coverageBarPct = coverage?.value != null ? Math.max(0, Math.min(100, coverage.value)) : 0;

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: CANVAS, fontFamily: "var(--font-ibm-plex-sans,'IBM Plex Sans',system-ui,sans-serif)" }}>

      {/* ── Header — shared PlatformHeader (polished nav treatment). Only
           Dashboard + Intelligence render for Executive User — Workforce,
           Recruiting, and Admin are RBAC-403 for this capability profile
           today (RBAC-951/952), confirmed via
           apps/web/src/app/(dashboard)/workforce/employees/error.tsx —
           PlatformHeader computes that visibility from `roles` itself. */}
      <PlatformHeader roles={roles} activeItem="dashboard" />

      {/* ── Shell: sidebar + main ── */}
      <div className="flex flex-1" style={{ maxWidth: 1360, margin: '0 auto', width: '100%' }}>

        {/* ── Sidebar ── */}
        <aside style={{ width: 288, flexShrink: 0, padding: '40px 24px 40px 28px' }}>
          <p style={{ fontSize: 11.5, color: MUTED, margin: '0 0 14px' }}>Welcome back</p>

          {postureStatement ? (
            <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-.01em', lineHeight: 1.45, margin: '0 0 12px', color: TEXT }}>
              {postureStatement}
            </h2>
          ) : (
            <h2 style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.5, margin: '0 0 12px', color: MUTED }}>
              Workforce intelligence summary is not available at this time.
            </h2>
          )}
          <p style={{ fontSize: 11, color: MUTED, lineHeight: 1.55, margin: '0 0 28px' }}>
            Synthesized from Workforce Readiness, Attrition Risk, and Workforce Metrics.
          </p>

          <div aria-hidden="true" style={{ height: 1, background: BORDER, margin: '0 0 24px' }} />

          <div style={{ background: '#eff6ff', border: '1px solid rgba(37,99,235,.2)', borderRadius: 10, padding: 18, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700, color: TEXT, marginBottom: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={BLUE} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" /></svg>
              Go deeper
            </div>
            <p style={{ fontSize: 11.5, color: SUB, lineHeight: 1.55, margin: '0 0 14px' }}>
              See the full factor-level breakdown behind Workforce Readiness and Attrition Risk.
            </p>
            <Link
              href="/intelligence"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: '#fff', background: BLUE, padding: '9px 14px', borderRadius: 6, textDecoration: 'none' }}
            >
              Open Intelligence →
            </Link>
          </div>

          <p style={{ fontSize: 10.5, color: MUTED, lineHeight: 1.65, margin: 0 }}>
            All scores are deterministic and advisory — no OpenAI or external model is used. No individual, candidate, or department-level detail is shown. Human review and leadership judgment should guide all decisions.
          </p>
        </aside>

        {/* ── Main ── */}
        <main style={{ flex: 1, minWidth: 0, padding: '40px 32px 80px 28px' }}>

          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 34 }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.01em', margin: 0, color: TEXT }}>Executive Dashboard</h1>
              <p style={{ fontSize: 12.5, color: SUB, margin: '4px 0 0' }}>Aggregate workforce intelligence overview</p>
            </div>
            <span style={{ fontSize: 11.5, color: MUTED, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>{pageDate}</span>
          </div>

          {/* ── Strategic Risk Signals — the two governed, thresholded scores.
               Reasoning is rendered as the FULL, unmodified string the API
               returns (see file-level deviation note above) — never trimmed
               or recomposed on the frontend, matching the same rule already
               enforced for SA/HRD/WP on the operational dashboard above. */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: SUB }}>Strategic Risk Signals</span>
            <span style={{ fontSize: 11, color: MUTED }}>Governed, thresholded scores</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 44 }}>

            {/* Workforce Readiness */}
            <div style={{ ...CARD, borderRadius: 12, position: 'relative', overflow: 'hidden' }}>
              <div aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: BLUE }} />
              <div style={{ padding: '26px 26px 22px' }}>
                {readinessFetchFailed ? (
                  <p style={{ fontSize: 13, color: SUB, margin: 0 }}>Workforce readiness unavailable. Reload the dashboard to try again.</p>
                ) : readinessData !== null ? (() => {
                  const level = readinessData.data.readinessLevel;
                  const pill = READINESS_LEVEL_PILL[level] ?? READINESS_LEVEL_PILL.AT_RISK!;
                  const gaugeColor = READINESS_LEVEL_COLOR[level] ?? AMBER;
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ width: 30, height: 30, borderRadius: 8, background: '#eff6ff', color: BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} aria-hidden="true">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                          </span>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT }}>Workforce Readiness</span>
                        </div>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: pill.bg, color: pill.c, border: `1px solid ${pill.bd}` }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: pill.c }} />
                          {level.charAt(0) + level.slice(1).toLowerCase().replace('_', ' ')}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                        <RingGauge pct={readinessData.data.readinessScore} color={gaugeColor}>
                          <span style={{ fontFamily: MONO, fontSize: 25, fontWeight: 700, color: TEXT, letterSpacing: '-.02em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                            {readinessData.data.readinessScore}
                          </span>
                          <span style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>/ 100</span>
                        </RingGauge>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          {/* Full, unmodified reasoning string — never trimmed on the frontend. */}
                          <p style={{ fontSize: 13, color: SUB, lineHeight: 1.6, margin: '0 0 14px' }}>{readinessData.data.reasoning}</p>
                          <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 10.5, color: MUTED }}>Human review required before action.</span>
                            <span style={{ fontSize: 10.5, color: MUTED, fontFamily: MONO }}>Confidence: {confidenceLabel(readinessData.data.confidence)}</span>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })() : (
                  <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>Workforce readiness not available at this time.</p>
                )}
              </div>
            </div>

            {/* Attrition Risk */}
            <div style={{ ...CARD, borderRadius: 12, position: 'relative', overflow: 'hidden' }}>
              <div aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: AMBER }} />
              <div style={{ padding: '26px 26px 22px' }}>
                {attritionFetchFailed ? (
                  <p style={{ fontSize: 13, color: SUB, margin: 0 }}>Attrition risk unavailable. Reload the dashboard to try again.</p>
                ) : attritionData !== null ? (() => {
                  const level = attritionData.data.attritionRiskLevel;
                  const pill = ATTRITION_LEVEL_PILL[level] ?? ATTRITION_LEVEL_PILL.MEDIUM!;
                  const gaugeColor = ATTRITION_LEVEL_COLOR[level] ?? AMBER;
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ width: 30, height: 30, borderRadius: 8, background: '#fffbeb', color: AMBER, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} aria-hidden="true">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /><polyline points="17 18 23 18 23 12" /></svg>
                          </span>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT }}>Attrition Risk</span>
                        </div>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, background: pill.bg, color: pill.c, border: `1px solid ${pill.bd}` }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: pill.c }} />
                          {level.charAt(0) + level.slice(1).toLowerCase()}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                        <RingGauge pct={attritionData.data.attritionScore} color={gaugeColor}>
                          <span style={{ fontFamily: MONO, fontSize: 25, fontWeight: 700, color: TEXT, letterSpacing: '-.02em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                            {attritionData.data.attritionScore}
                          </span>
                          <span style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>/ 100</span>
                        </RingGauge>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <p style={{ fontSize: 13, color: SUB, lineHeight: 1.6, margin: '0 0 14px' }}>{attritionData.data.reasoning}</p>
                          <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 10.5, color: MUTED }}>Human review required before action.</span>
                            <span style={{ fontSize: 10.5, color: MUTED, fontFamily: MONO }}>Confidence: {confidenceLabel(attritionData.data.confidence)}</span>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })() : (
                  <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>Attrition risk not available at this time.</p>
                )}
              </div>
            </div>

          </div>

          {/* ── Capacity & Throughput — the four ungoverned operating metrics,
               grouped by the question each pair answers rather than listed
               flat. No color judgment applied to Coverage/Time-to-Fill/
               Hiring-Velocity — no governed threshold exists for them.
               Vacancy Rate's bar is amber purely to echo the number visually
               being the larger of the pair, not a risk classification. */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: SUB }}>Capacity &amp; Throughput</span>
            <span style={{ fontSize: 11, color: MUTED }}>Operating metrics, no threshold applied</span>
          </div>
          {executiveMetricsFetchFailed ? (
            <p style={{ fontSize: 13, color: SUB, marginBottom: 20 }}>Workforce metrics unavailable. Reload the dashboard to try again.</p>
          ) : executiveMetricsData === null ? (
            <p style={{ fontSize: 13, color: MUTED, marginBottom: 20 }}>Workforce metrics not available at this time.</p>
          ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 38 }}>

            {/* Staffing Capacity */}
            <div style={{ ...CARD, borderRadius: 12 }}>
              <div style={{ padding: '16px 24px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 30, height: 30, borderRadius: 8, background: CANVAS, border: `1px solid ${BORDER}`, color: SUB, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M3 9h6" /></svg>
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Staffing Capacity</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>How full is the structure right now</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                <div style={{ padding: '22px 24px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>Coverage Rate</div>
                  <div style={{ fontFamily: MONO, fontSize: 25, fontWeight: 700, letterSpacing: '-.02em', color: TEXT, marginBottom: 10, fontVariantNumeric: 'tabular-nums' }}>{fmtExecutiveMetric(coverage)}</div>
                  <div style={{ height: 4, borderRadius: 3, background: BORDER, overflow: 'hidden', marginBottom: 10 }}>
                    <div style={{ height: '100%', borderRadius: 3, background: BLUE, width: `${coverageBarPct}%` }} />
                  </div>
                  <p style={{ fontSize: 11, color: MUTED, lineHeight: 1.5, margin: 0 }}>Active positions filled by an active employee.</p>
                </div>
                <div style={{ padding: '22px 24px', borderLeft: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>Vacancy Rate</div>
                  <div style={{ fontFamily: MONO, fontSize: 25, fontWeight: 700, letterSpacing: '-.02em', color: TEXT, marginBottom: 10, fontVariantNumeric: 'tabular-nums' }}>{fmtExecutiveMetric(vacancy)}</div>
                  <div style={{ height: 4, borderRadius: 3, background: BORDER, overflow: 'hidden', marginBottom: 10 }}>
                    <div style={{ height: '100%', borderRadius: 3, background: AMBER, width: `${vacancyBarPct}%` }} />
                  </div>
                  <p style={{ fontSize: 11, color: MUTED, lineHeight: 1.5, margin: 0 }}>Open vacancies relative to active positions.</p>
                </div>
              </div>
            </div>

            {/* Hiring Throughput */}
            <div style={{ ...CARD, borderRadius: 12 }}>
              <div style={{ padding: '16px 24px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 30, height: 30, borderRadius: 8, background: CANVAS, border: `1px solid ${BORDER}`, color: SUB, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Hiring Throughput</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>How fast the pipeline is moving</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                <div style={{ padding: '22px 24px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>Time To Fill</div>
                  <div style={{ fontFamily: MONO, fontSize: 25, fontWeight: 700, letterSpacing: '-.02em', color: TEXT, marginBottom: 10, fontVariantNumeric: 'tabular-nums' }}>{fmtExecutiveMetric(timeToFill)}</div>
                  <p style={{ fontSize: 11, color: MUTED, lineHeight: 1.5, margin: 0 }}>
                    {timeToFill ? `Confidence: ${confidenceLabel(timeToFill.confidence)}${timeToFill.windowDays ? ` · ${timeToFill.windowDays}-day window` : ''}` : '—'}
                  </p>
                </div>
                <div style={{ padding: '22px 24px', borderLeft: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>Hiring Velocity</div>
                  <div style={{ fontFamily: MONO, fontSize: 25, fontWeight: 700, letterSpacing: '-.02em', color: TEXT, marginBottom: 10, fontVariantNumeric: 'tabular-nums' }}>{fmtExecutiveMetric(hiringVelocity)}</div>
                  <p style={{ fontSize: 11, color: MUTED, lineHeight: 1.5, margin: 0 }}>
                    {hiringVelocity ? `Confidence: ${confidenceLabel(hiringVelocity.confidence)}${hiringVelocity.windowDays ? ` · ${hiringVelocity.windowDays}-day window` : ''}` : '—'}
                  </p>
                </div>
              </div>
            </div>

          </div>
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 11, color: MUTED, lineHeight: 1.65, borderTop: `1px solid ${BORDER}`, paddingTop: 20 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            <p style={{ margin: 0 }}>
              <strong style={{ color: SUB }}>Data governance.</strong> All metrics shown are tenant-wide aggregates, deterministic, and computed from authorized workforce data. No individual employee, candidate, or department-level detail exists on this page. Department-level and per-vacancy views are reserved for System Administrator, HR Director, and Workforce Planner roles by design.
            </p>
          </div>

        </main>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  // Role resolution before fetch group so forbidden roles skip the intelligence endpoint
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
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
  // GD-M34-1 Decision 4/12: same allowed-role list as Workforce Readiness/
  // Attrition Risk (SA/HRD/WP/Executive User), kept as its own boolean per
  // the established one-boolean-per-signal discipline.
  const canSeeExecutiveMetrics = roles.some(r =>
    ['System Administrator', 'HR Director', 'Workforce Planner', 'Executive User'].includes(r)
  );
  // Platform-wide role navigation and dashboard content cleanup: resource-
  // specific capability booleans replacing the single canSeeOperationalDashboard
  // bucket. Each boolean mirrors one backend @RequireRoles() list exactly
  // (verified against the controllers during the role navigation audit), so a
  // dashboard fetch or section is gated on the same RBAC boundary the
  // underlying endpoint enforces — no bucket implies broader access than a
  // role actually has, and no role sees a dash-only card or false empty state
  // caused by an RBAC denial rather than real absence of data.
  // employee.controller.ts — GET /employees, GET /employees/:id
  const canSeeEmployeeData = roles.some(r =>
    ['System Administrator', 'HR Director', 'Workforce Planner', 'Hiring Manager', 'Compliance Officer'].includes(r)
  );
  // position.controller.ts + vacancy.controller.ts — GET endpoints share the
  // identical role list for both resources, so one boolean covers Active
  // Positions, Unfilled Vacancies, Critical Vacancies, and Open Vacancies.
  const canSeePositionVacancyData = roles.some(r =>
    ['System Administrator', 'HR Director', 'Workforce Planner'].includes(r)
  );
  // application/interview/offer.controller.ts — GET endpoints (Recruiting Pipeline panel)
  const canSeeRecruitingPipelineData = roles.some(r =>
    ['System Administrator', 'HR Director', 'Recruiter', 'Compliance Officer'].includes(r)
  );
  // employee-certifications.controller.ts — GET /expiring (Certifications panel)
  const canSeeCertsData = roles.some(r =>
    ['System Administrator', 'HR Director', 'Workforce Planner', 'Compliance Officer'].includes(r)
  );
  // M34 approved Executive User dashboard mockup: a capability check, not a
  // role-name check — true when the caller can see Workforce Metrics but has
  // none of the four operational data capabilities above. Under today's role
  // matrix this is Executive User only, but phrasing it this way means a
  // hypothetical user holding both an operational role and Executive User
  // correctly falls through to the full operational dashboard below (they
  // actually have that access), rather than being routed to the reduced view
  // by role name alone.
  const showExecutiveDashboard = canSeeExecutiveMetrics &&
    !canSeeEmployeeData && !canSeePositionVacancyData && !canSeeRecruitingPipelineData && !canSeeCertsData;
  // Top-level nav visibility (Workforce/Recruiting/Admin/Intelligence links)
  // now lives entirely in PlatformHeader (apps/web/src/components/shared/
  // platform-header.tsx), computed from `roles` — single source of truth for
  // every page/shell rather than a duplicated boolean per file.

  // 26 parallel fetches — allSettled so no single failure crashes the page
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
    r25,                     // intelligence: executive metrics (only fetched for allowed roles)
  ] = await Promise.allSettled([
    // Platform-wide dashboard content cleanup: each fetch below is gated by
    // the specific resource capability that backs its section, not a shared
    // bucket — gated at the fetch call site, not just at render time, so no
    // guaranteed-403 request is ever issued for a section that will never be
    // shown (same discipline already used for the intelligence fetches below).
    canSeeEmployeeData
      ? serverFetch<Count>('/api/v1/employees?employmentStatus=ACTIVE&pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeeEmployeeData
      ? serverFetch<Count>('/api/v1/employees?employmentStatus=PENDING_ONBOARDING&pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeeEmployeeData
      ? serverFetch<Count>('/api/v1/employees?employmentStatus=ON_LEAVE&pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeeEmployeeData
      ? serverFetch<Count>('/api/v1/employees?employmentStatus=SUSPENDED&pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeeEmployeeData
      ? serverFetch<Count>('/api/v1/employees?employmentStatus=SEPARATED&pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeePositionVacancyData
      ? serverFetch<Count>('/api/v1/positions?status=ACTIVE&pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeePositionVacancyData
      ? serverFetch<Count>('/api/v1/vacancies?status=OPEN&pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeePositionVacancyData
      ? serverFetch<Count>('/api/v1/vacancies?status=IN_RECRUITMENT&pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeePositionVacancyData
      ? serverFetch<Count>('/api/v1/vacancies?priority=CRITICAL&pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeeRecruitingPipelineData
      ? serverFetch<Count>('/api/v1/applications?status=SCREENING&pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeeRecruitingPipelineData
      ? serverFetch<Count>('/api/v1/applications?status=EVALUATION&pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeeRecruitingPipelineData
      ? serverFetch<Count>('/api/v1/applications?status=INTERVIEW&pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeeRecruitingPipelineData
      ? serverFetch<Count>('/api/v1/applications?status=OFFER&pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeeRecruitingPipelineData
      ? serverFetch<Count>('/api/v1/applications?status=HIRED&pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeeRecruitingPipelineData
      ? serverFetch<Count>('/api/v1/applications?pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeeRecruitingPipelineData
      ? serverFetch<Count>('/api/v1/interviews?status=SCHEDULED&pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeeRecruitingPipelineData
      ? serverFetch<Count>('/api/v1/offers?status=SENT&pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeeRecruitingPipelineData
      ? serverFetch<Count>('/api/v1/offers?status=ACCEPTED&pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeeRecruitingPipelineData
      ? serverFetch<Count>('/api/v1/offers?status=DECLINED&pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeePositionVacancyData
      ? serverFetch<VacancyListRes>('/api/v1/vacancies?status=OPEN&pageSize=3').catch(() => null)
      : Promise.resolve(null),
    canSeeCertsData
      ? serverFetch<CertsRes>('/api/v1/employee-certifications/expiring?withinDays=30&pageSize=3').catch(() => null)
      : Promise.resolve(null),
    canSeePositionVacancyData
      ? serverFetch<Count>('/api/v1/positions?pageSize=1').catch(() => null)
      : Promise.resolve(null),
    canSeeVacancyRisk
      ? serverFetch<VacancyRiskRes>('/api/v1/intelligence/vacancy-risk?pageSize=5')
      : Promise.resolve(null),
    canSeeWorkforceReadiness
      ? serverFetch<WorkforceReadinessRes>('/api/v1/intelligence/workforce-readiness')
      : Promise.resolve(null),
    canSeeAttritionRisk
      ? serverFetch<AttritionRiskRes>('/api/v1/intelligence/attrition-risk')
      : Promise.resolve(null),
    canSeeExecutiveMetrics
      ? serverFetch<ExecutiveMetricsRes>('/api/v1/intelligence/executive-metrics')
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
  const executiveMetricsData        = settled<ExecutiveMetricsRes>(r25);
  const executiveMetricsFetchFailed = canSeeExecutiveMetrics && r25.status === 'rejected';

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

  // M34 approved Executive User dashboard mockup — a dedicated, intentionally
  // designed view, not the operational dashboard with sections hidden. Owns
  // its own header (Dashboard + Intelligence nav only — no Workforce,
  // Recruiting, or Admin links, since those routes RBAC-403 for this
  // capability profile today) and layout entirely separate from the JSX
  // below, so nothing here can affect SA/HRD/WP/Recruiter/HM/CO rendering.
  if (showExecutiveDashboard) {
    return (
      <ExecutiveDashboardView
        roles={roles}
        pageDate={pageDate}
        readinessData={readinessData}
        readinessFetchFailed={readinessFetchFailed}
        attritionData={attritionData}
        attritionFetchFailed={attritionFetchFailed}
        executiveMetricsData={executiveMetricsData}
        executiveMetricsFetchFailed={executiveMetricsFetchFailed}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: CANVAS, fontFamily: "var(--font-ibm-plex-sans,'IBM Plex Sans',system-ui,sans-serif)" }}>

      {/* ── Header — shared PlatformHeader (polished nav treatment), same
           component as every other authenticated page/shell ── */}
      <PlatformHeader roles={roles} activeItem="dashboard" />

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

          {/* ── KPI ROW — up to 4 cards, per-card gated ───────────────────────
               Platform-wide dashboard content cleanup: Active Workforce depends
               on employee data; Active Positions / Unfilled Vacancies / Critical
               Vacancies depend on position+vacancy data. Each card is gated on
               its own resource capability rather than the whole row on one
               bucket, so a role with partial access (e.g. Hiring Manager: employee
               data only) sees exactly the cards it's authorized for — never a
               dash-only card caused by RBAC denial, per the existing Dashboard
               Data Fidelity Policy (GD-M23-1: "unsupported sections omitted
               entirely"). The row itself (and its eyebrow) is omitted entirely
               when no card would have real data. */}
          {(canSeeEmployeeData || canSeePositionVacancyData) && (
            <>
              <SectionEyebrow label="Operational Snapshot" />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${(canSeeEmployeeData ? 1 : 0) + (canSeePositionVacancyData ? 3 : 0)},1fr)`,
                  gap: 16,
                  marginBottom: 16,
                }}
              >

                {canSeeEmployeeData && (
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
                )}

                {canSeePositionVacancyData && (
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
                )}

                {canSeePositionVacancyData && (
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
                )}

                {canSeePositionVacancyData && (
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
                )}

              </div>
            </>
          )}

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

          {/* ── WORKFORCE METRICS — GD-M34-1 Decisions 12, 21. Own row below the
               three-signal grid above (not interleaved into its column template)
               so the existing Workforce Readiness / Attrition Risk / Vacancy Risk
               Signals layout is byte-for-byte unchanged. Role-gated (SA, HRD, WP,
               Executive User) — same allowed-role list as Workforce Readiness/
               Attrition Risk. Condensed values only — no raw formula math ("6 of
               50" breakdowns); that detail lives on /intelligence only.
               Labeled "Workforce Metrics", not "Executive Metrics" — this card is
               visible to SA/HRD/WP too, not Executive-User-exclusive, and the
               "Executive" framing was confusing on an HR Director's or Workforce
               Planner's own dashboard (M34 dashboard role-rendering correction).
               Backend endpoint/DTO naming (executive-metrics, ExecutiveMetricsRes)
               is unchanged — this is a display-label-only rename. */}
          {canSeeExecutiveMetrics && (
            <div style={{ marginBottom: 16 }}>
              <div style={CARD}>
                <div style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a', padding: '14px 20px', minHeight: 64, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span
                    aria-hidden="true"
                    style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: '#ffffff', border: '1px solid #fde68a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: AMBER }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="20" x2="12" y2="10" />
                      <line x1="18" y1="20" x2="18" y2="4" />
                      <line x1="6" y1="20" x2="6" y2="16" />
                    </svg>
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Workforce Metrics</span>
                </div>
                <div aria-hidden="true" style={{ height: 1, background: 'rgba(217,119,6,.25)' }} />

                {executiveMetricsFetchFailed ? (
                  <p style={{ padding: '20px', fontSize: 13, color: SUB, margin: 0 }}>
                    Workforce metrics unavailable. Reload the dashboard to try again.
                  </p>
                ) : executiveMetricsData !== null ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)' }}>
                    {([
                      { label: 'Vacancy Rate', metric: executiveMetricsData.data.vacancyRate },
                      { label: 'Coverage Rate', metric: executiveMetricsData.data.coverageRate },
                      { label: 'Time To Fill', metric: executiveMetricsData.data.timeToFill },
                      { label: 'Hiring Velocity', metric: executiveMetricsData.data.hiringVelocity },
                    ] as const).map(({ label, metric }, i) => (
                      <div key={label} style={{ padding: '16px 20px', borderLeft: i > 0 ? `1px solid ${BORDER}` : 'none' }}>
                        <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: MUTED, marginBottom: 8 }}>
                          {label}
                        </p>
                        <p style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, color: TEXT, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', margin: 0 }}>
                          {fmtExecutiveMetric(metric)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ padding: '20px', fontSize: 13, color: MUTED, margin: 0 }}>
                    Workforce metrics not available at this time.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── PIPELINE + OPEN VACANCIES — 2/3 + 1/3, independently gated ────
               Platform-wide dashboard content cleanup: Recruiting Pipeline
               depends on recruiting data (applications/interviews/offers);
               Open Vacancies depends on position/vacancy data. Each panel is
               gated on its own resource capability rather than sharing one
               bucket, so a role with only one of the two (e.g. Recruiter: pipeline
               only, no vacancies) sees just the panel it's authorized for —
               never an all-dash progress bar or a false "No open vacancies"
               message (that text means "zero exist", not "you lack access to
               see them"). The row collapses to a single full-width column when
               only one panel applies, and is omitted entirely when neither does. */}
          {(canSeeRecruitingPipelineData || canSeePositionVacancyData) && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: canSeeRecruitingPipelineData && canSeePositionVacancyData ? '2fr 1fr' : '1fr',
              gap: 16,
              marginBottom: 16,
            }}
          >

            {/* Recruiting Pipeline */}
            {canSeeRecruitingPipelineData && (
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
            )}

            {/* Open Vacancies — replaces Position Fill Rate (no fill data available) */}
            {canSeePositionVacancyData && (
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
            )}

          </div>
          )}

          {/* ── WORKFORCE STATUS + CERTIFICATIONS — 1/3 + 2/3, independently gated
               Platform-wide dashboard content cleanup: Workforce Status depends on
               employee data; Certifications depends on certification data. Each
               panel is gated on its own resource capability — a role with only one
               of the two (e.g. Hiring Manager: employee data only, no certs) sees
               just the panel it's authorized for, never an all-dash stat row or a
               broken 0% stacked bar caused by RBAC denial. certsFetchable is kept
               as defense-in-depth alongside the canSeeCertsData fetch gate. */}
          {(canSeeEmployeeData || certsFetchable) && (
          <div style={{ display: 'grid', gridTemplateColumns: canSeeEmployeeData && certsFetchable ? '1fr 2fr' : '1fr', gap: 16 }}>

            {/* Workforce Status */}
            {canSeeEmployeeData && (
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
            )}

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
          )}

        </div>
      </main>
    </div>
  );
}
