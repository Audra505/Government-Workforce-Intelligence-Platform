// Create Skill page — Server Component (no pre-fetch needed for this form).
// Reference: governance/GD-M24-1.md — Decision 1, 3

import Link from 'next/link';
import { WorkforceShell } from '@/features/workforce/components/workforce-shell';
import { CreateSkillForm } from '@/features/workforce/components/create-skill-form';

export default function NewSkillPage() {
  return (
    <WorkforceShell activeTab="skills" breadcrumb="New Skill">
      <div className="mb-6">
        <Link
          href="/workforce/skills"
          className="text-sm hover:underline"
          style={{ color: '#2563eb' }}
        >
          ← Skills
        </Link>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">Create Skill</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a skill to the catalog. Skills can then be assigned to employees.
        </p>
      </div>

      <div className="max-w-lg">
        <CreateSkillForm />
      </div>
    </WorkforceShell>
  );
}
