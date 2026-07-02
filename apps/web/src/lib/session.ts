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
