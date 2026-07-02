// /recruiting/candidates/new — Create candidate form (M20C Batch 2)
// Server Component: no data pre-fetch required; form has no server-side dependencies.
// RecruitingShell provides the navy header, domain nav, breadcrumb, and section tabs.
// CreateCandidateForm is a Client Component that owns form state and BFF submission.
// Reference: governance/GD-M20-1.md — Decision 2 (/recruiting/candidates/new), 3 (POST BFF), 7 (Candidates)

import Link from 'next/link';
import { RecruitingShell } from '@/features/recruiting/components/recruiting-shell';
import { CreateCandidateForm } from '@/features/recruiting/components/create-candidate-form';

const BLUE = '#2563eb';
const TEXT = '#0f172a';
const SUB  = '#475569';

export default function NewCandidatePage() {
  return (
    <RecruitingShell activeTab="candidates" breadcrumb="New Candidate">
      <div className="mb-6">
        <Link
          href="/recruiting/candidates"
          className="text-sm hover:underline"
          style={{ color: BLUE }}
        >
          ← Candidates
        </Link>

        <h2
          className="mt-3 text-2xl font-bold tracking-tight"
          style={{ color: TEXT }}
        >
          New Candidate
        </h2>
        <p className="mt-1 text-sm" style={{ color: SUB }}>
          Create a new candidate record. Fields marked with an asterisk are required.
        </p>
      </div>

      <div style={{ maxWidth: 520 }}>
        <CreateCandidateForm />
      </div>
    </RecruitingShell>
  );
}
