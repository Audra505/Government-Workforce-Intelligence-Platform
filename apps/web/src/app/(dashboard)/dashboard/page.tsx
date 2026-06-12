import { LogoutButton } from '@/features/auth/logout-button';

export default function DashboardPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">
            Government Workforce Intelligence Platform
          </h1>
          <LogoutButton />
        </div>
      </header>
      <main className="flex-1 p-6">
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <p className="mt-2 text-muted-foreground">
          Workforce analytics — available in Phase 2.
        </p>
      </main>
    </div>
  );
}
