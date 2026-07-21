'use client';

// Unified sign-out button for the platform navy header (#0c2340).
// Used by WorkforceShell and RecruitingShell (GD-M21-1 D11).
// Replaces the previous shadcn ghost-button variant which was styled for light headers.

import { useState } from 'react';

export function LogoutButton() {
  const [isLoading, setIsLoading] = useState(false);

  async function handleLogout() {
    setIsLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      // Hard navigation, not router.push — see login-form.tsx for why:
      // Next.js's client-side Router Cache can otherwise serve a stale RSC
      // payload for the next person to log in on this tab. A full page load
      // discards it entirely.
      window.location.href = '/login';
    }
  }

  return (
    <button
      onClick={handleLogout}
      disabled={isLoading}
      className="rounded-[5px] px-[13px] py-[6px] text-[13px] font-medium text-white/50 transition-all hover:bg-white/[0.08] hover:text-white/[0.85] disabled:opacity-50"
    >
      {isLoading ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
