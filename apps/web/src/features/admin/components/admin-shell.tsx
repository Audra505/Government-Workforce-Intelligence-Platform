// Shared layout shell for all Admin pages.
// Server Component — reads JWT from session cookie to determine role-gated tab visibility.
// Usage: wrap each admin page's content with <AdminShell activeTab="departments" breadcrumb="Departments">.
// Reference: governance/GD-M25-1.md — Decisions 5, 6, 12

import Link from 'next/link';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/auth';
import { getSessionRoles } from '@/lib/session';
import { PlatformHeader } from '@/components/shared/platform-header';

type ActiveTab = 'departments' | 'users';

type Props = {
  activeTab: ActiveTab;
  breadcrumb: string;
  children: React.ReactNode;
};

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
      {/* Header — shared PlatformHeader (polished nav treatment), same
          component as every other authenticated page/shell */}
      <PlatformHeader roles={roles} activeItem="admin" />

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
