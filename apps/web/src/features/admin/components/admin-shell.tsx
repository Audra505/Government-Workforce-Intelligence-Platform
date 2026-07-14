// Shared layout shell for all Admin pages.
// Server Component — reads JWT from session cookie to determine role-gated tab visibility.
// Usage: wrap each admin page's content with <AdminShell activeTab="departments" breadcrumb="Departments">.
// Reference: governance/GD-M25-1.md — Decisions 5, 6, 12

import Link from 'next/link';
import { cookies } from 'next/headers';
import { LogoutButton } from '@/features/auth/logout-button';
import { SESSION_COOKIE } from '@/lib/auth';
import { getSessionRoles } from '@/lib/session';
import { UserIdentityChip } from '@/components/shared/user-identity-chip';

type ActiveTab = 'departments' | 'users';

type Props = {
  activeTab: ActiveTab;
  breadcrumb: string;
  children: React.ReactNode;
};

const NAVY   = '#0c2340';
const CANVAS = '#f8fafc';
const BORDER = '#e2e8f0';
const TEXT   = '#0f172a';
const SUB    = '#475569';
const BLUE   = '#2563eb';

export function AdminShell({ activeTab, breadcrumb, children }: Props) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canAdminRead = roles.includes('System Administrator') || roles.includes('HR Director');
  const canDeptRead  = canAdminRead || roles.includes('Workforce Planner');

  const TABS: { id: ActiveTab; label: string; href: string; visible: boolean }[] = [
    { id: 'users',       label: 'Users',       href: '/admin/users',       visible: canAdminRead },
    { id: 'departments', label: 'Departments',  href: '/admin/departments', visible: canDeptRead  },
  ];

  const visibleTabs = TABS.filter((t) => t.visible);

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ fontFamily: "var(--font-ibm-plex-sans, 'IBM Plex Sans', system-ui, sans-serif)" }}
    >
      {/* Navy header — mirrors WorkforceShell / RecruitingShell (GD-M25-1 D12) */}
      <header style={{ backgroundColor: NAVY }} className="pl-6 pr-10 py-3.5">
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-10">
            <span className="text-base font-semibold tracking-wide" style={{ color: '#ffffff' }}>
              GWIP
            </span>

            {/* Domain nav — Admin active */}
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
                className="rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-white/50 transition-all hover:bg-white/[0.08] hover:text-white/[0.85]"
              >
                Recruiting
              </Link>
              <Link
                href="/admin/departments"
                className="rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-white transition-all"
                style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}
              >
                Admin
              </Link>
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

      {/* Page canvas */}
      <main className="flex-1" style={{ backgroundColor: CANVAS }}>
        <div className="mx-auto max-w-[1200px] px-6 pt-5 pb-12">
          {/* Breadcrumb */}
          <nav className="mb-4 flex items-center gap-1.5 text-xs" aria-label="Breadcrumb" style={{ color: SUB }}>
            <span>Admin</span>
            <span aria-hidden="true">›</span>
            <span className="font-medium" style={{ color: TEXT }}>{breadcrumb}</span>
          </nav>

          {/* Section tabs */}
          {visibleTabs.length > 0 && (
            <div className="mb-6 flex items-center border-b" style={{ borderColor: BORDER }}>
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
