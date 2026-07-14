// Shared JWT session role parsing utility.
// Extracted from per-page getSessionRoles() definitions in Workforce list and detail pages.
// Used by Workforce pages in M21B (shell adoption) and available for future use.
// Reference: governance/GD-M21-1.md — Decision 9

export function getSessionRoles(token: string): string[] {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { roles?: unknown };
    return Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
  } catch {
    return [];
  }
}

// GD-M28-1 D4: Full identity extracted from the JWT payload.
// All fields default to empty string/array when absent — never throws.
// Prefer this over getSessionRoles() for new code that needs more than role names.
export interface SessionUser {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
}

export function getSessionUser(token: string): SessionUser {
  try {
    const raw = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as {
      sub?: unknown;
      email?: unknown;
      firstName?: unknown;
      lastName?: unknown;
      roles?: unknown;
    };
    return {
      userId:    typeof raw.sub       === 'string' ? raw.sub       : '',
      email:     typeof raw.email     === 'string' ? raw.email     : '',
      firstName: typeof raw.firstName === 'string' ? raw.firstName : '',
      lastName:  typeof raw.lastName  === 'string' ? raw.lastName  : '',
      roles:     Array.isArray(raw.roles) ? (raw.roles as string[]) : [],
    };
  } catch {
    return { userId: '', email: '', firstName: '', lastName: '', roles: [] };
  }
}
