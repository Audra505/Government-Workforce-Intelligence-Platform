'use client';

// Renders an ISO timestamp in the VIEWER's own local timezone. This must
// run client-side: the page that uses it (apps/web/src/app/(dashboard)/
// dashboard/page.tsx's "Data as of" line) is a Server Component rendered
// inside the Docker container, whose system clock is UTC regardless of
// where the viewer actually is — formatting the timestamp there showed
// the container's UTC clock face, not the viewer's local time.
//
// Renders nothing until mounted. Computing the local time during the
// initial render would format using the server's timezone for the SSR
// pass and the browser's timezone for hydration, producing a React
// hydration mismatch. Mounting client-only sidesteps that: both the SSR
// output and the first client render are empty, and the correctly-zoned
// time fills in immediately after mount.

import { useEffect, useState } from 'react';

export function LocalTimestamp({ iso }: { iso: string }) {
  const [formatted, setFormatted] = useState<string | null>(null);

  useEffect(() => {
    setFormatted(new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
  }, [iso]);

  if (!formatted) return null;
  return <>{formatted}</>;
}
