// /recruiting/applications/new — Create application form
// M20A stub: routing confirmed. Create form implemented in M20C.
// Reference: governance/GD-M20-1.md — Decision 2, Decision 3 (POST /applications)

export default function NewApplicationPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">
            Government Workforce Intelligence Platform
          </h1>
        </div>
      </header>
      <main className="flex-1 p-6">
        <p className="text-sm text-muted-foreground">New Application</p>
      </main>
    </div>
  );
}
