// Password policy per spec/07_security_architecture.md — Password Rules:
//   Minimum 12 characters (enforced via @MinLength(12) at call site)
//   Must contain: uppercase, lowercase, digit, special character
//
// Special character is defined as any character that is not a letter, digit, or whitespace.
// No curated character list is used — the spec does not define one.
//
// Known Phase 1 gaps (deferred — no infrastructure available):
//   - Common password prohibition: requires lookup service
//   - Previously used password prohibition: requires password history table
//
// Import this constant in every DTO that accepts a new password value.
// Do NOT redefine the regex independently in other files.
export const PASSWORD_POLICY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d\s])/;

export const PASSWORD_POLICY_MESSAGE =
  'password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character';
