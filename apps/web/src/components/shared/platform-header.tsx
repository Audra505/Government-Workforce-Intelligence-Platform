// Shared authenticated-platform header — the polished nav treatment
// (icon-badge wordmark + tagline, role-gated nav, single active-pill
// convention) used consistently across Dashboard, Intelligence, Workforce,
// Recruiting, and Admin. This is the single source of truth for top-level
// nav visibility, so the pages/shells that render this chrome cannot drift
// from each other or from the approved role/nav matrix (platform-wide role
// navigation audit):
//   System Administrator / HR Director: Dashboard, Intelligence, Workforce, Recruiting, Admin
//   Workforce Planner:                  Dashboard, Intelligence, Workforce
//   Recruiter:                          Dashboard, Recruiting
//   Hiring Manager:                     Dashboard, Workforce
//   Compliance Officer:                 Dashboard, Workforce, Recruiting
//   Executive User:                     Dashboard, Intelligence
// Server Component — no hooks, no client state; every caller is itself a
// Server Component that already resolves `roles` from the session cookie.
//
// Nav items are plain <a> tags, not next/link — a deliberate, proven
// pattern already used for login/logout (see login-form.tsx / logout-
// button.tsx) to defeat Next.js's client-side Router Cache. That cache
// keys a rendered RSC payload by URL only; a role-dependent page like
// /dashboard or /intelligence can be soft-navigated back to after a
// different role rendered it earlier in the same tab (e.g. an admin
// session before a subsequent Executive User login), showing that other
// role's nav/content until the cache is invalidated. A plain <a> forces a
// full document reload on every top-level nav click, which starts a fresh
// Router Cache each time — the same trade-off (a full-page transition
// instead of an SPA-style one) already accepted for login/logout, now
// applied to in-app top nav for the same correctness reason.

import { LogoutButton } from '@/features/auth/logout-button';
import { UserIdentityChip } from '@/components/shared/user-identity-chip';

const NAVY = '#0c2340';

export type PlatformNavItem = 'dashboard' | 'intelligence' | 'workforce' | 'recruiting' | 'admin';

const NAV_ITEMS: { id: PlatformNavItem; label: string; href: string }[] = [
  { id: 'dashboard',    label: 'Dashboard',    href: '/dashboard' },
  { id: 'intelligence', label: 'Intelligence', href: '/intelligence' },
  { id: 'workforce',    label: 'Workforce',    href: '/workforce/employees' },
  { id: 'recruiting',   label: 'Recruiting',   href: '/recruiting/candidates' },
  { id: 'admin',        label: 'Admin',        href: '/admin/departments' },
];

export function PlatformHeader({ roles, activeItem }: { roles: string[]; activeItem: PlatformNavItem }) {
  const visible: Record<PlatformNavItem, boolean> = {
    dashboard: true,
    intelligence: roles.some((r) =>
      ['System Administrator', 'HR Director', 'Workforce Planner', 'Executive User'].includes(r)
    ),
    workforce: roles.some((r) =>
      ['System Administrator', 'HR Director', 'Workforce Planner', 'Hiring Manager', 'Compliance Officer'].includes(r)
    ),
    recruiting: roles.some((r) =>
      ['System Administrator', 'HR Director', 'Recruiter', 'Compliance Officer'].includes(r)
    ),
    admin: roles.includes('System Administrator') || roles.includes('HR Director'),
  };

  return (
    <header style={{ backgroundColor: NAVY }} className="px-8 py-3">
      <div className="flex w-full items-center justify-between">
        <div className="flex items-center gap-9">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </span>
            <div>
              <div className="text-[14px] font-semibold tracking-wide text-white leading-tight">GWIP</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.48)', lineHeight: 1.3 }}>Government Workforce Intelligence Platform</div>
            </div>
          </div>
          <nav className="flex items-center gap-0.5" aria-label="Domain navigation">
            {NAV_ITEMS.filter((item) => visible[item.id]).map((item) =>
              item.id === activeItem ? (
                <span
                  key={item.id}
                  className="rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-white"
                  style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}
                >
                  {item.label}
                </span>
              ) : (
                <a
                  key={item.id}
                  href={item.href}
                  className={
                    item.id === 'intelligence'
                      ? 'rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-[#60a5fa] transition-all hover:bg-white/[0.08] hover:text-[#93c5fd]'
                      : 'rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-white/50 transition-all hover:bg-white/[0.08] hover:text-white/[0.85]'
                  }
                >
                  {item.label}
                </a>
              )
            )}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <UserIdentityChip />
          <span aria-hidden="true" style={{ width: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
