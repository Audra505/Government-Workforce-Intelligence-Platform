// Shared layout shell for all Recruiting pages.
// Server Component — no data fetching; renders the navy header, domain nav,
// breadcrumb row, and inline section tabs.
// Usage: wrap each recruiting page's content with <RecruitingShell activeTab="candidates" breadcrumb="Candidates">.
// Reference: governance/GD-M20-1.md — Decision 4 (inline nav), Decision 16 (design system)
// M25A: Admin nav link added for SA+HRD (GD-M25-1 D5, D6).

import Link from 'next/link';
import { cookies } from 'next/headers';
import { LogoutButton } from '@/features/auth/logout-button';
import { SESSION_COOKIE } from '@/lib/auth';
import { getSessionRoles } from '@/lib/session';

type ActiveTab = 'candidates' | 'applications' | 'interviews' | 'offers';
type TabCounts = Partial<Record<ActiveTab, number>>;

type Props = {
  activeTab: ActiveTab;
  breadcrumb: string;
  children: React.ReactNode;
  counts?: TabCounts;
};

const TABS: { id: ActiveTab; label: string; href: string }[] = [
  { id: 'candidates',   label: 'Candidates',   href: '/recruiting/candidates' },
  { id: 'applications', label: 'Applications', href: '/recruiting/applications' },
  { id: 'interviews',   label: 'Interviews',   href: '/recruiting/interviews' },
  { id: 'offers',       label: 'Offers',       href: '/recruiting/offers' },
];

// GD-M20-1 D16 color palette
const NAVY   = '#0c2340';
const CANVAS = '#f8fafc';
const BORDER = '#e2e8f0';
const TEXT   = '#0f172a';
const SUB    = '#475569';
const BLUE   = '#2563eb';

export function RecruitingShell({ activeTab, breadcrumb, children, counts }: Props) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canSeeAdmin =
    roles.includes('System Administrator') || roles.includes('HR Director');

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ fontFamily: "var(--font-ibm-plex-sans, 'IBM Plex Sans', system-ui, sans-serif)" }}
    >
      {/* Navy header — GD-M20-1 D16: header background only */}
      <header style={{ backgroundColor: NAVY }} className="pl-6 pr-10 py-3.5">
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-10">
            {/* GWIP wordmark — final agency branding replaces at go-live (GD-M20-1 D16) */}
            <span className="text-base font-semibold tracking-wide" style={{ color: '#ffffff' }}>
              GWIP
            </span>

            {/* Domain nav — exactly Workforce and Recruiting (GD-M20-1 D16) */}
            <nav className="flex items-center gap-0.5" aria-label="Domain navigation">
              <Link
                href="/dashboard"
                className="rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-white/50 transition-all hover:bg-white/[0.08] hover:text-white/[0.85]"
              >
                Dashboard
              </Link>
              <Link
                href="/workforce/employees"
                className="rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-white/50 transition-all hover:bg-white/[0.08] hover:text-white/[0.85]"
              >
                Workforce
              </Link>
              <Link
                href="/recruiting/candidates"
                className="rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-white transition-all"
                style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}
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
            <span aria-hidden="true" style={{ width: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
            <LogoutButton />
          </div>
        </div>
      </header>

      {/* Page canvas */}
      <main className="flex-1" style={{ backgroundColor: CANVAS }}>
        <div className="mx-auto max-w-[1200px] px-6 pt-5 pb-12">
          {/* Breadcrumb — GD-M20-1 D16: "Breadcrumb row below the header" */}
          <nav className="mb-4 flex items-center gap-1.5 text-xs" aria-label="Breadcrumb" style={{ color: SUB }}>
            <span>Recruiting</span>
            <span aria-hidden="true">›</span>
            <span className="font-medium" style={{ color: TEXT }}>{breadcrumb}</span>
          </nav>

          {/* Inline section tabs — Candidates | Applications | Interviews | Offers */}
          <div
            className="mb-6 flex items-center border-b"
            style={{ borderColor: BORDER }}
          >
            {TABS.map((tab) => {
              const isActive = tab.id === activeTab;
              return (
                <Link
                  key={tab.id}
                  href={tab.href}
                  className="mr-6 pb-3 text-sm font-medium transition-colors"
                  style={
                    isActive
                      ? { borderBottom: `2px solid ${BLUE}`, marginBottom: -1, color: TEXT }
                      : { color: SUB }
                  }
                >
                  {tab.label}
                  {counts?.[tab.id] !== undefined && (
                    <span
                      style={{
                        marginLeft: 6,
                        backgroundColor: isActive ? '#dbeafe' : '#f1f5f9',
                        color: isActive ? BLUE : SUB,
                        borderRadius: 10,
                        padding: '1px 7px',
                        fontSize: 11,
                        fontWeight: 600,
                        verticalAlign: 'middle',
                      }}
                    >
                      {counts[tab.id]}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          {children}
        </div>
      </main>
    </div>
  );
}
