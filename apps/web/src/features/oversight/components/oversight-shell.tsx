// Shared layout shell for the M39 audit viewer, under the neutral
// 'oversight' route (not /admin — GD-M39-1 Decision 20).
// Server Component — reads JWT from session cookie to determine access.
// Reference: governance/GD-M39-1.md — Decision 20

import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/auth';
import { getSessionRoles } from '@/lib/session';
import { PlatformHeader } from '@/components/shared/platform-header';

type Props = {
  breadcrumb: string;
  children: React.ReactNode;
};

const CANVAS = '#f8fafc';
const TEXT = '#0f172a';
const SUB = '#475569';

export function OversightShell({ breadcrumb, children }: Props) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ fontFamily: "var(--font-ibm-plex-sans, 'IBM Plex Sans', system-ui, sans-serif)" }}
    >
      <PlatformHeader roles={roles} activeItem="oversight" />

      <main className="flex-1" style={{ backgroundColor: CANVAS }}>
        <div className="mx-auto max-w-[1200px] px-6 pt-5 pb-12">
          <nav className="mb-4 flex items-center gap-1.5 text-xs" aria-label="Breadcrumb" style={{ color: SUB }}>
            <span>Oversight</span>
            <span aria-hidden="true">›</span>
            <span className="font-medium" style={{ color: TEXT }}>{breadcrumb}</span>
          </nav>

          {children}
        </div>
      </main>
    </div>
  );
}

// Server-side page-level role check, mirroring the existing admin/users/
// page.tsx pattern — navigation visibility is never the authorization
// boundary; the API (GD-M39-1 Decision 16) remains authoritative.
export function getOversightAccess(roles: string[]): {
  canRead: boolean;
  canRecover: boolean;
  isComplianceOfficer: boolean;
} {
  const isSystemAdministrator = roles.includes('System Administrator');
  const isComplianceOfficer = roles.includes('Compliance Officer');
  return {
    canRead: isSystemAdministrator || isComplianceOfficer,
    canRecover: isSystemAdministrator,
    isComplianceOfficer,
  };
}
