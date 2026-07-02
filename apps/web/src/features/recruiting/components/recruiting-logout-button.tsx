'use client';

// Sign-out button styled for the recruiting navy header (#0c2340).
// Uses the same /api/auth/logout BFF endpoint as LogoutButton but with
// white text appropriate for the dark header background.
// LogoutButton (features/auth/logout-button.tsx) is unchanged — it remains
// in use by the existing workforce pages.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RecruitingLogoutButton() {
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
