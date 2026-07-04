// /recruiting/candidates/[id]/edit — Edit candidate (M22B)
// Server Component: fetches candidate data, gates on RBAC, renders EditCandidateForm.
//
// RBAC gate (UX only — NestJS enforces real RBAC on the BFF PUT):
//   canWrite → System Administrator, HR Director, Recruiter
//   All other roles redirect to the candidate detail page.
//
// Reference: governance/GD-M20-1.md — Decision 2, 3, 6, 7 (Candidates), 16
// Reference: apps/api/src/recruiting/candidate.controller.ts — PUT /candidates/:id (line 206)

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { serverFetch } from '@/lib/api';
import { SESSION_COOKIE } from '@/lib/auth';
import { RecruitingShell } from '@/features/recruiting/components/recruiting-shell';
import { EditCandidateForm } from '@/features/recruiting/components/edit-candidate-form';
import type { CandidateDetailApiResponse } from '@/features/recruiting/types';

const WRITE_ROLES = ['System Administrator', 'HR Director', 'Recruiter'];

function getSessionRoles(token: string): string[] {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { roles?: unknown };
    return Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
  } catch {
    return [];
  }
}

type Props = { params: { id: string } };

export default async function EditCandidatePage({ params }: Props) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canWrite = roles.some((r) => WRITE_ROLES.includes(r));

  if (!canWrite) {
    redirect(`/recruiting/candidates/${params.id}`);
  }

  const response = await serverFetch<CandidateDetailApiResponse>(`/api/v1/candidates/${params.id}`);
  const c = response.data;

  return (
    <RecruitingShell activeTab="candidates" breadcrumb={`Edit — ${c.firstName} ${c.lastName}`}>
      <div className="mb-4">
        <Link
          href={`/recruiting/candidates/${params.id}`}
          className="text-sm hover:underline"
          style={{ color: '#2563eb' }}
        >
          ← {c.firstName} {c.lastName}
        </Link>
      </div>
      <div className="mx-auto" style={{ maxWidth: 520 }}>
        <EditCandidateForm
          candidateId={c.id}
          defaultValues={{
            firstName: c.firstName,
            lastName:  c.lastName,
            email:     c.email,
            phone:     c.phone  ?? '',
            source:    c.source ?? '',
            notes:     c.notes  ?? '',
          }}
        />
      </div>
    </RecruitingShell>
  );
}
