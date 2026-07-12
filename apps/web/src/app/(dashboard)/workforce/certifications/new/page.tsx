// Create Certification page — Server Component (no pre-fetch needed for this form).
// Reference: governance/GD-M24-1.md — Decision 1, 3

import Link from 'next/link';
import { WorkforceShell } from '@/features/workforce/components/workforce-shell';
import { CreateCertificationForm } from '@/features/workforce/components/create-certification-form';

export default function NewCertificationPage() {
  return (
    <WorkforceShell activeTab="certifications" breadcrumb="New Certification">
      <div className="mb-6">
        <Link
          href="/workforce/certifications"
          className="text-sm hover:underline"
          style={{ color: '#2563eb' }}
        >
          ← Certifications
        </Link>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">Create Certification</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a certification to the catalog. Certifications can then be assigned to employees.
        </p>
      </div>

      <div className="max-w-lg">
        <CreateCertificationForm />
      </div>
    </WorkforceShell>
  );
}
