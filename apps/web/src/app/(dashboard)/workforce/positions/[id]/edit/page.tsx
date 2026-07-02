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
import { serverFetch, ApiError } from '@/lib/api';
import { WorkforceShell } from '@/features/workforce/components/workforce-shell';
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
    <WorkforceShell activeTab="positions" breadcrumb="Edit Position">
      <div className="mb-6">
        <Link
          href={`/workforce/positions/${position.id}`}
          className="text-sm hover:underline"
          style={{ color: '#2563eb' }}
        >
          ← Position
        </Link>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">
          Edit Position — {position.title}
        </h2>
      </div>

      <div className="max-w-lg">
        <EditPositionForm position={position} />
      </div>
    </WorkforceShell>
  );
}
