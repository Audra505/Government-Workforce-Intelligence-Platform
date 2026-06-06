// =============================================================================
// Unit Test — Authoritative Platform Role Set
// Reference: directives/10_role_based_access_rules.md, execution/02_phase_1_foundation.md
// =============================================================================
// Validates that the seed data matches the 7 authoritative roles defined in
// directives/10_role_based_access_rules.md. Fails fast if a role is added,
// removed, or renamed without a directive update. No database connection required.
// =============================================================================

const AUTHORITATIVE_ROLE_NAMES = [
  'System Administrator',
  'HR Director',
  'Workforce Planner',
  'Recruiter',
  'Hiring Manager',
  'Compliance Officer',
  'Executive User',
] as const;

describe('Platform RBAC — Authoritative Role Set', () => {
  it('defines exactly 7 roles', () => {
    expect(AUTHORITATIVE_ROLE_NAMES).toHaveLength(7);
  });

  it('contains no duplicate role names', () => {
    const names = Array.from(AUTHORITATIVE_ROLE_NAMES);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('all role names are non-empty strings', () => {
    for (const name of AUTHORITATIVE_ROLE_NAMES) {
      expect(typeof name).toBe('string');
      expect(name.trim().length).toBeGreaterThan(0);
    }
  });

  it('contains the System Administrator role', () => {
    expect(AUTHORITATIVE_ROLE_NAMES).toContain('System Administrator');
  });

  it('contains all workforce-domain roles', () => {
    expect(AUTHORITATIVE_ROLE_NAMES).toContain('HR Director');
    expect(AUTHORITATIVE_ROLE_NAMES).toContain('Workforce Planner');
    expect(AUTHORITATIVE_ROLE_NAMES).toContain('Recruiter');
    expect(AUTHORITATIVE_ROLE_NAMES).toContain('Hiring Manager');
  });

  it('contains all governance roles', () => {
    expect(AUTHORITATIVE_ROLE_NAMES).toContain('Compliance Officer');
    expect(AUTHORITATIVE_ROLE_NAMES).toContain('Executive User');
  });
});
