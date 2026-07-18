'use client';

// Client Component — GD-M32-1 Amendment 1 (Decisions 16-18).
// Owns two pieces of client-side UI state only: which sub-tab is active, and
// which vacancy is selected in the Vacancy Risk master-detail view. All data
// is fetched once, server-side, by the parent page and passed down as props —
// switching tabs or selecting a vacancy never triggers a network request or a
// URL change (Decision 18: "no repeated stacked-card detail layout"; the
// implementation decision that produced this file: client-side state, not
// query params or server round trips, so selection is instant).

import { useState } from 'react';
import type {
  RiskFactor, VacancyRiskItem, VacancyRiskRes, WorkforceReadinessRes, AttritionRiskRes,
} from '../types';
import { FACTOR_MAX, FACTOR_LABEL, confidenceLabel } from '../types';

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

const CARD = {
  background: '#ffffff',
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  boxShadow: SHADOW,
  overflow: 'hidden',
} as const;

const READINESS_CFG: Record<string, { bg: string; c: string; bd: string }> = {
  READY:      { bg: '#f0fdf4', c: GREEN, bd: '#bbf7d0' },
  DEVELOPING: { bg: '#eff6ff', c: BLUE,  bd: 'rgba(37,99,235,.2)' },
  AT_RISK:    { bg: '#fffbeb', c: AMBER, bd: '#fde68a' },
  CRITICAL:   { bg: '#fef2f2', c: RED,   bd: '#fecaca' },
};
const RISK_CFG: Record<string, { bg: string; c: string; bd: string }> = {
  LOW:      { bg: CANVAS,    c: MUTED, bd: BORDER },
  MEDIUM:   { bg: '#eff6ff', c: BLUE,  bd: 'rgba(37,99,235,.2)' },
  HIGH:     { bg: '#fffbeb', c: AMBER, bd: '#fde68a' },
  CRITICAL: { bg: '#fef2f2', c: RED,   bd: '#fecaca' },
};

type Tab = 'workforce-signals' | 'vacancy-risk';

type Props = {
  initialTab: Tab;
  canSeeVacancyRisk: boolean;
  readinessData: WorkforceReadinessRes | null;
  readinessFetchFailed: boolean;
  attritionData: AttritionRiskRes | null;
  attritionFetchFailed: boolean;
  vacancyRiskData: VacancyRiskRes | null;
  vacancyRiskFetchFailed: boolean;
};

export function IntelligenceWorkspace({
  initialTab,
  canSeeVacancyRisk,
  readinessData,
  readinessFetchFailed,
  attritionData,
  attritionFetchFailed,
  vacancyRiskData,
  vacancyRiskFetchFailed,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>(
    initialTab === 'vacancy-risk' && !canSeeVacancyRisk ? 'workforce-signals' : initialTab,
  );

  // Fetched once by the server page and handed down — selecting a different
  // vacancy below never re-fetches this list.
  const vacancyItems = vacancyRiskData?.data.items ?? [];
  const [selectedVacancyId, setSelectedVacancyId] = useState<string | null>(
    vacancyItems[0]?.vacancyId ?? null,
  );
  const selectedVacancy =
    vacancyItems.find((v) => v.vacancyId === selectedVacancyId) ?? vacancyItems[0] ?? null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28, borderBottom: `1px solid ${BORDER}`, margin: '20px 0 24px' }}>
        <TabButton label="Workforce Signals" active={activeTab === 'workforce-signals'} onClick={() => setActiveTab('workforce-signals')} />
        {canSeeVacancyRisk && (
          <TabButton label="Vacancy Risk" active={activeTab === 'vacancy-risk'} onClick={() => setActiveTab('vacancy-risk')} />
        )}
        <span style={{ padding: '10px 2px 12px', fontSize: 13, color: '#cbd5e1', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Department Gap
          <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' as const, color: '#94a3b8', background: '#f1f5f9', border: `1px solid ${BORDER}`, borderRadius: 9999, padding: '1px 7px' }}>
            Soon
          </span>
        </span>
      </div>

      {activeTab === 'workforce-signals' ? (
        <WorkforceSignalsTab
          readinessData={readinessData}
          readinessFetchFailed={readinessFetchFailed}
          attritionData={attritionData}
          attritionFetchFailed={attritionFetchFailed}
        />
      ) : (
        <VacancyRiskTab
          items={vacancyItems}
          fetchFailed={vacancyRiskFetchFailed}
          selectedVacancy={selectedVacancy}
          selectedVacancyId={selectedVacancy?.vacancyId ?? null}
          onSelect={setSelectedVacancyId}
        />
      )}

      <p style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.6, margin: '20px 0 0', paddingTop: 16, borderTop: `1px solid ${BORDER}` }}>
        <strong style={{ color: SUB }}>All scores on this page are deterministic and advisory.</strong>{' '}
        No OpenAI or external model is used anywhere in Phase 4 Intelligence. Human review is required
        before any workforce action.
      </p>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '10px 2px 12px',
        marginBottom: -1,
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        color: active ? TEXT : MUTED,
        borderTop: 'none', borderLeft: 'none', borderRight: 'none',
        borderBottom: active ? `2px solid ${BLUE}` : '2px solid transparent',
        background: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}

