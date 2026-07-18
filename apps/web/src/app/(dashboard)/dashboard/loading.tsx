// Suspense fallback shown while the Dashboard Server Component's ~25 parallel
// fetches resolve. Mirrors the current header/nav and page shell exactly so it
// never reads as a different, older version of the app — this file previously
// carried a pre-M25/M32 nav (no Intelligence, no Admin) and an old-style plain
// text nav, which is what produced a visible "old design, then current design"
// flash on every dashboard load slow enough to trigger it.

import type { CSSProperties } from 'react';

const NAVY   = '#0c2340';
const CANVAS = '#f8fafc';
const BORDER = '#e2e8f0';

function Bone({ w, h, style }: { w: number | string; h: number; style?: CSSProperties }) {
  return (
    <div
      className="animate-pulse rounded"
      style={{ width: w, height: h, backgroundColor: BORDER, ...style }}
    />
  );
}

function CardBone({ h = 140 }: { h?: number }) {
  return (
    <div
      className="animate-pulse"
      style={{ height: h, background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: 8 }}
    />
  );
}

export default function DashboardLoading() {
  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: CANVAS, fontFamily: "var(--font-ibm-plex-sans,'IBM Plex Sans',system-ui,sans-serif)" }}
    >
      {/* Header — identical structure/classNames to dashboard/page.tsx so there is
          no visible swap when the real page replaces this fallback. Nav items are
          role-blind here (this fallback has no session/cookie access), so all of
          Intelligence/Workforce/Recruiting/Admin are shown; a role without access
          to one of them sees it for a single transient frame at most. */}
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
              <span className="rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-[#60a5fa]">
                Intelligence
              </span>
              <span className="rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-white/50">
                Workforce
              </span>
              <span className="rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-white/50">
                Recruiting
              </span>
              <span className="rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-white/50">
                Admin
              </span>
            </nav>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 72px' }}>
          {/* Page heading */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28 }}>
            <div>
              <Bone w={140} h={28} style={{ marginBottom: 6 }} />
              <Bone w={180} h={14} />
            </div>
          </div>

          {/* Operational Snapshot — 4 KPI tiles */}
          <Bone w={140} h={11} style={{ marginBottom: 10 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse bg-white" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: '20px' }}>
                <Bone w={90} h={10} style={{ marginBottom: 10 }} />
                <Bone w={48} h={30} style={{ marginBottom: 8 }} />
                <Bone w={110} h={10} />
              </div>
            ))}
          </div>

          {/* Workforce Intelligence — stacked left (1fr), wide right (1.4fr) — same
              ratio as the real dashboard's condensed-cards-left / Vacancy Risk-right
              layout. */}
          <Bone w={150} h={11} style={{ marginBottom: 10 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 16, marginBottom: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <CardBone h={150} />
              <CardBone h={150} />
            </div>
            <CardBone h={316} />
          </div>

          {/* Lower sections */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <CardBone h={220} />
            <CardBone h={220} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <CardBone h={220} />
            <CardBone h={220} />
          </div>
        </div>
      </main>
    </div>
  );
}
