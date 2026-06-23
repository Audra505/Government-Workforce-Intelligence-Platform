// Edit Position page — Server Component.
// Fetches position by ID; renders EditPositionForm.
// notFound() on 404 or 400 — position not found or invalid UUID.
// CLOSED positions cannot be edited — redirected to detail page.
// Only SA + HR Director should reach this page; NestJS enforces RBAC on PATCH submission.
// Status field is intentionally absent from the edit form — lifecycle actions control transitions.
// Reference: directives/02_position_management_rules.md — POS-AUTH-002
// Reference: governance/GD-PHASE2-CLOSURE-002.md — Decision 3 (status via lifecycle only)

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { LogoutButton } from '@/features/auth/logout-button';
import { serverFetch, ApiError } from '@/lib/api';
import { EditPositionForm } from '@/features/workforce/components/edit-position-form';
import type { PositionDetailApiResponse } from '@/features/workforce/types';

type Props = { params: { id: string } };

export default async function EditPositionPage({ params }: Props) {
  let response: PositionDetailApiResponse;

  try {
    response = await serverFetch<PositionDetailApiResponse>(`/api/v1/positions/${params.id}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
      notFound();
    }
    throw err;
  }

  const position = response.data;

  // CLOSED positions are terminal — redirect to detail page
  if (position.status === 'CLOSED') {
    redirect(`/workforce/positions/${params.id}`);
  }

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
        <div className="mb-6">
          <Link
            href={`/workforce/positions/${position.id}`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Back to Position
          </Link>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">
            Edit Position — {position.title}
          </h2>
        </div>

        <div className="max-w-lg">
          <EditPositionForm position={position} />
        </div>
      </main>
    </div>
  );
}