function FactorTable({ factors }: { factors: RiskFactor[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.06em', color: MUTED, paddingBottom: 8, borderBottom: `1px solid ${BORDER}` }}>
            Factor
          </th>
          <th style={{ textAlign: 'right', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.06em', color: MUTED, paddingBottom: 8, borderBottom: `1px solid ${BORDER}` }}>
            Pts
          </th>
        </tr>
      </thead>
      <tbody>
        {factors.map((f) => {
          const max = FACTOR_MAX[f.name] ?? f.contribution;
          const pct = max > 0 ? Math.round((f.contribution / max) * 100) : 0;
          return (
            <tr key={f.name}>
              <td style={{ fontSize: 12.5, padding: '10px 0', borderBottom: `1px solid ${BORDER}`, verticalAlign: 'middle' }}>
                <span style={{ fontWeight: 600, color: TEXT }}>{FACTOR_LABEL[f.name] ?? f.name}</span>
                <br />
                <span style={{ color: SUB }}>{f.detail}</span>
              </td>
              <td style={{ padding: '10px 0', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 56, height: 5, background: BORDER, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: AMBER, borderRadius: 3, width: `${pct}%` }} />
                  </div>
                  <span style={{ fontFamily: MONO, fontWeight: 700, color: TEXT, fontSize: 12, width: 48, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {f.contribution}/{max}
                  </span>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SignalTile({
  label, score, level, levelColor, reasoning, fetchFailed, unavailable,
}: {
  label: string;
  score?: number;
  level?: string;
  levelColor?: { bg: string; c: string; bd: string };
  reasoning?: string;
  fetchFailed: boolean;
  unavailable: boolean;
}) {
  return (
    <div style={{ ...CARD, padding: 20 }}>
      <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: MUTED, marginBottom: 12 }}>
        {label}
      </p>
      {fetchFailed ? (
        <p style={{ fontSize: 13, color: SUB }}>Unavailable. Reload to try again.</p>
      ) : unavailable ? (
        <p style={{ fontSize: 13, color: MUTED }}>Not available at this time.</p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
            <span style={{ fontFamily: MONO, fontSize: 30, fontWeight: 700, color: TEXT, letterSpacing: '-.02em' }}>
              {score}
            </span>
            {level && levelColor && (
              <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 9999, letterSpacing: '.04em', textTransform: 'uppercase' as const, whiteSpace: 'nowrap', background: levelColor.bg, color: levelColor.c, border: `1px solid ${levelColor.bd}` }}>
                {level.replace('_', ' ')}
              </span>
            )}
          </div>
          <p style={{ fontSize: 12, color: SUB, lineHeight: 1.5, marginBottom: 14 }}>{reasoning}</p>
          <div style={{ height: 3, borderRadius: 2, background: BORDER, overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 2, background: BLUE, width: `${score ?? 0}%` }} />
          </div>
        </>
      )}
    </div>
  );
}

function WorkforceSignalsTab({
  readinessData, readinessFetchFailed, attritionData, attritionFetchFailed,
}: {
  readinessData: WorkforceReadinessRes | null;
  readinessFetchFailed: boolean;
  attritionData: AttritionRiskRes | null;
  attritionFetchFailed: boolean;
}) {
  const rc = readinessData ? (READINESS_CFG[readinessData.data.readinessLevel] ?? READINESS_CFG.AT_RISK!) : undefined;
  const ac = attritionData ? (RISK_CFG[attritionData.data.attritionRiskLevel] ?? RISK_CFG.MEDIUM!) : undefined;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <SignalTile
          label="Workforce Readiness"
          score={readinessData?.data.readinessScore}
          level={readinessData?.data.readinessLevel}
          levelColor={rc}
          reasoning={readinessData?.data.reasoning}
          fetchFailed={readinessFetchFailed}
          unavailable={!readinessFetchFailed && readinessData === null}
        />
        <SignalTile
          label="Attrition Risk"
          score={attritionData?.data.attritionScore}
          level={attritionData?.data.attritionRiskLevel}
          levelColor={ac}
          reasoning={attritionData?.data.reasoning}
          fetchFailed={attritionFetchFailed}
          unavailable={!attritionFetchFailed && attritionData === null}
        />
      </div>

      {(readinessData || attritionData) && (
        <div style={CARD}>
          <div style={{ padding: '16px 24px', borderBottom: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Factor Contributions</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
              What&apos;s driving each score above, weighted by governed point value
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            <div style={{ padding: '20px 24px' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: AMBER, textTransform: 'uppercase' as const, letterSpacing: '.07em', marginBottom: 6 }}>
                Workforce Readiness
              </p>
              {readinessData ? <FactorTable factors={readinessData.data.factors} /> : (
                <p style={{ fontSize: 12, color: MUTED }}>Not available.</p>
              )}
            </div>
            <div style={{ padding: '20px 24px', borderLeft: `1px solid ${BORDER}` }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: AMBER, textTransform: 'uppercase' as const, letterSpacing: '.07em', marginBottom: 6 }}>
                Attrition Risk
              </p>
              {attritionData ? <FactorTable factors={attritionData.data.factors} /> : (
                <p style={{ fontSize: 12, color: MUTED }}>Not available.</p>
              )}
            </div>
          </div>
          <div style={{ padding: '12px 24px', borderTop: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, background: CANVAS }}>
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED }}>
              {readinessData?.data.formulaVersion ?? '—'} · {attritionData?.data.formulaVersion ?? '—'}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED }}>
              {readinessData ? `Readiness confidence: ${confidenceLabel(readinessData.data.confidence)}` : ''}
              {readinessData && attritionData ? ' · ' : ''}
              {attritionData ? `Attrition confidence: ${confidenceLabel(attritionData.data.confidence)}` : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function VacancyRiskTab({
  items, fetchFailed, selectedVacancy, selectedVacancyId, onSelect,
}: {
  items: VacancyRiskItem[];
  fetchFailed: boolean;
  selectedVacancy: VacancyRiskItem | null;
  selectedVacancyId: string | null;
  onSelect: (id: string) => void;
}) {
  if (fetchFailed) {
    return <p style={{ fontSize: 13, color: SUB }}>Vacancy risk scores unavailable. Reload to try again.</p>;
  }
  if (items.length === 0) {
    return <p style={{ fontSize: 13, color: MUTED }}>No open vacancies scored at this time.</p>;
  }

  // Real, derivable aggregates only — computed here from the same fetched
  // list, not invented (GD-M32-1 Decision 18).
  const highOrCriticalCount = items.filter((v) => v.riskLevel === 'HIGH' || v.riskLevel === 'CRITICAL').length;
  const avgDaysOpen = Math.round(items.reduce((sum, v) => sum + v.daysOpen, 0) / items.length);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div style={{ ...CARD, padding: '18px 20px' }}>
          <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: MUTED, marginBottom: 8 }}>
            High or Critical Risk Vacancies
          </p>
          <p style={{ margin: 0 }}>
            <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 700, color: TEXT, letterSpacing: '-.02em' }}>{highOrCriticalCount}</span>{' '}
            <span style={{ fontSize: 14, color: MUTED, fontWeight: 500 }}>of {items.length} scored</span>
          </p>
        </div>
        <div style={{ ...CARD, padding: '18px 20px' }}>
          <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: MUTED, marginBottom: 8 }}>
            Avg. Days Open (Scored Vacancies)
          </p>
          <p style={{ margin: 0 }}>
            <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 700, color: TEXT, letterSpacing: '-.02em' }}>{avgDaysOpen}</span>
            <span style={{ fontSize: 14, color: MUTED, fontWeight: 500 }}>d</span>
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, alignItems: 'start' }}>
        <div style={CARD}>
          <div style={{ padding: '14px 20px', borderBottom: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Scored Vacancies</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
              {items.length} ranked by computed risk — highest first
            </div>
          </div>
          {items.map((item, i) => {
            const rt = RISK_CFG[item.riskLevel] ?? RISK_CFG.LOW!;
            const isSelected = item.vacancyId === selectedVacancyId;
            const isLast = i === items.length - 1;
            return (
              <button
                key={item.vacancyId}
                type="button"
                onClick={() => onSelect(item.vacancyId)}
                style={{
                  display: 'flex',
                  width: '100%',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '12px 20px',
                  borderTop: 'none', borderRight: 'none',
                  borderBottom: isLast ? 'none' : `1px solid ${BORDER}`,
                  borderLeft: `3px solid ${isSelected ? AMBER : 'transparent'}`,
                  background: isSelected ? '#fffbeb' : 'transparent',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 'inherit',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 12.5, fontWeight: 500, color: TEXT, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.positionTitle}
                  </p>
                  {item.departmentName && (
                    <p style={{ fontSize: 11, color: MUTED, margin: '2px 0 0' }}>{item.departmentName}</p>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 9999, letterSpacing: '.03em', textTransform: 'uppercase' as const, whiteSpace: 'nowrap', background: rt.bg, color: rt.c, border: `1px solid ${rt.bd}` }}>
                    {item.riskLevel}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: TEXT }}>{item.riskScore}</span>
                </div>
              </button>
            );
          })}
        </div>

        {selectedVacancy && (
          <div style={CARD}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '22px 24px 18px', borderBottom: `1px solid ${BORDER}` }}>
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: TEXT, margin: 0 }}>{selectedVacancy.positionTitle}</h3>
                {selectedVacancy.departmentName && (
                  <p style={{ fontSize: 12, color: MUTED, margin: '2px 0 0' }}>{selectedVacancy.departmentName}</p>
                )}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: TEXT }}>
                  <span style={{ fontFamily: MONO }}>{selectedVacancy.riskScore}</span> / 100
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, marginTop: 2, color: (RISK_CFG[selectedVacancy.riskLevel] ?? RISK_CFG.LOW!).c }}>
                  {selectedVacancy.riskLevel}
                </div>
              </div>
            </div>
            <div style={{ padding: '20px 24px' }}>
              <p style={{ fontSize: 13, color: SUB, lineHeight: 1.6, marginBottom: 18 }}>{selectedVacancy.reasoning}</p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.06em', color: MUTED, paddingBottom: 8, borderBottom: `1px solid ${BORDER}` }}>Factor</th>
                    <th style={{ textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.06em', color: MUTED, paddingBottom: 8, borderBottom: `1px solid ${BORDER}` }}>Detail</th>
                    <th style={{ textAlign: 'right', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.06em', color: MUTED, paddingBottom: 8, borderBottom: `1px solid ${BORDER}` }}>Contribution</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedVacancy.factors.map((f) => {
                    const max = FACTOR_MAX[f.name] ?? f.contribution;
                    const pct = max > 0 ? Math.round((f.contribution / max) * 100) : 0;
                    return (
                      <tr key={f.name}>
                        <td style={{ fontSize: 13, fontWeight: 600, color: TEXT, padding: '11px 0', borderBottom: `1px solid ${BORDER}` }}>
                          {FACTOR_LABEL[f.name] ?? f.name}
                        </td>
                        <td style={{ fontSize: 12.5, color: SUB, padding: '11px 0', borderBottom: `1px solid ${BORDER}` }}>{f.detail}</td>
                        <td style={{ padding: '11px 0', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 72, height: 5, background: BORDER, borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ height: '100%', background: AMBER, borderRadius: 3, width: `${pct}%` }} />
                            </div>
                            <span style={{ fontFamily: MONO, fontWeight: 700, color: TEXT, fontSize: 12.5, width: 54, textAlign: 'right', whiteSpace: 'nowrap' }}>
                              {f.contribution}/{max}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '12px 24px', borderTop: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, background: CANVAS }}>
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED }}>{selectedVacancy.formulaVersion}</span>
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED }}>Confidence: {confidenceLabel(selectedVacancy.confidence)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
