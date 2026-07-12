// Edit Certification page — Server Component.
// Fetches certification by ID; renders EditCertificationForm.
// notFound() on 404 or 400 — certification not found or invalid UUID.
// Reference: governance/GD-M24-1.md — Decision 1, 3

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverFetch, ApiError } from '@/lib/api';
import { WorkforceShell } from '@/features/workforce/components/workforce-shell';
import { EditCertificationForm } from '@/features/workforce/components/edit-certification-form';
import type { CertificationDetailApiResponse } from '@/features/workforce/types';

type Props = { params: { id: string } };

export default async function EditCertificationPage({ params }: Props) {
  let response: CertificationDetailApiResponse;

  try {
    response = await serverFetch<CertificationDetailApiResponse>(`/api/v1/certifications/${params.id}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
      notFound();
    }
    throw err;
  }

  const certification = response.data;

  return (
    <WorkforceShell activeTab="certifications" breadcrumb="Edit Certification">
      <div className="mb-6">
        <Link
          href="/workforce/certifications"
          className="text-sm hover:underline"
          style={{ color: '#2563eb' }}
        >
          ← Certifications
        </Link>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">
          Edit Certification — {certification.name}
        </h2>
      </div>

      <div className="max-w-lg">
        <EditCertificationForm certification={certification} />
      </div>
    </WorkforceShell>
  );
}
