import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@/lib/auth';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionCookie = cookies().get(SESSION_COOKIE)?.value;

  if (!sessionCookie) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-background">
      {children}
    </div>
  );
}
