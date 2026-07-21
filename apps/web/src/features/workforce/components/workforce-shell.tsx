// Shared layout shell for all Workforce pages.
// Server Component — no data fetching; renders the navy header, domain nav,
// breadcrumb row, and inline section tabs.
// Usage: wrap each workforce page's content with <WorkforceShell activeTab="positions" breadcrumb="Positions">.
// Reference: governance/GD-M21-1.md — Decision 3 (shell), Decision 16 (design system)
// M25A: Admin nav link added for SA+HRD (GD-M25-1 D5, D6).

import Link from 'next/link';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/auth';
import { getSessionRoles } from '@/lib/session';
import { PlatformHeader } from '@/components/shared/platform-header';

// GD-M24-1 D4: ActiveTab extended with 'skills' and 'certifications'.
// Canonical tab order: Positions · Vacancies · Employees · Skills · Certifications.
type ActiveTab = 'positions' | 'vacancies' | 'employees' | 'skills' | 'certifications';
type TabCounts = Partial<Record<ActiveTab, number>>;

type Props = {
  activeTab: ActiveTab;
  breadcrumb: string;
  children: React.ReactNode;
  counts?: TabCounts;
};

// GD-M21-1 D16 color palette (matches GD-M20-1 D16)
const CANVAS = '#f8fafc';
const BORDER = '#e2e8f0';
const TEXT   = '#0f172a';
const SUB    = '#475569';
const BLUE   = '#2563eb';

export function WorkforceShell({ activeTab, breadcrumb, children, counts }: Props) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];

  // Sub-tab visibility mirrors each backend GET endpoint's exact @RequireRoles
  // list (position/vacancy.controller.ts: SA/HRD/WP only; employee.controller.ts:
  // SA/HRD/WP/HM/CO; skill/certification.controller.ts: SA/HRD/WP/CO) so a role
  // reaching this shell (SA/HRD/WP/HM/CO) never sees a tab that leads to a 403.
  const canSeePositionsVacancies = roles.some((r) =>
    ['System Administrator', 'HR Director', 'Workforce Planner'].includes(r)
  );
  const canSeeEmployeesTab = roles.some((r) =>
    ['System Administrator', 'HR Director', 'Workforce Planner', 'Hiring Manager', 'Compliance Officer'].includes(r)
  );
  const canSeeSkillsCertsTab = roles.some((r) =>
    ['System Administrator', 'HR Director', 'Workforce Planner', 'Compliance Officer'].includes(r)
  );

  const TABS: { id: ActiveTab; label: string; href: string; visible: boolean }[] = [
    { id: 'positions',      label: 'Positions',      href: '/workforce/positions',      visible: canSeePositionsVacancies },
    { id: 'vacancies',      label: 'Vacancies',      href: '/workforce/vacancies',      visible: canSeePositionsVacancies },
    { id: 'employees',      label: 'Employees',      href: '/workforce/employees',      visible: canSeeEmployeesTab       },
    { id: 'skills',         label: 'Skills',         href: '/workforce/skills',         visible: canSeeSkillsCertsTab     },
    { id: 'certifications', label: 'Certifications', href: '/workforce/certifications', visible: canSeeSkillsCertsTab     },
  ];
  const visibleTabs = TABS.filter((t) => t.visible);

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ fontFamily: "var(--font-ibm-plex-sans, 'IBM Plex Sans', system-ui, sans-serif)" }}
    >
      {/* Header — shared PlatformHeader (polished nav treatment), same
          component as every other authenticated page/shell */}
      <PlatformHeader roles={roles} activeItem="workforce" />

      {/* Page canvas */}
      <main className="flex-1" style={{ backgroundColor: CANVAS }}>
        <div className="mx-auto max-w-[1200px] px-6 pt-5 pb-12">
          {/* Breadcrumb */}
          <nav className="mb-4 flex items-center gap-1.5 text-xs" aria-label="Breadcrumb" style={{ color: SUB }}>
            <span>Workforce</span>
            <span aria-hidden="true">›</span>
            <span className="font-medium" style={{ color: TEXT }}>{breadcrumb}</span>
          </nav>

          {/* Inline section tabs — role-visible tabs only (platform-wide role
              navigation audit: a tab that leads to a 403 for this role is
              hidden, mirroring AdminShell's existing visible-flag pattern) */}
          {visibleTabs.length > 0 && (
            <div
              className="mb-6 flex items-center border-b"
              style={{ borderColor: BORDER }}
            >
              {visibleTabs.map((tab) => {
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
          )}

          {children}
        </div>
      </main>
    </div>
  );
}
