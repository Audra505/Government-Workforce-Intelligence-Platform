'use client';

// Unified sign-out button for the platform navy header (#0c2340).
// Used by WorkforceShell and RecruitingShell (GD-M21-1 D11).
// Replaces the previous shadcn ghost-button variant which was styled for light headers.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  async function handleLogout() {
    setIsLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  }

  return (
    <button
      onClick={handleLogout}
      disabled={isLoading}
      className="text-sm transition-colors disabled:opacity-50"
      style={{ color: 'rgba(255,255,255,0.7)' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#ffffff'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.7)'; }}
    >
      {isLoading ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
