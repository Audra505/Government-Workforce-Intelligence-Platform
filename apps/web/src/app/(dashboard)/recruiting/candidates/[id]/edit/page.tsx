// /recruiting/candidates/[id]/edit — Edit candidate
// M20A stub: routing placeholder only. Edit form not yet implemented.
// Reference: governance/GD-M20-1.md — Decision 3 (PATCH /candidates/:id)

type Props = {
  params: { id: string };
};

export default function EditCandidatePage({ params }: Props) {
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
        <p className="text-sm text-muted-foreground">Edit Candidate — {params.id}</p>
      </main>
    </div>
  );
}
