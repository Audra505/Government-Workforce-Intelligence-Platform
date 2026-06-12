// Session cookie identity and configuration.
// No next/headers import — safe to import from middleware, Route Handlers, and Server Components.
// Reference: spec/07_security_architecture.md — Session Storage, httpOnly cookie requirement
// Reference: spec/09_frontend_architecture.md — Session Storage: "Memory + Secure Cookie Strategy"

export const SESSION_COOKIE = 'gov-platform-session';

// maxAge matches the JWT accessToken lifetime defined in spec/07 (Token Lifetime: 1 Hour)
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  maxAge: 3600,
  path: '/',
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type BffResponse =
  | { success: true }
  | { success: false; error: { code: string; message: string } };
