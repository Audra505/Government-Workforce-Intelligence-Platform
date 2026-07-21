// Shared layout shell for all Recruiting pages.
// Server Component — no data fetching; renders the navy header, domain nav,
// breadcrumb row, and inline section tabs.
// Usage: wrap each recruiting page's content with <RecruitingShell activeTab="candidates" breadcrumb="Candidates">.
// Reference: governance/GD-M20-1.md — Decision 4 (inline nav), Decision 16 (design system)
// M25A: Admin nav link added for SA+HRD (GD-M25-1 D5, D6).

import Link from 'next/link';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/auth';
import { getSessionRoles } from '@/lib/session';
import { PlatformHeader } from '@/components/shared/platform-header';

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
const CANVAS = '#f8fafc';
const BORDER = '#e2e8f0';
const TEXT   = '#0f172a';
const SUB    = '#475569';
const BLUE   = '#2563eb';

export function RecruitingShell({ activeTab, breadcrumb, children, counts }: Props) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ fontFamily: "var(--font-ibm-plex-sans, 'IBM Plex Sans', system-ui, sans-serif)" }}
    >
      {/* Header — shared PlatformHeader (polished nav treatment), same
          component as every other authenticated page/shell */}
      <PlatformHeader roles={roles} activeItem="recruiting" />

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
