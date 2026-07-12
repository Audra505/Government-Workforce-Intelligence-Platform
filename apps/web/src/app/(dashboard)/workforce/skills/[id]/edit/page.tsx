// Edit Skill page — Server Component.
// Fetches skill by ID; renders EditSkillForm.
// notFound() on 404 or 400 — skill not found or invalid UUID.
// Reference: governance/GD-M24-1.md — Decision 1, 3

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverFetch, ApiError } from '@/lib/api';
import { WorkforceShell } from '@/features/workforce/components/workforce-shell';
import { EditSkillForm } from '@/features/workforce/components/edit-skill-form';
import type { SkillDetailApiResponse } from '@/features/workforce/types';

type Props = { params: { id: string } };

export default async function EditSkillPage({ params }: Props) {
  let response: SkillDetailApiResponse;

  try {
    response = await serverFetch<SkillDetailApiResponse>(`/api/v1/skills/${params.id}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
      notFound();
    }
    throw err;
  }

  const skill = response.data;

  return (
    <WorkforceShell activeTab="skills" breadcrumb="Edit Skill">
      <div className="mb-6">
        <Link
          href="/workforce/skills"
          className="text-sm hover:underline"
          style={{ color: '#2563eb' }}
        >
          ← Skills
        </Link>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">
          Edit Skill — {skill.name}
        </h2>
      </div>

      <div className="max-w-lg">
        <EditSkillForm skill={skill} />
      </div>
    </WorkforceShell>
  );
}
