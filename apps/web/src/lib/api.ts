// Server-side authenticated fetch utility.
// Safe to call only from Server Components and Route Handlers — uses next/headers.
// Reference: spec/07_security_architecture.md — SEC-003 JWT transport, SEC-004 Defense in Depth
// Reference: spec/09_frontend_architecture.md — API Integration Strategy

import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/auth';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function serverFetch<T>(path: string): Promise<T> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const base = process.env.API_URL ?? 'http://localhost:3001';

  const res = await fetch(`${base}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new ApiError(res.status, `API request failed with status ${res.status}`);
  }

  return res.json() as Promise<T>;
}
