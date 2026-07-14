// GD-M28-1 D7: Non-interactive Server Component showing signed-in user identity.
// Reads the session cookie internally — no props required.
// Placement: before the vertical divider in all 4 authenticated headers (GD-M28-1 D9).
// Returns null when no session or no roles — no UI rendered.

import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/auth';
import { getSessionUser } from '@/lib/session';

// GD-M28-1 D6: Canonical abbreviation map — exported for reuse in future compact displays.
export const ROLE_ABBREVIATIONS: Record<string, string> = {
  'System Administrator': 'SA',
  'HR Director':          'HRD',
  'Workforce Planner':    'WP',
  'Recruiter':            'REC',
  'Hiring Manager':       'HM',
  'Compliance Officer':   'CO',
  'Executive User':       'EU',
};

export function UserIdentityChip() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const user = getSessionUser(token);
  if (!user.roles[0]) return null;

  const primaryRole = user.roles[0];
  const extraCount = user.roles.length - 1;
  const abbr = ROLE_ABBREVIATIONS[primaryRole] ?? primaryRole.slice(0, 3).toUpperCase();
  const badge = extraCount > 0 ? `+${extraCount}` : abbr;
  const displayName = user.firstName || user.email;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color: 'rgba(255,255,255,0.75)',
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      <span>{displayName}</span>
      <span style={{ color: 'rgba(255,255,255,0.4)' }}>·</span>
      <span>{primaryRole}</span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '1px 5px',
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.04em',
          background: 'rgba(147,197,253,0.15)',
          color: '#93c5fd',
        }}
      >
        {badge}
      </span>
    </span>
  );
}
